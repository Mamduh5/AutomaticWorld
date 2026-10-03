import { fundCognition } from './resource-fixtures.js';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import type { CognitionInput,CognitionProvider } from '../packages/cognition/src/index.js';
import { CAPABILITIES,type AgentRecord } from '../packages/shared/src/index.js';
import { WorldEngine,defaultConfig,type WorldConfig } from '../packages/world/src/engine.js';
import { prepareCognitionContext } from '../packages/world/src/cognition-context.js';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function setup(provider?:CognitionProvider,overrides:Partial<WorldConfig>={}){const dir=await mkdtemp(path.join(tmpdir(),'ai-world-context-'));dirs.push(dir);const engine=new WorldEngine({...defaultConfig(dir),...overrides},provider);await engine.genesis();fundCognition(engine);return engine;}
const wait=()=>({thoughtSummary:'wait',selectedAction:{type:'WAIT' as const,ticks:1}});
function extraAgent(name:string):AgentRecord{return{id:randomUUID(),name,createdAt:new Date().toISOString(),generation:0,parentIds:[],status:'active',cognitionConfig:{provider:'test'},capabilities:[...CAPABILITIES],metadata:{test:true},computeCredits:10_000,storageBytes:0,sleepingUntilTick:0,eligibleFromTick:0};}
const context=(engine:WorldEngine,agent:AgentRecord)=>prepareCognitionContext(engine.repo,engine.files,agent,engine.repo.getWorld()!,{budgetTokens:engine.config.cognitionInputBudgetTokens,outputReserveTokens:engine.config.cognitionOutputReserveTokens});
async function consume(engine:WorldEngine,agent:AgentRecord){const prepared=await context(engine,agent);expect(engine.repo.advanceObservationCursor(agent.id,prepared.advance,engine.repo.getWorld()!.currentTick)).toBe(true);return prepared.input;}
function recordAction(engine:WorldEngine,agent:AgentRecord,tick:number,actionType:string,actionId:string,facts:Record<string,unknown>,effects:Record<string,unknown>[],success=true,error?:string){
  engine.repo.addEvent('AUTONOMY_ACTION',tick,agent.id,null,{actionType,actionId,success,...facts});
  return engine.repo.addEvent('ACTION_RESULT',tick,agent.id,null,{actionType,actionId,success,effects,...(error?{error}:{})});
}

