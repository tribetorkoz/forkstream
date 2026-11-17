import {
  GitFork,
  Languages,
  Pause,
  Play,
  Plus,
  Settings2,
  Sparkles,
  Cpu,
} from 'lucide-react'
import { translations, type Lang } from '../i18n'
import type { ExecutionMode, SessionStateSnapshot } from '../../shared/types'

interface TopBarProps {
  lang: Lang
  onToggleLang: () => void
  snapshot: SessionStateSnapshot | null
  connected: boolean
  eventCount: number
  mode: ExecutionMode
  mergirafVersion: string | null
  skillsCount: number
  onNewSession: () => void
  onTogglePause: () => void
  onChangeSpeed: (speed: number) => void
  onOpenSettings: () => void
  onOpenSkills: () => void
}

export function TopBar({
  lang,
  onToggleLang,
  snapshot,
  connected,
  eventCount,
  mode,
  mergirafVersion,
  skillsCount,
  onNewSession,
  onTogglePause,
  onChangeSpeed,
  onOpenSettings,
  onOpenSkills,
}: TopBarProps) {
  const t = translations[lang]
  const status = snapshot?.status ?? 'idle'
  const activeForks =
    snapshot?.forks.filter((f) => ['spawning', 'working', 'verifying', 'merging'].includes(f.status))
      .length ?? 0

  return (
    <header className="h-12 shrink-0 border-b border-slate-800/90 bg-[#0c1018]/95 backdrop-blur px-3.5 flex items-center justify-between gap-2 select-none">
      {/* Brand + Live Status */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={onNewSession}
          className="flex items-center gap-2 hover:opacity-90 transition cursor-pointer"
          title={t.tagline}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <GitFork className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white">{t.appName}</span>
        </button>

        {snapshot && (
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                status === 'running'
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                  : status === 'paused'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                    : status === 'completed'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  status === 'running'
                    ? 'bg-rose-400 animate-ping'
                    : status === 'paused'
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                }`}
              />
              {status === 'running'
                ? t.onAir
                : status === 'paused'
                  ? t.paused
                  : status === 'completed'
                    ? t.completed
                    : t.error}
            </span>

            {activeForks > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-400/40 animate-pulse">
                <GitFork className="w-3 h-3" />
                {activeForks} {t.forksActive}
              </span>
            )}

            <span
              dir="ltr"
              className="hidden xl:inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-cyan-400' : 'bg-slate-600'}`} />
              AG-UI SSE · {eventCount} ev
            </span>
          </div>
        )}

        {mergirafVersion && (
          <span
            dir="ltr"
            className="hidden lg:inline-flex items-center gap-1 text-[11px] font-mono text-emerald-300/90 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded"
            title={mergirafVersion}
          >
            ✓ {mergirafVersion}
          </span>
        )}
      </div>

      {/* Playback & Tooling Controls */}
      <div className="flex items-center gap-1.5">
        {snapshot && (status === 'running' || status === 'paused') && (
          <>
            <button
              onClick={onTogglePause}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              {status === 'paused' ? (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">{t.resume}</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">{t.pause}</span>
                </>
              )}
            </button>

            {snapshot.mode === 'sandbox' && (
              <select
                value={snapshot.speedMultiplier}
                onChange={(e) => onChangeSpeed(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1 cursor-pointer focus:outline-none focus:border-cyan-500"
              >
                <option value={0.5}>{t.speedSlow}</option>
                <option value={1}>{t.speedNormal}</option>
                <option value={2}>{t.speedFast}</option>
              </select>
            )}
          </>
        )}

        {snapshot && (
          <button
            onClick={onNewSession}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.newSession}</span>
          </button>
        )}

        <button
          onClick={onOpenSkills}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="hidden md:inline">{t.skills}</span>
          {skillsCount > 0 && (
            <span className="px-1.5 py-0 rounded-full text-[10px] font-bold bg-violet-500/25 text-violet-200">
              {skillsCount}
            </span>
          )}
        </button>

        <button
          onClick={onOpenSettings}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition cursor-pointer"
        >
          {mode === 'llm' ? (
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Settings2 className="w-3.5 h-3.5 text-cyan-400" />
          )}
          <span className="hidden md:inline">
            {mode === 'llm' ? t.modeLlm : mode === 'opencode' ? t.modeOpencode : t.settings}
          </span>
        </button>

        <button
          onClick={onToggleLang}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition cursor-pointer"
          title="Switch Language / تغيير اللغة"
        >
          <Languages className="w-3.5 h-3.5" />
          <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
        </button>
      </div>
    </header>
  )
}
