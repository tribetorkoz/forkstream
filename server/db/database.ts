import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { eq, gt, sql } from 'drizzle-orm'
import { migrationId, statements } from './migrations/0001_initial.js'
import * as schema from './schema.js'

export type ForkStreamDatabase = LibSQLDatabase<typeof schema>

let client: Client | undefined
let database: ForkStreamDatabase | undefined
let initPromise: Promise<ForkStreamDatabase> | undefined

export async function initializeDatabase(dbPath = process.env.FORKSTREAM_DB_PATH || path.resolve('data/forkstream.sqlite')): Promise<ForkStreamDatabase> {
  if (database) return database
  if (initPromise) return initPromise
  initPromise = (async () => {
    const absolute = path.resolve(dbPath)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    const c = createClient({ url: `file:${absolute}` })
    await c.execute('PRAGMA foreign_keys = ON')
    await c.execute('PRAGMA journal_mode = WAL')
    await c.execute('PRAGMA busy_timeout = 5000')
    await c.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)`)
    const found = await c.execute({ sql: 'SELECT id FROM schema_migrations WHERE id = ?', args: [migrationId] })
    if (found.rows.length === 0) {
      const tx = await c.transaction('write')
      try {
        for (const statement of statements) await tx.execute(statement)
        await tx.execute({
          sql: 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
          args: [migrationId, Date.now()],
        })
        await tx.commit()
      } catch (error) {
        await tx.rollback()
        throw error
      }
    }
    client = c
    database = drizzle(c, { schema })
    return database
  })()
  try {
    return await initPromise
  } catch (error) {
    initPromise = undefined
    throw error
  }
}

export function getDatabase(): ForkStreamDatabase {
  if (!database) throw new Error('Database not initialized; call initializeDatabase() first')
  return database
}

export function isDatabaseInitialized(): boolean {
  return database !== undefined
}

export async function closeDatabase(): Promise<void> {
  if (client) await client.close()
  client = undefined
  database = undefined
  initPromise = undefined
}

export interface StoredEvent {
  id: string
  streamId: string
  sequence: number
  eventType: string
  schemaVersion: number
  payload: unknown
  occurredAt: number
}

let databaseWriteTail: Promise<void> = Promise.resolve()

export function withDatabaseWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = databaseWriteTail.catch(() => undefined).then(operation)
  databaseWriteTail = result.then(() => undefined, () => undefined)
  return result
}

/** Append-only event write with a per-stream monotonic sequence; serialize local writers. */
export function appendEvent(input: { streamId: string; eventType: string; payload: unknown; eventId?: string }): Promise<StoredEvent> {
  return withDatabaseWriteLock(async () => {
    const db = getDatabase()
    const id = input.eventId ?? randomUUID()
    return db.transaction(async (tx) => {
      const rows = await tx.select({ maxSequence: sql<number>`coalesce(max(${schema.eventLog.sequence}), 0)` })
        .from(schema.eventLog).where(eq(schema.eventLog.streamId, input.streamId))
      const sequence = Number(rows[0]?.maxSequence ?? 0) + 1
      const occurredAt = Date.now()
      await tx.insert(schema.eventLog).values({
        id, streamId: input.streamId, sequence, eventType: input.eventType,
        schemaVersion: 1, payloadJson: JSON.stringify(input.payload), occurredAt,
      })
      return { id, streamId: input.streamId, sequence, eventType: input.eventType, schemaVersion: 1, payload: input.payload, occurredAt }
    })
  })
}

export async function readEvents(streamId: string, afterSequence = 0, limit = 500): Promise<StoredEvent[]> {
  const db = getDatabase()
  const rows = await db.select().from(schema.eventLog)
    .where(sql`${schema.eventLog.streamId} = ${streamId} AND ${schema.eventLog.sequence} > ${afterSequence}`)
    .orderBy(schema.eventLog.sequence).limit(Math.max(1, Math.min(5000, limit)))
  return rows.map((row) => ({
    id: row.id, streamId: row.streamId, sequence: row.sequence, eventType: row.eventType,
    schemaVersion: row.schemaVersion, payload: JSON.parse(row.payloadJson) as unknown, occurredAt: row.occurredAt,
  }))
}

export async function latestEventSequence(streamId: string): Promise<number> {
  const [row] = await getDatabase().select({ sequence: sql<number>`coalesce(max(${schema.eventLog.sequence}), 0)` })
    .from(schema.eventLog).where(eq(schema.eventLog.streamId, streamId))
  return Number(row?.sequence ?? 0)
}

export async function countEventsAfter(streamId: string, sequence: number): Promise<number> {
  const [row] = await getDatabase().select({ count: sql<number>`count(*)` }).from(schema.eventLog)
    .where(sql`${schema.eventLog.streamId} = ${streamId} AND ${schema.eventLog.sequence} > ${sequence}`)
  return Number(row?.count ?? 0)
}
