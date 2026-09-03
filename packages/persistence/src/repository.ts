import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRecord, MemoryKind, MemoryRecord, MessageRecord, WorldEventRecord, WorldRecord } from '../../shared/src/index.js';

const json = <T>(value: string): T => JSON.parse(value) as T;

export class WorldRepository {
  readonly db: Database.Database;

  constructor(readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void { this.db.close(); }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, current_tick INTEGER NOT NULL, simulated_time TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL, generation INTEGER NOT NULL, parent_ids TEXT NOT NULL, status TEXT NOT NULL, cognition_config TEXT NOT NULL, capabilities TEXT NOT NULL, metadata TEXT NOT NULL, compute_credits INTEGER NOT NULL, storage_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, from_type TEXT NOT NULL, to_agent_id TEXT NOT NULL REFERENCES agents(id), created_at TEXT NOT NULL, tick INTEGER NOT NULL, content TEXT NOT NULL, read_at TEXT);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, tick INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_uid TEXT NOT NULL UNIQUE, tick INTEGER NOT NULL, timestamp TEXT NOT NULL, type TEXT NOT NULL, actor_id TEXT, subject_id TEXT, payload TEXT NOT NULL);
    `);
  }

  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }
  getWorld(): WorldRecord | null {
    const r = this.db.prepare('SELECT * FROM world LIMIT 1').get() as any;
    return r ? { id: r.id, createdAt: r.created_at, currentTick: r.current_tick, simulatedTime: r.simulated_time, status: r.status } : null;
  }
  createWorld(world: WorldRecord): void { this.db.prepare('INSERT INTO world VALUES (?, ?, ?, ?, ?)').run(world.id, world.createdAt, world.currentTick, world.simulatedTime, world.status); }
  setTick(tick: number, simulatedTime: string): void { this.db.prepare('UPDATE world SET current_tick=?, simulated_time=?').run(tick, simulatedTime); }
  setWorldStatus(status: WorldRecord['status']): void { this.db.prepare('UPDATE world SET status=?').run(status); }
  createAgent(a: AgentRecord): void {
    this.db.prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(a.id, a.name, a.createdAt, a.generation, JSON.stringify(a.parentIds), a.status, JSON.stringify(a.cognitionConfig), JSON.stringify(a.capabilities), JSON.stringify(a.metadata), a.computeCredits, a.storageBytes);
  }
  private mapAgent(r: any): AgentRecord { return { id: r.id, name: r.name, createdAt: r.created_at, generation: r.generation, parentIds: json(r.parent_ids), status: r.status, cognitionConfig: json(r.cognition_config), capabilities: json(r.capabilities), metadata: json(r.metadata), computeCredits: r.compute_credits, storageBytes: r.storage_bytes }; }
  getAgent(ref: string): AgentRecord | null { const r = this.db.prepare('SELECT * FROM agents WHERE id=? OR name=? COLLATE NOCASE LIMIT 1').get(ref, ref); return r ? this.mapAgent(r) : null; }
  listAgents(): AgentRecord[] { return (this.db.prepare('SELECT * FROM agents ORDER BY created_at, name').all() as any[]).map((r) => this.mapAgent(r)); }
  updateResources(agentId: string, computeCredits: number, storageBytes: number): void { this.db.prepare('UPDATE agents SET compute_credits=?, storage_bytes=? WHERE id=?').run(computeCredits, storageBytes, agentId); }
  addEvent(type: string, tick: number, actorId: string | null, subjectId: string | null, payload: Record<string, unknown> = {}): WorldEventRecord {
    const eventUid = randomUUID(), timestamp = new Date().toISOString();
    const result = this.db.prepare('INSERT INTO events(event_uid,tick,timestamp,type,actor_id,subject_id,payload) VALUES(?,?,?,?,?,?,?)').run(eventUid, tick, timestamp, type, actorId, subjectId, JSON.stringify(payload));
    return { id: Number(result.lastInsertRowid), eventUid, tick, timestamp, type, actorId, subjectId, payload };
  }
  listEvents(limit = 50): WorldEventRecord[] { return (this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({ id: r.id, eventUid: r.event_uid, tick: r.tick, timestamp: r.timestamp, type: r.type, actorId: r.actor_id, subjectId: r.subject_id, payload: json(r.payload) })); }
  sendMessage(fromId: string, fromType: MessageRecord['fromType'], toAgentId: string, tick: number, content: string): MessageRecord {
    const m: MessageRecord = { id: randomUUID(), fromId, fromType, toAgentId, tick, content, createdAt: new Date().toISOString(), readAt: null };
    this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)').run(m.id,m.fromId,m.fromType,m.toAgentId,m.createdAt,m.tick,m.content,m.readAt); return m;
  }
  messagesFor(agentId: string, limit = 20): MessageRecord[] { return (this.db.prepare('SELECT * FROM messages WHERE to_agent_id=? ORDER BY created_at DESC LIMIT ?').all(agentId,limit) as any[]).map((r) => ({ id:r.id,fromId:r.from_id,fromType:r.from_type,toAgentId:r.to_agent_id,createdAt:r.created_at,tick:r.tick,content:r.content,readAt:r.read_at })); }
  addMemory(agentId: string, kind: MemoryKind, content: string, tick: number): MemoryRecord { const m={id:randomUUID(),agentId,kind,content,createdAt:new Date().toISOString(),tick}; this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?)').run(m.id,m.agentId,m.kind,m.content,m.createdAt,m.tick); return m; }
  memoriesFor(agentId: string, limit = 20): MemoryRecord[] { return (this.db.prepare('SELECT * FROM memories WHERE agent_id=? ORDER BY created_at DESC LIMIT ?').all(agentId,limit) as any[]).map((r)=>({id:r.id,agentId:r.agent_id,kind:r.kind,content:r.content,createdAt:r.created_at,tick:r.tick})); }
}
