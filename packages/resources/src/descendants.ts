import { randomUUID } from 'node:crypto';
import type { DescendantLaws, DescendantOperation, WorldRepository } from '../../persistence/src/repository.js';
import { CAPABILITIES, type AgentRecord, type DescendantProposalRecord, type LineageRecord } from '../../shared/src/index.js';
import { integer, RESOURCE_TYPES } from './economy.js';

/** Descendant metadata uses the historical columns for Local Compute; conservation uses the value ledger. */
export class ResourceDescendants {
  constructor(private readonly repo:WorldRepository){}
  private get economy(){return this.repo.economy;}
  private id(proposal:string,party:'proposer'|'acceptor',unit:string){return `descendant:${proposal}:${party}:${unit}`;}
  propose(input:{proposerAgentId:string;coParentAgentId:string;proposedName:string;contribution:number;cognitionContribution:number;tick:number}):DescendantProposalRecord {
    return this.repo.transaction(()=>{
      this.economy.requireModel();integer(input.contribution);integer(input.cognitionContribution);
      const a=this.repo.getAgent(input.proposerAgentId),b=this.repo.getAgent(input.coParentAgentId);
      if(!a||a.status!=='active'||!b||b.status!=='active')throw new Error('Both requested parents must be active');
      if(a.id===b.id)throw new Error('Two distinct inhabitants are required');
      if(this.repo.getAgent(input.proposedName))throw new Error('Inhabitant names must currently be unique');
      const id=randomUUID(),now=new Date().toISOString();
      this.repo.db.prepare("INSERT INTO descendant_proposals(id,proposer_agent_id,co_parent_agent_id,proposed_name,proposer_compute_contribution,proposer_cognition_contribution,status,created_tick,created_at) VALUES(?,?,?,?,?,?,'PENDING',?,?)").run(id,a.id,b.id,input.proposedName,input.contribution,input.cognitionContribution,input.tick,now);
      for(const resource of RESOURCE_TYPES)this.economy.reserve(this.id(id,'proposer',resource),'RESOURCE',resource,`AGENT:${a.id}`,resource==='LOCAL_COMPUTE'?input.contribution:input.cognitionContribution,'DESCENDANT');
      this.repo.addEvent('DESCENDANT_PROPOSAL_CREATED',input.tick,a.id,b.id,{proposalId:id,proposedName:input.proposedName,localComputeContribution:input.contribution,cognitionContribution:input.cognitionContribution});
      return this.repo.getDescendantProposal(id)!;
    });
  }
  release(id:string,actor:string,cancel:boolean,tick:number):DescendantProposalRecord {
    return this.repo.transaction(()=>{
      const p=this.repo.getDescendantProposal(id);if(!p)throw new Error('Descendant proposal not found');
      if((cancel?p.proposerAgentId:p.coParentAgentId)!==actor)throw new Error(cancel?'Only the proposer can cancel':'Only the requested co-parent can respond');
      if(cancel&&p.status==='CANCELLED')return p;if(p.status!=='PENDING')throw new Error('Proposal already resolved');
      if(this.repo.getDescendantOperationByProposal(id))throw new Error('A consented creation is already durably pending');
      for(const unit of RESOURCE_TYPES){const reservation=this.id(id,'proposer',unit);if(this.economy.reservation(reservation))this.economy.resolveReservation(reservation);}
      const status=cancel?'CANCELLED':'REJECTED';this.repo.db.prepare('UPDATE descendant_proposals SET status=?,responded_tick=?,responded_at=? WHERE id=?').run(status,tick,new Date().toISOString(),id);
      this.repo.addEvent(cancel?'DESCENDANT_PROPOSAL_CANCELLED':'DESCENDANT_PROPOSAL_REJECTED',tick,actor,cancel?p.coParentAgentId:p.proposerAgentId,{proposalId:id,proposedName:p.proposedName});return this.repo.getDescendantProposal(id)!;
    });
  }
  prepare(id:string,actor:string,local:number,cognition:number,tick:number,laws:DescendantLaws):DescendantOperation {
    return this.repo.transaction(()=>{
      integer(local);integer(cognition);const p=this.repo.getDescendantProposal(id);if(!p)throw new Error('Descendant proposal not found');if(p.coParentAgentId!==actor)throw new Error('Only the requested co-parent can respond');if(p.status!=='PENDING')throw new Error('Proposal already resolved');
      const existing=this.repo.getDescendantOperationByProposal(id);if(existing){if(existing.acceptorContribution!==local||existing.acceptorCognitionContribution!==cognition)throw new Error('Contribution differs from durable consent');return existing;}
      const a=this.repo.getAgent(p.proposerAgentId)!,b=this.repo.getAgent(actor)!;if(a.status!=='active'||b.status!=='active')throw new Error('Both parents must be active');
      if(this.repo.listAgents().filter(a=>a.status==='active').length+this.repo.incompleteDescendantOperations().filter(o=>o.state==='PREPARED'||o.state==='FILESYSTEM_COMMITTED').length>=laws.maximumActiveInhabitants)throw new Error('World active inhabitant ceiling reached');
      if(this.repo.getAgent(p.proposedName))throw new Error('Proposed name is unavailable');
      if(this.repo.incompleteDescendantOperations().some(o=>o.childName.toLowerCase()===p.proposedName.toLowerCase()))throw new Error('Proposed name is already reserved by consented creation');
      const childLocal=integer(p.proposerComputeContribution+local),childCognition=integer((p.proposerCognitionContribution??0)+cognition),now=new Date().toISOString();
      for(const unit of RESOURCE_TYPES)this.economy.reserve(this.id(id,'acceptor',unit),'RESOURCE',unit,`AGENT:${actor}`,unit==='LOCAL_COMPUTE'?local:cognition,'DESCENDANT');
      const operation:DescendantOperation={id:randomUUID(),proposalId:id,childAgentId:randomUUID(),acceptorContribution:local,acceptorCognitionContribution:cognition,childName:p.proposedName,generation:Math.max(a.generation,b.generation)+1,birthTick:tick,childCompute:childLocal,childCognition,overhead:0,state:'PREPARED',error:null,createdAt:now,updatedAt:now};
      this.repo.db.prepare("INSERT INTO descendant_operations(id,proposal_id,child_agent_id,acceptor_contribution,acceptor_cognition_contribution,child_name,generation,birth_tick,child_compute,child_cognition,overhead,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,'PREPARED',?,?)").run(operation.id,id,operation.childAgentId,local,cognition,p.proposedName,operation.generation,tick,childLocal,childCognition,now,now);
      return operation;
    });
  }
  complete(operationId:string,laws:DescendantLaws):{operation:DescendantOperation;child:AgentRecord;lineage:LineageRecord} {
    return this.repo.transaction(()=>{
      const op=this.repo.listDescendantOperations().find(o=>o.id===operationId);if(!op)throw new Error('Descendant operation not found');const existing=this.repo.getAgent(op.childAgentId),lineage=this.repo.lineageFor(op.childAgentId);if(existing&&lineage)return{operation:op,child:existing,lineage};
      if(op.state!=='FILESYSTEM_COMMITTED')throw new Error('Child filesystem must be committed');const p=this.repo.getDescendantProposal(op.proposalId)!;
      if(p.status!=='PENDING')throw new Error('Proposal is no longer pending');if(this.repo.listAgents().filter(a=>a.status==='active').length>=laws.maximumActiveInhabitants)throw new Error('World active inhabitant ceiling reached');
      const child:AgentRecord={id:op.childAgentId,name:op.childName,createdAt:new Date().toISOString(),generation:op.generation,parentIds:[p.proposerAgentId,p.coParentAgentId],status:'active',cognitionConfig:{provider:'world-selected'},capabilities:[...CAPABILITIES],metadata:{descendant:true,birthTick:op.birthTick},computeCredits:0,storageBytes:0,sleepingUntilTick:0,eligibleFromTick:op.birthTick+1};
      this.repo.createAgent(child);this.economy.ensureAgent(child.id);
      for(const unit of RESOURCE_TYPES)for(const party of ['proposer','acceptor'] as const){const id=this.id(p.id,party,unit),r=this.economy.reservation(id);if(r)this.economy.resolveReservation(id,r.amount,`AGENT:${child.id}`);else if(unit==='LOCAL_COMPUTE')throw new Error('Missing descendant escrow');}
      // Previously consented v1 overhead remains a recorded loss; v2 creations have no overhead.
      if(op.overhead){const id=`legacy-descendant-overhead:${op.id}`;this.economy.reserve(id,'RESOURCE','LOCAL_COMPUTE',`AGENT:${child.id}`,op.overhead,'DESCENDANT_LEGACY_OVERHEAD');this.economy.resolveReservation(id,op.overhead);}
      if(this.economy.self(child.id).localCompute.total!==op.childCompute||this.economy.self(child.id).cognitionCredits.total!==(op.childCognition??0))throw new Error('Child endowment differs from consented escrow');
      const result:LineageRecord={childAgentId:child.id,parentAAgentId:p.proposerAgentId,parentBAgentId:p.coParentAgentId,proposalId:p.id,birthTick:op.birthTick};
      this.repo.db.prepare('INSERT INTO lineage VALUES(?,?,?,?,?)').run(child.id,p.proposerAgentId,p.coParentAgentId,p.id,op.birthTick);
      this.repo.db.prepare("UPDATE descendant_proposals SET status='COMPLETED',responded_tick=?,responded_at=?,child_agent_id=? WHERE id=?").run(op.birthTick,new Date().toISOString(),child.id,p.id);
      this.repo.addEvent('DESCENDANT_PROPOSAL_ACCEPTED',op.birthTick,p.coParentAgentId,p.proposerAgentId,{proposalId:p.id,child:{id:child.id,name:child.name,generation:child.generation,status:child.status},localComputeEndowment:op.childCompute,cognitionEndowment:op.childCognition??0});
      this.repo.addEvent('DESCENDANT_CREATED',op.birthTick,null,child.id,{visibility:'SHARED',inhabitant:{id:child.id,name:child.name,generation:child.generation,status:child.status}});
      this.repo.updateDescendantOperation(op.id,'DATABASE_COMMITTED');return{operation:{...op,state:'DATABASE_COMMITTED'},child:this.repo.getAgent(child.id)!,lineage:result};
    });
  }
}
