import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { configuredCognitionProvider,isSuspendableProviderFailure,type CognitionInput,type CognitionOutput,type CognitionProvider,type ProviderFailureDetails } from '../packages/cognition/src/index.js';
import { createRunReport } from '../packages/operations/src/run-report.js';
import { WorldEngine,defaultConfig } from '../packages/world/src/engine.js';
import { ContinuousWorldRunner } from '../packages/world/src/runner.js';

const dirs:string[]=[];
const policy={initialBackoffMs:5,maxBackoffMs:15,maxSuspensionMs:250,retryAfterMaxMs:100};
const success=(ticks=1):CognitionOutput=>({thoughtSummary:'Selected WAIT.',selectedAction:{type:'WAIT',ticks},reasoningMetadata:{providerRequestSucceeded:true,providerAttempts:1,providerUsageAvailable:true,inputTokens:7,outputTokens:2}});
const failure=(phase:'timeout'|'transport'|'response_parse'|'response_schema'|'http',httpStatus?:number):CognitionOutput=>({thoughtSummary:'Cognition output could not be validated; safely waited.',selectedAction:{type:'WAIT',ticks:1},reasoningMetadata:{providerError:'Provider unavailable',providerRequestSucceeded:false,providerAttempts:2,providerUsageAvailable:false,inputTokens:0,outputTokens:0,providerFailure:{phase,...(httpStatus===undefined?{}:{httpStatus}),message:'Provider unavailable',retryable:true}}});
async function setup(provider:CognitionProvider){const dir=await mkdtemp(path.join(tmpdir(),'ai-world-provider-suspension-'));dirs.push(dir);const engine=new WorldEngine(defaultConfig(dir),provider);await engine.genesis();engine.resume();return{engine,dir};}
const state=(engine:WorldEngine,name:string)=>{const agent=engine.repo.getAgent(name)!;return{compute:agent.computeCredits,sleep:agent.sleepingUntilTick,cursor:engine.repo.observationCursor(agent.id),memories:engine.repo.memoryCount(agent.id)};};
const runEvents=(engine:WorldEngine,id:string)=>{const run=engine.repo.getAutonomyRun(id)!;return engine.repo.eventsBetweenIds(run.startEventId,run.endEventId!);};
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});

