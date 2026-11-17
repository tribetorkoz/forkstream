/**
 * Hybrid Observer / Live Director Agent (`ObserverAgent`)
 *
 * Combines three verified open-source patterns:
 *  1. Zero-token filesystem watcher (`chokidar` v5 + `kpdecker/jsdiff`) streaming sub-50ms unified diffs
 *     for both `main` and every active `fork/*` worktree (simple10/agents-observe & AgentWatch pattern).
 *  2. Capped 2,000-character rolling activity digest (Anthropic Observer sidecar architecture) so
 *     token usage stays tiny even on long sessions.
 *  3. Context-aware Fork Router + Runtime Sentinel (HiSentinel / VibeTrace): tracks exactly what file,
 *     section, checkpoint, and runtime error the user is watching, so when the user sends a mid-stream
 *     fix command without naming any file, Observer routes the Fork Agent to the exact right file & commit.
 */
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { createTwoFilesPatch, diffLines } from 'diff'
import { isSensitivePath, redactSecrets } from '../security/workspaceGuard.js'
import { openWorkspaceRoot } from '../security/workspaceFs.js'
import type {
  ConsoleTelemetryEntry,
  FileSnapshot,
  ObserverAlert,
  ObserverFocusState,
  SelectedDomElement,
} from '../../shared/types.js'

const MAX_DIGEST_CHARS = 2000

export interface ObserverFileEvent {
  worktree: 'main' | string
  snapshot: FileSnapshot
  cameraSection: string | null
}

export class ObserverAgent {
  private mainWatcher: FSWatcher | null = null
  private forkWatchers = new Map<string, FSWatcher>()
  private fileCache = new Map<string, string>() // key: `${worktree}:${relPath}`
  private touchCounts = new Map<string, number>()

  readonly state: ObserverFocusState = {
    status: 'idle',
    activeFile: null,
    activeWorktree: 'main',
    cameraSection: null,
    headline: 'Observer standing by — ready to stream live files, diffs & preview.',
    headlineAr: 'الوكيل المشاهد جاهز — يترقّب بدء العمل لبث الملفات والأكواد والنتيجة حياً.',
    latestCheckpointId: null,
    latestCommitHash: null,
    recentFiles: [],
    cappedDigest: '',
    alerts: [],
    previewVersion: 0,
    forkPreviewVersions: {},
  }

  constructor(
    private readonly onFileObserved: (ev: ObserverFileEvent) => void,
    private readonly onAlertRaised: (alert: ObserverAlert) => void,
  ) {}

  async startWatchingMain(mainDir: string): Promise<void> {
    this.state.status = 'watching'
    this.mainWatcher = this.createWatcher(mainDir, 'main')
  }

  async startWatchingFork(forkId: string, forkDir: string): Promise<void> {
    if (this.forkWatchers.has(forkId)) return
    // Pre-seed through the same rooted read boundary used for later watcher events.
    await this.seedBaselineCache(forkDir, forkId)
    const watcher = this.createWatcher(forkDir, forkId)
    this.forkWatchers.set(forkId, watcher)
  }

  async stopWatchingFork(forkId: string): Promise<void> {
    const w = this.forkWatchers.get(forkId)
    if (w) {
      this.forkWatchers.delete(forkId)
      await w.close().catch(() => {})
    }
  }

  async dispose(): Promise<void> {
    if (this.mainWatcher) {
      await this.mainWatcher.close().catch(() => {})
      this.mainWatcher = null
    }
    for (const [, w] of this.forkWatchers) {
      await w.close().catch(() => {})
    }
    this.forkWatchers.clear()
  }

