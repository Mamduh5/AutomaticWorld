import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COGNITION_RESPONSE_INSTRUCTION, cognitionUserPayload, estimateContextTokens, OpenAICompatibleCognitionProvider, type CognitionInput, type CognitionProvider } from '../packages/cognition/src/index.js';
import { LocalCognitionPreparationError } from '../packages/cognition/src/local-error.js';
import { createRunReport } from '../packages/operations/src/run-report.js';
import { createExperimentReport } from '../packages/operations/src/experiment-report.js';
import { DockerExecutionSandbox, FakeExecutionSandbox } from '../packages/sandbox/src/docker.js';
import { BOOTSTRAP_INSTRUCTION, eventVisibility } from '../packages/shared/src/index.js';
import { prepareCognitionContext } from '../packages/world/src/cognition-context.js';
import { WorldEngine, defaultConfig } from '../packages/world/src/engine.js';
import { ContinuousWorldRunner } from '../packages/world/src/runner.js';
import { fundCognition, setLocal } from './resource-fixtures.js';

const engines:WorldEngine[]=[], dirs:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const engine of engines.splice(0))if(engine.repo.db.open)engine.close();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const success=()=>({thoughtSummary:'Selected WAIT.',selectedAction:{type:'WAIT' as const,ticks:1},reasoningMetadata:{providerRequestSucceeded:true,providerAttempts:1}});
const execution={success:true,exitCode:0,stdout:'ok',stderr:'',timedOut:false,durationMs:1,truncated:false};
async function fixture(provider?:CognitionProvider,sandbox=new FakeExecutionSandbox(()=>execution)){
  const dir=await mkdtemp(path.join(tmpdir(),'aw-t1854-'));dirs.push(dir);
  const engine=new WorldEngine(defaultConfig(dir),provider,sandbox);engines.push(engine);await engine.genesis();fundCognition(engine);return engine;
}
const tokens=(input:CognitionInput)=>estimateContextTokens(`${BOOTSTRAP_INSTRUCTION}\n${COGNITION_RESPONSE_INSTRUCTION}`)+estimateContextTokens(cognitionUserPayload(input));
const policy={initialBackoffMs:1,maxBackoffMs:2,maxSuspensionMs:100,retryAfterMaxMs:10};

