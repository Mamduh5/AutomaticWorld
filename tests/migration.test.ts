import Database from 'better-sqlite3';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import { WorldEngine,defaultConfig } from '../packages/world/src/engine.js';

const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
describe('in-place Milestone 3 schema migration',()=>{
  it('adds new tables without replacing founders or historical events',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'ai-world-migration-'));dirs.push(dir);const original=new WorldEngine(defaultConfig(dir));const genesis=await original.genesis(),ids=genesis.agents.map((agent)=>agent.id),eventUid=original.repo.listEvents(1)[0]?.eventUid;original.close();const dbPath=path.join(dir,'world.sqlite'),legacy=new Database(dbPath);legacy.exec('DROP TABLE IF EXISTS tool_invocations; DROP TABLE IF EXISTS tool_versions; DROP TABLE IF EXISTS tools; DROP TABLE IF EXISTS filesystem_operations; DROP TABLE IF EXISTS owner_ingress; DROP TABLE IF EXISTS autonomy_runs;');legacy.close();const migrated=new WorldEngine(defaultConfig(dir));await migrated.genesis();expect(migrated.repo.listAgents().map((agent)=>agent.id)).toEqual(ids);expect(migrated.repo.listAgents()).toHaveLength(2);expect(migrated.repo.listEvents(100).some((event)=>event.eventUid===eventUid)).toBe(true);const tables=(migrated.repo.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map((row)=>row.name);expect(tables).toEqual(expect.arrayContaining(['tools','tool_versions','tool_invocations','filesystem_operations','owner_ingress','autonomy_runs']));migrated.close();});
});