  private async seedBaselineCache(rootDir: string, worktree: string): Promise<void> {
    const safeRoot = await openWorkspaceRoot(rootDir)
    const entries = safeRoot.walk('.', {
      symlinkPolicy: 'skip',
      maxDepth: 64,
      maxEntries: 50000,
      order: 'filesystem',
      limitBehavior: 'throw',
      entryFilter: (entry) => {
        const parts = entry.relativePath.split('/')
        if (parts.some((part) => part.startsWith('.') || part === 'node_modules')) return 'skip-subtree'
        if (isSensitivePath(entry.relativePath)) return 'skip-subtree'
        return entry.kind === 'directory' ? 'include' : entry.kind === 'file' ? 'include' : 'skip'
      },
    })
    for await (const entry of entries) {
      if (entry.kind !== 'file') continue
      try {
        this.fileCache.set(`${worktree}:${entry.relativePath}`, redactSecrets(await safeRoot.readText(entry.relativePath)))
      } catch {
        // A path that changes after enumeration is skipped; subsequent watcher events re-read safely.
      }
    }
  }

  private createWatcher(rootDir: string, worktree: 'main' | string): FSWatcher {
    const watcher = chokidar.watch(rootDir, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      ignored: (filePath: string) => {
        const rel = path.relative(rootDir, filePath)
        if (!rel) return false
        return rel.split(path.sep).some((seg) => seg.startsWith('.') || seg === 'node_modules') || isSensitivePath(rel)
      },
      awaitWriteFinish: {
        stabilityThreshold: 60,
        pollInterval: 25,
      },
    })

    const handleFile = async (absPath: string) => {
      try {
        const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/')
        if (!relPath || relPath.startsWith('.') || isSensitivePath(relPath)) return
        const safeRoot = await openWorkspaceRoot(rootDir)
        const content = await safeRoot.readText(relPath)
        this.recordFileMutation(worktree, relPath, content)
      } catch {
        // Ignore transient races, rejected links, oversized files, and disappearances.
      }
    }