describe('atomic complete cognition context admission',()=>{
  it.each(['peer message','own result','own consequence','shared consequence','continuity'] as const)('rejects content and all delivery IDs together at the %s boundary',async(category)=>{
    const e=await fixture(),mam=e.repo.getAgent('Mam')!,toey=e.repo.getAgent('Toey')!;
    // Four-digit historical IDs reproduce the exact continuity 8000 -> 8002 delta.
    e.repo.db.prepare("UPDATE sqlite_sequence SET seq=1853 WHERE name='events'").run();
    const message=category==='peer message'?e.repo.sendMessage(toey.id,'agent',mam.id,0,'new mandatory message'):null;
    const event=message?null:e.repo.addEvent(category==='own result'?'ACTION_RESULT':'FILE_UPDATED',0,category==='shared consequence'?toey.id:mam.id,null,{marker:category,...(category==='shared consequence'?{space:'SHARED'}:{})});
    if(category==='continuity')e.repo.db.prepare('UPDATE observation_cursors SET own_event_id=?,shared_event_id=? WHERE agent_id=?').run(event!.id,event!.id,mam.id);
    vi.spyOn(e.repo,'listEvents').mockReturnValue(category==='continuity'?[event!]:[]);
    const agent={...mam,metadata:{...mam.metadata,packingPadding:''}},build=(budgetTokens=8000)=>prepareCognitionContext(e.repo,e.files,agent,e.repo.getWorld()!,{budgetTokens,outputReserveTokens:2000});
    const full=await build(30000);
    const keys=category==='peer message'?['newMessageIds'] as const:category==='own result'?['newObservationEventIds','actionResultIds'] as const:category==='shared consequence'?['newObservationEventIds','sharedConsequenceIds'] as const:category==='continuity'?['continuityEventIds'] as const:['newObservationEventIds'] as const;
    const bare=structuredClone(full.input);for(const key of keys)bare.currentObservation.contextDelivery[key]=[];
    const base=tokens(bare),pad=(8000-base)*3;
    let chosen=-1;
    for(let offset=-2;offset<=2;offset++){const value='x'.repeat(pad+offset);bare.currentObservation.self.metadata.packingPadding=value;full.input.currentObservation.self.metadata.packingPadding=value;if(tokens(bare)===8000&&(category!=='continuity'||tokens(full.input)===8002)){chosen=pad+offset;break;}}
    expect(chosen).toBeGreaterThan(0);agent.metadata.packingPadding='x'.repeat(chosen);
    expect(tokens(bare)).toBe(8000);expect(tokens(full.input)).toBeGreaterThan(8000);if(category==='continuity')expect(tokens(full.input)).toBe(8002);
    const rejected=await build(),observation=rejected.input.currentObservation;
    expect(tokens(rejected.input)).toBeLessThanOrEqual(8000);expect(rejected.diagnostic.estimatedTotalInputTokens).toBe(tokens(rejected.input));
    for(const key of keys)expect(observation.contextDelivery[key]).toEqual([]);
    expect(message?observation.newlyDeliveredMessages:observation.nearbyOrRelevantEvents).toEqual([]);
    if(message){expect(rejected.advance.messageRowId).toBe(0);expect(rejected.diagnostic.pending.messages).toBe(1);}
    else if(category==='continuity')expect(rejected.advance.ownEventId).toBe(event!.id);
    else if(category==='shared consequence'){expect(rejected.advance.sharedEventId).toBeLessThan(event!.id);expect(rejected.diagnostic.pending.sharedConsequences).toBe(1);}
    else expect(rejected.advance.ownEventId).toBeLessThan(event!.id);
    // Make just enough room, keeping the configured budget. Mandatory observations win.
    agent.metadata.packingPadding='x'.repeat(chosen-60);const admitted=await build(),seen=admitted.input.currentObservation;
    for(const key of keys)expect(seen.contextDelivery[key]).toEqual([message?.id??event!.id]);
    expect(message?seen.newlyDeliveredMessages.map(item=>item.id):seen.nearbyOrRelevantEvents.map(item=>item.id)).toEqual([message?.id??event!.id]);
    if(message)expect(admitted.advance.messageRowId).toBe(e.repo.latestMessageRowId(mam.id));
    else if(category==='shared consequence')expect(admitted.advance.sharedEventId).toBe(event!.id);
    else expect(admitted.advance.ownEventId).toBe(event!.id);
    expect(tokens(admitted.input)).toBeLessThanOrEqual(8000);
  });

  it('budgets truncation notes and embedded artifact/history identifiers in the complete payload',async()=>{
    const e=await fixture(),a=e.repo.getAgent('Mam')!,b=e.repo.getAgent('Toey')!;
    await e.perform(a.id,{type:'CREATE_TEXT_FILE',path:'working.txt',content:'x'.repeat(5000)});
    await e.perform(a.id,{type:'READ_FILE',path:'working.txt'});
    await e.perform(a.id,{type:'READ_FILE',path:'working.txt'});
    for(let i=0;i<10;i++){e.repo.sendMessage(b.id,'agent',a.id,0,'message '+i+'x'.repeat(1000));e.repo.addMemory(a.id,'knowledge','memory '+i+'x'.repeat(3000),0);}
    // The new mandatory action schema increases foundation size; keep this fixture tightly bounded.
    const p=await prepareCognitionContext(e.repo,e.files,a,e.repo.getWorld()!,{budgetTokens:3500,outputReserveTokens:2000}),o=p.input.currentObservation;
    expect(tokens(p.input)).toBeLessThanOrEqual(3500);expect(o.contextDelivery.newMessageIds).toEqual(o.newlyDeliveredMessages.map(m=>m.id));
    expect(o.contextDelivery.actionResultIds).toEqual(o.nearbyOrRelevantEvents.filter(event=>event.delivery==='NEW_ACTION_RESULT').map(event=>event.id));
    expect(p.diagnostic.sections.deliveryMetadata!.estimatedTokens).toBe(estimateContextTokens(o.contextDelivery));
    expect(p.diagnostic.pending.messages).toBeGreaterThan(0);expect(e.repo.observationCursor(a.id).messageRowId).toBe(0);
  });
});