describe('long-profile provider infrastructure suspension',()=>{
  const cases:Array<[Partial<ProviderFailureDetails>,boolean]>=[
    [{phase:'timeout',retryable:true},true],
    [{phase:'transport',retryable:true},true],
    ...[408,429,500,502,503,504].map((httpStatus):[Partial<ProviderFailureDetails>,boolean]=>[{phase:'http',httpStatus,retryable:true},true]),
    ...[400,401,403,404,200].map((httpStatus):[Partial<ProviderFailureDetails>,boolean]=>[{phase:'http',httpStatus,retryable:true},false]),
    [{phase:'response_parse',retryable:true},false],
    [{phase:'response_schema',httpStatus:200,retryable:true},false],
    [{phase:'timeout',retryable:false},false],
  ];
  it.each(cases)('classifies %j as suspendable=%s',(diagnostic,expected)=>{expect(isSuspendableProviderFailure(diagnostic)).toBe(expected);});

  it('freezes timeout cognition, retries identical context, and acts once',async()=>{
    const calls:string[]=[],contexts:string[]=[];let mam=0;
    const {engine}=await setup({async think(input){calls.push(input.identity.name);if(input.identity.name==='Mam'){contexts.push(JSON.stringify(input));if(mam++===0)return failure('timeout');}return success();}});
    const before=state(engine,'Mam');const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'space-bunny-free',rateLimitSuspension:policy});const events=runEvents(engine,result.runId),report=createRunReport(engine.repo,result.runId);
    expect(result.ticks).toBe(1);expect(calls).toEqual(['Mam','Mam','Toey']);expect(contexts[0]).toBe(contexts[1]);
    expect(events.filter((event)=>event.type==='TICK_COMPLETED')).toHaveLength(1);
    expect(events.filter((event)=>event.type==='AUTONOMY_ACTION')).toHaveLength(2);
    expect(events.filter((event)=>event.type==='COGNITION_PROVIDER_ERROR'||event.type==='COGNITION_FALLBACK')).toHaveLength(0);
    expect(events.filter((event)=>event.type==='AGENT_WAITED'&&event.actorId===engine.repo.getAgent('Mam')!.id)).toHaveLength(1);
    expect(events.find((event)=>event.type==='PROVIDER_COOLDOWN_STARTED')?.payload).toMatchObject({phase:'timeout',providerAttempts:2});
    expect(report.facts).toMatchObject({rateLimitSuspensions:0,providerSuspensions:1,providerSuspensionRetries:1,providerSuspensionRecoveries:1,timeoutSuspensions:1,providerHttpAttemptsRecorded:4,shortProviderRetriesRecorded:1,providerAttemptsWithUnknownUsage:2,logicalCognitionOpportunities:2});
    expect(before.compute-state(engine,'Mam').compute).toBe(6);engine.close();
  });

  it('preserves a completed peer and frozen pending context through cancellation and restart',async()=>{
    const controller=new AbortController(),calls:string[]=[],contexts:string[]=[];
    const {engine,dir}=await setup({async think(input){calls.push(input.identity.name);if(input.identity.name==='Toey'){contexts.push(JSON.stringify(input));queueMicrotask(()=>controller.abort());return failure('timeout');}return success();}});
    const mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const priorAction=engine.repo.addEvent('ACTION_RESULT',0,toey.id,null,{actionType:'WAIT',actionId:'prior-intentional-wait',success:true,effects:[{waitedTicks:1,wakeTick:1}]});
    const cursor=engine.repo.observationCursor(toey.id);expect(engine.repo.advanceObservationCursor(toey.id,{before:cursor,messageRowId:cursor.messageRowId,ownEventId:priorAction.id,sharedEventId:priorAction.id},0)).toBe(true);
    const prior=engine.repo.sendMessage(toey.id,'agent',mam.id,0,'Earlier peer note'),toeyBefore=state(engine,'Toey');
    const first=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'space-bunny-free',rateLimitSuspension:policy,signal:controller.signal});
    expect(first).toMatchObject({ticks:0,reason:'shutdown signal'});expect(calls).toEqual(['Mam','Toey']);expect(engine.repo.getWorld()?.currentTick).toBe(0);expect(state(engine,'Toey')).toEqual(toeyBefore);
    expect(engine.repo.tickSchedule()).toMatchObject({state:'PAUSED',completedAgentIds:[mam.id],pendingAgentId:engine.repo.getAgent('Toey')!.id,suspensionCause:{phase:'timeout'}});
    expect(engine.repo.tickScheduleDiagnostic()).toMatchObject({providerSuspensionAttempts:1,suspensionCause:{phase:'timeout'}});expect(engine.repo.runnerLeaseStatus().present).toBe(false);engine.close();
    const resumedCalls:string[]=[];const resumed=new WorldEngine(defaultConfig(dir),{async think(input){resumedCalls.push(input.identity.name);contexts.push(JSON.stringify(input));return success();}});
    const second=await new ContinuousWorldRunner(resumed).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'space-bunny-free',rateLimitSuspension:policy});
    expect(second.ticks).toBe(1);expect(resumedCalls).toEqual(['Toey']);expect(contexts[0]).toBe(contexts[1]);
    expect((JSON.parse(contexts[0]!) as CognitionInput).currentObservation.recentPeerConversation.map((message)=>message.id)).toContain(prior.id);
    expect((JSON.parse(contexts[0]!) as CognitionInput).currentObservation.recentSelfActivity.map((activity)=>activity.actionId)).toContain('prior-intentional-wait');
    expect(runEvents(resumed,second.runId).find((event)=>event.type==='PROVIDER_COOLDOWN_RETRY')?.payload).toMatchObject({phase:'timeout',resumed:true});
    expect(resumed.repo.listEvents().filter((event)=>event.type==='AUTONOMY_ACTION'&&event.actorId===mam.id&&event.tick===1)).toHaveLength(1);
    expect(resumed.repo.listEvents().filter((event)=>event.type==='TICK_COMPLETED'&&event.tick===1)).toHaveLength(1);resumed.close();
  });

  it('keeps the tick frozen when the other inhabitant sleeps, including repeated timeout and exhaustion',async()=>{
    let calls=0;const {engine}=await setup({async think(input){if(input.identity.name==='Mam'){calls++;return failure('timeout');}return success(10);}});
    engine.repo.setSleepingUntil(engine.repo.getAgent('Toey')!.id,10);const before=state(engine,'Mam');
    const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'space-bunny-free',rateLimitSuspension:{...policy,maxSuspensionMs:35}});
    expect(result).toMatchObject({ticks:0,reason:'provider suspension exhausted'});expect(calls).toBeGreaterThanOrEqual(2);
    expect(engine.repo.getWorld()?.currentTick).toBe(0);expect(state(engine,'Mam')).toEqual(before);
    expect(engine.repo.tickSchedule()).toMatchObject({state:'PAUSED',pendingAgentId:engine.repo.getAgent('Mam')!.id});
    expect(engine.repo.listEvents().filter((event)=>event.type==='AUTONOMY_ACTION'||event.type==='TICK_COMPLETED')).toHaveLength(0);
    expect(engine.repo.runnerLeaseStatus().present).toBe(false);engine.close();
  });

  it('preserves resources and cursor across several timeout retries before success',async()=>{
    const probe:{engine?:WorldEngine;initial?:ReturnType<typeof state>}={};let mamCalls=0;
    const setupResult=await setup({async think(input){if(input.identity.name==='Mam'){if(probe.engine&&probe.initial){expect(state(probe.engine,'Mam')).toEqual(probe.initial);expect(probe.engine.repo.getWorld()?.currentTick).toBe(0);}if(mamCalls++<3)return failure('timeout');}return success();}});
    const engine=setupResult.engine;probe.engine=engine;probe.initial=state(engine,'Mam');
    const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'model',rateLimitSuspension:{...policy,maxSuspensionMs:500}}),events=runEvents(engine,result.runId);
    expect(mamCalls).toBe(4);expect(result.ticks).toBe(1);expect(events.filter((event)=>event.type==='PROVIDER_COOLDOWN_FAILURE')).toHaveLength(3);
    expect(events.filter((event)=>event.type==='TICK_COMPLETED')).toHaveLength(1);expect(events.filter((event)=>event.type==='COGNITION_FALLBACK')).toHaveLength(0);engine.close();
  });

  it.each([['transport',undefined],['http',408],['http',500],['http',503]] as const)('suspends %s %s then recovers',(phase,status)=>{
    return (async()=>{let calls=0;const {engine}=await setup({async think(){return calls++===0?failure(phase,status):success();}});
      const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'model',rateLimitSuspension:policy});
      const events=runEvents(engine,result.runId);expect(result.ticks).toBe(1);expect(events.find((event)=>event.type==='PROVIDER_COOLDOWN_STARTED')?.payload).toMatchObject({phase,...(status===undefined?{}:{httpStatus:status})});expect(events.some((event)=>event.type==='COGNITION_PROVIDER_ERROR')).toBe(false);engine.close();})();
  });

  it.each([['response_parse',undefined],['response_schema',200],['http',400],['http',401],['http',403],['http',404]] as const)('falls back for %s %s without suspension',(phase,status)=>{
    return (async()=>{const {engine}=await setup({async think(){return failure(phase,status);}});
      const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'model',rateLimitSuspension:policy});
      const events=runEvents(engine,result.runId);expect(result.ticks).toBe(1);expect(events.filter((event)=>event.type==='COGNITION_PROVIDER_ERROR')).toHaveLength(2);expect(events.some((event)=>event.type==='PROVIDER_COOLDOWN_STARTED')).toBe(false);engine.close();})();
  });

  it('keeps heartbeat alive through timeout cooldown',async()=>{
    let calls=0;const {engine}=await setup({async think(){return calls++===0?failure('timeout'):success();}});
    const renew=vi.spyOn(engine.repo,'renewRunnerLease');engine.config.runnerHeartbeatMs=10;engine.config.runnerLeaseMs=100;
    const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'model',rateLimitSuspension:{...policy,initialBackoffMs:60,maxBackoffMs:60,maxSuspensionMs:200}});
    expect(result.ticks).toBe(1);expect(renew.mock.calls.length).toBeGreaterThanOrEqual(3);expect(engine.repo.listEvents().some((event)=>event.type==='RUNNER_LEASE_LOST')).toBe(false);engine.close();
  });

  it('keeps timeout fallback in the ordinary profile and reports unknown upstream usage',async()=>{
    const {engine}=await setup({async think(){return failure('timeout');}});
    const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'model'}),report=createRunReport(engine.repo,result.runId);
    expect(result.ticks).toBe(1);expect(report).toMatchObject({cognitionAttempts:2,cognitionTurns:0,facts:{providerFailures:2,systemFallbackActions:2,providerSuspensions:0,providerHttpAttemptsRecorded:4,shortProviderRetriesRecorded:2,providerAttemptsWithUnknownUsage:4}});
    expect(engine.repo.listEvents().some((event)=>event.type==='PROVIDER_COOLDOWN_STARTED')).toBe(false);engine.close();
  });

  it('does not report recovery when a pending timeout retry ends in schema fallback',async()=>{
    let mam=0;const {engine}=await setup({async think(input){if(input.identity.name==='Mam')return mam++===0?failure('timeout'):failure('response_schema',200);return success();}});
    const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:1,provider:'opencode-zen',modelIdentifier:'model',rateLimitSuspension:policy}),events=runEvents(engine,result.runId),report=createRunReport(engine.repo,result.runId);
    expect(result.ticks).toBe(1);expect(events.some((event)=>event.type==='PROVIDER_COOLDOWN_RECOVERED')).toBe(false);
    expect(events.find((event)=>event.type==='PROVIDER_COOLDOWN_ABORTED')?.payload).toMatchObject({phase:'timeout',reason:'pending cognition fell back after suspension'});
    expect(report.facts).toMatchObject({providerSuspensions:1,providerSuspensionRecoveries:0,providerFailures:1,systemFallbackActions:1});engine.close();
  });
});

