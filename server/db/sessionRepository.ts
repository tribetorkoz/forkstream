import { desc, eq, inArray, sql } from 'drizzle-orm'
import { getDatabase, withDatabaseWriteLock } from './database.js'
import { agents, checkpoints, forks, messages, sessions, toolInvocations, usageRecords } from './schema.js'
import type { SessionStateSnapshot } from '../../shared/types.js'

export async function persistSessionSnapshot(snapshot: SessionStateSnapshot, projectId: string | null = snapshot.projectId ?? null): Promise<void> {
  const db = getDatabase()
  const now = Date.now()
  await withDatabaseWriteLock(() => db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      id: snapshot.sessionId, projectId, title: snapshot.title, prompt: snapshot.prompt,
      status: snapshot.status, mode: snapshot.mode, snapshotJson: JSON.stringify(snapshot),
      createdAt: snapshot.createdAt, updatedAt: now,
      finishedAt: ['completed', 'error'].includes(snapshot.status) ? now : null,
    }).onConflictDoUpdate({
      target: sessions.id,
      set: {
        projectId, title: snapshot.title, prompt: snapshot.prompt, status: snapshot.status,
        mode: snapshot.mode, snapshotJson: JSON.stringify(snapshot), updatedAt: now,
        finishedAt: ['completed', 'error'].includes(snapshot.status) ? now : null,
      },
    })

    await tx.insert(messages).values({
      id: `${snapshot.sessionId}:user-prompt`, sessionId: snapshot.sessionId, agentId: null,
      role: 'user', content: snapshot.prompt, metadataJson: JSON.stringify({ source: 'session.create' }), createdAt: snapshot.createdAt,
    }).onConflictDoNothing()

    const dbAgentId = (id: string): string => `${snapshot.sessionId}:${id}`
    const roleAgentIds = new Set([dbAgentId('builder'), dbAgentId('observer'), dbAgentId('merger')])
    const agentRows = [
      { id: dbAgentId('builder'), sessionId: snapshot.sessionId, role: 'builder', status: snapshot.status, branchName: 'main', worktreePath: snapshot.repoPath, createdAt: snapshot.createdAt, updatedAt: now },
      { id: dbAgentId('observer'), sessionId: snapshot.sessionId, role: 'observer', status: 'watching', branchName: null, worktreePath: null, createdAt: snapshot.createdAt, updatedAt: now },
      ...snapshot.forks.map((fork) => ({
        id: dbAgentId(fork.id), sessionId: snapshot.sessionId, role: 'fork', status: fork.status,
        branchName: fork.branchName, worktreePath: fork.worktreePath, createdAt: fork.createdAt, updatedAt: fork.completedAt ?? now,
      })),
    ]
    for (const fork of snapshot.forks) roleAgentIds.add(dbAgentId(fork.id))
    await tx.insert(agents).values(agentRows).onConflictDoUpdate({
      target: agents.id,
      set: { status: sql`excluded.status`, branchName: sql`excluded.branch_name`, worktreePath: sql`excluded.worktree_path`, updatedAt: now },
    })

    if (snapshot.checkpoints.length) {
      await tx.insert(checkpoints).values(snapshot.checkpoints.map((checkpoint) => ({
        id: `${snapshot.sessionId}:${checkpoint.id}`, sessionId: snapshot.sessionId,
        agentId: checkpoint.agentId === 'builder' || checkpoint.agentId === 'observer' || checkpoint.agentId === 'merger' || snapshot.forks.some((fork) => fork.id === checkpoint.agentId)
          ? dbAgentId(checkpoint.agentId)
          : null,
        commitHash: checkpoint.commitHash,
        parentId: checkpoint.parentCheckpointId ? `${snapshot.sessionId}:${checkpoint.parentCheckpointId}` : null,
        metadataJson: JSON.stringify(checkpoint), createdAt: checkpoint.timestamp,
      }))).onConflictDoNothing()
    }

    if (snapshot.forks.length) {
      await tx.insert(forks).values(snapshot.forks.map((fork) => ({
        id: fork.id, sessionId: snapshot.sessionId, agentId: dbAgentId(fork.id), parentForkId: null,
        baseCommitHash: fork.baseCommitHash, status: fork.status, metadataJson: JSON.stringify(fork),
        createdAt: fork.createdAt, updatedAt: fork.completedAt ?? now,
      }))).onConflictDoUpdate({
        target: forks.id, set: { status: sql`excluded.status`, metadataJson: sql`excluded.metadata_json`, updatedAt: now },
      })
    }

    if (snapshot.activity.length) {
      const activityMessages = snapshot.activity.map((item) => {
        const agentId = dbAgentId(item.agentId)
        return {
          id: `${snapshot.sessionId}:${item.id}`, sessionId: snapshot.sessionId,
          agentId: roleAgentIds.has(agentId) ? agentId : null,
          role: item.agentRole, content: item.message,
          metadataJson: JSON.stringify({ ...item, messageAr: item.messageAr }), createdAt: item.timestamp,
        }
      })
      await tx.insert(messages).values(activityMessages).onConflictDoNothing()
    }
  }))
}

