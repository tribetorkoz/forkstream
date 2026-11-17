/**
 * Interactive Execution, Fork & Merge DAG (`@xyflow/react` v12) + AG-UI Feed + Skills + Real Git Log
 *
 * Visualizes Builder's main checkpoint trunk, every parallel isolated `git worktree` Fork branch,
 * and every 2-parent Mergiraf AST merge commit. Clicking any checkpoint inspects its real Git diff
 * or selects it as a Time-Travel Fork base (LangGraph / VibeTrace paradigm).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  Activity,
  FileText,
  GitCommitHorizontal,
  GitFork,
  GitMerge,
  Network,
  Sparkles,
} from 'lucide-react'
import { translations, type Lang } from '../i18n'
import type { DistilledSkill, GitCheckpoint, SessionStateSnapshot } from '../../shared/types'

interface CheckpointNodeData extends Record<string, unknown> {
  cp: GitCheckpoint
  lang: Lang
  isSelected: boolean
  onInspect: (cp: GitCheckpoint) => void
  onPickForkBase: (cp: GitCheckpoint) => void
}

function CheckpointNode({ data }: NodeProps<Node<CheckpointNodeData>>) {
  const { cp, lang, isSelected, onInspect, onPickForkBase } = data
  const isFork = cp.agentRole === 'fork'
  const isMerge = cp.agentRole === 'merge'

  const palette = isFork
    ? 'border-amber-500/70 bg-amber-950/50 text-amber-100'
    : isMerge
      ? 'border-emerald-500/70 bg-emerald-950/50 text-emerald-100'
      : 'border-cyan-500/45 bg-slate-900/95 text-slate-100'

  return (
    <div
      onClick={() => onInspect(cp)}
      className={`w-48 rounded-lg border px-2.5 py-1.5 shadow-lg transition cursor-pointer ${palette} ${
        isSelected ? 'ring-2 ring-white/80 scale-[1.02]' : 'hover:brightness-110'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-slate-400" />
      <div className="flex items-center justify-between gap-1 text-[10px] font-mono mb-0.5">
        <span className="inline-flex items-center gap-1 font-semibold">
          {isFork ? (
            <GitFork className="w-3 h-3 text-amber-400" />
          ) : isMerge ? (
            <GitMerge className="w-3 h-3 text-emerald-400" />
          ) : (
            <GitCommitHorizontal className="w-3 h-3 text-cyan-400" />
          )}
          {cp.shortHash}
        </span>
        {(cp.linesAdded > 0 || cp.linesRemoved > 0) && (
          <span>
            <span className="text-emerald-400">+{cp.linesAdded}</span>{' '}
            <span className="text-rose-400">-{cp.linesRemoved}</span>
          </span>
        )}
      </div>
      <div className="text-[11px] font-medium truncate leading-snug">
        {lang === 'ar' ? cp.titleAr : cp.title}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="text-[9.5px] font-mono text-slate-400 truncate">
          {cp.filesChanged[0] || 'init'}
        </span>
        {cp.agentRole !== 'fork' && cp.stepIndex > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPickForkBase(cp)
            }}
            className="text-[9.5px] px-1.5 py-0 rounded bg-white/10 hover:bg-cyan-500/30 text-cyan-200 cursor-pointer shrink-0"
            title={translations[lang].forkFromHere}
          >
            ⑂ Fork
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-slate-400" />
    </div>
  )
}

const nodeTypes = { checkpoint: CheckpointNode }

interface ForkGraphPaneProps {
  lang: Lang
  snapshot: SessionStateSnapshot
  activeTab: 'graph' | 'activity' | 'skills' | 'git'
  onChangeTab: (tab: 'graph' | 'activity' | 'skills' | 'git') => void
  selectedForkBaseId: string | null
  onInspectCheckpoint: (cp: GitCheckpoint) => void
  onPickForkBase: (cp: GitCheckpoint) => void
  onToggleSkill: (skillId: string, enabled: boolean) => void
}

export function ForkGraphPane({
  lang,
  snapshot,
  activeTab,
  onChangeTab,
  selectedForkBaseId,
  onInspectCheckpoint,
  onPickForkBase,
  onToggleSkill,
}: ForkGraphPaneProps) {
  const t = translations[lang]
  const [gitCommits, setGitCommits] = useState<
    Array<{ hash: string; shortHash: string; parents: string[]; subject: string }>
  >([])
  const [selectedSkill, setSelectedSkill] = useState<DistilledSkill | null>(null)

  useEffect(() => {
    if (activeTab !== 'git') return
    fetch(`/api/sessions/${encodeURIComponent(snapshot.sessionId)}/git-log`)
      .then((r) => r.json())
      .then((d) => setGitCommits(d.commits || []))
      .catch(() => {})
  }, [activeTab, snapshot.sessionId, snapshot.checkpoints.length])

  // Build clean horizontal DAG layout: main trunk at y=22, fork lanes at y=118, 200...
  const { nodes, edges } = useMemo(() => {
    const builtNodes: Node<CheckpointNodeData>[] = []
    const builtEdges: Edge[] = []
    const xByCp = new Map<string, number>()

    let mainIndex = 0
    let forkLane = 0

    for (const cp of snapshot.checkpoints) {
      if (cp.agentRole === 'builder' || cp.agentRole === 'merge') {
        const x = 24 + mainIndex * 228
        xByCp.set(cp.id, x)
        mainIndex += 1
        builtNodes.push({
          id: cp.id,
          type: 'checkpoint',
          position: { x, y: 18 },
          data: {
            cp,
            lang,
            isSelected: selectedForkBaseId === cp.id,
            onInspect: onInspectCheckpoint,
            onPickForkBase,
          },
        })
      } else {
        // Fork checkpoint branches below its base checkpoint!
        const baseX = (cp.parentCheckpointId ? xByCp.get(cp.parentCheckpointId) : undefined) ?? 200
        const x = baseX + 114
        const y = 108 + (forkLane % 2) * 76
        forkLane += 1
        xByCp.set(cp.id, x)
        builtNodes.push({
          id: cp.id,
          type: 'checkpoint',
          position: { x, y },
          data: {
            cp,
            lang,
            isSelected: selectedForkBaseId === cp.id,
            onInspect: onInspectCheckpoint,
            onPickForkBase,
          },
        })
      }

      if (cp.parentCheckpointId) {
        builtEdges.push({
          id: `e_${cp.parentCheckpointId}_${cp.id}`,
          source: cp.parentCheckpointId,
          target: cp.id,
          animated: cp.agentRole === 'fork' || snapshot.status === 'running',
          style: {
            stroke: cp.agentRole === 'fork' ? '#f59e0b' : '#22d3ee',
            strokeWidth: 2,
          },
        })
      }
      if (cp.secondParentCheckpointId) {
        builtEdges.push({
          id: `e_merge_${cp.secondParentCheckpointId}_${cp.id}`,
          source: cp.secondParentCheckpointId,
          target: cp.id,
          animated: true,
          style: {
            stroke: '#10b981',
            strokeWidth: 2.2,
          },
        })
      }
    }

    // Also render in-flight un-committed forks immediately so user sees the agent split the exact millisecond they click!
    for (const f of snapshot.forks) {
      const cpExists = snapshot.checkpoints.some((c) => c.id === `cp_${f.id}`)
      if (!cpExists && ['spawning', 'working'].includes(f.status)) {
        const baseX = xByCp.get(f.baseCheckpointId) ?? Math.max(24, (mainIndex - 1) * 228)
        const liveId = `live_${f.id}`
        const liveCp: GitCheckpoint = {
          id: liveId,
          commitHash: f.baseCommitHash,
          shortHash: f.id,
          stepIndex: 0,
          title: `⚡ ${f.userPrompt}`,
          titleAr: `⚡ ${f.userPrompt}`,
          agentId: f.id,
          agentRole: 'fork',
          parentCheckpointId: f.baseCheckpointId,
          filesChanged: f.targetFiles,
          linesAdded: 0,
          linesRemoved: 0,
          timestamp: f.createdAt,
          diffPatch: '',
        }
        builtNodes.push({
          id: liveId,
          type: 'checkpoint',
          position: { x: baseX + 110, y: 110 },
          data: {
            cp: liveCp,
            lang,
            isSelected: false,
            onInspect: () => {},
            onPickForkBase: () => {},
          },
        })
        builtEdges.push({
          id: `e_live_${f.id}`,
          source: f.baseCheckpointId,
          target: liveId,
          animated: true,
          style: { stroke: '#fbbf24', strokeWidth: 2.5, strokeDasharray: '5 3' },
        })
      }
    }

    return { nodes: builtNodes, edges: builtEdges }
  }, [
    snapshot.checkpoints,
    snapshot.forks,
    snapshot.status,
    lang,
    selectedForkBaseId,
    onInspectCheckpoint,
    onPickForkBase,
  ])

  return (
    <section className="h-52 shrink-0 border-t border-slate-800/90 bg-[#090c14] flex flex-col min-h-0">
      {/* Dock Tabs */}
      <div className="h-8 shrink-0 px-3 border-b border-slate-800/80 bg-[#0d121d] flex items-center gap-1 overflow-x-auto text-[11.5px]">
        <button
          onClick={() => onChangeTab('graph')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition cursor-pointer shrink-0 ${
            activeTab === 'graph'
              ? 'bg-cyan-500/15 text-cyan-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          {t.tabGraph}
          <span className="text-[10px] font-mono opacity-75">({snapshot.checkpoints.length})</span>
        </button>

        <button
          onClick={() => onChangeTab('activity')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition cursor-pointer shrink-0 ${
            activeTab === 'activity'
              ? 'bg-violet-500/15 text-violet-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          {t.tabActivity}
          <span className="text-[10px] font-mono opacity-75">({snapshot.activity.length})</span>
        </button>

        <button
          onClick={() => onChangeTab('skills')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition cursor-pointer shrink-0 ${
            activeTab === 'skills'
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t.tabSkills}
          {snapshot.skills.length > 0 && (
            <span className="px-1.5 rounded-full text-[10px] bg-emerald-500/25 text-emerald-200 font-bold">
              {snapshot.skills.length}
            </span>
          )}
        </button>

        <button
          onClick={() => onChangeTab('git')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition cursor-pointer shrink-0 ${
            activeTab === 'git'
              ? 'bg-amber-500/15 text-amber-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <GitCommitHorizontal className="w-3.5 h-3.5" />
          {t.tabGitLog}
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'graph' && (
          <div dir="ltr" className="w-full h-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.22, maxZoom: 1.05 }}
              minZoom={0.35}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1e293b" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="h-full overflow-y-auto px-3 py-1.5 space-y-1 text-xs">
            {snapshot.activity.map((item) => {
              const roleColor =
                item.agentRole === 'fork'
                  ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                  : item.agentRole === 'merger'
                    ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
                    : item.agentRole === 'observer'
                      ? 'text-violet-300 bg-violet-500/15 border-violet-500/30'
                      : item.agentRole === 'user'
                        ? 'text-pink-300 bg-pink-500/15 border-pink-500/30'
                        : 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30'

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 py-1 px-2 rounded bg-slate-900/55 border border-slate-800/60"
                >
                  <span
                    dir="ltr"
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border shrink-0 ${roleColor}`}
                  >
                    {item.badge || item.agentRole.toUpperCase()}
                  </span>
                  <span className="text-slate-200 truncate flex-1">
                    {lang === 'ar' ? item.messageAr : item.message}
                  </span>
                  {item.commitHash && (
                    <span dir="ltr" className="font-mono text-[10px] text-slate-500 shrink-0">
                      {item.commitHash}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="h-full overflow-y-auto px-3 py-2">
            {snapshot.skills.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400 text-center max-w-xl mx-auto">
                {t.noSkillsYet}
              </div>
            ) : selectedSkill ? (
              <div dir="ltr" className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-emerald-300">{selectedSkill.skillMdPath}</span>
                  <button
                    onClick={() => setSelectedSkill(null)}
                    className="text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    ← Back
                  </button>
                </div>
                <pre className="text-[11px] font-mono bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 whitespace-pre-wrap">
                  {selectedSkill.skillMdContent}
                </pre>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {snapshot.skills.map((sk) => (
                  <div
                    key={sk.id}
                    className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col gap-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-emerald-300 truncate">
                        {lang === 'ar' ? sk.nameAr : sk.name}
                      </span>
                      <input
                        type="checkbox"
                        checked={sk.enabled}
                        onChange={(e) => onToggleSkill(sk.id, e.target.checked)}
                        className="accent-emerald-500 cursor-pointer"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{sk.decision}</p>
                    <div className="flex items-center justify-between pt-1 mt-auto text-[10px] font-mono text-slate-500">
                      <span>
                        reuse {(sk.scores.reusability * 100).toFixed(0)}% · safe{' '}
                        {(sk.scores.safety * 100).toFixed(0)}%
                      </span>
                      <button
                        onClick={() => setSelectedSkill(sk)}
                        className="inline-flex items-center gap-1 text-cyan-300 hover:underline cursor-pointer"
                      >
                        <FileText className="w-3 h-3" />
                        SKILL.md
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'git' && (
          <div dir="ltr" className="h-full overflow-y-auto px-3 py-1.5 font-mono text-[11px] space-y-1">
            {gitCommits.map((c) => {
              const isMerge = c.parents.length > 1
              return (
                <div
                  key={c.hash}
                  className="flex items-center gap-2 py-0.5 px-2 rounded bg-slate-900/50 border border-slate-800/50"
                >
                  <span className={isMerge ? 'text-emerald-400 font-bold' : 'text-cyan-400'}>
                    {c.shortHash}
                  </span>
                  {isMerge && (
                    <span className="px-1.5 rounded bg-emerald-500/20 text-emerald-300 text-[9.5px]">
                      2-PARENT MERGE
                    </span>
                  )}
                  <span className="text-slate-200 truncate flex-1">{c.subject}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
