import { useState } from 'react'
import { Check, Cpu, Server, Terminal, X } from 'lucide-react'
import { translations, type Lang } from '../i18n'
import type { ExecutionMode, LLMProviderId, ProviderConfig } from '../../shared/types'

interface SettingsModalProps {
  lang: Lang
  current: Omit<ProviderConfig, 'apiKey'> & { hasApiKey: boolean }
  onSave: (next: Partial<ProviderConfig>) => Promise<void>
  onClose: () => void
}

const DEFAULT_MODELS: Record<LLMProviderId, { main: string; fast: string }> = {
  anthropic: { main: 'claude-sonnet-4-5', fast: 'claude-haiku-4-5' },
  openai: { main: 'gpt-4.1', fast: 'gpt-4.1-mini' },
  google: { main: 'gemini-2.5-pro', fast: 'gemini-2.5-flash' },
  openrouter: { main: 'anthropic/claude-sonnet-4.5', fast: 'anthropic/claude-haiku-4.5' },
  compatible: { main: 'qwen2.5-coder:14b', fast: 'qwen2.5-coder:7b' },
}

export function SettingsModal({ lang, current, onSave, onClose }: SettingsModalProps) {
  const t = translations[lang]
  const [mode, setMode] = useState<ExecutionMode>(current.mode)
  const [provider, setProvider] = useState<LLMProviderId>(current.provider)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(current.model)
  const [fastModel, setFastModel] = useState(current.fastModel || '')
  const [baseUrl, setBaseUrl] = useState(current.baseUrl || '')
  const [opencodeUrl, setOpencodeUrl] = useState(current.opencodeUrl || 'http://127.0.0.1:4096')
  const [saving, setSaving] = useState(false)

  const handleProviderChange = (p: LLMProviderId) => {
    setProvider(p)
    setModel(DEFAULT_MODELS[p].main)
    setFastModel(DEFAULT_MODELS[p].fast)
    if (p === 'openrouter') setBaseUrl('https://openrouter.ai/api/v1')
    else if (p === 'compatible') setBaseUrl('http://127.0.0.1:11434/v1')
    else setBaseUrl('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload: Partial<ProviderConfig> = {
        mode,
        provider,
        model,
        fastModel,
        baseUrl,
        opencodeUrl,
      }
      if (apiKey.trim()) payload.apiKey = apiKey.trim()
      await onSave(payload)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#0e131f] border border-slate-700/80 shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-sm text-white">{t.settingsTitle}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* 3 Real Engine Modes */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setMode('sandbox')}
              className={`p-2.5 rounded-xl border text-start transition cursor-pointer ${
                mode === 'sandbox'
                  ? 'bg-cyan-500/15 border-cyan-400 text-cyan-100'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <Terminal className="w-4 h-4 mb-1 text-cyan-400" />
              <div className="font-semibold text-[11.5px]">{t.modeSandbox}</div>
            </button>

            <button
              type="button"
              onClick={() => setMode('llm')}
              className={`p-2.5 rounded-xl border text-start transition cursor-pointer ${
                mode === 'llm'
                  ? 'bg-emerald-500/15 border-emerald-400 text-emerald-100'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <Cpu className="w-4 h-4 mb-1 text-emerald-400" />
              <div className="font-semibold text-[11.5px]">{t.modeLlm}</div>
            </button>

            <button
              type="button"
              onClick={() => setMode('opencode')}
              className={`p-2.5 rounded-xl border text-start transition cursor-pointer ${
                mode === 'opencode'
                  ? 'bg-violet-500/15 border-violet-400 text-violet-100'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <Server className="w-4 h-4 mb-1 text-violet-400" />
              <div className="font-semibold text-[11.5px]">{t.modeOpencode}</div>
            </button>
          </div>

          {mode === 'sandbox' && (
            <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-300 leading-relaxed">
              {lang === 'ar'
                ? 'يعمل فوراً بدون مفتاح API على مستودع Git حقيقي مع chokidar وGit Worktrees ودمج Mergiraf AST وبروتوكول AG-UI SSE لتجربة المنظومة الكاملة مباشرة.'
                : 'Runs immediately with zero API keys against a real Git repository, real chokidar watcher, real isolated Git Worktrees, Mergiraf AST merge, and AG-UI v1.0 SSE streaming.'}
            </div>
          )}

          {mode === 'llm' && (
            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">Provider (Vercel AI SDK v5)</label>
                <select
                  dir="ltr"
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as LLMProviderId)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT / Codex)</option>
                  <option value="google">Google (Gemini)</option>
                  <option value="openrouter">OpenRouter (All Models)</option>
                  <option value="compatible">Ollama / OpenAI-Compatible Local</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  API Key {current.hasApiKey ? '(✓ saved — enter new to replace)' : ''}
                </label>
                <input
                  dir="ltr"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider === 'compatible' ? 'ollama (optional)' : 'sk-...'}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-slate-400 mb-1">Builder Model</label>
                  <input
                    dir="ltr"
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Fork / Observer Fast Model</label>
                  <input
                    dir="ltr"
                    type="text"
                    value={fastModel}
                    onChange={(e) => setFastModel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                </div>
              </div>

              {(provider === 'openrouter' || provider === 'compatible' || baseUrl) && (
                <div>
                  <label className="block text-slate-400 mb-1">Base URL</label>
                  <input
                    dir="ltr"
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://127.0.0.1:11434/v1"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {mode === 'opencode' && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                {lang === 'ar'
                  ? 'شغّل `opencode serve --hostname 127.0.0.1 --port 4096` على الحاسوب نفسه الذي يعمل عليه ForkStream. عنوان 127.0.0.1 يُشير إلى جهاز الخادم، لا جهاز المتصفح؛ لذلك لا يصل إصدار Arena البعيد إلى OpenCode على حاسوبك.'
                  : 'Run `opencode serve --hostname 127.0.0.1 --port 4096` on the same computer as the ForkStream server. 127.0.0.1 means the server host, not your browser device; the remote Arena instance cannot reach OpenCode on your computer.'}
              </div>
              <div>
                <label className="block text-slate-400 mb-1">OpenCode Server URL</label>
                <input
                  dir="ltr"
                  type="text"
                  value={opencodeUrl}
                  onChange={(e) => setOpencodeUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Model (provider/model, optional)</label>
                <input
                  dir="ltr"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="anthropic/claude-sonnet-4-5"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                />
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              {t.saveSettings}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