export async function persistToolInvocation(input: {
  id: string; sessionId: string; toolName: string; inputJson: string; outputText?: string; startedAt?: number;
}): Promise<void> {
  const now = Date.now()
  await withDatabaseWriteLock(() => getDatabase().insert(toolInvocations).values({
    id: `${input.sessionId}:${input.id}`, sessionId: input.sessionId, agentId: `${input.sessionId}:builder`,
    toolName: input.toolName, status: 'completed', inputJson: input.inputJson,
    outputJson: JSON.stringify(input.outputText ?? null), startedAt: input.startedAt ?? now, finishedAt: now,
  }).onConflictDoUpdate({
    target: toolInvocations.id,
    set: { status: 'completed', outputJson: JSON.stringify(input.outputText ?? null), finishedAt: now },
  }))
}

export async function markUnfinishedSessionsInterrupted(): Promise<number> {
  const db = getDatabase()
  const active = await db.select({ id: sessions.id, snapshotJson: sessions.snapshotJson })
    .from(sessions).where(inArray(sessions.status, ['running', 'paused', 'idle']))
  const now = Date.now()
  for (const row of active) {
    let snapshot: Record<string, unknown> = {}
    try { snapshot = JSON.parse(row.snapshotJson) as Record<string, unknown> } catch { /* retain recoverable row */ }
    snapshot.status = 'interrupted'
    snapshot.recoveryState = 'interrupted-after-process-restart'
    await db.update(sessions).set({ status: 'interrupted', snapshotJson: JSON.stringify(snapshot), updatedAt: now }).where(eq(sessions.id, row.id))
  }
  return active.length
}

export async function listPersistedSessions(): Promise<Array<{ id: string; title: string; status: string; mode: string; createdAt: number; updatedAt: number; projectId: string | null }>> {
  return getDatabase().select({
    id: sessions.id, title: sessions.title, status: sessions.status, mode: sessions.mode,
    createdAt: sessions.createdAt, updatedAt: sessions.updatedAt, projectId: sessions.projectId,
  }).from(sessions).orderBy(desc(sessions.createdAt))
}

export async function readPersistedSnapshot(id: string): Promise<SessionStateSnapshot | null> {
  const [row] = await getDatabase().select({ snapshotJson: sessions.snapshotJson }).from(sessions).where(eq(sessions.id, id)).limit(1)
  if (!row) return null
  try { return JSON.parse(row.snapshotJson) as SessionStateSnapshot } catch { return null }
}

export async function persistUsageRecord(input: {
  id: string; sessionId: string; provider: string; model: string; inputTokens: number; outputTokens: number;
}): Promise<void> {
  const now = Date.now()
  const inputTokens = Math.max(0, Math.trunc(input.inputTokens))
  const outputTokens = Math.max(0, Math.trunc(input.outputTokens))
  let costMicrousd = 0
  let costStatus = 'unknown: configure FORKSTREAM_MODEL_PRICING_JSON for this provider/model'
  try {
    const rates = JSON.parse(process.env.FORKSTREAM_MODEL_PRICING_JSON || '{}') as Record<string, {
      inputUsdPerMillion?: number; outputUsdPerMillion?: number;
    }>
    const rate = rates[`${input.provider}/${input.model}`] ?? rates[input.model]
    if (rate && Number.isFinite(rate.inputUsdPerMillion) && Number.isFinite(rate.outputUsdPerMillion)
      && (rate.inputUsdPerMillion ?? -1) >= 0 && (rate.outputUsdPerMillion ?? -1) >= 0) {
      // USD-per-million-token prices numerically equal micro-USD-per-token.
      costMicrousd = Math.round(inputTokens * rate.inputUsdPerMillion! + outputTokens * rate.outputUsdPerMillion!)
      costStatus = 'estimated from explicitly configured per-million-token rates'
    }
  } catch {
    costStatus = 'unknown: invalid FORKSTREAM_MODEL_PRICING_JSON'
  }
  await withDatabaseWriteLock(() => getDatabase().insert(usageRecords).values({
    id: `${input.sessionId}:${input.id}`, sessionId: input.sessionId, agentId: `${input.sessionId}:builder`,
    provider: input.provider, model: input.model, inputTokens, outputTokens,
    costMicrousd, metadataJson: JSON.stringify({ costStatus }), createdAt: now,
  }))
}