describe('local cognition failures stop at the unfinished boundary',()=>{
  it.each([false,true])('pauses pre-provider faults with durable scheduler=%s and no credit leak',async(durable)=>{
    const think=vi.fn(async()=>success()),sandbox=new FakeExecutionSandbox(()=>execution),dispatch=vi.spyOn(sandbox,'execute'),e=await fixture({think},sandbox),a=e.repo.getAgent('Mam')!,b=e.repo.getAgent('Toey')!;
    e.repo.sendMessage(b.id,'agent',a.id,0,'must stay unread');
    const before=e.repo.observationCursor(a.id),credits=e.repo.economy.self(a.id).cognitionCredits;
    // Real builder failure, before opportunity creation, rather than a provider fake.
    e.repo.db.prepare('UPDATE agents SET metadata=? WHERE id=?').run(JSON.stringify({padding:'x'.repeat(30000)}),a.id);
    e.resume();const result=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:10,...(durable?{rateLimitSuspension:policy}:{})});
    expect(result).toMatchObject({ticks:0,reason:'local cognition preparation failure: context_prepare/input_budget_exceeded'});
    expect(think).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();expect(e.repo.getWorld()).toMatchObject({currentTick:0,status:'paused'});
    expect(e.repo.observationCursor(a.id)).toEqual(before);expect(e.repo.economy.self(a.id).cognitionCredits).toEqual(credits);
    expect(e.repo.db.prepare('SELECT * FROM cognition_opportunities').all()).toEqual([]);expect(e.repo.db.prepare("SELECT * FROM value_reservations WHERE purpose='COGNITION'").all()).toEqual([]);
    const events=e.repo.listEvents(100);expect(events.filter(event=>['COGNITION_PROVIDER_ERROR','COGNITION_FALLBACK','PROVIDER_COOLDOWN_STARTED','PROVIDER_COOLDOWN_RETRY','AUTONOMY_CIRCUIT_BREAKER_OPENED','AGENT_WAITED','TICK_COMPLETED'].includes(event.type))).toEqual([]);
    const local=events.find(event=>event.type==='COGNITION_LOCAL_ERROR')!;expect(local.payload).toMatchObject({phase:'context_prepare',code:'input_budget_exceeded',committedTick:0,cognitionHoldStatus:'none',providerAttempts:0});expect(eventVisibility(local)).toBe('OWNER_KERNEL_ONLY');
    expect(e.repo.runnerLeaseStatus().present).toBe(false);if(durable)expect(e.repo.tickSchedule()).toMatchObject({state:'PAUSED',completedAgentIds:[],cooldownStartedAtMs:null,rateLimitAttempts:0});else expect(e.repo.tickSchedule()).toBeNull();
    expect(createRunReport(e.repo,result.runId).facts).toMatchObject({localCognitionFailures:1,providerFailures:0,providerSuspensions:0,systemFallbackActions:0});
    expect(createExperimentReport(e.repo,result.runId)).toMatchObject({localCognitionFailures:1,providerFailures:0,providerSuspensions:0});
    await e.tick();expect(e.repo.listEvents(100).filter(event=>event.type==='COGNITION_LOCAL_ERROR')).toHaveLength(1);
    // Explicit repair/resume recovers a locally paused schedule without a provider retry event.
    e.repo.db.prepare('UPDATE agents SET metadata=? WHERE id=?').run('{}',a.id);e.resume();const recovered=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:1,...(durable?{rateLimitSuspension:policy}:{})});
    expect(recovered.ticks).toBe(1);expect(think).toHaveBeenCalledTimes(2);expect(e.repo.listEvents(100).some(event=>event.type==='PROVIDER_COOLDOWN_RETRY')).toBe(false);
  });

  it('preserves an existing hold after local request preparation fails, then consumes it once after restart',async()=>{
    const fetcher=vi.fn(),provider=new OpenAICompatibleCognitionProvider({apiKey:null,fetcher}),e=await fixture(provider),a=e.repo.getAgent('Mam')!;
    e.repo.setSleepingUntil(e.repo.getAgent('Toey')!.id,10);e.resume();const before=e.repo.economy.self(a.id).cognitionCredits.total,cursor=e.repo.observationCursor(a.id);
    const failed=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:1,rateLimitSuspension:policy});expect(failed.reason).toContain('request_prepare/configuration_invalid');expect(fetcher).not.toHaveBeenCalled();
    const opportunity=e.repo.db.prepare('SELECT * FROM cognition_opportunities').get() as {id:string;context:string};
    expect(e.repo.economy.reservation(opportunity.id)?.status).toBe('RESERVED');expect(e.repo.economy.self(a.id).cognitionCredits).toEqual({total:before,reserved:1,available:before-1});expect(e.repo.observationCursor(a.id)).toEqual(cursor);
    const dir=e.config.dataDir;e.close();const think=vi.fn(async(input:CognitionInput)=>{expect(JSON.stringify(input)).toBe(JSON.stringify(JSON.parse(opportunity.context).input));return success();}),restarted=new WorldEngine(defaultConfig(dir),{think});engines.push(restarted);
    await restarted.tick();expect(think).not.toHaveBeenCalled();restarted.resume();const recovered=await new ContinuousWorldRunner(restarted).run({tickMs:0,maxTicks:1,rateLimitSuspension:policy});expect(recovered.ticks).toBe(1);expect(think).toHaveBeenCalledTimes(1);
    expect(restarted.repo.economy.self(a.id).cognitionCredits).toEqual({total:before-1,reserved:0,available:before-1});
    expect(restarted.repo.db.prepare('SELECT transition FROM reservation_journal WHERE reservation_id=? ORDER BY id').all(opportunity.id)).toEqual([{transition:'RESERVED'},{transition:'CONSUMED'}]);
    expect(restarted.repo.economy.integrity()).toEqual([]);
  });

  it('rejects corrupt persisted context locally and preserves its hold on repeated explicit restarts',async()=>{
    const think=vi.fn(async()=>success()),e=await fixture({think}),a=e.repo.getAgent('Mam')!,id=`cognition:${e.repo.getWorld()!.id}:1:${a.id}`;
    e.repo.economy.reserve(id,'RESOURCE','COGNITION_CREDIT',`AGENT:${a.id}`,1,'COGNITION');e.repo.db.prepare("INSERT INTO cognition_opportunities(id,agent_id,tick,context,action_id,status) VALUES(?,?,?,?,?,'PENDING')").run(id,a.id,1,'{invalid',randomUUID());
    for(let i=0;i<2;i++){e.resume();await expect(e.tick()).rejects.toBeInstanceOf(LocalCognitionPreparationError);expect(e.repo.getWorld()).toMatchObject({currentTick:0,status:'paused'});}
    expect(think).not.toHaveBeenCalled();expect(e.repo.economy.reservation(id)?.status).toBe('RESERVED');expect(e.repo.db.prepare('SELECT * FROM reservation_journal WHERE reservation_id=?').all(id)).toHaveLength(1);expect(e.repo.economy.integrity()).toEqual([]);
  });

  it('keeps a completed peer action exactly once when a later inhabitant has a local fault',async()=>{
    const think=vi.fn(async()=>success()),e=await fixture({think}),a=e.repo.getAgent('Mam')!,b=e.repo.getAgent('Toey')!;
    e.repo.db.prepare('UPDATE agents SET metadata=? WHERE id=?').run(JSON.stringify({padding:'x'.repeat(30000)}),b.id);e.resume();const failed=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:2,rateLimitSuspension:policy});expect(failed.ticks).toBe(0);expect(think).toHaveBeenCalledTimes(1);expect(e.repo.tickSchedule()?.completedAgentIds).toEqual([a.id]);
    e.repo.db.prepare('UPDATE agents SET metadata=? WHERE id=?').run('{}',b.id);e.resume();await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:1,rateLimitSuspension:policy});expect(think).toHaveBeenCalledTimes(2);expect(e.repo.listEvents(100).filter(event=>event.type==='AGENT_WAITED'&&event.actorId===a.id)).toHaveLength(1);
    expect(e.repo.listEvents(100).find(event=>event.type==='AUTONOMY_RUN_STOPPED'&&event.payload.runId===failed.runId)?.payload.cognitionTurns).toBe(1);
  });

  it('keeps a consumed successful opportunity intact when its persisted output cannot be recovered',async()=>{
    const think=vi.fn(async()=>success()),e=await fixture({think}),a=e.repo.getAgent('Mam')!,id=`cognition:${e.repo.getWorld()!.id}:1:${a.id}`,prepared=await prepareCognitionContext(e.repo,e.files,a,e.repo.getWorld()!,{budgetTokens:8000,outputReserveTokens:2000});
    const before=e.repo.economy.self(a.id).cognitionCredits.total;
    e.repo.economy.reserve(id,'RESOURCE','COGNITION_CREDIT',`AGENT:${a.id}`,1,'COGNITION');e.repo.economy.resolveReservation(id,1);
    e.repo.db.prepare("INSERT INTO cognition_opportunities(id,agent_id,tick,context,output,action_id,status) VALUES(?,?,?,?,?,?,'SUCCESS')").run(id,a.id,1,JSON.stringify(prepared),JSON.stringify({thoughtSummary:'persisted',selectedAction:{type:'INVALID'}}),randomUUID());
    e.resume();await expect(e.tick()).rejects.toMatchObject({phase:'cognition_recovery',code:'local_preparation_failed'});
    expect(think).not.toHaveBeenCalled();expect(e.repo.economy.reservation(id)?.status).toBe('CONSUMED');expect(e.repo.economy.self(a.id).cognitionCredits.total).toBe(before-1);expect(e.repo.getWorld()).toMatchObject({status:'paused',currentTick:0});
    // Correct the fixture's corrupted persisted output; recovery reuses it without a call/debit.
    e.repo.db.prepare('UPDATE cognition_opportunities SET output=? WHERE id=?').run(JSON.stringify(success()),id);e.repo.setSleepingUntil(e.repo.getAgent('Toey')!.id,10);e.resume();await e.tick();
    expect(think).not.toHaveBeenCalled();expect(e.repo.economy.self(a.id).cognitionCredits.total).toBe(before-1);expect(e.repo.db.prepare('SELECT * FROM reservation_journal WHERE reservation_id=?').all(id)).toHaveLength(2);
  });

  it('classifies request serialization before HTTP without retrying or exposing source data',async()=>{
    const e=await fixture(),a=e.repo.getAgent('Mam')!,prepared=await prepareCognitionContext(e.repo,e.files,a,e.repo.getWorld()!,{budgetTokens:8000,outputReserveTokens:2000}),fetcher=vi.fn(),provider=new OpenAICompatibleCognitionProvider({apiKey:'fake',fetcher});
    prepared.input.currentObservation.self.metadata.circular=prepared.input;
    await expect(provider.think(prepared.input)).rejects.toMatchObject({phase:'request_prepare',code:'local_preparation_failed'});expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies untyped builder exceptions by their local boundary and persists no raw exception',async()=>{
    const think=vi.fn(async()=>success()),e=await fixture({think});
    vi.spyOn(e.repo,'relevantMemories').mockImplementation(()=>{throw new Error('secret fixture at https://private.invalid');});
    e.resume();const result=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:1});
    expect(result).toMatchObject({ticks:0,reason:'local cognition preparation failure: context_prepare/local_preparation_failed'});
    expect(think).not.toHaveBeenCalled();expect(JSON.stringify(e.repo.listEvents(100))).not.toContain('private.invalid');expect(e.repo.getWorld()?.status).toBe('paused');
  });
});

