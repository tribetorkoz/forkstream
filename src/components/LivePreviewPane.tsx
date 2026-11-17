/**
 * Live Result Preview + Picture-in-Picture (PiP) Isolated Fork Preview + DOM Element Inspector
 *
 * Streams the live rendered web application directly from the `main` Git worktree,
 * auto-focuses newly modified sections via Observer camera postMessage, lets the user
 * click ANY DOM element to launch a targeted parallel Fork, and automatically opens a
 * live Picture-in-Picture preview of any active `fork/*` worktree before AST merge!
 */
import { useEffect, useRef, useState } from 'react'
import {
  Columns2,
  Crosshair,
  GitFork,
  MonitorPlay,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react'
import { translations, type Lang } from '../i18n'
import type { SelectedDomElement, SessionStateSnapshot } from '../../shared/types'

interface LivePreviewPaneProps {
  lang: Lang
  snapshot: SessionStateSnapshot
  cameraSection: string | null
  onElementPicked: (el: SelectedDomElement) => void
}

export function LivePreviewPane({
  lang,
  snapshot,
  cameraSection,
  onElementPicked,
}: LivePreviewPaneProps) {
  const t = translations[lang]
  const mainIframeRef = useRef<HTMLIFrameElement | null>(null)
  const forkIframeRef = useRef<HTMLIFrameElement | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [splitCompare, setSplitCompare] = useState(false)
  const [showConsole, setShowConsole] = useState(false)
  const [manualReload, setManualReload] = useState(0)

  const liveFork = snapshot.forks.find((f) =>
    ['working', 'verifying', 'merging'].includes(f.status),
  )
  const forkVersion = liveFork ? snapshot.observer.forkPreviewVersions[liveFork.id] ?? 0 : 0

  const mainSrc = `${snapshot.previewUrl}?v=${snapshot.observer.previewVersion}_${manualReload}`
  const forkSrc = liveFork ? `${liveFork.previewUrl}?v=${forkVersion}` : null

  // Preview documents run in opaque-origin sandboxed frames. Accept bridge messages
  // only from the active frames, and relay telemetry through this authenticated parent.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'null' || !e.data || typeof e.data !== 'object') return
      let expectedSource: string | null = null
      if (e.source === mainIframeRef.current?.contentWindow) expectedSource = 'main'
      else if (liveFork && e.source === forkIframeRef.current?.contentWindow) expectedSource = liveFork.id
      if (!expectedSource) return

      const data = e.data as Record<string, unknown>
      if (data.sessionId !== snapshot.sessionId || data.source !== expectedSource) return
      if (data.type === 'FORKSTREAM_ELEMENT_SELECTED' && data.element && typeof data.element === 'object') {
        const element = data.element as Partial<SelectedDomElement>
        if (typeof element.selector !== 'string' || element.selector.length > 256 ||
            typeof element.tagName !== 'string' || element.tagName.length > 32 ||
            typeof element.textSnippet !== 'string' || element.textSnippet.length > 160 ||
            (element.sectionId !== undefined && (typeof element.sectionId !== 'string' || element.sectionId.length > 128)) ||
            (element.inferredFile !== undefined && (typeof element.inferredFile !== 'string' || element.inferredFile.length > 512))) return
        setInspecting(false)
        onElementPicked(element as SelectedDomElement)
        return
      }
      if (data.type === 'FORKSTREAM_CONSOLE') {
        const levels = ['log', 'info', 'warn', 'error']
        if (!levels.includes(String(data.level)) || typeof data.message !== 'string') return
        void fetch(`/api/sessions/${encodeURIComponent(snapshot.sessionId)}/telemetry`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            level: data.level,
            message: data.message.slice(0, 600),
            source: expectedSource,
            fileHint: typeof data.fileHint === 'string' ? data.fileHint.slice(0, 180) : undefined,
          }),
        }).catch(() => {})
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [liveFork?.id, onElementPicked, snapshot.sessionId])

  // Direct preview camera smoothly when Observer switches section
  useEffect(() => {
    if (!cameraSection || !mainIframeRef.current?.contentWindow) return
    const timer = setTimeout(() => {
      mainIframeRef.current?.contentWindow?.postMessage(
        { type: 'FORKSTREAM_FOCUS_SECTION', section: cameraSection },
        '*',
      )
    }, 220)
    return () => clearTimeout(timer)
  }, [cameraSection, snapshot.observer.previewVersion])

  const toggleInspect = () => {
    const next = !inspecting
    setInspecting(next)
    mainIframeRef.current?.contentWindow?.postMessage(
      { type: 'FORKSTREAM_SET_INSPECT', enabled: next },
      '*',
    )
  }

  const latestCp = snapshot.checkpoints[snapshot.checkpoints.length - 1]
  const warnCount = snapshot.consoleLogs.filter((c) => c.level === 'error' || c.level === 'warn').length

  return (
    <section className="flex flex-col h-full min-h-0 bg-[#0b0e16]">
      {/* Preview Toolbar */}
      <div className="h-9 shrink-0 px-3 border-b border-slate-800/80 bg-[#0e131f] flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <MonitorPlay className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="font-semibold text-slate-200 truncate">{t.livePreviewHeader}</span>
          {latestCp && (
            <span
              dir="ltr"
              className="hidden sm:inline-block font-mono text-[10.5px] px-1.5 py-0 rounded bg-slate-900 text-slate-400 border border-slate-800"
            >
              main@{latestCp.shortHash}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleInspect}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition cursor-pointer ${
              inspecting
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-semibold animate-pulse'
                : 'bg-slate-900 text-cyan-300 border-slate-700 hover:border-cyan-500/60'
            }`}
            title={t.inspectElement}
          >
            <Crosshair className="w-3 h-3" />
            <span className="hidden md:inline">
              {inspecting ? t.inspectingActive : t.inspectElement}
            </span>
          </button>

          {liveFork && (
            <button
              onClick={() => setSplitCompare((s) => !s)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
                splitCompare
                  ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                  : 'bg-slate-900 text-amber-300 border-slate-700'
              }`}
              title={t.splitCompare}
            >
              <Columns2 className="w-3 h-3" />
            </button>
          )}

          <button
            onClick={() => setShowConsole((s) => !s)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
              showConsole
                ? 'bg-slate-700 text-white border-slate-600'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={t.consoleTitle}
          >
            <TerminalSquare className="w-3 h-3" />
            {warnCount > 0 && (
              <span className="text-[10px] font-bold text-amber-300">{warnCount}</span>
            )}
          </button>

          <button
            onClick={() => setManualReload((n) => n + 1)}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 cursor-pointer"
            title={t.reloadPreview}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Live Preview Viewport (+ Side-by-Side or Floating PiP Fork Preview) */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden bg-[#070a11]">
        <div className={`h-full ${liveFork && splitCompare ? 'w-1/2 border-e border-amber-500/40' : 'w-full'} relative`}>
          <iframe
            ref={mainIframeRef}
            src={mainSrc}
            title="Main Worktree Live Preview"
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-[#090d16]"
            onLoad={() => {
              if (inspecting) {
                mainIframeRef.current?.contentWindow?.postMessage(
                  { type: 'FORKSTREAM_SET_INSPECT', enabled: true },
                  '*',
                )
              }
            }}
          />
        </div>

        {/* Side-by-Side Fork Worktree Preview */}
        {liveFork && forkSrc && splitCompare && (
          <div className="w-1/2 h-full flex flex-col bg-[#090d16]">
            <div className="px-2.5 py-1 bg-amber-950/60 border-b border-amber-500/40 flex items-center justify-between text-[11px] text-amber-200">
              <span className="flex items-center gap-1 font-semibold">
                <GitFork className="w-3 h-3" />
                {t.pipTitle} ({liveFork.branchName})
              </span>
              <span className="uppercase font-mono text-[10px]">{liveFork.status}</span>
            </div>
            <iframe
              ref={forkIframeRef}
              src={forkSrc}
              title="Fork Worktree Live Preview"
              sandbox="allow-scripts"
              className="flex-1 w-full border-0"
            />
          </div>
        )}

        {/* Floating Picture-in-Picture (PiP) Fork Preview while Fork works in parallel! */}
        {liveFork && forkSrc && !splitCompare && (
          <div className="absolute bottom-3 end-3 w-64 sm:w-72 h-44 rounded-xl overflow-hidden border-2 border-amber-400/70 bg-[#0c1018] shadow-2xl shadow-black/70 flex flex-col z-20">
            <div className="px-2.5 py-1 bg-amber-500/20 border-b border-amber-400/40 flex items-center justify-between text-[10.5px] text-amber-200">
              <span className="flex items-center gap-1 font-semibold truncate">
                <GitFork className="w-3 h-3 shrink-0" />
                <span dir="ltr" className="font-mono">
                  {liveFork.branchName}
                </span>
              </span>
              <button
                onClick={() => setSplitCompare(true)}
                className="text-[10px] px-1.5 rounded bg-amber-400/20 hover:bg-amber-400/35 text-amber-100 cursor-pointer"
              >
                ⤢
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden bg-[#090d16]">
              <iframe
                ref={forkIframeRef}
                src={forkSrc}
                title="Fork PiP Preview"
                sandbox="allow-scripts"
                className="w-[200%] h-[200%] origin-top-left scale-50 border-0 pointer-events-none"
                style={{ transformOrigin: lang === 'ar' ? 'top right' : 'top left' }}
              />
            </div>
            <div className="px-2 py-0.5 bg-slate-950/90 text-[10px] text-amber-200/90 truncate">
              {lang === 'ar' ? liveFork.currentActionAr : liveFork.currentAction}
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Live Runtime Console */}
      {showConsole && (
        <div
          dir="ltr"
          className="h-28 shrink-0 border-t border-slate-800 bg-[#07090f] overflow-y-auto p-2 font-mono text-[11px] space-y-1"
        >
          {snapshot.consoleLogs.length === 0 ? (
            <div className="text-slate-500">No runtime console messages yet.</div>
          ) : (
            snapshot.consoleLogs.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-start gap-2 ${
                  entry.level === 'error'
                    ? 'text-rose-400'
                    : entry.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-slate-300'
                }`}
              >
                <span className="text-slate-600 shrink-0">[{entry.source}]</span>
                <span className="break-all">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
