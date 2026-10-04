import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { estimateContextTokens } from '../packages/cognition/src/index.js';
import type { Movement } from '../packages/resources/src/economy.js';
import { FakeExecutionSandbox } from '../packages/sandbox/src/docker.js';
import { CAPABILITIES,eventVisibility } from '../packages/shared/src/index.js';
import { AgentActionSchema } from '../packages/tools/src/actions.js';
import { prepareCognitionContext } from '../packages/world/src/cognition-context.js';
import { defaultConfig,WorldEngine } from '../packages/world/src/engine.js';
import { OwnershipFenceError } from '../packages/sandbox/src/filesystem.js';

const dirs:string[]=[],engines:WorldEngine[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const e of engines.splice(0))if(e.repo.db.open)e.close();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),'aw-withdrawal-'));dirs.push(dir);const think=vi.fn(async()=>({thoughtSummary:'Selected WAIT.',selectedAction:{type:'WAIT' as const,ticks:1}})),sandbox=new FakeExecutionSandbox(()=>{throw new Error('No sandbox workload expected');}),e=new WorldEngine(defaultConfig(dir),{think},sandbox);engines.push(e);await e.genesis();return{e,think};}
const request=(e:WorldEngine,name='Toey',reason='Relevant private request')=>e.repo.economy.request(e.repo.getAgent(name)!.id,{resource:'LOCAL_COMPUTE',amount:10,reason});
const cancel=(requestId:string)=>({type:'CANCEL_RESOURCE_PURCHASE_REQUEST' as const,requestId});
const valueState=(e:WorldEngine)=>({accounts:e.repo.economy.accounts(),ledger:e.repo.economy.ledger(),reservations:e.repo.db.prepare('SELECT * FROM value_reservations').all(),journal:e.repo.db.prepare('SELECT * FROM reservation_journal').all(),storage:e.repo.listAgents().map(a=>[a.id,a.storageBytes])});
const cancellations=(e:WorldEngine)=>e.repo.listEvents(1000).filter(event=>event.type==='RESOURCE_PURCHASE_REQUEST_CANCELLED');

