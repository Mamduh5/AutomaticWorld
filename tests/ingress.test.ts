import { createHmac } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import { LineWebhookIngress } from '../packages/messaging/src/ingress.js';
import { WorldEngine,defaultConfig } from '../packages/world/src/engine.js';

const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function setup(){const dir=await mkdtemp(path.join(tmpdir(),'ai-world-ingress-'));dirs.push(dir);const engine=new WorldEngine(defaultConfig(dir));await engine.genesis();const ingress=new LineWebhookIngress(engine.ownerIngress,engine.repo,{channelSecret:'secret',ownerSourceId:'owner-line-id'});return{engine,ingress};}
const body=(events:unknown[])=>Buffer.from(JSON.stringify({destination:'channel',events}));
const sign=(raw:Buffer)=>createHmac('sha256','secret').update(raw).digest('base64');
const event=(text='Mam: hello',id='event-1',userId='owner-line-id')=>({type:'message',webhookEventId:id,deliveryContext:{isRedelivery:false},source:{type:'user',userId},message:{type:'text',id:'message-1',text}});

describe('Owner ingress and LINE security',()=>{
  it('routes CLI ingress through durable owner messaging and wakes the recipient',async()=>{const {engine}=await setup(),mam=engine.repo.getAgent('Mam')!;await engine.perform(mam.id,{type:'WAIT',ticks:50},1);const result=await engine.ownerIngress.ingestCli('Mam','wake up');expect(result.status).toBe('INGESTED');expect(engine.repo.messagesFor(mam.id)[0]).toMatchObject({fromType:'owner',content:'wake up'});expect(engine.repo.getAgent(mam.id)?.sleepingUntilTick).toBe(0);engine.close();});
  it('validates the exact raw body before parsing and durably ingests a valid event',async()=>{const {engine,ingress}=await setup(),raw=body([event()]);expect(await ingress.handleRaw(raw,sign(raw))).toMatchObject({statusCode:200,accepted:1});await ingress.drain();const mam=engine.repo.getAgent('Mam')!;expect(engine.repo.messagesFor(mam.id)).toHaveLength(1);expect(engine.repo.listEvents().some((item)=>item.type==='OWNER_MESSAGE_INGESTED')).toBe(true);engine.close();});
  it('rejects missing, invalid, and body-mutated signatures',async()=>{const {engine,ingress}=await setup(),raw=body([event()]),signature=sign(raw);expect((await ingress.handleRaw(raw,undefined)).statusCode).toBe(401);expect((await ingress.handleRaw(raw,'bad')).statusCode).toBe(401);expect((await ingress.handleRaw(Buffer.concat([raw,Buffer.from(' ')]),signature)).statusCode).toBe(401);expect(engine.repo.messagesFor(engine.repo.getAgent('Mam')!.id)).toHaveLength(0);engine.close();});
  it('rejects a different LINE source without granting Owner identity',async()=>{const {engine,ingress}=await setup(),raw=body([event('Mam: impostor','event-other','other-user')]);expect(await ingress.handleRaw(raw,sign(raw))).toMatchObject({statusCode:200,rejected:1});expect(engine.repo.messagesFor(engine.repo.getAgent('Mam')!.id)).toHaveLength(0);engine.close();});
  it('accepts zero-event verification and deduplicates redelivery',async()=>{const {engine,ingress}=await setup(),empty=body([]);expect(await ingress.handleRaw(empty,sign(empty))).toEqual({statusCode:200,accepted:0,rejected:0,duplicates:0});const raw=body([event()]);await ingress.handleRaw(raw,sign(raw));await ingress.drain();expect(await ingress.handleRaw(raw,sign(raw))).toMatchObject({duplicates:1});expect(engine.repo.messagesFor(engine.repo.getAgent('Mam')!.id)).toHaveLength(1);expect(engine.repo.listEvents().some((item)=>item.type==='OWNER_WEBHOOK_REDELIVERED')).toBe(true);engine.close();});
  it('keeps unresolved routing in a rejected ingress record without broadcasting',async()=>{const {engine,ingress}=await setup(),raw=body([event('everyone hello','unroutable')]);const result=await ingress.handleRaw(raw,sign(raw));await ingress.drain();expect(result.accepted).toBe(1);expect(engine.repo.messagesFor(engine.repo.getAgent('Mam')!.id)).toHaveLength(0);expect(engine.repo.messagesFor(engine.repo.getAgent('Toey')!.id)).toHaveLength(0);expect(engine.repo.listEvents().some((item)=>item.type==='OWNER_INGRESS_REJECTED')).toBe(true);engine.close();});
});
