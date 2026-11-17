/**
 * Always-Active Mid-Execution Parallel Fork Command Bar
 *
 * Unlike traditional agent chat inputs that lock while the agent runs, this command bar
 * stays LIVE throughout execution. Submitting splits a parallel Fork Agent in a real
 * isolated `git worktree` (inheriting the Observer's exact focus file, checkpoint, and
 * clicked DOM element) while Builder Agent keeps running uninterrupted!
 */
import { useState } from 'react'
import { Crosshair, Eye, GitFork, Sparkles, X } from 'lucide-react'
import { translations, type Lang } from '../i18n'
import type {
  GitCheckpoint,
  ScenarioPreset,
  SelectedDomElement,
  SessionStateSnapshot,
} from '../../shared/types'

interface ForkCommandBarProps {
  lang: Lang
  snapshot: SessionStateSnapshot
  scenario?: ScenarioPreset
  selectedElement: SelectedDomElement | null
  onClearElement: () => void
  selectedForkBase: GitCheckpoint | null
  onClearForkBase: () => void
  onSubmitFork: (prompt: string) => Promise<void>
}

export function ForkCommandBar({
  lang,
  snapshot,
  scenario,
  selectedElement,
  onClearElement,
  selectedForkBase,
  onClearForkBase,
  onSubmitFork,
}: ForkCommandBarProps) {
  const t = translations[lang]
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSend = async (textOverride?: string) => {
    const finalPrompt = (textOverride ?? input).trim()
    if (!finalPrompt || submitting) return
    setSubmitting(true)
    try {
      await onSubmitFork(finalPrompt)
      if (!textOverride) setInput('')
    } finally {
      setSubmitting(false)
    }
  }

  const isRunning = snapshot.status === 'running'
  const latestCp = snapshot.checkpoints[snapshot.checkpoints.length - 1]
  const baseCp = selectedForkBase ?? latestCp

  return (
    <footer className="shrink-0 border-t border-slate-800 bg-[#0c111c] px-3.5 py-2 space-y-1.5">
      {/* Context Chips + Quick 1-Click Mid-Run Fork Pills */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {snapshot.observer.activeFile && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-200 border border-violet-500/30">
              <Eye className="w-3 h-3" />
              <span>{t.observerContextChip}</span>
              <code dir="ltr" className="font-mono text-[10.5px]">
                {snapshot.observer.activeFile}
              </code>
            </span>
          )}

          {baseCp && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                selectedForkBase
                  ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                  : 'bg-slate-900 text-slate-300 border-slate-700'
              }`}
            >
              <GitFork className="w-3 h-3 text-cyan-400" />
              <span>{t.checkpointChip}</span>
              <code dir="ltr" className="font-mono text-[10.5px]">
                {baseCp.shortHash}
              </code>
              {selectedForkBase && (
                <button onClick={onClearForkBase} className="hover:text-white cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          )}

          {selectedElement && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200 border border-cyan-400/50">
              <Crosshair className="w-3 h-3" />
              <span>{t.selectedElemChip}</span>
              <code dir="ltr" className="font-mono text-[10.5px]">
                {selectedElement.selector}
              </code>
              <button onClick={onClearElement} className="hover:text-white cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>

        {/* Contextual Quick Fork Suggestions */}
        {scenario && (
          <div className="flex items-center gap-1 overflow-x-auto max-w-full">
            <Sparkles className="w-3 h-3 text-amber-400 shrink-0 hidden sm:block" />
            {scenario.quickForkSuggestions.slice(0, 4).map((sug, idx) => (
              <button
                key={idx}
                disabled={submitting}
                onClick={() => handleSend(lang === 'ar' ? sug.promptAr : sug.prompt)}
                className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium border transition cursor-pointer shrink-0 ${
                  sug.category === 'bugfix'
                    ? 'bg-rose-500/12 hover:bg-rose-500/25 text-rose-200 border-rose-500/35'
                    : sug.category === 'design'
                      ? 'bg-emerald-500/12 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/35'
                      : 'bg-cyan-500/12 hover:bg-cyan-500/25 text-cyan-200 border-cyan-500/35'
                }`}
              >
                ⑂ {lang === 'ar' ? sug.labelAr : sug.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Fork Command Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSend()
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isRunning ? t.commandPlaceholderRunning : t.commandPlaceholderDone}
          className={`flex-1 bg-[#070a11] text-slate-100 placeholder:text-slate-500 text-xs sm:text-[13px] rounded-lg px-3.5 py-2 border transition focus:outline-none ${
            isRunning
              ? 'border-amber-500/40 focus:border-amber-400 shadow-[0_0_0_1px_rgba(245,158,11,0.12)]'
              : 'border-slate-700 focus:border-cyan-400'
          }`}
        />
        <button
          type="submit"
          disabled={!input.trim() || submitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 shadow-lg shadow-amber-500/20 transition cursor-pointer shrink-0"
        >
          <GitFork className="w-3.5 h-3.5" />
          <span>{submitting ? t.sendingFork : t.sendForkBtn}</span>
        </button>
      </form>
    </footer>
  )
}