describe('requester withdrawal of resource purchase requests',()=>{
  it.each(['Mam','Toey'])('%s cancels its own pending request without any value or storage movement',async(name)=>{
    const {e}=await fixture(),a=e.repo.getAgent(name)!,r=request(e,name),before=valueState(e),creation=e.repo.listEvents(100).find(event=>event.type==='RESOURCE_PURCHASE_REQUESTED')!;
    const result=await e.perform(a.id,cancel(r.id),7);
    expect(result).toMatchObject({success:true,effects:[{request:{id:r.id,status:'CANCELLED',resource:'LOCAL_COMPUTE',amount:10,createdTick:0,reason:r.reason}}]});
    expect(e.repo.economy.getRequest(r.id)).toEqual({...r,status:'CANCELLED'});expect(valueState(e)).toEqual(before);
    expect(cancellations(e)).toHaveLength(1);expect(cancellations(e)[0]).toMatchObject({actorId:a.id,subjectId:null,tick:7,payload:{requestId:r.id,agentId:a.id,resource:'LOCAL_COMPUTE',amount:10,createdTick:0,withdrawnTick:7}});
    expect(eventVisibility(cancellations(e)[0]!)).toBe('AGENT_VISIBLE');expect(e.repo.eventsBetweenIds(creation.id-1,creation.id)[0]).toEqual(creation);expect(e.repo.economy.integrity()).toEqual([]);
  });

  it.each(['Mam','Toey'])('%s cannot withdraw the other founder request or discover its private details',async(name)=>{
    const {e}=await fixture(),owner=name==='Mam'?'Toey':'Mam',r=request(e,owner,'PRIVATE_REQUEST_MARKER'),a=e.repo.getAgent(name)!,before=valueState(e);
    const foreign=await e.perform(a.id,cancel(r.id)),missing=await e.perform(a.id,cancel(randomUUID()));
    expect(foreign.success).toBe(false);expect(foreign.error).toBe(missing.error);expect(foreign.effects).toEqual([]);expect(JSON.stringify(foreign)).not.toMatch(/PRIVATE_REQUEST_MARKER|LOCAL_COMPUTE/);
    expect(e.repo.economy.getRequest(r.id)).toEqual(r);expect(valueState(e)).toEqual(before);expect(cancellations(e)).toEqual([]);
  });

  it('rejects an unknown actor at both the service and normal action boundary',async()=>{
    const {e}=await fixture(),r=request(e),before=valueState(e),unknown=randomUUID();
    expect(()=>e.repo.economy.cancelRequest(unknown,r.id,0)).toThrow('not found or not authorized');await expect(e.perform(unknown,cancel(r.id))).rejects.toThrow('Unknown agent');
    expect(e.repo.economy.getRequest(r.id)).toEqual(r);expect(valueState(e)).toEqual(before);expect(cancellations(e)).toEqual([]);
  });

  it('rejects an unknown request and a malformed request ID cleanly',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,before=valueState(e);
    expect((await e.perform(a.id,cancel(randomUUID()))).error).toBe('Resource purchase request not found or not authorized');
    expect((await e.perform(a.id,cancel('not-a-uuid'))).error).toBe('Malformed action rejected');expect(valueState(e)).toEqual(before);
  });

  it.each(['APPROVED','DENIED','SETTLED','CANCELLED'] as const)('rejects withdrawal from %s without altering lifecycle or value',async(status)=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e),s=e.repo.economy;
    if(status==='APPROVED'||status==='SETTLED')s.decideRequest(r.id,true);if(status==='DENIED')s.decideRequest(r.id,false);
    if(status==='SETTLED')s.settleRequest(r.id,{amount:10,cost:0,key:'fixture-receipt',reference:'isolated external capacity fixture'});if(status==='CANCELLED')s.cancelRequest(a.id,r.id,0);
    const old=s.getRequest(r.id),before=valueState(e),events=cancellations(e);expect((await e.perform(a.id,cancel(r.id))).error).toBe('Only PENDING resource purchase requests can be cancelled');
    expect(s.getRequest(r.id)).toEqual(old);expect(valueState(e)).toEqual(before);expect(cancellations(e)).toEqual(events);expect(s.integrity()).toEqual([]);
  });

  it('rejects all subsequent Owner decisions and settlement of a cancelled request',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e),s=e.repo.economy;s.cancelRequest(a.id,r.id,0);const before=valueState(e),old=s.getRequest(r.id);
    expect(()=>s.decideRequest(r.id,true)).toThrow('current state');expect(()=>s.decideRequest(r.id,false)).toThrow('current state');expect(()=>s.settleRequest(r.id,{cost:0,amount:10,key:'forbidden',reference:'isolated fixture'})).toThrow('Approve');
    expect(s.getRequest(r.id)).toEqual(old);expect(valueState(e)).toEqual(before);expect(cancellations(e)).toHaveLength(1);expect(s.integrity()).toEqual([]);
  });

  it('replays a durable action idempotently across restart; a new withdrawal action is clearly rejected',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e),id=randomUUID(),action=cancel(r.id),first=await e.perform(a.id,action,0,()=>true,id),before=valueState(e);
    expect(await e.perform(a.id,action,0,()=>true,id)).toEqual(first);e.close();const restarted=new WorldEngine(defaultConfig(e.config.dataDir));engines.push(restarted);
    expect(await restarted.perform(a.id,action,0,()=>true,id)).toEqual(first);expect((await restarted.perform(a.id,action)).success).toBe(false);
    expect(cancellations(restarted)).toHaveLength(1);expect(valueState(restarted)).toEqual(before);expect(restarted.repo.economy.integrity()).toEqual([]);
  });

  it('rolls back cancellation if the durable event cannot be recorded',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e),before=valueState(e);
    e.repo.db.exec("CREATE TRIGGER cancellation_crash BEFORE INSERT ON events WHEN NEW.type='RESOURCE_PURCHASE_REQUEST_CANCELLED' BEGIN SELECT RAISE(ABORT,'fixture crash'); END");
    expect((await e.perform(a.id,cancel(r.id))).success).toBe(false);expect(e.repo.economy.getRequest(r.id)).toEqual(r);expect(valueState(e)).toEqual(before);expect(cancellations(e)).toEqual([]);
    e.repo.db.exec('DROP TRIGGER cancellation_crash');expect((await e.perform(a.id,cancel(r.id))).success).toBe(true);expect(e.repo.economy.integrity()).toEqual([]);
  });

  it('keeps the existing Owner approval, denial, actual-settlement and retry paths intact in fixtures',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,s=e.repo.economy;
    // Monetary data below is an isolated test fixture, never a live supply or payment.
    s.recordCapital({currency:'USD',amount:1000,to:`AGENT:${a.id}`,key:'fixture-real-money-record'});
    const denied=s.request(a.id,{resource:'LOCAL_COMPUTE',amount:10,currency:'USD',maxSpend:200,reason:'fixture'});s.decideRequest(denied.id,true);expect(s.capital(`AGENT:${a.id}`).USD!.reserved).toBe(200);s.decideRequest(denied.id,false);expect(s.capital(`AGENT:${a.id}`).USD!.reserved).toBe(0);expect(s.getRequest(denied.id).status).toBe('DENIED');
    const settled=s.request(a.id,{resource:'COGNITION_CREDIT',amount:10,currency:'USD',maxSpend:200,reason:'fixture'}),receipt={cost:150,amount:10,key:'fixture-settlement',reference:'isolated verified receipt fixture'};s.decideRequest(settled.id,true);s.settleRequest(settled.id,receipt);const before=valueState(e);s.settleRequest(settled.id,receipt);expect(valueState(e)).toEqual(before);expect(s.capital(`AGENT:${a.id}`).USD).toEqual({total:850,reserved:0,available:850});expect(s.self(a.id).cognitionCredits.total).toBe(10);expect(s.integrity()).toEqual([]);
  });

  it('cancellation of a request with a proposed maximum spend neither reserves capital nor creates a refund',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,s=e.repo.economy;s.recordCapital({currency:'USD',amount:500,to:`AGENT:${a.id}`,key:'fixture-investment'});
    const r=s.request(a.id,{resource:'LOCAL_COMPUTE',amount:10,currency:'USD',maxSpend:200,reason:'private proposal'}),before=valueState(e);
    expect((await e.perform(a.id,cancel(r.id))).success).toBe(true);expect(valueState(e)).toEqual(before);expect(s.getRequest(r.id).settlement_id).toBeNull();expect(s.integrity()).toEqual([]);
  });
});

