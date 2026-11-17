import { AlertTriangle, CheckCircle2, Eye, GitFork, GitMerge, Terminal, Zap } from 'lucide-react'
import { translations, type Lang } from '../i18n'
import type { ObserverAlert, SessionStateSnapshot } from '../../shared/types'

interface ObserverStripProps {
  lang: Lang
  snapshot: SessionStateSnapshot
  onTriggerAlertFork: (alert: ObserverAlert) => void
  onSelectFork: (forkId: string) => void
}

export function ObserverStrip({
  lang,
  snapshot,
  onTriggerAlertFork,
  onSelectFork,
}: ObserverStripProps) {
  const t = translations[lang]
  const pct =
    snapshot.totalSteps > 0
      ? Math.min(100, Math.round((snapshot.completedSteps / snapshot.totalSteps) * 100))
      : 0

  const openAlert = snapshot.observer.alerts.find((a) => !a.resolved)
  const activeForks = snapshot.forks.filter((f) =>
    ['spawning', 'working', 'verifying', 'merging'].includes(f.status),
  )
  const recentMergedFork =
    activeForks.length === 0
      ? snapshot.forks.find((f) => f.status === 'merged' || f.status === 'conflict_resolved')
      : undefined

  return (
    <div className="shrink-0 border-b border-slate-800/80 bg-[#0b0f17]">
      {/* Dual/Triple Live Agent Track Strip */}
      <div className="px-3.5 py-2 grid grid-cols-1 lg:grid-cols-12 gap-2 items-center text-xs">
        {/* Track 1: Builder Agent */}
        <div className="lg:col-span-5 flex items-center gap-2.5 bg-slate-900/70 border border-slate-800/90 rounded-lg px-2.5 py-1.5 min-w-0">
          <div className="w-6 h-6 rounded-md bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-cyan-300 text-[11px]">{t.builderTitle}</span>
              <span dir="ltr" className="font-mono text-[10px] text-slate-400">
                {snapshot.completedSteps}/{snapshot.totalSteps} ({pct}%)
              </span>
            </div>
            <div className="truncate text-slate-200 text-[11.5px]">
              {lang === 'ar' ? snapshot.currentBuilderActionAr : snapshot.currentBuilderAction}
            </div>
            <div className="mt-1 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Track 2: Observer Director Agent */}
        <div
          className={`${
            activeForks.length > 0 || recentMergedFork ? 'lg:col-span-4' : 'lg:col-span-7'
          } flex items-center gap-2.5 bg-violet-950/20 border border-violet-500/25 rounded-lg px-2.5 py-1.5 min-w-0`}
        >
          <div className="w-6 h-6 rounded-md bg-violet-500/20 border border-violet-500/35 flex items-center justify-center shrink-0">
            <Eye className="w-3.5 h-3.5 text-violet-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-violet-300 text-[11px]">{t.observerTitle}</span>
              {snapshot.observer.activeFile && (
                <span
                  dir="ltr"
                  className="font-mono text-[10px] px-1.5 py-0 rounded bg-violet-500/15 text-violet-200 truncate max-w-[160px]"
                >
                  {snapshot.observer.activeFile}
                </span>
              )}
            </div>
            <div className="truncate text-slate-200 text-[11.5px]">
              {lang === 'ar' ? snapshot.observer.headlineAr : snapshot.observer.headline}
            </div>
          </div>
        </div>

        {/* Track 3: Active Fork Agent (or Latest Merged Badge) */}
        {activeForks.length > 0 && (
          <button
            onClick={() => onSelectFork(activeForks[0].id)}
            className="lg:col-span-3 flex items-center gap-2 bg-amber-950/30 hover:bg-amber-950/45 border border-amber-500/45 rounded-lg px-2.5 py-1.5 min-w-0 text-start transition cursor-pointer"
          >
            <div className="w-6 h-6 rounded-md bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
              <GitFork className="w-3.5 h-3.5 text-amber-300 animate-spin" style={{ animationDuration: '4s' }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span dir="ltr" className="font-mono font-semibold text-amber-300 text-[11px]">
                  {activeForks[0].branchName}
                </span>
                <span className="text-[10px] uppercase font-bold text-amber-200 bg-amber-500/20 px-1.5 rounded">
                  {activeForks[0].status}
                </span>
              </div>
              <div className="truncate text-amber-100 text-[11px]">
                {lang === 'ar' ? activeForks[0].currentActionAr : activeForks[0].currentAction}
              </div>
            </div>
          </button>
        )}

        {!activeForks.length && recentMergedFork && (
          <button
            onClick={() => onSelectFork(recentMergedFork.id)}
            className="lg:col-span-3 flex items-center gap-2 bg-emerald-950/25 hover:bg-emerald-950/40 border border-emerald-500/35 rounded-lg px-2.5 py-1.5 min-w-0 text-start transition cursor-pointer"
          >
            <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-400/35 flex items-center justify-center shrink-0">
              <GitMerge className="w-3.5 h-3.5 text-emerald-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span dir="ltr" className="font-mono font-semibold text-emerald-300 text-[11px]">
                  {recentMergedFork.branchName} → main
                </span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              </div>
              <div className="truncate text-emerald-100/90 text-[11px]">
                {lang === 'ar'
                  ? recentMergedFork.mergeSummaryAr || recentMergedFork.currentActionAr
                  : recentMergedFork.mergeSummary || recentMergedFork.currentAction}
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Observer Live Anomaly Alert Bar — 1-Click Parallel Fork & Fix! */}
      {openAlert && (
        <div className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-amber-500/10 border-t border-amber-500/30 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />
            <span className="font-semibold text-amber-200 truncate">
              {lang === 'ar' ? openAlert.titleAr : openAlert.title}
            </span>
          </div>
          <button
            onClick={() => onTriggerAlertFork(openAlert)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/25 transition cursor-pointer shrink-0"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            {t.forkAndFixNow}
          </button>
        </div>
      )}
    </div>
  )
}
