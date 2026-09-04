import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import { runnerLeaseDoctorChecks } from '../packages/operations/src/runner-lease-doctor.js';
import { WorldEngine,defaultConfig } from '../packages/world/src/engine.js';

const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function engine(){const dir=await mkdtemp(path.join(tmpdir(),'ai-world-lease-doctor-'));dirs.push(dir);const value=new WorldEngine(defaultConfig(dir));await value.genesis();return value;}

describe('runner lease diagnostics',()=>{
  it('probes an absent lease without persisting a row',async()=>{const e=await engine(),checks=runnerLeaseDoctorChecks(e.repo);expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({name:'Runner lease',passed:true,detail:'none'}),expect.objectContaining({name:'Runner lease acquire/release',passed:true})]));expect(e.repo.runnerLeaseStatus().present).toBe(false);e.close();});
  it('protects an active lease from the isolated acquire/release probe',async()=>{const e=await engine();e.repo.acquireRunnerLease('active-token',5_000,'active-runner');const before=e.repo.runnerLeaseDiagnostic(),checks=runnerLeaseDoctorChecks(e.repo),after=e.repo.runnerLeaseDiagnostic();expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({name:'Runner lease',passed:true,detail:expect.stringContaining('active valid')}),expect.objectContaining({name:'Runner lease acquire/release',passed:true,detail:'not attempted; active lease protected'})]));expect(after.tokenHash).toBe(before.tokenHash);e.repo.releaseRunnerLease('active-token');e.close();});
  it('reports an expired lease as recoverable and a malformed lease as unhealthy',async()=>{const e=await engine();e.repo.acquireRunnerLease('expired-token',1_000,'expired-runner');e.repo.db.prepare('UPDATE runner_lease SET expires_at=?').run(Date.now()-1);expect(runnerLeaseDoctorChecks(e.repo)[0]).toEqual(expect.objectContaining({passed:true,detail:expect.stringContaining('expired stale')}));e.repo.db.prepare('UPDATE runner_lease SET expires_at=?,runner_id=NULL').run(Date.now()+5_000);expect(runnerLeaseDoctorChecks(e.repo)[0]).toEqual(expect.objectContaining({passed:false,detail:expect.stringContaining('malformed')}));e.close();});
});
