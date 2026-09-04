import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import type { CognitionInput,CognitionProvider } from '../packages/cognition/src/index.js';
import { eventVisibility } from '../packages/shared/src/index.js';
import { FakeExecutionSandbox } from '../packages/sandbox/src/docker.js';
import { WorldEngine,defaultConfig } from '../packages/world/src/engine.js';

const dirs:string[]=[];
async function engine(provider?:CognitionProvider,sandbox?:FakeExecutionSandbox){const dir=await mkdtemp(path.join(tmpdir(),'ai-world-visibility-'));dirs.push(dir);const value=new WorldEngine(defaultConfig(dir),provider,sandbox);await value.genesis();return value;}
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});

describe('event visibility boundary',()=>{
  it('is deny-by-default and classifies known kernel audit events as Owner-only',()=>{
    for(const type of ['COGNITION_PROVIDER_ERROR','COGNITION_FALLBACK','RUNNER_START_FAILED','RUNNER_STARTED','RUNNER_STOPPED','RUNNER_LEASE_LOST','AUTONOMY_CIRCUIT_BREAKER_OPENED','WORLD_CHECKPOINT_CREATED','FILESYSTEM_RECONCILIATION_STARTED','FILESYSTEM_RECONCILIATION_FAILED','UNKNOWN_FUTURE_KERNEL_EVENT'])expect(eventVisibility({type,payload:{}})).toBe('OWNER_KERNEL_ONLY');
    expect(eventVisibility({type:'PROGRAM_EXECUTION_FAILED',payload:{exitCode:1}})).toBe('AGENT_VISIBLE');
    expect(eventVisibility({type:'PROGRAM_EXECUTION_FAILED',payload:{infrastructureFailure:true,error:'Docker daemon unavailable'}})).toBe('OWNER_KERNEL_ONLY');
  });

  it('keeps kernel audit text out of observations while retaining ordinary execution failures',async()=>{
    const e=await engine(),mam=e.repo.getAgent('Mam')!;
    const forbidden=['OpenRouter','HTTP 402','API key','circuit breaker','runner lease','Docker daemon','checkpoint','SQLite','provider HTTP error'];
    forbidden.forEach((text,index)=>e.repo.addEvent(index%2?'RUNNER_STOPPED':'COGNITION_PROVIDER_ERROR',0,mam.id,null,{detail:text}));
    e.repo.addEvent('WORLD_CHECKPOINT_CREATED',0,null,null,{detail:'checkpoint'});
    e.repo.addEvent('PROGRAM_EXECUTION_FAILED',0,mam.id,null,{exitCode:1,stderr:'ordinary syntax failure',infrastructureFailure:false});
    const serialized=JSON.stringify(await e.observe(mam));
    for(const text of forbidden)expect(serialized).not.toContain(text);
    expect(serialized).toContain('ordinary syntax failure');
    e.close();
  });

  it('persists LIST_INHABITANTS effects for the next cognition turn without private fields',async()=>{
    const inputs:CognitionInput[]=[];
    const provider:CognitionProvider={async think(input){inputs.push(input);return{thoughtSummary:'discover',selectedAction:{type:'LIST_INHABITANTS'}};}};
    const e=await engine(provider);e.resume();await e.run(2);
    for(const name of ['Mam','Toey']){const second=inputs.filter((input)=>input.identity.name===name)[1]!,result=second.currentObservation.nearbyOrRelevantEvents.find((event)=>event.type==='ACTION_RESULT');expect(result?.summary.effects).toEqual([{inhabitants:e.listPublicInhabitants(second.identity.id)}]);const serialized=JSON.stringify(result);expect(serialized).not.toMatch(/cognitionConfig|capabilities|metadata|computeCredits|storageBytes|sleepingUntilTick|parentIds|createdAt/);}
    e.close();
  });
});

describe('memory provenance boundary',()=>{
  it('rejects kernel event sources and excludes quarantined records from retrieval',async()=>{
    const e=await engine(),mam=e.repo.getAgent('Mam')!,kernel=e.repo.addEvent('COGNITION_PROVIDER_ERROR',0,mam.id,null,{error:'Provider HTTP 402'}),visible=e.repo.addEvent('PROGRAM_EXECUTION_FAILED',0,mam.id,null,{exitCode:1,stderr:'SyntaxError'});
    expect(()=>e.repo.addMemory(mam.id,'reflection','kernel autobiography',0,{sourceEventId:kernel.id})).toThrow(/Kernel-only/);
    const active=e.repo.addMemory(mam.id,'episodic','SyntaxError from my program',0,{sourceEventId:visible.id,sourceRunId:'run-visible'}),quarantined=e.repo.addMemory(mam.id,'reflection','historical owner-only contamination',0,{retrievalStatus:'QUARANTINED'});
    expect(e.repo.relevantMemories(mam.id,'error contamination',1,20).map((memory)=>memory.id)).toContain(active.id);
    expect(e.repo.relevantMemories(mam.id,'error contamination',1,20).map((memory)=>memory.id)).not.toContain(quarantined.id);
    expect(e.repo.memoriesFor(mam.id,20).find((memory)=>memory.id===quarantined.id)?.retrievalStatus).toBe('QUARANTINED');
    e.close();
  });

  it('does not create a memory or observable result for execution infrastructure failure',async()=>{
    const sandbox=new FakeExecutionSandbox(()=>({success:false,exitCode:null,stdout:'',stderr:'',timedOut:false,durationMs:1,truncated:false,error:'Docker daemon unavailable'})),inputs:CognitionInput[]=[];
    const provider:CognitionProvider={async think(input){inputs.push(input);return{thoughtSummary:'execute',selectedAction:input.identity.name==='Mam'?input.currentObservation.tick===0?{type:'CREATE_TEXT_FILE',path:'x.js',content:'throw 1'}:{type:'EXECUTE_PROGRAM',runtime:'node',entrypoint:'x.js',args:[],stdin:''}:{type:'WAIT',ticks:1}};}};
    const e=await engine(provider,sandbox);e.resume();await e.run(3);const mam=e.repo.getAgent('Mam')!;
    expect(e.repo.memoriesFor(mam.id,20).some((memory)=>memory.content.includes('Docker daemon'))).toBe(false);
    expect(JSON.stringify(inputs.filter((input)=>input.identity.name==='Mam').at(-1))).not.toContain('Docker daemon');
    expect(e.repo.listEvents(100).some((event)=>event.payload.error==='Docker daemon unavailable')).toBe(true);
    e.close();
  });
});
