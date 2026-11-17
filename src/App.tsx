import { useCallback, useEffect, useState } from 'react'
import { Eye, GitFork, GitMerge, Play, Rocket, Sparkles, Terminal } from 'lucide-react'
import { translations, type Lang } from './i18n'
import { useAguiSession } from './hooks/useAguiSession'
import { TopBar } from './components/TopBar'
import { ObserverStrip } from './components/ObserverStrip'
import { LiveCodePane } from './components/LiveCodePane'
import { LivePreviewPane } from './components/LivePreviewPane'
import { ForkGraphPane } from './components/ForkGraphPane'
import { ForkCommandBar } from './components/ForkCommandBar'
import { SettingsModal } from './components/SettingsModal'
import type {
  DistilledSkill,
  GitCheckpoint,
  ObserverAlert,
  ProviderConfig,
  ScenarioPreset,
  SelectedDomElement,
} from '../shared/types'

interface SystemInfoResponse {
  tooling: {
    gitVersion: string
    mergirafPath: string | null
    mergirafVersion: string | null
  }
  provider: Omit<ProviderConfig, 'apiKey' | 'opencodePassword'> & {
    hasApiKey: boolean
    hasOpencodePassword: boolean
  }
  scenarios: ScenarioPreset[]
  skillsCount: number
}