describe('private pending-request visibility and dormancy',()=>{
  it('provides own request facts and the cancellation capability, excluding foreign requests and funding data',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,b=e.repo.getAgent('Mam')!,r=request(e,'Toey','TOEY_PRIVATE_REASON'),other=request(e,'Mam','MAM_PRIVATE_REASON');
    const input=await e.observe(a),inspect=await e.perform(a.id,{type:'INSPECT_SELF'}),resources=inspect.effects[0]!.resources as {pendingResourcePurchaseRequests:unknown[]};
    const facts={id:r.id,resource:r.resource,amount:r.amount,status:'PENDING',createdTick:r.created_tick,reason:r.reason};expect(input.accessibleResources.pendingResourcePurchaseRequests).toEqual([facts]);expect(input.accessibleResources.pendingResourcePurchaseRequestCount).toBe(1);expect(resources.pendingResourcePurchaseRequests).toEqual([facts]);
    expect(input.kernelCapabilities.map(c=>c.type)).toContain('CANCEL_RESOURCE_PURCHASE_REQUEST');expect(CAPABILITIES).toContain('CANCEL_RESOURCE_PURCHASE_REQUEST');expect(AgentActionSchema.parse(cancel(r.id))).toEqual(cancel(r.id));
    expect(JSON.stringify({input,inspect})).not.toContain(other.id);expect(JSON.stringify({input,inspect})).not.toContain('MAM_PRIVATE_REASON');expect(JSON.stringify(input.accessibleResources.pendingResourcePurchaseRequests)).not.toMatch(/funding_account|max_spend|currency/);
    expect(JSON.stringify(e.listPublicInhabitants(a.id))).not.toMatch(/PRIVATE_REASON|pendingResourcePurchase/);
    expect(JSON.stringify((await e.perform(b.id,{type:'LIST_INHABITANTS'})).effects)).not.toContain(r.id);
    await e.perform(a.id,cancel(r.id));const after=await e.observe(a),foreign=await e.observe(b);expect(after.accessibleResources.pendingResourcePurchaseRequests).toEqual([]);expect(after.nearbyOrRelevantEvents.some(event=>event.type==='RESOURCE_PURCHASE_REQUEST_CANCELLED')).toBe(true);expect(JSON.stringify(foreign)).not.toContain(r.id);
  });

  it('bounds pending request context and terminal history while INSPECT_SELF retains all own pending requests',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,s=e.repo.economy;
    const terminal=request(e,'Toey','old terminal marker');s.cancelRequest(a.id,terminal.id,0);e.repo.db.prepare('UPDATE observation_cursors SET own_event_id=?,shared_event_id=? WHERE agent_id=?').run(e.repo.latestEventId(),e.repo.latestEventId(),a.id);
    const pending=Array.from({length:20},(_,i)=>request(e,'Toey','pending '+i));
    const p=await prepareCognitionContext(e.repo,e.files,a,e.repo.getWorld()!,{budgetTokens:8000,outputReserveTokens:2000}),selected=p.input.currentObservation.accessibleResources.pendingResourcePurchaseRequests!;
    expect(selected.length).toBeGreaterThan(0);expect(selected.length).toBeLessThanOrEqual(5);expect(estimateContextTokens(selected)).toBeLessThanOrEqual(600);expect(p.diagnostic.estimatedTotalInputTokens).toBeLessThanOrEqual(8000);expect(p.input.currentObservation.accessibleResources.pendingResourcePurchaseRequestCount).toBe(20);expect(p.diagnostic.truncations).toContain('pending purchase requests bounded; use INSPECT_SELF for all pending requests');expect(selected.every(r=>r.status==='PENDING')).toBe(true);expect(selected.map(r=>r.id)).not.toContain(terminal.id);
    const inspected=await e.perform(a.id,{type:'INSPECT_SELF'});expect((inspected.effects[0]!.resources as {pendingResourcePurchaseRequests:unknown[]}).pendingResourcePurchaseRequests).toHaveLength(pending.length);
    const tight=await prepareCognitionContext(e.repo,e.files,a,e.repo.getWorld()!,{budgetTokens:3500,outputReserveTokens:2000});expect(tight.diagnostic.estimatedTotalInputTokens).toBeLessThanOrEqual(3500);expect(s.pendingRequests(a.id)).toHaveLength(20);
  });

  it('retains a dormant requester pending request through startup, dormant ticks and restart without provider calls',async()=>{
    const {e,think}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e),before=valueState(e);expect(e.repo.economy.self(a.id).cognitionDormant).toBe(true);
    await e.initialize();e.resume();await e.run(3);e.pause();expect(think).not.toHaveBeenCalled();expect(e.repo.economy.getRequest(r.id)).toEqual(r);expect(valueState(e)).toEqual(before);expect(cancellations(e)).toEqual([]);
    e.close();const restarted=new WorldEngine(defaultConfig(e.config.dataDir));engines.push(restarted);await restarted.initialize();expect(restarted.repo.economy.getRequest(r.id)).toEqual(r);expect(restarted.repo.economy.self(a.id).cognitionDormant).toBe(true);
  });

  it('reuses the durable cancellation result after cognition recovery without another provider call or credit charge',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e),think=vi.spyOn(e.cognition,'think').mockResolvedValue({thoughtSummary:'withdraw my request',selectedAction:cancel(r.id)});
    e.repo.economy.injectResource({resource:'COGNITION_CREDIT',amount:1,to:`AGENT:${a.id}`,source:'OWNER_RESOURCE_INJECTION',key:'fixture-cognition'});
    const perform=e.perform.bind(e);e.perform=async(...args)=>{const result=await perform(...args);if(args[1]&&typeof args[1]==='object'&&(args[1] as {type:string}).type==='CANCEL_RESOURCE_PURCHASE_REQUEST')throw new OwnershipFenceError('fixture crash after cancellation commit');return result;};
    e.resume();await e.tick();expect(e.repo.getWorld()!.currentTick).toBe(0);expect(e.repo.economy.getRequest(r.id).status).toBe('CANCELLED');expect(e.repo.economy.consumed('COGNITION_CREDIT')).toBe(1);e.perform=perform;await e.tick();
    expect(think).toHaveBeenCalledTimes(1);expect(cancellations(e)).toHaveLength(1);expect(e.repo.economy.consumed('COGNITION_CREDIT')).toBe(1);expect(e.repo.getWorld()!.currentTick).toBe(1);expect(e.repo.economy.integrity()).toEqual([]);
  });
});