describe('bounded recent peer conversation',()=>{
  it('T187/T188: retains a consumed message beside stale memory and a shared artifact',async()=>{
    const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const approval=engine.repo.sendMessage(mam.id,'agent',toey.id,187,'Design approved; please proceed.');
    const first=await consume(engine,toey);
    expect(first.currentObservation.newlyDeliveredMessages.map((message)=>message.id)).toContain(approval.id);
    expect(first.currentObservation.recentPeerConversation.map((message)=>message.id)).not.toContain(approval.id);
    engine.repo.addMemory(toey.id,'knowledge','old pending review',187,{salience:1});
    await engine.perform(mam.id,{type:'CREATE_TEXT_FILE',space:'SHARED',path:'design.txt',content:'old design note'});
    const next=await context(engine,toey);
    expect(next.input.currentObservation.newlyDeliveredMessages).toEqual([]);
    expect(next.input.currentObservation.recentPeerConversation).toContainEqual(expect.objectContaining({id:approval.id,tick:187,content:approval.content,from:{id:mam.id,name:'Mam'},to:{id:toey.id,name:'Toey'}}));
    expect(next.input.relevantMemories.some((memory)=>memory.content==='old pending review')).toBe(true);
    expect(next.input.currentObservation.sharedArtifacts).toContain('design.txt');
    expect(next.diagnostic.sections.recentPeerConversation).toMatchObject({count:1});
    engine.close();
  });

  it('T591-597: newer approvals remain temporal facts while old state remains retrievable',async()=>{
    const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const request=engine.repo.sendMessage(toey.id,'agent',mam.id,590,'Please check the design.');
    const firstApproval=engine.repo.sendMessage(mam.id,'agent',toey.id,591,'The design is approved.');
    await consume(engine,toey);
    engine.repo.addMemory(toey.id,'knowledge','Waiting for review',591,{salience:1});
    await engine.perform(mam.id,{type:'CREATE_TEXT_FILE',space:'SHARED',path:'design.txt',content:'pending review'});
    const later=await context(engine,toey);
    expect(later.input.currentObservation.recentPeerConversation.map((message)=>message.id)).toEqual([request.id,firstApproval.id]);
    expect(later.input.relevantMemories.some((memory)=>memory.content==='Waiting for review')).toBe(true);
    const secondApproval=engine.repo.sendMessage(mam.id,'agent',toey.id,595,'Updated design is approved.');
    const fresh=await consume(engine,toey);
    expect(fresh.currentObservation.newlyDeliveredMessages.map((message)=>message.id)).toContain(secondApproval.id);
    expect(fresh.currentObservation.recentPeerConversation.map((message)=>message.id)).not.toContain(secondApproval.id);
    const after=await context(engine,toey);
    expect(after.input.currentObservation.recentPeerConversation.at(-1)?.id).toBe(secondApproval.id);
    for(let tick=596;tick<=598;tick++)engine.repo.sendMessage(toey.id,'agent',mam.id,tick,`Follow-up ${tick}`);
    expect((await context(engine,toey)).input.currentObservation.recentPeerConversation.map((message)=>message.id)).not.toContain(firstApproval.id);
    engine.close();
  });

  it('T673-683: validation, completion, and closure remain visible with older pending memory',async()=>{
    const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const validation=engine.repo.sendMessage(mam.id,'agent',toey.id,673,'Validation passed.');await consume(engine,toey);
    const completion=engine.repo.sendMessage(toey.id,'agent',mam.id,678,'Implementation complete.');
    const closure=engine.repo.sendMessage(mam.id,'agent',toey.id,683,'Closing this thread.');await consume(engine,toey);
    engine.repo.addMemory(toey.id,'knowledge','Old pending-review note',650,{salience:1});
    const later=await context(engine,toey);
    expect(later.input.currentObservation.recentPeerConversation.map((message)=>message.id)).toEqual([validation.id,completion.id,closure.id]);
    expect(later.input.relevantMemories.some((memory)=>memory.content==='Old pending-review note')).toBe(true);
    engine.close();
  });

  it('keeps three-agent conversations private and excludes Owner messages',async()=>{
    const engine=await setup(),a=engine.repo.getAgent('Mam')!,b=engine.repo.getAgent('Toey')!,c=extraAgent('Third');engine.repo.createAgent(c);
    const ab=engine.repo.sendMessage(a.id,'agent',b.id,1,'AB_PRIVATE'),bc=engine.repo.sendMessage(b.id,'agent',c.id,2,'BC_PRIVATE');
    engine.repo.sendMessage('owner:external','owner',a.id,3,'OWNER_PRIVATE');
    await consume(engine,a);await consume(engine,c);
    const aConversation=(await context(engine,a)).input.currentObservation.recentPeerConversation;
    const cConversation=(await context(engine,c)).input.currentObservation.recentPeerConversation;
    expect(aConversation.map((message)=>message.id)).toEqual([ab.id]);
    expect(cConversation.map((message)=>message.id)).toEqual([bc.id]);
    expect(JSON.stringify(aConversation)).not.toContain('BC_PRIVATE');
    expect(JSON.stringify(cConversation)).not.toContain('AB_PRIVATE');
    engine.close();
  });

  it('keeps unseen inbound new only, while own outbound needs no cursor',async()=>{
    const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const sent=engine.repo.sendMessage(toey.id,'agent',mam.id,1,'I sent this.');
    const inbound=engine.repo.sendMessage(mam.id,'agent',toey.id,2,'New inbound.');
    const before=engine.repo.observationCursor(toey.id),prepared=await context(engine,toey);
    expect(prepared.input.currentObservation.recentPeerConversation.map((message)=>message.id)).toEqual([sent.id]);
    expect(prepared.input.currentObservation.newlyDeliveredMessages.map((message)=>message.id)).toContain(inbound.id);
    expect(engine.repo.observationCursor(toey.id)).toEqual(before);
    await consume(engine,toey);
    expect((await context(engine,toey)).input.currentObservation.recentPeerConversation.map((message)=>message.id)).toEqual([sent.id,inbound.id]);
    engine.close();
  });

  it('does not promote unseen inbound history on provider fallback',async()=>{
    let fail=true;const inputs:CognitionInput[]=[],engine=await setup({async think(input){inputs.push(input);if(input.identity.name==='Toey'&&fail){fail=false;return{...wait(),reasoningMetadata:{providerRequestSucceeded:false,providerError:'fixture failure'}};}return wait();}}),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const outbound=engine.repo.sendMessage(toey.id,'agent',mam.id,0,'Prior outbound'),inbound=engine.repo.sendMessage(mam.id,'agent',toey.id,0,'Pending inbound');
    engine.resume();await engine.tick();
    expect(engine.repo.observationCursor(toey.id).messageRowId).toBe(0);
    expect((await context(engine,toey)).input.currentObservation.recentPeerConversation.map((message)=>message.id)).toEqual([outbound.id]);
    expect(inputs.find((input)=>input.identity.id===toey.id)?.currentObservation.newlyDeliveredMessages.map((message)=>message.id)).toContain(inbound.id);
    await engine.tick();
    expect((await context(engine,toey)).input.currentObservation.recentPeerConversation.map((message)=>message.id)).toEqual([outbound.id,inbound.id]);
    engine.close();
  });

  it('selects the last four distinct messages and displays them chronologically',async()=>{
    const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const sent=Array.from({length:6},(_,index)=>engine.repo.sendMessage(toey.id,'agent',mam.id,index+1,'repeated literal content'));
    expect((await context(engine,toey)).input.currentObservation.recentPeerConversation.map((message)=>message.id)).toEqual(sent.slice(2).map((message)=>message.id));
    engine.close();
  });

  it('uses bounded indexed sender and recipient lookups',async()=>{
    const engine=await setup(),toey=engine.repo.getAgent('Toey')!;
    const outgoing=engine.repo.db.prepare("EXPLAIN QUERY PLAN SELECT rowid AS row_id,* FROM messages WHERE from_id=? AND from_type='agent' AND to_agent_id<>? ORDER BY rowid DESC LIMIT ?").all(toey.id,toey.id,4) as Array<{detail:string}>;
    const incoming=engine.repo.db.prepare("EXPLAIN QUERY PLAN SELECT rowid AS row_id,* FROM messages WHERE to_agent_id=? AND from_type='agent' AND from_id<>? AND rowid<=? ORDER BY rowid DESC LIMIT ?").all(toey.id,toey.id,100,4) as Array<{detail:string}>;
    expect(outgoing.map((step)=>step.detail).join(' ')).toContain('idx_messages_from_id');
    expect(incoming.map((step)=>step.detail).join(' ')).toContain('idx_messages_to_agent_id');
    expect(engine.repo.recentPeerMessages(toey.id,0,4)).toEqual([]);
    engine.close();
  });

  it('drops recent continuity before mandatory messages and consequences under budget pressure',async()=>{
    const engine=await setup(undefined,{cognitionInputBudgetTokens:5_000}),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    try{
    for(let index=0;index<4;index++)engine.repo.sendMessage(toey.id,'agent',mam.id,index,`earlier-${index}-`+'z'.repeat(2_000));
    const inbound=Array.from({length:8},(_,index)=>engine.repo.sendMessage(mam.id,'agent',toey.id,10+index,`new-${index}-`+'x'.repeat(index===0?400:3_000)));
    const consequence=engine.repo.addEvent('ACTION_RESULT',18,toey.id,null,{actionType:'EXECUTE_PROGRAM',success:false,effects:[{stderr:'FAILURE_'+'.'.repeat(300)}]});
    const prepared=await context(engine,toey),observation=prepared.input.currentObservation;
    expect(observation.newlyDeliveredMessages.map((message)=>message.id)).toContain(inbound[0]!.id);
    expect(observation.contextDelivery.actionResultIds).toContain(consequence.id);
    expect(prepared.diagnostic.pending.messages).toBeGreaterThan(0);
    expect(observation.recentPeerConversation.length).toBeLessThan(4);
    expect(observation.recentPeerConversation.every((message)=>message.from.id===toey.id)).toBe(true);
    expect(prepared.diagnostic.sections.recentPeerConversation!.estimatedTokens).toBeLessThanOrEqual(800);
    expect(prepared.diagnostic.estimatedTotalInputTokens).toBeLessThanOrEqual(5_000);
    expect(engine.repo.observationCursor(toey.id).messageRowId).toBe(0);
    }finally{engine.close();}
  });
});

