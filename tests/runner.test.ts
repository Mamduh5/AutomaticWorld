import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import type { CognitionProvider } from '../packages/cognition/src/index.js';
import { FakeExecutionSandbox } from '../packages/sandbox/src/docker.js';
import { WorldEngine,defaultConfig } from '../packages/world/src/engine.js';
import { ContinuousWorldRunner } from '../packages/world/src/runner.js';
const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function engine(provider?:CognitionProvider){const dir=await mkdtemp(path.join(tmpdir(),'ai-world-runner-'));dirs.push(dir);const e=new WorldEngine(defaultConfig(dir),provider,new FakeExecutionSandbox(()=>({success:true,exitCode:0,stdout:'',stderr:'',timedOut:false,durationMs:1,truncated:false})));await e.genesis();e.resume();return e;}
describe('continuous runner',()=>{
  it('honors a maximum tick count and releases its database lease',async()=>{const e=await engine();const result=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:2});expect(result).toMatchObject({ticks:2,reason:'maximum ticks reached'});expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);expect(e.repo.getWorld()?.currentTick).toBe(2);expect(e.repo.acquireRunnerLease('later',1_000)).toBe(true);e.close();});
  it('finishes an in-flight cycle before graceful abort and persists shutdown',async()=>{const provider:CognitionProvider={async think(){await new Promise((resolve)=>setTimeout(resolve,20));return{thoughtSummary:'wait',selectedAction:{type:'WAIT',ticks:1}};}};const e=await engine(provider),controller=new AbortController();setTimeout(()=>controller.abort(),5);const result=await new ContinuousWorldRunner(e).run({tickMs:100,maxTicks:10,signal:controller.signal});expect(result.reason).toBe('shutdown signal');expect(result.ticks).toBe(1);expect(e.repo.getWorld()?.currentTick).toBe(1);expect(e.repo.listEvents().some((event)=>event.type==='RUNNER_STOPPED')).toBe(true);e.close();});
});
