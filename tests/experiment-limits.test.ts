import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import type { CognitionProvider } from '../packages/cognition/src/index.js';
import { DEFAULT_EXPERIMENT_CEILINGS,LONG_EXPERIMENT_CEILINGS,resolveExperimentCliLimits,resolveExperimentLimits } from '../packages/operations/src/experiment-limits.js';
import { CAPABILITIES } from '../packages/shared/src/index.js';
import { WorldEngine,defaultConfig } from '../packages/world/src/engine.js';
import { ContinuousWorldRunner } from '../packages/world/src/runner.js';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const waitProvider=(inputTokens:number):CognitionProvider=>({async think(){return{thoughtSummary:'Selected WAIT.',selectedAction:{type:'WAIT',ticks:1},reasoningMetadata:{providerRequestSucceeded:true,inputTokens,outputTokens:1}};}});
async function setup(provider:CognitionProvider){const dir=await mkdtemp(path.join(tmpdir(),'ai-world-limits-'));dirs.push(dir);const engine=new WorldEngine(defaultConfig(dir),provider);await engine.genesis();engine.resume();return engine;}
function addThirdInhabitant(engine:WorldEngine):void{const founders=engine.repo.listAgents();engine.repo.createAgent({id:randomUUID(),name:'Third',createdAt:new Date().toISOString(),generation:1,parentIds:founders.map((agent)=>agent.id),status:'active',cognitionConfig:{provider:'world-selected'},capabilities:[...CAPABILITIES],metadata:{test:true},computeCredits:10_000,storageBytes:0,sleepingUntilTick:0,eligibleFromTick:0});}

describe('experiment limit profiles',()=>{
  it('preserves conservative defaults when no profile is selected',()=>{expect(resolveExperimentCliLimits(['experiment','--live','--ticks','20'])).toEqual({profile:'default',maxTicks:20,maxCognitionTurns:40,...DEFAULT_EXPERIMENT_CEILINGS});});
  it('resolves the long profile for 500 ticks with population headroom',()=>{expect(resolveExperimentCliLimits(['experiment','--ticks','500','--profile','long'])).toEqual({profile:'long',maxTicks:500,...LONG_EXPERIMENT_CEILINGS});});
  it('lets explicit values override profile values and accepts compatibility aliases',()=>{expect(resolveExperimentCliLimits(['experiment','--ticks','500','--profile','long','--max-input-tokens','123456','--compute-ceiling','321','--execution-limit','12','--wall-ms','3456'])).toMatchObject({profile:'long',maxInputTokens:123_456,computeCeiling:321,executionLimit:12,wallClockLimitMs:3_456});});
  it('does not alter the per-cognition input budget',()=>{const before=defaultConfig('unused').cognitionInputBudgetTokens;resolveExperimentLimits({ticks:500,profile:'long'});expect(before).toBe(8_000);expect(defaultConfig('unused').cognitionInputBudgetTokens).toBe(before);});
  it.each(['0','-1','NaN','1.5','9007199254740992'])('rejects invalid tick value %s',value=>{expect(()=>resolveExperimentCliLimits(['experiment','--ticks',value])).toThrow('positive safe integer');});
  it.each(['--max-input-tokens','--max-output-tokens','--max-compute','--max-cognition-turns','--max-executions','--max-wall-clock-ms'].flatMap((flag)=>['0','-1','NaN','1.5','9007199254740992'].map((value)=>[flag,value] as const)))('rejects invalid %s value %s',(flag,value)=>{expect(()=>resolveExperimentCliLimits(['experiment','--ticks','1',flag,value])).toThrow('positive safe integer');});
  it('rejects conflicting aliases',()=>{expect(()=>resolveExperimentCliLimits(['experiment','--ticks','1','--max-compute','2','--compute-ceiling','3'])).toThrow('conflicts');});
});

describe('long-run accounting laws',()=>{
  it('does not mint inhabitant compute and counts more than two inhabitants',async()=>{const engine=await setup(waitProvider(3));addThirdInhabitant(engine);const before=engine.repo.listAgents().map((agent)=>agent.computeCredits),limits=resolveExperimentLimits({ticks:1,profile:'long'}),result=await new ContinuousWorldRunner(engine).run({tickMs:0,...limits,provider:'deterministic-test'}),after=engine.repo.listAgents().map((agent)=>agent.computeCredits),run=engine.repo.getAutonomyRun(result.runId)!;expect(after).toEqual(before.map((compute)=>compute-6));expect(run).toMatchObject({tickLimit:1,cognitionTurnLimit:5_000,inputTokenLimit:10_000_000,outputTokenLimit:500_000,computeCeiling:20_000,executionLimit:1_000,wallClockLimitMs:10_800_000});expect(engine.repo.eventsBetweenIds(run.startEventId,run.endEventId!).filter((event)=>event.type==='COGNITION_TURN_COMPLETED')).toHaveLength(3);engine.close();});
  it('terminates at a factual aggregate limit with at most one completed tick boundary of overshoot',async()=>{const perTurn=7,engine=await setup(waitProvider(perTurn));addThirdInhabitant(engine);const result=await new ContinuousWorldRunner(engine).run({tickMs:0,maxTicks:10,maxInputTokens:10,provider:'deterministic-test'}),run=engine.repo.getAutonomyRun(result.runId)!,events=engine.repo.eventsBetweenIds(run.startEventId,run.endEventId!),inputTokens=events.filter((event)=>event.type==='COGNITION_TURN_COMPLETED').reduce((sum,event)=>sum+Number(event.payload.inputTokens),0),boundaryUsage=perTurn*3;expect(result).toMatchObject({ticks:1,reason:'provider input-token limit reached'});expect(inputTokens).toBe(boundaryUsage);expect(inputTokens-10).toBeLessThanOrEqual(boundaryUsage);engine.close();});
});