describe('OpenCode request timeout configuration',()=>{
  const env={COGNITION_PROVIDER:'opencode-zen',OPENCODE_ZEN_API_KEY:'test',OPENCODE_ZEN_MODEL:'space-bunny-free'};
  it('defaults to 45 seconds and accepts an override without affecting OpenRouter',async()=>{
    const delays:number[]=[];const fetcher=((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{const start=Date.now();init?.signal?.addEventListener('abort',()=>{delays.push(Date.now()-start);reject(new DOMException('aborted','AbortError'));});})) as typeof fetch;
    const configured=configuredCognitionProvider({...env,OPENCODE_ZEN_REQUEST_TIMEOUT_MS:'1000'},fetcher);expect(configured.provider).not.toBeNull();
    const result=await configured.provider!.think({identity:{id:'a',name:'Mam',bootstrapInstruction:''},currentObservation:{} as never,relevantMemories:[],availableActions:[]});
    expect(result.reasoningMetadata).toMatchObject({providerRequestSucceeded:false,providerAttempts:2,providerFailure:{phase:'timeout'}});expect(delays).toHaveLength(2);expect(delays.every((ms)=>ms>=900&&ms<1500)).toBe(true);
    expect((configuredCognitionProvider(env).provider as unknown as {timeoutMs:number}).timeoutMs).toBe(45_000);expect((configured.provider as unknown as {timeoutMs:number}).timeoutMs).toBe(1_000);
    expect(JSON.stringify(configured.provider!.configuration())).not.toContain('test');expect(configuredCognitionProvider({...env,OPENCODE_ZEN_REQUEST_TIMEOUT_MS:'0'}).error).toMatch(/REQUEST_TIMEOUT/);
    expect(configuredCognitionProvider({...env,OPENCODE_ZEN_REQUEST_TIMEOUT_MS:'abc'}).error).toMatch(/REQUEST_TIMEOUT/);
    expect(configuredCognitionProvider({...env,OPENCODE_ZEN_REQUEST_TIMEOUT_MS:'120001'}).error).toMatch(/REQUEST_TIMEOUT/);
    const router=configuredCognitionProvider({COGNITION_PROVIDER:'openrouter',OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'model',OPENCODE_ZEN_REQUEST_TIMEOUT_MS:'bad'});expect(router.provider).not.toBeNull();
  },10_000);
});