describe('bounded recent self activity',()=>{
  it('reconstructs repeated identical reads and empty listings without collapsing them',async()=>{
    const engine=await setup(),toey=engine.repo.getAgent('Toey')!,read=(tick:number,id:string)=>recordAction(engine,toey,tick,'READ_FILE',id,{path:'sieve_tool_v3/sieve.py',space:'PRIVATE'},[{path:'sieve_tool_v3/sieve.py',space:'PRIVATE',content:'file contents stay elsewhere',bytes:3532,hash:'H'}]),list=(tick:number,id:string)=>recordAction(engine,toey,tick,'LIST_FILES',id,{path:'sieve_v3_conformance',space:'PRIVATE'},[{path:'sieve_v3_conformance',space:'PRIVATE',files:[]}]);
    recordAction(engine,toey,740,'CREATE_DIRECTORY','create',{path:'sieve_v3_conformance',space:'PRIVATE'},[{path:'sieve_v3_conformance',space:'PRIVATE'}]);
    read(760,'read-1');list(761,'list-1');read(762,'read-2');list(763,'list-2');
    recordAction(engine,toey,769,'EXECUTE_PROGRAM','execute',{entrypoint:'sieve_tool_v3/sieve.py',runtime:'python'},[{execution:{id:'execution-769',success:true,exitCode:0,stdout:'negative input passed'}}]);
    list(770,'list-3');read(771,'read-3');
    await consume(engine,toey);
    const activity=(await context(engine,toey)).input.currentObservation.recentSelfActivity;
    expect(activity.map((item)=>item.actionId)).toEqual(['list-1','read-2','list-2','execute','list-3','read-3']);
    expect(activity.filter((item)=>item.actionType==='LIST_FILES').map((item)=>item.result.fileCount)).toEqual([0,0,0]);
    expect(activity.filter((item)=>item.actionType==='READ_FILE').map((item)=>item.result.hash)).toEqual(['H','H']);
    expect(activity.filter((item)=>item.actionType==='READ_FILE').map((item)=>item.result.bytes)).toEqual([3532,3532]);
    expect(activity.find((item)=>item.actionId==='execute')).toMatchObject({target:{entrypoint:'sieve_tool_v3/sieve.py',runtime:'python'},result:{exitCode:0}});
    expect(JSON.stringify(activity)).not.toContain('file contents stay elsewhere');
    expect(JSON.stringify(activity)).not.toMatch(/duplicate|repeated|unproductive|already completed/);
    engine.close();
  });

  it('T770-805: retains six distinct observed actions in order with factual compact results',async()=>{
    const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    recordAction(engine,toey,770,'CREATE_TEXT_FILE','a-770',{path:'a.py',space:'PRIVATE'},[{path:'a.py',space:'PRIVATE',bytes:20,revision:1}]);
    recordAction(engine,toey,771,'READ_FILE','a-771',{path:'a.py',space:'PRIVATE'},[{path:'a.py',space:'PRIVATE',content:'PRIVATE_FILE_CONTENT',bytes:20,hash:'file-hash'}]);
    recordAction(engine,toey,780,'SEND_MESSAGE','a-780',{to:mam.id},[{messageId:'message-780',toAgentId:mam.id}]);
    recordAction(engine,toey,790,'EXECUTE_PROGRAM','a-790',{runtime:'python',entrypoint:'main.py'},[{execution:{id:'execution-790',success:true,exitCode:0,stdout:'SECRET_STDOUT',stderr:'SECRET_STDERR'}}]);
    recordAction(engine,toey,798,'INVOKE_TOOL','a-798',{toolVersionId:'missing-version'},[],false,'Tool version not found or not authorized');
    recordAction(engine,toey,801,'WAIT','a-801',{waitTicks:2},[{waitedTicks:2,wakeTick:803}]);
    recordAction(engine,toey,803,'SEARCH_TEXT','a-803',{path:'.',space:'PRIVATE'},[{space:'PRIVATE',query:'needle',results:[{path:'a.py',line:1,excerpt:'SECRET_EXCERPT'}]}]);
    const peer=engine.repo.sendMessage(mam.id,'agent',toey.id,804,'Please continue the test.');
    const first=await consume(engine,toey);expect(first.currentObservation.recentSelfActivity).toEqual([]);
    engine.repo.addEvent('COGNITION_FALLBACK',805,toey.id,null,{actionType:'WAIT',reason:'provider failed'});
    const newResult=recordAction(engine,toey,805,'LIST_FILES','a-805',{path:'.',space:'PRIVATE'},[{path:'.',space:'PRIVATE',files:['a.py']}]);
    const prepared=await context(engine,toey),activity=prepared.input.currentObservation.recentSelfActivity;
    expect(activity.map((item)=>item.actionId)).toEqual(['a-771','a-780','a-790','a-798','a-801','a-803']);
    expect(activity.map((item)=>item.tick)).toEqual([771,780,790,798,801,803]);
    expect(activity.find((item)=>item.actionType==='SEND_MESSAGE')).toMatchObject({result:{messageId:'message-780',toAgentId:mam.id}});
    expect(activity.find((item)=>item.actionType==='INVOKE_TOOL')).toMatchObject({status:'FAILED',target:{toolVersionId:'missing-version'},result:{error:'Tool version not found or not authorized'}});
    expect(activity.find((item)=>item.actionType==='WAIT')).toMatchObject({status:'SUCCEEDED',target:{waitTicks:2},result:{wakeTick:803}});
    expect(activity.find((item)=>item.actionType==='EXECUTE_PROGRAM')).toMatchObject({result:{success:true,exitCode:0,executionId:'execution-790'}});
    expect(activity.find((item)=>item.actionType==='SEARCH_TEXT')).toMatchObject({target:{query:'needle'},result:{matchCount:1}});
    expect(prepared.input.currentObservation.contextDelivery.actionResultIds).toContain(newResult.id);
    expect(prepared.input.currentObservation.recentPeerConversation.map((message)=>message.id)).toContain(peer.id);
    expect(JSON.stringify(activity)).not.toMatch(/PRIVATE_FILE_CONTENT|SECRET_STDOUT|SECRET_STDERR|SECRET_EXCERPT|provider failed/);
    expect(prepared.diagnostic.sections.recentSelfActivity).toMatchObject({count:6});
    expect(prepared.diagnostic.sections.recentSelfActivity!.estimatedTokens).toBeLessThanOrEqual(800);
    expect((await context(engine,toey)).input.currentObservation.recentSelfActivity).toEqual(activity);
    expect(engine.repo.observationCursor(toey.id).ownEventId).toBeLessThan(newResult.id);
    engine.close();
  });

  it('keeps agents separate and promotes a new result only after cursor advancement',async()=>{
    const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    const mamResult=recordAction(engine,mam,1,'CREATE_DIRECTORY','mam-action',{path:'mam-private'},[{path:'mam-private'}]);
    const toeyResult=recordAction(engine,toey,1,'CREATE_DIRECTORY','toey-action',{path:'toey-private'},[{path:'toey-private'}]);
    for(const [agent,result] of [[mam,mamResult],[toey,toeyResult]] as const){const first=await context(engine,agent);expect(first.input.currentObservation.recentSelfActivity).toEqual([]);expect(first.input.currentObservation.contextDelivery.actionResultIds).toContain(result.id);await consume(engine,agent);}
    const mamActivity=(await context(engine,mam)).input.currentObservation.recentSelfActivity,toeyActivity=(await context(engine,toey)).input.currentObservation.recentSelfActivity;
    expect(mamActivity.map((item)=>item.actionId)).toEqual(['mam-action']);expect(toeyActivity.map((item)=>item.actionId)).toEqual(['toey-action']);
    expect(JSON.stringify(mamActivity)).not.toContain('toey-private');expect(JSON.stringify(toeyActivity)).not.toContain('mam-private');
    engine.close();
  });

  it('yields the section to mandatory messages and new action results under budget pressure',async()=>{
    const engine=await setup(undefined,{cognitionInputBudgetTokens:4_000}),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;
    for(let index=0;index<6;index++)recordAction(engine,toey,index,'READ_FILE',`old-${index}`,{path:`file-${index}.txt`,space:'PRIVATE'},[{path:`file-${index}.txt`,space:'PRIVATE',bytes:10,hash:`hash-${index}`,content:'old content'}]);
    await consume(engine,toey);
    const message=engine.repo.sendMessage(mam.id,'agent',toey.id,10,'MANDATORY_MESSAGE_'+'.'.repeat(500));
    const result=recordAction(engine,toey,10,'INVOKE_TOOL','new-failure',{toolVersionId:'failed-tool'},[],false,'MANDATORY_FAILURE');
    const prepared=await context(engine,toey);
    expect(prepared.input.currentObservation.contextDelivery.newMessageIds).toContain(message.id);
    expect(prepared.input.currentObservation.contextDelivery.actionResultIds).toContain(result.id);
    expect(prepared.input.currentObservation.recentSelfActivity.every((item)=>item.actionId!=='new-failure')).toBe(true);
    expect(prepared.diagnostic.sections.recentSelfActivity!.estimatedTokens).toBeLessThanOrEqual(800);
    expect(prepared.diagnostic.estimatedTotalInputTokens).toBeLessThanOrEqual(4_000);
    engine.close();
  });
});

