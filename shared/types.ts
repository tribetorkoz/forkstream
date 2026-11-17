/**
 * Shared TypeScript contracts across ForkStream Server & Client.
 * Grounded in:
 *  - AG-UI Protocol v1.0 (@ag-ui/core) event stream envelope
 *  - VibeTrace (arXiv:2611.04466 / github.com/idvxlab/VibeTrace) execution trace & skill distillation model
 *  - Vibe Kanban / Claude Squad isolated Git Worktree lifecycle
 *  - Mergiraf AST structural merge outcomes
 */

export type ExecutionMode = 'sandbox' | 'llm' | 'opencode'

export type LLMProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'compatible'

export interface ProviderConfig {
  mode: ExecutionMode
  provider: LLMProviderId
  apiKey?: string
  model: string
  fastModel?: string
  baseUrl?: string
  opencodeUrl?: string
}

export type SessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'interrupted'

export type ForkStatus =
  | 'spawning'
  | 'working'
  | 'verifying'
  | 'merging'
  | 'merged'
  | 'conflict_resolved'
  | 'failed'

export interface FileSnapshot {
  path: string
  content: string
  previousContent: string
  diffPatch: string
  linesAdded: number
  linesRemoved: number
  updatedAt: number
  updatedBy: 'builder' | string // 'builder' or forkId
  worktree: 'main' | string
  touchCount: number
}

export interface GitCheckpoint {
  id: string
  commitHash: string
  shortHash: string
  stepIndex: number
  title: string
  titleAr: string
  agentId: string // 'builder' or forkId
  agentRole: 'builder' | 'fork' | 'merge'
  parentCheckpointId?: string
  secondParentCheckpointId?: string // populated on merge commits
  filesChanged: string[]
  linesAdded: number
  linesRemoved: number
  previewSection?: string
  timestamp: number
  diffPatch: string
  mergeStrategy?: 'mergiraf-ast' | 'git-ort-clean' | 'ai-diff3-resolved' | 'fast-forward'
}

export interface SelectedDomElement {
  selector: string
  tagName: string
  textSnippet: string
  sectionId?: string
  inferredFile?: string
}

export interface ConsoleTelemetryEntry {
  id: string
  level: 'log' | 'warn' | 'error' | 'info'
  message: string
  source: 'main' | string // 'main' or forkId
  fileHint?: string
  timestamp: number
}

export interface ObserverAlert {
  id: string
  severity: 'warning' | 'error' | 'info'
  title: string
  titleAr: string
  detail: string
  detailAr: string
  targetFile: string
  checkpointId: string
  suggestedFixPrompt: string
  suggestedFixPromptAr: string
  resolved: boolean
  timestamp: number
}

/**
 * Capped-digest Observer state (2,000-char rolling digest inspired by Anthropic's sidecar Observer pattern).
 */
export interface ObserverFocusState {
  status: 'watching' | 'alerting' | 'routing_fork' | 'verifying_merge' | 'idle'
  activeFile: string | null
  activeWorktree: 'main' | string
  cameraSection: string | null
  headline: string
  headlineAr: string
  latestCheckpointId: string | null
  latestCommitHash: string | null
  recentFiles: string[]
  cappedDigest: string
  alerts: ObserverAlert[]
  previewVersion: number
  forkPreviewVersions: Record<string, number>
}

export interface AgentFork {
  id: string
  branchName: string
  worktreePath: string
  baseCheckpointId: string
  baseCommitHash: string
  baseShortHash: string
  userPrompt: string
  targetFiles: string[]
  selectedElement?: SelectedDomElement
  status: ForkStatus
  currentAction: string
  currentActionAr: string
  filesModified: string[]
  diffPatch: string
  linesAdded: number
  linesRemoved: number
  previewUrl: string
  mergeCommitHash?: string
  mergeStrategy?: 'mergiraf-ast' | 'git-ort-clean' | 'ai-diff3-resolved' | 'fast-forward'
  mergeSummary?: string
  mergeSummaryAr?: string
  syncNoticeSentToBuilder: boolean
  distilledSkillId?: string
  createdAt: number
  completedAt?: number
  error?: string
}

export interface ActivityFeedItem {
  id: string
  agentId: string
  agentRole: 'builder' | 'observer' | 'fork' | 'merger' | 'user'
  eventType: string // AG-UI EventType or sub-event
  message: string
  messageAr: string
  filePath?: string
  commitHash?: string
  badge?: string
  timestamp: number
}

/**
 * VibeTrace Trace-to-Skill artifact (arXiv:2611.04466 Section IV-C) + agentskills.io SKILL.md format.
 */
export interface DistilledSkill {
  id: string
  slug: string
  name: string
  nameAr: string
  context: string
  decision: string
  strategy: string
  scores: {
    reusability: number
    informativeness: number
    safety: number
  }
  sourceSessionId: string
  sourceForkId: string
  sourceUserPrompt: string
  sourceCommitHash: string
  skillMdPath: string
  skillMdContent: string
  enabled: boolean
  createdAt: number
}

export interface ScenarioPreset {
  id: string
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  defaultPrompt: string
  defaultPromptAr: string
  quickForkSuggestions: Array<{
    label: string
    labelAr: string
    prompt: string
    promptAr: string
    category: 'bugfix' | 'design' | 'feature'
  }>
}

export interface SessionStateSnapshot {
  sessionId: string
  projectId?: string
  title: string
  prompt: string
  scenarioId?: string
  mode: ExecutionMode
  status: SessionStatus
  speedMultiplier: number // 1 = normal, 0.5 = slow-mo for watching, 2 = fast
  totalSteps: number
  completedSteps: number
  currentBuilderAction: string
  currentBuilderActionAr: string
  mergirafAvailable: boolean
  mergirafVersion: string | null
  gitVersion: string
  repoPath: string
  previewUrl: string
  files: Record<string, FileSnapshot>
  forkFiles: Record<string, Record<string, FileSnapshot>>
  checkpoints: GitCheckpoint[]
  forks: AgentFork[]
  observer: ObserverFocusState
  consoleLogs: ConsoleTelemetryEntry[]
  activity: ActivityFeedItem[]
  syncNoticesDelivered: string[]
  skills: DistilledSkill[]
  createdAt: number
}