export function App() {
  const [lang, setLang] = useState<Lang>('ar')
  const [sysInfo, setSysInfo] = useState<SystemInfoResponse | null>(null)
  const [authState, setAuthState] = useState<{ required: boolean; authenticated: boolean } | null>(null)
  const [ownerToken, setOwnerToken] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showSkillsModal, setShowSkillsModal] = useState(false)
  const [globalSkills, setGlobalSkills] = useState<DistilledSkill[]>([])

  // Synchronized Live Control Room state
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedWorktree, setSelectedWorktree] = useState<string>('main')
  const [autoFollow, setAutoFollow] = useState(true)
  const [dockTab, setDockTab] = useState<'graph' | 'activity' | 'skills' | 'git'>('graph')
  const [selectedElement, setSelectedElement] = useState<SelectedDomElement | null>(null)
  const [selectedForkBase, setSelectedForkBase] = useState<GitCheckpoint | null>(null)
  const [checkpointPatch, setCheckpointPatch] = useState<{ title: string; patch: string } | null>(
    null,
  )

  const { snapshot, setSnapshot, connected, eventCount, lastStreamedFile } =
    useAguiSession(sessionId)

  const t = translations[lang]

  useEffect(() => {
    let active = true
    void fetch('/api/auth/status', { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Authentication service unavailable')
        const data = await res.json() as { required: boolean; authenticated: boolean }
        if (active) setAuthState(data)
      })
      .catch(() => {
        if (active) setAuthState({ required: true, authenticated: false })
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
  }, [lang])

  const loadSystem = useCallback(async () => {
    try {
      const res = await fetch('/api/system')
      if (!res.ok) return
      const data = (await res.json()) as SystemInfoResponse
      if (!data?.tooling || !data?.provider || !Array.isArray(data.scenarios)) return
      setSysInfo(data)
    } catch {
      // retry silently
    }
  }, [])

  useEffect(() => {
    void loadSystem()
  }, [loadSystem])

  // Auto-follow Observer's live file camera unless user manually pinned a file
  useEffect(() => {
    if (!autoFollow || !lastStreamedFile) return
    setCheckpointPatch(null)
    setSelectedWorktree(lastStreamedFile.worktree)
    setSelectedFile(lastStreamedFile.path)
  }, [autoFollow, lastStreamedFile])

  // Switch back to `main` cleanly once a viewed fork merges
  useEffect(() => {
    if (!snapshot || selectedWorktree === 'main') return
    const f = snapshot.forks.find((x) => x.id === selectedWorktree)
    if (f && (f.status === 'merged' || f.status === 'conflict_resolved')) {
      setSelectedWorktree('main')
      if (f.filesModified[0]) setSelectedFile(f.filesModified[0])
    }
  }, [snapshot, selectedWorktree])

  const startSession = async (opts: { scenarioId?: string; prompt?: string }) => {
    if (launching) return
    setLaunching(true)
    try {
      setSelectedElement(null)
      setSelectedForkBase(null)
      setCheckpointPatch(null)
      setSelectedWorktree('main')
      setSelectedFile(null)
      setAutoFollow(true)
      setDockTab('graph')

      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      const data = await res.json()
      if (data.snapshot?.sessionId) {
        setSnapshot(data.snapshot)
        setSessionId(data.snapshot.sessionId)
      }
    } finally {
      setLaunching(false)
    }
  }

  const handleTogglePause = async () => {
    if (!snapshot) return
    const paused = snapshot.status === 'running'
    const res = await fetch(`/api/sessions/${encodeURIComponent(snapshot.sessionId)}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
    })
    const data = await res.json()
    if (data.snapshot) setSnapshot(data.snapshot)
  }

  const handleChangeSpeed = async (speedMultiplier: number) => {
    if (!snapshot) return
    const res = await fetch(`/api/sessions/${encodeURIComponent(snapshot.sessionId)}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speedMultiplier }),
    })
    const data = await res.json()
    if (data.snapshot) setSnapshot(data.snapshot)
  }

  const handleSpawnFork = async (prompt: string, fromCpId?: string) => {
    if (!snapshot) return
    await fetch(`/api/sessions/${encodeURIComponent(snapshot.sessionId)}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPrompt: prompt,
        fromCheckpointId: fromCpId ?? selectedForkBase?.id,
        selectedElement: selectedElement ?? undefined,
      }),
    })
    setSelectedElement(null)
    setSelectedForkBase(null)
  }

  const handleAlertFork = (alert: ObserverAlert) => {
    void handleSpawnFork(
      lang === 'ar' ? alert.suggestedFixPromptAr : alert.suggestedFixPrompt,
      alert.checkpointId,
    )
  }

  const handleSaveSettings = async (next: Partial<ProviderConfig>) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    await loadSystem()
  }

  const handleToggleSkill = async (skillId: string, enabled: boolean) => {
    await fetch(`/api/skills/${encodeURIComponent(skillId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    const res = await fetch('/api/skills')
    const data = await res.json()
    setGlobalSkills(data.skills || [])
    if (snapshot) {
      setSnapshot({ ...snapshot, skills: data.skills || [] })
    }
    await loadSystem()
  }

  const openSkillsView = async () => {
    if (snapshot) {
      setDockTab('skills')
      return
    }
    const res = await fetch('/api/skills')
    const data = await res.json()
    setGlobalSkills(data.skills || [])
    setShowSkillsModal(true)
  }

  const unlockServer = async (event: React.FormEvent) => {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ownerToken }),
      })
      if (!res.ok) throw new Error('رمز الدخول غير صحيح أو أصل الطلب غير مسموح')
      setOwnerToken('')
      setAuthState({ required: true, authenticated: true })
      await loadSystem()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'تعذّر فتح ForkStream')
    } finally {
      setAuthBusy(false)
    }
  }

  const activeScenario = sysInfo?.scenarios?.find((s) => s.id === snapshot?.scenarioId)
  const skillsCount = snapshot?.skills.length ?? sysInfo?.skillsCount ?? 0

  if (authState === null) {
    return <main className="h-screen grid place-items-center bg-[#090b10] text-slate-100">جارٍ التحقق من قفل ForkStream…</main>
  }
  if (authState.required && !authState.authenticated) {
    return (
      <main dir="rtl" className="h-screen grid place-items-center bg-[#090b10] text-slate-100 p-5">
        <form onSubmit={unlockServer} className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#101621] p-6 space-y-4 shadow-2xl">
          <div className="text-xs font-mono text-cyan-300">FORKSTREAM · OWNER LOCK</div>
          <h1 className="text-xl font-bold">افتح مساحة العمل المحلية</h1>
          <p className="text-sm leading-7 text-slate-400">أدخل رمز المالك الذي ظهر عند تشغيل الخادم. إذا كان محفوظاً مسبقاً، استخرجه محلياً بالأمر <code dir="ltr" className="text-cyan-200">npm run auth:token</code>. الرمز لا يُحفظ في المتصفح.</p>
          <input dir="ltr" type="password" autoComplete="one-time-code" value={ownerToken} onChange={(e) => setOwnerToken(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono" placeholder="Owner token" required />
          {authError && <p role="alert" className="text-sm text-rose-300">{authError}</p>}
          <button disabled={authBusy} className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">{authBusy ? 'جارٍ الفتح…' : 'فتح ForkStream'}</button>
        </form>
      </main>
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#090b10] text-slate-100">
      <TopBar
        lang={lang}
        onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
        snapshot={snapshot}
        connected={connected}
        eventCount={eventCount}
        mode={snapshot?.mode ?? sysInfo?.provider.mode ?? 'sandbox'}
        mergirafVersion={snapshot?.mergirafVersion ?? sysInfo?.tooling.mergirafVersion ?? null}
        skillsCount={skillsCount}
        onNewSession={() => setSessionId(null)}
        onTogglePause={handleTogglePause}
        onChangeSpeed={handleChangeSpeed}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSkills={openSkillsView}
      />

      {/* ── Launch Studio (when no active session) ─────────────────────────── */}
      {!snapshot ? (
        <main className="flex-1 overflow-y-auto px-4 py-8 sm:py-10">
          <div className="max-w-4xl mx-auto space-y-7">
            {/* Hero */}
            <div className="text-center space-y-3">
              <div
                dir="ltr"
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/25"
              >
                <span>AG-UI v1.0 SSE</span>
                <span>•</span>
                <span>chokidar + CodeMirror 6 Diff</span>
                <span>•</span>
                <span>Git Worktrees</span>
                <span>•</span>
                <span>{sysInfo?.tooling.mergirafVersion || 'Mergiraf AST'}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white max-w-2xl mx-auto leading-snug">
                {t.heroTitle}
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto leading-relaxed">
                {t.heroSubtitle}
              </p>
            </div>

            {/* 3-Actor Pipeline Pills */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/90 flex items-start gap-2.5">
                <Terminal className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-cyan-300 mb-0.5">{t.step1Badge}</div>
                  <div className="text-slate-400 text-[11.5px]">{t.step1Desc}</div>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/90 flex items-start gap-2.5">
                <Eye className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-violet-300 mb-0.5">{t.step2Badge}</div>
                  <div className="text-slate-400 text-[11.5px]">{t.step2Desc}</div>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/90 flex items-start gap-2.5">
                <GitMerge className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-emerald-300 mb-0.5">{t.step3Badge}</div>
                  <div className="text-slate-400 text-[11.5px]">{t.step3Desc}</div>
                </div>
              </div>
            </div>

            {/* Interactive Live Scenarios */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(sysInfo?.scenarios || []).map((sc) => (
                <div
                  key={sc.id}
                  className="p-5 rounded-2xl bg-gradient-to-b from-[#111827] to-[#0c111c] border border-slate-800 hover:border-cyan-500/50 transition flex flex-col justify-between gap-4 shadow-xl"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-base text-white">
                        {lang === 'ar' ? sc.nameAr : sc.name}
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        git worktree
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {lang === 'ar' ? sc.descriptionAr : sc.description}
                    </p>
                  </div>

                  <button
                    disabled={launching}
                    onClick={() =>
                      startSession({
                        scenarioId: sc.id,
                        prompt: lang === 'ar' ? sc.defaultPromptAr : sc.defaultPrompt,
                      })
                    }
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-slate-950 shadow-lg shadow-cyan-500/20 transition cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {t.startScenario}
                  </button>
                </div>
              ))}
            </div>

            {/* Custom Task Launcher (Works with Real LLM API, OpenCode, or Sandbox!) */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!customPrompt.trim()) return
                void startSession({ prompt: customPrompt.trim() })
              }}
              className="p-4 rounded-2xl bg-[#0d121d] border border-slate-800 space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <GitFork className="w-3.5 h-3.5 text-amber-400" />
                  {t.customPromptTitle}
                </span>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
                >
                  {sysInfo?.provider.mode === 'llm'
                    ? `✓ ${sysInfo.provider.provider} (${sysInfo.provider.model})`
                    : sysInfo?.provider.mode === 'opencode'
                      ? `✓ OpenCode (${sysInfo.provider.opencodeUrl})`
                      : lang === 'ar'
                        ? 'ربط مفتاح Claude / GPT / Gemini / OpenCode ←'
                        : 'Connect Claude / GPT / Gemini / OpenCode →'}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder={t.customPromptPlaceholder}
                  className="flex-1 bg-[#070a11] border border-slate-700 focus:border-cyan-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!customPrompt.trim() || launching}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white border border-slate-700 cursor-pointer shrink-0"
                >
                  <Rocket className="w-3.5 h-3.5 text-cyan-400" />
                  {t.launchCustom}
                </button>
              </div>
            </form>
          </div>
        </main>
      ) : (
        /* ── Active Live Broadcast Control Room ─────────────────────────── */
        <>
          <ObserverStrip
            lang={lang}
            snapshot={snapshot}
            onTriggerAlertFork={handleAlertFork}
            onSelectFork={(forkId) => {
              const forkMap = snapshot.forkFiles[forkId]
              if (forkMap && Object.keys(forkMap).length > 0) {
                setAutoFollow(false)
                setSelectedWorktree(forkId)
                setSelectedFile(Object.keys(forkMap)[0])
              } else {
                setDockTab('graph')
              }
            }}
          />

          {/* Center Split: Live Code & Diff Stream + Live Result Preview (with Fork PiP) */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
            <LiveCodePane
              lang={lang}
              snapshot={snapshot}
              selectedFile={selectedFile}
              selectedWorktree={selectedWorktree}
              autoFollow={autoFollow}
              onSelectFile={(wt, fp) => {
                setAutoFollow(false)
                setSelectedWorktree(wt)
                setSelectedFile(fp)
              }}
              onToggleAutoFollow={() => setAutoFollow((v) => !v)}
              customCheckpointPatch={checkpointPatch}
              onClearCheckpointPatch={() => setCheckpointPatch(null)}
            />

            <LivePreviewPane
              lang={lang}
              snapshot={snapshot}
              cameraSection={lastStreamedFile?.cameraSection ?? snapshot.observer.cameraSection}
              onElementPicked={(el) => setSelectedElement(el)}
            />
          </div>

          {/* Bottom Dock: Live React Flow Fork/Merge DAG + AG-UI Feed + SKILL.md + Real Git Log */}
          <ForkGraphPane
            lang={lang}
            snapshot={snapshot}
            activeTab={dockTab}
            onChangeTab={setDockTab}
            selectedForkBaseId={selectedForkBase?.id ?? null}
            onInspectCheckpoint={(cp) => {
              if (cp.diffPatch) {
                setAutoFollow(false)
                setCheckpointPatch({
                  title: `${cp.shortHash} — ${lang === 'ar' ? cp.titleAr : cp.title}`,
                  patch: cp.diffPatch,
                })
              }
            }}
            onPickForkBase={(cp) => setSelectedForkBase(cp)}
            onToggleSkill={handleToggleSkill}
          />

          {/* Always-Ready Mid-Execution Fork Command Bar */}
          <ForkCommandBar
            lang={lang}
            snapshot={snapshot}
            scenario={activeScenario}
            selectedElement={selectedElement}
            onClearElement={() => setSelectedElement(null)}
            selectedForkBase={selectedForkBase}
            onClearForkBase={() => setSelectedForkBase(null)}
            onSubmitFork={(p) => handleSpawnFork(p)}
          />
        </>
      )}

      {/* Settings Modal */}
      {showSettings && sysInfo && (
        <SettingsModal
          lang={lang}
          current={sysInfo.provider}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Standalone Skills Modal (from Launch Screen) */}
      {showSkillsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[#0e131f] border border-slate-700 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                {t.tabSkills}
              </h2>
              <button
                onClick={() => setShowSkillsModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="p-5 max-h-96 overflow-y-auto space-y-2.5 text-xs">
              {globalSkills.length === 0 ? (
                <p className="text-slate-400 leading-relaxed">{t.noSkillsYet}</p>
              ) : (
                globalSkills.map((sk) => (
                  <div
                    key={sk.id}
                    className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-300">
                        {lang === 'ar' ? sk.nameAr : sk.name}
                      </span>
                      <code dir="ltr" className="text-[10px] font-mono text-slate-500">
                        {sk.skillMdPath}
                      </code>
                    </div>
                    <p className="text-slate-300">{sk.decision}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