describe('durable cognition observation cursors',()=>{
  it('delivers one message once as new context and permits later local-memory recall',async()=>{const inputs:CognitionInput[]=[],provider:CognitionProvider={async think(input){inputs.push(input);return wait();}},engine=await setup(provider),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;await engine.perform(mam.id,{type:'SEND_MESSAGE',to:toey.id,content:'one durable hello'});engine.resume();await engine.tick();expect(engine.repo.observationCursor(toey.id).messageRowId).toBeGreaterThan(0);await engine.tick();engine.repo.addMemory(toey.id,'knowledge','one durable hello remembered locally',2,{salience:1});await engine.tick();const seen=inputs.filter((input)=>input.identity.name==='Toey');expect(seen[0]?.currentObservation.newlyDeliveredMessages.map((message)=>message.content)).toEqual(['one durable hello']);expect(seen[1]?.currentObservation.newlyDeliveredMessages).toEqual([]);expect(seen[2]?.relevantMemories.some((memory)=>memory.content.includes('remembered locally'))).toBe(true);expect(engine.repo.messagesFor(toey.id).map((message)=>message.content)).toContain('one durable hello');engine.close();});

  it('does not consume an unseen message or action result on provider failure and survives restart',async()=>{let failToey=true;const firstInputs:CognitionInput[]=[],provider:CognitionProvider={async think(input){firstInputs.push(input);if(input.identity.name==='Toey'&&failToey){failToey=false;return{...wait(),reasoningMetadata:{providerRequestSucceeded:false,providerError:'test failure'}};}return wait();}},engine=await setup(provider),dir=engine.config.dataDir,mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;await engine.perform(mam.id,{type:'SEND_MESSAGE',to:toey.id,content:'survive failure'});engine.resume();await engine.tick();expect(firstInputs.find((input)=>input.identity.name==='Toey')?.currentObservation.newlyDeliveredMessages[0]?.content).toBe('survive failure');expect(engine.repo.observationCursor(toey.id).messageRowId).toBe(0);await engine.tick();expect(firstInputs.filter((input)=>input.identity.name==='Toey')[1]?.currentObservation.newlyDeliveredMessages[0]?.content).toBe('survive failure');const ownResult=engine.repo.listEvents(100).find((event)=>event.type==='ACTION_RESULT'&&event.actorId===toey.id)!;engine.close();let failRestartedToey=true;const restartedInputs:CognitionInput[]=[],restarted=new WorldEngine(defaultConfig(dir),{async think(input){restartedInputs.push(input);if(input.identity.name==='Toey'&&failRestartedToey){failRestartedToey=false;return{...wait(),reasoningMetadata:{providerRequestSucceeded:false,providerError:'test failure'}};}return wait();}});restarted.resume();const beforeResultCursor=restarted.repo.observationCursor(toey.id).ownEventId;await restarted.tick();expect(restarted.repo.observationCursor(toey.id).ownEventId).toBe(beforeResultCursor);await restarted.tick();const toeyRestarted=restartedInputs.filter((input)=>input.identity.name==='Toey');expect(toeyRestarted[0]?.currentObservation.nearbyOrRelevantEvents.some((event)=>event.id===ownResult.id&&event.delivery==='NEW_ACTION_RESULT')).toBe(true);expect(toeyRestarted[1]?.currentObservation.nearbyOrRelevantEvents.some((event)=>event.id===ownResult.id&&event.delivery==='NEW_ACTION_RESULT')).toBe(true);restarted.close();});

  it('advances only delivered portions and rejects a stale runner token',async()=>{const engine=await setup(undefined,{cognitionInputBudgetTokens:5_000}),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!,mamBefore=engine.repo.observationCursor(mam.id);for(let index=0;index<8;index++)await engine.perform(mam.id,{type:'SEND_MESSAGE',to:toey.id,content:`message-${index}-`+'x'.repeat(3_500)});const diagnostic=await engine.cognitionContextDiagnostic(toey),before=engine.repo.observationCursor(toey.id);expect(diagnostic.messageIdsDelivered.length).toBeGreaterThan(0);expect(diagnostic.pending.messages).toBeGreaterThan(0);expect(engine.repo.observationCursor(toey.id)).toEqual(before);expect(engine.repo.acquireRunnerLease('old-runner',30_000)).toBe(true);engine.repo.releaseRunnerLease('old-runner');expect(engine.repo.acquireRunnerLease('new-runner',30_000)).toBe(true);expect(engine.repo.advanceObservationCursor(toey.id,{before,messageRowId:diagnostic.cursorAfter.messageRowId,ownEventId:diagnostic.cursorAfter.ownEventId,sharedEventId:diagnostic.cursorAfter.sharedEventId},0,'old-runner')).toBe(false);expect(engine.repo.observationCursor(toey.id)).toEqual(before);expect(engine.repo.observationCursor(mam.id)).toEqual(mamBefore);engine.repo.releaseRunnerLease('new-runner');engine.close();});

  it('excludes Owner-only and private foreign events while exposing shared publication',async()=>{const engine=await setup(),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;engine.repo.addEvent('COGNITION_PROVIDER_ERROR',0,mam.id,null,{error:'kernel only'});engine.repo.addEvent('TOOL_PUBLISHED',0,mam.id,null,{toolVersionId:'private-version',visibility:'PRIVATE'});const shared=engine.repo.addEvent('TOOL_PUBLISHED',0,mam.id,null,{toolVersionId:'shared-version',visibility:'SHARED'}),serialized=JSON.stringify(await engine.observe(toey));expect(serialized).not.toContain('kernel only');expect(serialized).not.toContain('private-version');expect(serialized).toContain('shared-version');expect((await engine.observe(toey)).contextDelivery.sharedConsequenceIds).toContain(shared.id);engine.close();});
});