describe('genuine provider classification remains distinct',()=>{
  it.each([408,429,500,502,503,504])('keeps HTTP %s short retries and genuine infrastructure breaker behavior',async(httpStatus)=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{message:'fixture unavailable'}}),{status:httpStatus}));
    const provider=new OpenAICompatibleCognitionProvider({apiKey:'fixture',fetcher,maxRetries:1}),e=await fixture(provider);
    e.repo.setSleepingUntil(e.repo.getAgent('Toey')!.id,10);e.resume();const result=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:3,infrastructureFailureThreshold:1});
    expect(result).toMatchObject({ticks:1,reason:'infrastructure failure circuit breaker'});expect(fetcher).toHaveBeenCalledTimes(2);
    const report=createRunReport(e.repo,result.runId);expect(report.facts).toMatchObject({localCognitionFailures:0,providerFailures:1,providerSuspensions:0,systemFallbackActions:1,providerHttpAttemptsRecorded:2,shortProviderRetriesRecorded:1});
    expect(e.repo.listEvents(100).find(event=>event.type==='COGNITION_PROVIDER_ERROR')?.payload).toMatchObject({phase:'http',httpStatus,attemptCount:2});
  });
});

describe('execution admission facts',()=>{
  async function workload(e:WorldEngine,tool:boolean){const a=e.repo.getAgent('Mam')!;await e.perform(a.id,{type:'CREATE_TEXT_FILE',path:'main.js',content:'console.log("ok")'});if(!tool)return{type:'EXECUTE_PROGRAM' as const,runtime:'node' as const,entrypoint:'main.js',args:[],stdin:''};const published=await e.perform(a.id,{type:'PUBLISH_TOOL',sourceDirectory:'.',entrypoint:'main.js',runtime:'node',name:'fixture',description:'fixture',visibility:'SHARED'});return{type:'INVOKE_TOOL' as const,toolVersionId:(published.effects[0]!.toolVersion as {id:string}).id,input:{}};}
  it.each([false,true])('rejects repeated insufficient Local Compute with tool=%s before dispatch',async(tool)=>{
    const sandbox=new FakeExecutionSandbox(()=>execution),dispatch=vi.spyOn(sandbox,'execute'),e=await fixture(undefined,sandbox),a=e.repo.getAgent('Mam')!,action=await workload(e,tool);setLocal(e,a.id,10,a.storageBytes);
    for(let i=0;i<3;i++){const result=await e.perform(a.id,action);expect(result.success).toBe(false);expect(result.effects).toEqual([{reason:'insufficient_local_compute',resource:'LOCAL_COMPUTE',requiredReservation:100,available:10}]);expect(result.error).toContain('required reservation 100, available 10');}
    expect(dispatch).not.toHaveBeenCalled();expect(e.repo.executionsFor(a.id)).toEqual([]);expect(e.repo.db.prepare('SELECT * FROM execution_outcomes').all()).toEqual([]);expect(e.repo.db.prepare("SELECT * FROM value_reservations WHERE purpose='EXECUTION'").all()).toEqual([]);
    expect(e.repo.economy.self(a.id).localCompute).toEqual({total:10,reserved:0,available:10});expect(e.repo.economy.consumed('LOCAL_COMPUTE')).toBe(0);
    const events=e.repo.listEvents(100);expect(events.some(event=>event.type==='PROGRAM_EXECUTION_STARTED'||event.type==='TOOL_INVOKED')).toBe(false);expect(events.filter(event=>event.type==='ACTION_FAILED')).toHaveLength(3);
    const visible=await e.observe(a);expect(visible.nearbyOrRelevantEvents.filter(event=>event.type==='ACTION_FAILED')).toHaveLength(3);expect(JSON.stringify(visible)).toContain('insufficient_local_compute');
  });

  it.each([false,true])('reserves 100 before sandbox dispatch, settles actual cost once with tool=%s',async(tool)=>{
    const e=await fixture(),a=e.repo.getAgent('Mam')!,action=await workload(e,tool),id=randomUUID();setLocal(e,a.id,100,a.storageBytes);
    const dispatch=vi.spyOn(e.executionSandbox,'execute').mockImplementation(async()=>{expect(e.repo.economy.self(a.id).localCompute).toEqual({total:100,reserved:100,available:0});expect(e.repo.listEvents(100).find(event=>event.type===(tool?'TOOL_INVOKED':'PROGRAM_EXECUTION_STARTED'))?.payload.boundary).toBe('sandbox_dispatch');return execution;});
    expect((await e.perform(a.id,action,0,()=>true,id)).success).toBe(true);expect((await e.perform(a.id,action,0,()=>true,id)).success).toBe(true);expect(dispatch).toHaveBeenCalledTimes(1);
    // 25 base + 1 duration + 1 output; the unused 73 units are available again.
    expect(e.repo.economy.self(a.id).localCompute).toEqual({total:73,reserved:0,available:73});expect(e.repo.executionsFor(a.id)).toHaveLength(1);expect(e.repo.db.prepare('SELECT * FROM execution_outcomes').all()).toHaveLength(1);expect(e.repo.economy.integrity()).toEqual([]);
  });

  it('STARTED proves admission and dispatch even when Docker image verification rejects before container launch',async()=>{
    const e=await fixture(),a=e.repo.getAgent('Mam')!,action=await workload(e,false),verify=vi.fn(async()=>({verified:false,resolved:null,error:'fixture missing image'})),sandbox=new DockerExecutionSandbox(undefined,verify);
    vi.spyOn(e.executionSandbox,'execute').mockImplementation(request=>sandbox.execute(request));setLocal(e,a.id,100,a.storageBytes);
    const result=await e.perform(a.id,action);expect(result.success).toBe(false);expect(verify).toHaveBeenCalledTimes(1);expect(e.repo.listEvents(100).filter(event=>event.type==='PROGRAM_EXECUTION_STARTED')).toHaveLength(1);expect(e.repo.executionsFor(a.id)).toHaveLength(1);expect(e.repo.economy.self(a.id).localCompute).toEqual({total:75,reserved:0,available:75});expect(e.repo.db.prepare('SELECT * FROM execution_outcomes').all()).toHaveLength(1);
  });

  it('reads historical false STARTED sequences and generic provider errors without rewriting their provenance',async()=>{
    const e=await fixture();e.resume();const run=await new ContinuousWorldRunner(e).run({tickMs:0,maxTicks:1});const record=e.repo.getAutonomyRun(run.runId)!,a=e.repo.getAgent('Mam')!;
    const old=e.repo.addEvent('PROGRAM_EXECUTION_STARTED',1,a.id,null,{runtime:'node',entrypoint:'old.js'});e.repo.addEvent('ACTION_FAILED',1,a.id,null,{error:'Insufficient available balance to reserve'});e.repo.addEvent('COGNITION_PROVIDER_ERROR',1,a.id,null,{phase:'unknown',attempts:0});
    e.repo.db.prepare('UPDATE autonomy_runs SET end_event_id=? WHERE id=?').run(e.repo.latestEventId(),record.id);const report=createRunReport(e.repo,record.id);
    expect(report.facts).toMatchObject({localCognitionFailures:0,providerFailures:1,executions:0});expect(e.repo.eventsBetweenIds(old.id-1,old.id)[0]).toEqual(old);expect(eventVisibility(old)).toBe('AGENT_VISIBLE');
  });

  it('delivers neutral admission facts as ordinary failed cognition action consequences on repeated selections',async()=>{
    const think=vi.fn(async()=>({thoughtSummary:'try executable',selectedAction:{type:'EXECUTE_PROGRAM' as const,runtime:'node' as const,entrypoint:'main.js',args:[],stdin:''}})),sandbox=new FakeExecutionSandbox(()=>execution),dispatch=vi.spyOn(sandbox,'execute'),e=await fixture({think},sandbox),a=e.repo.getAgent('Mam')!;
    await workload(e,false);setLocal(e,a.id,10,a.storageBytes);e.repo.setSleepingUntil(e.repo.getAgent('Toey')!.id,10);e.resume();await e.run(3);
    expect(think).toHaveBeenCalledTimes(3);expect(dispatch).not.toHaveBeenCalled();expect(e.repo.economy.self(a.id).localCompute).toEqual({total:10,reserved:0,available:10});
    const results=e.repo.listEvents(100).filter(event=>event.type==='ACTION_RESULT');expect(results).toHaveLength(3);
    for(const result of results){expect(result.payload.success).toBe(false);expect(result.payload.effects).toEqual([{reason:'insufficient_local_compute',resource:'LOCAL_COMPUTE',requiredReservation:100,available:10}]);}
    expect(e.repo.listEvents(100).some(event=>event.type==='PROGRAM_EXECUTION_STARTED')).toBe(false);
  });
});
