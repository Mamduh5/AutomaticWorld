import type { WorldEngine } from '../packages/world/src/engine.js';
import { randomUUID } from 'node:crypto';
/** Explicit Owner capacity allocation to temporary test worlds only. */
export function fundCognition(engine:WorldEngine):void {
  for(const agent of engine.repo.listAgents()){
    if(engine.repo.economy.self(agent.id).cognitionCredits.total===0)engine.repo.economy.injectResource({resource:'COGNITION_CREDIT',amount:10_000,to:`AGENT:${agent.id}`,source:'OWNER_RESOURCE_INJECTION',key:`fixture-cognition:${agent.id}`,reference:'deterministic fixture allocation'});
    const latest=engine.repo.latestEventId();engine.repo.db.prepare('UPDATE observation_cursors SET own_event_id=?,shared_event_id=? WHERE agent_id=?').run(latest,latest,agent.id);
  }
}
export const local=(engine:WorldEngine,id:string)=>engine.repo.economy.self(engine.repo.getAgent(id)!.id).localCompute.available;
export function setLocal(engine:WorldEngine,id:string,amount:number,storage:number):void {
  const agent=engine.repo.getAgent(id)!,current=local(engine,agent.id);
  if(amount>current)engine.repo.economy.injectResource({resource:'LOCAL_COMPUTE',amount:amount-current,to:`AGENT:${agent.id}`,source:'OWNER_RESOURCE_INJECTION',key:randomUUID()});
  if(amount<current)engine.repo.economy.transfer('RESOURCE','LOCAL_COMPUTE',current-amount,`AGENT:${agent.id}`,'WORLD_RESERVE',randomUUID());
  engine.repo.updateStorage(agent.id,storage);
}