describe('bounded multi-inhabitant cognition context',()=>{
  it.each([2,10,50])('stays within budget with %i inhabitants and large histories',async(population)=>{const budget=3_000,engine=await setup(undefined,{cognitionInputBudgetTokens:budget}),mam=engine.repo.getAgent('Mam')!;for(let index=2;index<population;index++)engine.repo.createAgent(extraAgent(`Agent-${index}`));for(let index=0;index<600;index++)engine.repo.addEvent(index%3===0?'RUNNER_STARTED':'TOOL_PUBLISHED',0,index%3===0?null:engine.repo.getAgent('Toey')!.id,null,index%3===0?{detail:'owner-only-'+index}:{toolVersionId:`shared-${index}`,visibility:'SHARED',detail:'z'.repeat(2_000)});for(let index=0;index<30;index++)engine.repo.sendMessage(engine.repo.getAgent('Toey')!.id,'agent',mam.id,0,`burst-${index}-`+'m'.repeat(3_000));for(let index=0;index<40;index++)engine.repo.addMemory(mam.id,'knowledge',`memory-${index}-`+'k'.repeat(2_000),0,{salience:0.5});for(let version=1;version<=60;version++)engine.repo.createToolVersion({publisher:mam,tick:0,visibility:'SHARED',runtime:'python',entrypoint:'main.py',sourceHash:String(version).padStart(64,'0'),manifest:{name:'scale-tool',description:'d'.repeat(500),usage:null,visibility:'SHARED',runtime:'python',entrypoint:'main.py',inputProtocol:'json-stdin',fileCount:1,totalBytes:1,sourceHash:String(version).padStart(64,'0')},previousVersionId:null,storePath:`system/tool-store/${version}`});const diagnostic=await engine.cognitionContextDiagnostic(mam);expect(diagnostic.estimatedTotalInputTokens).toBeLessThanOrEqual(budget);expect(diagnostic.sections.accessibleTools!.count).toBeLessThanOrEqual(8);expect((await engine.observe(mam)).world.populationCount).toBe(population);expect(JSON.stringify(await engine.observe(mam))).not.toContain('owner-only-');engine.close();});
});