describe('purchase cancellation integrity',()=>{
  it.each(['PENDING','APPROVED','DENIED','SETTLED'] as const)('detects a later illegal transition from CANCELLED to %s',async(status)=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e);e.repo.economy.cancelRequest(a.id,r.id,0);e.repo.db.prepare('UPDATE resource_purchase_requests SET status=? WHERE id=?').run(status,r.id);expect(e.repo.economy.integrity()).toContain(`Purchase cancellation lifecycle mismatch ${r.id}`);
  });
  it('detects modified ownership and forbidden settlement linkage without changing the schema',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,b=e.repo.getAgent('Mam')!,r=request(e),schema=e.repo.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();e.repo.economy.cancelRequest(a.id,r.id,0);
    expect(e.repo.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    e.repo.db.prepare('UPDATE resource_purchase_requests SET agent_id=?,funding_account=?,settlement_id=? WHERE id=?').run(b.id,`AGENT:${b.id}`,'invalid-settlement',r.id);
    const failures=e.repo.economy.integrity();expect(failures).toContain(`Purchase request ownership changed ${r.id}`);expect(failures).toContain(`Cancelled purchase has economic effects ${r.id}`);
  });
  it('detects an external settlement ledger reference to a cancelled request',async()=>{
    const {e}=await fixture(),a=e.repo.getAgent('Toey')!,r=request(e);e.repo.economy.cancelRequest(a.id,r.id,0);
    const movement=e.repo.economy as unknown as {move(input:Movement):string};
    movement.move({kind:'RESOURCE',unit:'LOCAL_COMPUTE',amount:1,from:null,to:`AGENT:${a.id}`,category:'PURCHASE_SETTLEMENT',initiator:'owner:external',key:'corrupt-fixture-settlement',artifact:r.id});expect(e.repo.economy.integrity()).toContain(`Cancelled purchase has economic effects ${r.id}`);
  });
});
