export const migrationId = '0001_initial'

export const statements = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, canonical_path TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('local','clone')), remote_url TEXT,
    vcs TEXT NOT NULL CHECK (vcs IN ('git','none')), default_branch TEXT,
    languages_json TEXT NOT NULL DEFAULT '[]', package_managers_json TEXT NOT NULL DEFAULT '[]',
    detected_commands_json TEXT NOT NULL DEFAULT '{}', last_opened_at INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_canonical_path_uq ON projects(canonical_path)`,
  `CREATE INDEX IF NOT EXISTS projects_last_opened_idx ON projects(last_opened_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_project_created_idx ON sessions(project_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status)`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, status TEXT NOT NULL, branch_name TEXT, worktree_path TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agents_session_idx ON agents(session_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages(session_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS tool_invocations (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, tool_name TEXT NOT NULL, status TEXT NOT NULL,
    input_json TEXT NOT NULL, output_json TEXT, error_text TEXT, started_at INTEGER NOT NULL, finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS tool_invocations_session_idx ON tool_invocations(session_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, commit_hash TEXT NOT NULL, parent_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS checkpoints_session_created_idx ON checkpoints(session_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS forks (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, parent_fork_id TEXT, base_commit_hash TEXT NOT NULL,
    status TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS forks_session_created_idx ON forks(session_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS merge_operations (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    fork_id TEXT REFERENCES forks(id) ON DELETE SET NULL, status TEXT NOT NULL, strategy TEXT,
    base_commit_hash TEXT, result_commit_hash TEXT, verification_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS merge_ops_session_created_idx ON merge_operations(session_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS event_log (
    id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1, payload_json TEXT NOT NULL,
    occurred_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS event_log_stream_seq_uq ON event_log(stream_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS event_log_stream_idx ON event_log(stream_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, provider TEXT, model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_microusd INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS usage_session_created_idx ON usage_records(session_id, created_at)`,
]