describe('bounded recent artifact working context',()=>{
  it('keeps two substantive file projections, evicts the oldest, and refreshes rereads',async()=>{const inputs:CognitionInput[]=[],provider:CognitionProvider={async think(input){inputs.push(input);if(input.identity.name==='Toey')return{thoughtSummary:'wait',selectedAction:{type:'WAIT',ticks:10}};const pathByTick:Record<number,string>={0:'a.py',1:'b.py',2:'c.py',3:'a.py'},pathValue=pathByTick[input.currentObservation.tick];return pathValue?{thoughtSummary:`read ${pathValue}`,selectedAction:{type:'READ_FILE',path:pathValue}}:wait();}},engine=await setup(provider),mam=engine.repo.getAgent('Mam')!;for(const [pathValue,marker] of [['a.py','A'],['b.py','B'],['c.py','C']] as const)await engine.perform(mam.id,{type:'CREATE_TEXT_FILE',path:pathValue,content:`${marker}_START\n${marker.toLowerCase().repeat(2_000)}\n${marker}_END`});engine.resume();await engine.run(5);const mamInputs=inputs.filter((input)=>input.identity.name==='Mam'),at=(tick:number)=>mamInputs.find((input)=>input.currentObservation.tick===tick)!.currentObservation.workingArtifacts;expect(at(2).map((item)=>item.path)).toEqual(['b.py','a.py']);expect(at(2).every((item)=>item.truncated&&item.content.includes(`${item.path[0]!.toUpperCase()}_START`)&&item.content.includes(`${item.path[0]!.toUpperCase()}_END`))).toBe(true);expect(at(3).map((item)=>item.path)).toEqual(['c.py','b.py']);expect(at(4).map((item)=>item.path)).toEqual(['a.py','c.py']);expect((await engine.cognitionContextDiagnostic(mam)).estimatedTotalInputTokens).toBeLessThanOrEqual(engine.config.cognitionInputBudgetTokens);engine.close();});

  it('never crosses private read history between inhabitants',async()=>{const inputs:CognitionInput[]=[],provider:CognitionProvider={async think(input){inputs.push(input);return input.currentObservation.tick===0?{thoughtSummary:'read own file',selectedAction:{type:'READ_FILE',path:`${input.identity.name.toLowerCase()}.txt`}}:wait();}},engine=await setup(provider),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!;await engine.perform(mam.id,{type:'CREATE_TEXT_FILE',path:'mam.txt',content:'MAM_PRIVATE_MARKER'});await engine.perform(toey.id,{type:'CREATE_TEXT_FILE',path:'toey.txt',content:'TOEY_PRIVATE_MARKER'});engine.resume();await engine.run(2);const mamContext=inputs.filter((input)=>input.identity.name==='Mam').at(-1)!.currentObservation.workingArtifacts,toeyContext=inputs.filter((input)=>input.identity.name==='Toey').at(-1)!.currentObservation.workingArtifacts;expect(mamContext.map((item)=>item.path)).toEqual(['mam.txt']);expect(toeyContext.map((item)=>item.path)).toEqual(['toey.txt']);expect(JSON.stringify(mamContext)).not.toContain('TOEY_PRIVATE_MARKER');expect(JSON.stringify(toeyContext)).not.toContain('MAM_PRIVATE_MARKER');engine.close();});

  it('reconstructs the same two reads after restart without advancing a cursor',async()=>{const engine=await setup(),dir=engine.config.dataDir,mam=engine.repo.getAgent('Mam')!;for(const [pathValue,content] of [['a.py','restart A'],['b.py','restart B']] as const){await engine.perform(mam.id,{type:'CREATE_TEXT_FILE',path:pathValue,content});const result=await engine.perform(mam.id,{type:'READ_FILE',path:pathValue});engine.repo.addEvent('ACTION_RESULT',0,mam.id,null,{actionType:'READ_FILE',actionId:result.actionId,success:true,effects:result.effects});}engine.close();const restarted=new WorldEngine(defaultConfig(dir)),sameMam=restarted.repo.getAgent(mam.id)!,before=restarted.repo.observationCursor(mam.id),first=await restarted.observe(sameMam),afterFirst=restarted.repo.observationCursor(mam.id),second=await restarted.observe(sameMam);expect(first.workingArtifacts.map((item)=>item.path)).toEqual(['b.py','a.py']);expect(second.workingArtifacts).toEqual(first.workingArtifacts);expect(afterFirst).toEqual(before);expect(restarted.repo.observationCursor(mam.id)).toEqual(before);restarted.close();});

  it('drops working material before mandatory new messages and failed action results',async()=>{const engine=await setup(undefined,{cognitionInputBudgetTokens:4_000}),mam=engine.repo.getAgent('Mam')!,toey=engine.repo.getAgent('Toey')!,seedRead=(pathValue:string,marker:string)=>{const content=`${marker}\n${marker.repeat(4_000)}`,hash=createHash('sha256').update(content).digest('hex');engine.repo.addEvent('ACTION_RESULT',0,mam.id,null,{actionType:'READ_FILE',actionId:randomUUID(),success:true,effects:[{path:pathValue,space:'PRIVATE',content,bytes:Buffer.byteLength(content),hash}]});};seedRead('a.py','A');seedRead('b.py','B');const cursor=engine.repo.observationCursor(mam.id),throughReads=engine.repo.latestEventId();expect(engine.repo.advanceObservationCursor(mam.id,{before:cursor,messageRowId:cursor.messageRowId,ownEventId:throughReads,sharedEventId:throughReads},0)).toBe(true);const message=engine.repo.sendMessage(toey.id,'agent',mam.id,0,'MANDATORY_MESSAGE_'+'.'.repeat(500)),failed=engine.repo.addEvent('ACTION_RESULT',0,mam.id,null,{actionType:'EXECUTE_PROGRAM',actionId:randomUUID(),success:false,effects:[{stderr:'MANDATORY_FAILURE_'+'.'.repeat(1_000)}],error:'Program exited with 1'}),before=engine.repo.observationCursor(mam.id),prepared=await engine.cognitionContextDiagnostic(mam);expect(prepared.messageIdsDelivered).toContain(message.id);expect(prepared.actionResultIdsDelivered).toContain(failed.id);expect(prepared.workingArtifacts.length).toBeLessThan(2);expect(prepared.estimatedTotalInputTokens).toBeLessThanOrEqual(engine.config.cognitionInputBudgetTokens);expect(engine.repo.observationCursor(mam.id)).toEqual(before);engine.close();});
});
