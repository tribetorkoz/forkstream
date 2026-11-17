import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const id = (name = 'id') => text(name).primaryKey()
const createdAt = () => integer('created_at', { mode: 'number' }).notNull()
const updatedAt = () => integer('updated_at', { mode: 'number' }).notNull()

export const projects = sqliteTable('projects', {
  id: id(),
  name: text('name').notNull(),
  canonicalPath: text('canonical_path').notNull(),
  source: text('source', { enum: ['local', 'clone'] }).notNull(),
  remoteUrl: text('remote_url'),
  vcs: text('vcs', { enum: ['git', 'none'] }).notNull(),
  defaultBranch: text('default_branch'),
  languagesJson: text('languages_json').notNull().default('[]'),
  packageManagersJson: text('package_managers_json').notNull().default('[]'),
  detectedCommandsJson: text('detected_commands_json').notNull().default('{}'),
  lastOpenedAt: integer('last_opened_at', { mode: 'number' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('projects_canonical_path_uq').on(t.canonicalPath), index('projects_last_opened_idx').on(t.lastOpenedAt)])

export const sessions = sqliteTable('sessions', {
  id: id(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull(),
  mode: text('mode').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  finishedAt: integer('finished_at', { mode: 'number' }),
}, (t) => [index('sessions_project_created_idx').on(t.projectId, t.createdAt), index('sessions_status_idx').on(t.status)])

export const agents = sqliteTable('agents', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  status: text('status').notNull(),
  branchName: text('branch_name'),
  worktreePath: text('worktree_path'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('agents_session_idx').on(t.sessionId)])

export const messages = sqliteTable('messages', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: createdAt(),
}, (t) => [index('messages_session_created_idx').on(t.sessionId, t.createdAt)])

export const toolInvocations = sqliteTable('tool_invocations', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  status: text('status').notNull(),
  inputJson: text('input_json').notNull(),
  outputJson: text('output_json'),
  errorText: text('error_text'),
  startedAt: integer('started_at', { mode: 'number' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'number' }),
}, (t) => [index('tool_invocations_session_idx').on(t.sessionId, t.startedAt)])

export const checkpoints = sqliteTable('checkpoints', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  commitHash: text('commit_hash').notNull(),
  parentId: text('parent_id'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: createdAt(),
}, (t) => [index('checkpoints_session_created_idx').on(t.sessionId, t.createdAt)])

export const forks = sqliteTable('forks', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  parentForkId: text('parent_fork_id'),
  baseCommitHash: text('base_commit_hash').notNull(),
  status: text('status').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('forks_session_created_idx').on(t.sessionId, t.createdAt)])

export const mergeOperations = sqliteTable('merge_operations', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  forkId: text('fork_id').references(() => forks.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  strategy: text('strategy'),
  baseCommitHash: text('base_commit_hash'),
  resultCommitHash: text('result_commit_hash'),
  verificationJson: text('verification_json').notNull().default('{}'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('merge_ops_session_created_idx').on(t.sessionId, t.createdAt)])

export const eventLog = sqliteTable('event_log', {
  id: id(),
  streamId: text('stream_id').notNull(),
  sequence: integer('sequence').notNull(),
  eventType: text('event_type').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  payloadJson: text('payload_json').notNull(),
  occurredAt: integer('occurred_at', { mode: 'number' }).notNull(),
}, (t) => [uniqueIndex('event_log_stream_seq_uq').on(t.streamId, t.sequence), index('event_log_stream_idx').on(t.streamId, t.sequence)])

export const usageRecords = sqliteTable('usage_records', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  provider: text('provider'),
  model: text('model'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costMicrousd: integer('cost_microusd').notNull().default(0),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: createdAt(),
}, (t) => [index('usage_session_created_idx').on(t.sessionId, t.createdAt)])

export const schema = { projects, sessions, agents, messages, toolInvocations, checkpoints, forks, mergeOperations, eventLog, usageRecords }