    watcher.on('add', (filePath) => { void handleFile(filePath) })
    watcher.on('change', (filePath) => { void handleFile(filePath) })
    return watcher
  }

  /**
   * Synchronously usable by both `chokidar` events and explicit PostToolUse hooks
   * (deduplicates identical content automatically so hooks + FS watcher never double-emit).
   */
  recordFileMutation(
    worktree: 'main' | string,
    relPath: string,
    content: string,
    explicitSection?: string,
  ): FileSnapshot | null {
    if (isSensitivePath(relPath)) return null
    const cacheKey = `${worktree}:${relPath}`
    const safeContent = redactSecrets(content)
    const previousContent = this.fileCache.get(cacheKey) ?? ''
    if (previousContent === safeContent && this.fileCache.has(cacheKey)) {
      return null
    }
    this.fileCache.set(cacheKey, safeContent)

    const count = (this.touchCounts.get(cacheKey) ?? 0) + 1
    this.touchCounts.set(cacheKey, count)

    const diffPatch = createTwoFilesPatch(
      `a/${relPath}`,
      `b/${relPath}`,
      previousContent,
      safeContent,
      worktree === 'main' ? 'previous' : `fork-base (${worktree})`,
      worktree === 'main' ? 'live' : `fork-live (${worktree})`,
      { context: 3 },
    )

    let linesAdded = 0
    let linesRemoved = 0
    for (const part of diffLines(previousContent, safeContent)) {
      const c = part.count ?? 0
      if (part.added) linesAdded += c
      if (part.removed) linesRemoved += c
    }

    const snapshot: FileSnapshot = {
      path: relPath,
      content: safeContent,
      previousContent,
      diffPatch,
      linesAdded,
      linesRemoved,
      updatedAt: Date.now(),
      updatedBy: worktree === 'main' ? 'builder' : worktree,
      worktree,
      touchCount: count,
    }

    const cameraSection = explicitSection ?? this.inferPreviewSection(relPath, safeContent)

    if (worktree === 'main') {
      this.state.activeFile = relPath
      this.state.activeWorktree = 'main'
      if (cameraSection) this.state.cameraSection = cameraSection
      this.state.recentFiles = [relPath, ...this.state.recentFiles.filter((f) => f !== relPath)].slice(
        0,
        8,
      )
      this.state.previewVersion += 1
      this.state.headline = `Streaming ${relPath} (+${linesAdded}/-${linesRemoved})${cameraSection ? ` → focusing #${cameraSection}` : ''}`
      this.state.headlineAr = `يبث الآن الملف ${relPath} (+${linesAdded}/-${linesRemoved})${cameraSection ? ` ← توجيه المعاينة إلى قسم #${cameraSection}` : ''}`
    } else {
      this.state.forkPreviewVersions[worktree] = (this.state.forkPreviewVersions[worktree] ?? 0) + 1
    }

    // Append capped digest entry (Anthropic Observer 2,000-char ceiling)
    this.appendDigest(`[${worktree}] ${relPath} (+${linesAdded}/-${linesRemoved})`)

    // Static watchdog scan on Builder writes (catches suspicious bugs immediately!)
    if (worktree === 'main') {
      this.inspectCodeForAnomalies(relPath, safeContent)
    }

    this.onFileObserved({ worktree, snapshot, cameraSection })
    return snapshot
  }

  recordCheckpoint(checkpointId: string, commitHash: string, section?: string): void {
    this.state.latestCheckpointId = checkpointId
    this.state.latestCommitHash = commitHash
    if (section) this.state.cameraSection = section
    this.appendDigest(`[checkpoint ${commitHash.slice(0, 7)}]`)
  }

  recordConsoleTelemetry(entry: ConsoleTelemetryEntry): void {
    if (entry.level === 'error' || entry.level === 'warn') {
      this.appendDigest(`[runtime-${entry.level}:${entry.source}] ${entry.message.slice(0, 160)}`)
      if (entry.source === 'main' && entry.level === 'error') {
        const targetFile = entry.fileHint || this.state.activeFile || 'js/app.js'
        const alreadyOpen = this.state.alerts.some(
          (a) => !a.resolved && a.targetFile === targetFile && a.detail.includes(entry.message.slice(0, 40)),
        )
        if (!alreadyOpen) {
          this.raiseAlert({
            id: `alert_${Date.now().toString(36)}`,
            severity: 'error',
            title: `Runtime error detected in ${targetFile}`,
            titleAr: `رصد الوكيل المشاهد خطأ تشغيل حي في ${targetFile}`,
            detail: entry.message,
            detailAr: `رسالة الخطأ في المعاينة الحية: ${entry.message}`,
            targetFile,
            checkpointId: this.state.latestCheckpointId || 'cp_0',
            suggestedFixPrompt: `Fix the runtime error in ${targetFile}: ${entry.message}`,
            suggestedFixPromptAr: `أصلح خطأ التشغيل في ${targetFile}: ${entry.message}`,
            resolved: false,
            timestamp: Date.now(),
          })
        }
      }
    }
  }

  markAlertsResolvedForFiles(files: string[]): void {
    const set = new Set(files)
    let anyUnresolved = false
    for (const alert of this.state.alerts) {
      if (set.has(alert.targetFile)) {
        alert.resolved = true
      }
      if (!alert.resolved) anyUnresolved = true
    }
    if (!anyUnresolved && this.state.status === 'alerting') {
      this.state.status = 'watching'
    }
  }

  raiseAlert(alert: ObserverAlert): void {
    this.state.alerts = [alert, ...this.state.alerts].slice(0, 10)
    this.state.status = 'alerting'
    this.onAlertRaised(alert)
  }

  /**
   * Smart Fork Context Router:
   * Resolves WHICH file(s) a Fork Agent should inspect/modify based on:
   *  1. Explicit filename in user prompt (if any)
   *  2. Selected DOM element from Live Preview Inspector (if user clicked an element)
   *  3. Semantic intent matching (colors/theme -> CSS, cart/discount/price -> cart.js, search/filter/hero -> HTML+JS, chart/kpi -> analytics.js)
   *  4. Fallback to the exact file Observer was streaming on screen when the user intervened!
   */
  resolveTargetFilesForFork(
    userPrompt: string,
    availableFiles: string[],
    selectedElement?: SelectedDomElement,
  ): string[] {
    const lower = userPrompt.toLowerCase()
    const matched = new Set<string>()

    // 1. Direct filename mention
    for (const f of availableFiles) {
      const base = path.basename(f).toLowerCase()
      if (lower.includes(f.toLowerCase()) || lower.includes(base)) {
        matched.add(f)
      }
    }

    // 2. Selected DOM element hint
    if (selectedElement?.inferredFile && availableFiles.includes(selectedElement.inferredFile)) {
      matched.add(selectedElement.inferredFile)
    }

    // 3. Intent-based file routing (Arabic + English)
    const isStyleIntent =
      /لون|ألوان|الوان|ثيم|داكن|فاتح|أخضر|اخضر|ذهبي|أحمر|احمر|وردي|أزرق|ازرق|بنفسجي|خط|تصميم|بطاق|ظل|زوايا|colou?r|theme|dark|light|emerald|green|gold|amber|rose|pink|blue|font|style|css|card|gradient|border|radius/i.test(
        userPrompt,
      )
    const isCartOrBugIntent =
      /خصم|سلة|حساب|سعر|أسعار|اسعار|ضريب|خطأ|خطا|أصلح|اصلح|إصلاح|اصلاح|مجموع|discount|cart|price|calc|bug|fix|error|total|promo|coupon|checkout|math/i.test(
        userPrompt,
      )
    const isSearchOrUiIntent =
      /بحث|فلتر|تصفية|زر|شريط|عنوان|هيدر|بانر|إعلان|اعلان|عملة|تصدير|إضافة|اضافة|أضف|اضف|أيقون|search|filter|button|navbar|header|hero|title|banner|currency|export|csv|add|modal|badge/i.test(
        userPrompt,
      )
    const isAnalyticsIntent =
      /إحصائ|احصائ|رسم|بياني|مخطط|تقرير|نسب|مؤشر|chart|stat|analytic|metric|kpi|graph|revenue/i.test(
        userPrompt,
      )

    if (isStyleIntent) {
      availableFiles.filter((f) => f.endsWith('.css')).forEach((f) => matched.add(f))
    }
    if (isCartOrBugIntent) {
      availableFiles
        .filter((f) => /cart|calc|logic|store|task|app/i.test(f) && f.endsWith('.js'))
        .forEach((f) => matched.add(f))
      // Also check open alert target files
      this.state.alerts
        .filter((a) => !a.resolved)
        .forEach((a) => {
          if (availableFiles.includes(a.targetFile)) matched.add(a.targetFile)
        })
    }
    if (isSearchOrUiIntent) {
      availableFiles
        .filter((f) => f.endsWith('.html') || /app\.js$|ui\.js$|data\.js$/i.test(f))
        .forEach((f) => matched.add(f))
    }
    if (isAnalyticsIntent) {
      availableFiles
        .filter((f) => /analytic|chart|stat|kpi|metrics/i.test(f))
        .forEach((f) => matched.add(f))
    }

    // 4. Fallback to live Observer camera focus file
    if (matched.size === 0) {
      if (this.state.activeFile && availableFiles.includes(this.state.activeFile)) {
        matched.add(this.state.activeFile)
      }
      if (availableFiles.includes('index.html')) {
        matched.add('index.html')
      }
    }

    return Array.from(matched).slice(0, 4)
  }

  private inspectCodeForAnomalies(relPath: string, content: string): void {
    // Detect inverted discount multiplier bug (e.g., `subtotal * (1 + discountRate)` instead of `1 - discountRate`)
    if (
      relPath.endsWith('.js') &&
      /subtotal\s*\*\s*\(\s*1\s*\+\s*discountRate\s*\)/.test(content)
    ) {
      const already = this.state.alerts.some((a) => a.targetFile === relPath && !a.resolved)
      if (!already) {
        this.raiseAlert({
          id: `alert_${Date.now().toString(36)}`,
          severity: 'warning',
          title: `Logic bug spotted in ${relPath}: discount ADDS +20% instead of subtracting!`,
          titleAr: `تنبيه من الوكيل المشاهد في ${relPath}: دالة الخصم تُضيف +20% للسعر بدلاً من خصمها!`,
          detail:
            'Line computes `subtotal * (1 + discountRate)` which overcharges customers when applying a coupon.',
          detailAr:
            'السطر يحسب `subtotal * (1 + discountRate)` مما يرفع الفاتورة عند تفعيل كود الخصم! يمكنك شطر الوكيل لإصلاحها فوراً بينما يكمل الوكيل الأول عمله.',
          targetFile: relPath,
          checkpointId: this.state.latestCheckpointId || 'cp_0',
          suggestedFixPrompt:
            'Fix the discount bug in js/cart.js so applying the coupon subtracts 20% (1 - discountRate) instead of adding it',
          suggestedFixPromptAr:
            'أصلح خطأ حساب الخصم في js/cart.js ليخصم 20% من المجموع بدلاً من إضافتها',
          resolved: false,
          timestamp: Date.now(),
        })
      }
    }

    // Detect inverted SLA/growth percentage bug in analytics dashboard scenario
    if (
      relPath.endsWith('.js') &&
      /const\s+conversionRate\s*=\s*\(\(totalRevenue\s*\/\s*visitors\)\s*\*\s*100\)/.test(content)
    ) {
      const already = this.state.alerts.some((a) => a.targetFile === relPath && !a.resolved)
      if (!already) {
        this.raiseAlert({
          id: `alert_${Date.now().toString(36)}`,
          severity: 'warning',
          title: `Formula bug spotted in ${relPath}: conversionRate divides revenue instead of conversions!`,
          titleAr: `تنبيه من الوكيل المشاهد في ${relPath}: معادلة معدل التحويل تقسم الإيرادات بدلاً من عدد الطلبات (تظهر >400%)!`,
          detail:
            'conversionRate uses totalRevenue / visitors instead of conversions / visitors, producing an impossible >400% rate.',
          detailAr:
            'المعادلة تستخدم `totalRevenue / visitors` بدلاً من `conversions / visitors` مما يعطي نسبة مستحيلة فوق 400%! اشطر الوكيل لإصلاحها فوراً.',
          targetFile: relPath,
          checkpointId: this.state.latestCheckpointId || 'cp_0',
          suggestedFixPrompt:
            'Fix conversionRate formula in js/metrics.js to divide conversions by visitors instead of totalRevenue',
          suggestedFixPromptAr:
            'أصلح معادلة معدل التحويل في js/metrics.js لتقسم عدد التحويلات على الزوار بدلاً من الإيرادات',
          resolved: false,
          timestamp: Date.now(),
        })
      }
    }
  }

  private inferPreviewSection(relPath: string, content: string): string | null {
    if (/cart/i.test(relPath)) return 'cart-section'
    if (/analytic|chart|metric/i.test(relPath)) return 'analytics-section'
    if (/catalog|product|data/i.test(relPath)) return 'catalog-section'
    if (/hero|header/i.test(relPath)) return 'hero-section'
    if (/token|style|theme/i.test(relPath)) return 'hero-section'
    const secMatch = content.match(/data-section="([^"]+)"/)
    return secMatch ? secMatch[1] : null
  }

  private appendDigest(line: string): void {
    const next = this.state.cappedDigest ? `${this.state.cappedDigest}\n${line}` : line
    this.state.cappedDigest =
      next.length > MAX_DIGEST_CHARS ? next.slice(next.length - MAX_DIGEST_CHARS) : next
  }
}
