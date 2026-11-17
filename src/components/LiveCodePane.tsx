/**
 * Live File & Code Diff Streaming Pane
 *
 * Uses official CodeMirror 6 (`codemirror`, `@codemirror/view`, `@codemirror/state`)
 * and `@codemirror/merge` (`unifiedMergeView`) for real syntax-highlighted
 * inline green/red diff streaming as Builder Agent and parallel Fork Agents edit files.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { unifiedMergeView } from '@codemirror/merge'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { Code2, Diff, Eye, FileCode2, GitBranch } from 'lucide-react'
import { translations, type Lang } from '../i18n'
import type { FileSnapshot, SessionStateSnapshot } from '../../shared/types'

interface LiveCodePaneProps {
  lang: Lang
  snapshot: SessionStateSnapshot
  selectedFile: string | null
  selectedWorktree: 'main' | string
  autoFollow: boolean
  onSelectFile: (worktree: string, filePath: string) => void
  onToggleAutoFollow: () => void
  customCheckpointPatch?: { title: string; patch: string } | null
  onClearCheckpointPatch?: () => void
}

function languageExtensionFor(filePath: string): Extension {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return html()
  if (lower.endsWith('.css')) return css()
  if (lower.endsWith('.json')) return json()
  if (lower.endsWith('.md')) return markdown()
  return javascript({ jsx: true, typescript: lower.endsWith('.ts') || lower.endsWith('.tsx') })
}

export function LiveCodePane({
  lang,
  snapshot,
  selectedFile,
  selectedWorktree,
  autoFollow,
  onSelectFile,
  onToggleAutoFollow,
  customCheckpointPatch,
  onClearCheckpointPatch,
}: LiveCodePaneProps) {
  const t = translations[lang]
  const [viewMode, setViewMode] = useState<'diff' | 'code'>('diff')
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  const worktreeMap: Record<string, FileSnapshot> = useMemo(() => {
    if (selectedWorktree === 'main') return snapshot.files
    return snapshot.forkFiles[selectedWorktree] || snapshot.files
  }, [snapshot.files, snapshot.forkFiles, selectedWorktree])

  const fileList = useMemo(() => Object.values(worktreeMap).sort((a, b) => a.path.localeCompare(b.path)), [worktreeMap])

  const activeSnap: FileSnapshot | null = useMemo(() => {
    if (selectedFile && worktreeMap[selectedFile]) return worktreeMap[selectedFile]
    if (snapshot.observer.activeFile && worktreeMap[snapshot.observer.activeFile]) {
      return worktreeMap[snapshot.observer.activeFile]
    }
    return fileList[0] ?? null
  }, [selectedFile, worktreeMap, snapshot.observer.activeFile, fileList])

  const forkIdsWithFiles = useMemo(
    () => Object.keys(snapshot.forkFiles).filter((k) => Object.keys(snapshot.forkFiles[k] || {}).length > 0),
    [snapshot.forkFiles],
  )

  // Mount / update real CodeMirror 6 instance with @codemirror/merge unifiedMergeView
  useEffect(() => {
    const host = editorHostRef.current
    if (!host) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    if (customCheckpointPatch) {
      const state = EditorState.create({
        doc: customCheckpointPatch.patch || '// No file changes in root checkpoint',
        extensions: [
          lineNumbers(),
          oneDark,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      })
      viewRef.current = new EditorView({ state, parent: host })
      return
    }

    if (!activeSnap) return

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      oneDark,
      languageExtensionFor(activeSnap.path),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ]

    // Activate @codemirror/merge inline unified diff when file was modified (or created)
    if (
      viewMode === 'diff' &&
      activeSnap.previousContent !== activeSnap.content &&
      activeSnap.previousContent.length > 0
    ) {
      extensions.push(
        unifiedMergeView({
          original: activeSnap.previousContent,
          highlightChanges: true,
          gutter: true,
          syntaxHighlightDeletions: true,
          mergeControls: false,
        }),
      )
    }

    const state = EditorState.create({
      doc: activeSnap.content,
      extensions,
    })

    viewRef.current = new EditorView({ state, parent: host })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [activeSnap, viewMode, customCheckpointPatch])

  return (
    <section className="flex flex-col h-full min-h-0 bg-[#0b0e16] border-e border-slate-800/90">
      {/* Pane Header */}
      <div className="h-9 shrink-0 px-3 border-b border-slate-800/80 bg-[#0e131f] flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="font-semibold text-slate-200 truncate">{t.liveCodeHeader}</span>
          {activeSnap && !customCheckpointPatch && (
            <span dir="ltr" className="hidden sm:inline-flex items-center gap-1 font-mono text-[11px]">
              <span className="text-emerald-400">+{activeSnap.linesAdded}</span>
              <span className="text-rose-400">-{activeSnap.linesRemoved}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onToggleAutoFollow}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition cursor-pointer ${
              autoFollow
                ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span className="hidden xl:inline">{t.autoFollow}</span>
          </button>

          <div className="inline-flex rounded bg-slate-900 border border-slate-800 p-0.5">
            <button
              onClick={() => {
                onClearCheckpointPatch?.()
                setViewMode('diff')
              }}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium cursor-pointer ${
                viewMode === 'diff' && !customCheckpointPatch
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Diff className="w-3 h-3" />
              Diff
            </button>
            <button
              onClick={() => {
                onClearCheckpointPatch?.()
                setViewMode('code')
              }}
              className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium cursor-pointer ${
                viewMode === 'code' && !customCheckpointPatch
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Code
            </button>
          </div>
        </div>
      </div>

      {/* Worktree Selector Tabs (main + any fork patches) */}
      {forkIdsWithFiles.length > 0 && (
        <div
          dir="ltr"
          className="px-2.5 py-1 border-b border-slate-800/70 bg-[#0a0d15] flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono"
        >
          <button
            onClick={() => {
              onClearCheckpointPatch?.()
              const first = Object.keys(snapshot.files)[0]
              if (first) onSelectFile('main', first)
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer ${
              selectedWorktree === 'main'
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <GitBranch className="w-3 h-3" />
            main
          </button>
          {forkIdsWithFiles.map((fid) => (
            <button
              key={fid}
              onClick={() => {
                onClearCheckpointPatch?.()
                const first = Object.keys(snapshot.forkFiles[fid] || {})[0]
                if (first) onSelectFile(fid, first)
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer ${
                selectedWorktree === fid
                  ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              <GitBranch className="w-3 h-3" />
              fork/{fid}
            </button>
          ))}
        </div>
      )}

      {customCheckpointPatch && (
        <div className="px-3 py-1 bg-indigo-950/40 border-b border-indigo-500/30 flex items-center justify-between text-[11px]">
          <span className="text-indigo-200 truncate">{customCheckpointPatch.title}</span>
          <button
            onClick={onClearCheckpointPatch}
            className="text-indigo-300 hover:text-white underline cursor-pointer ms-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Body: File Tree + CodeMirror 6 Editor (Always LTR for code) */}
      <div dir="ltr" className="flex-1 min-h-0 flex overflow-hidden">
        {/* Compact File Sidebar */}
        <aside className="w-40 sm:w-44 shrink-0 border-r border-slate-800/80 bg-[#090c13] overflow-y-auto py-1.5">
          <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {selectedWorktree === 'main' ? 'main/' : `forks/${selectedWorktree}/`}
          </div>
          {fileList.length === 0 ? (
            <div className="px-2.5 py-4 text-[11px] text-slate-500">{t.noFilesYet}</div>
          ) : (
            fileList.map((f) => {
              const isSelected = activeSnap?.path === f.path && !customCheckpointPatch
              const isLiveCamera = snapshot.observer.activeFile === f.path && selectedWorktree === 'main'
              const wasMergedFromFork = f.touchCount > 1
              return (
                <button
                  key={f.path}
                  onClick={() => {
                    onClearCheckpointPatch?.()
                    onSelectFile(selectedWorktree, f.path)
                  }}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between gap-1 text-left text-[11.5px] font-mono transition cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/12 text-cyan-200 border-l-2 border-cyan-400'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border-l-2 border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0 truncate">
                    <FileCode2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isLiveCamera
                          ? 'text-violet-400'
                          : wasMergedFromFork
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                      }`}
                    />
                    <span className="truncate">{f.path}</span>
                  </span>
                  {wasMergedFromFork && (
                    <span
                      className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-300 shrink-0"
                      title={`Updated ${f.touchCount}×`}
                    >
                      v{f.touchCount}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </aside>

        {/* CodeMirror 6 Host */}
        <div className="flex-1 min-w-0 h-full overflow-hidden relative">
          {!activeSnap && !customCheckpointPatch ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-500 px-4 text-center">
              {t.noFilesYet}
            </div>
          ) : (
            <div ref={editorHostRef} className="h-full w-full overflow-auto" />
          )}
        </div>
      </div>
    </section>
  )
}
