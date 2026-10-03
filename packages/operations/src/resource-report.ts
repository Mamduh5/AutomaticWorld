import type { WorldRepository } from '../../persistence/src/repository.js';
export interface ResourceRunReport {
  resourceModelVersion:2;initialCognitionCredits:number;remainingCognitionCredits:number;cognitionCreditsConsumed:number;
  initialLocalCompute:number;remainingLocalCompute:number;localComputeConsumed:number;
  localComputeReserved:number;localComputeRefunded:number;capitalChanges:unknown[];
  resourceTransfers:number;purchaseRequests:number;purchaseSettlements:number;dormancyTransitions:number;restorationTransitions:number;
  maxCognitionCredits:number|null;maxLocalCompute:number|null;
}
export function resourceRunReport(repo:WorldRepository,runId:string):ResourceRunReport|null {
  if(repo.economy.version()!==2)return null;
  const snapshot=repo.db.prepare('SELECT * FROM resource_run_snapshots WHERE run_id=?').get(runId) as {initial_cognition:number;initial_local:number;ending_cognition:number|null;ending_local:number|null;max_cognition:number|null;max_local:number|null;start_ledger_id:number;end_ledger_id:number|null}|undefined;
  if(!snapshot)return null;
  const run=repo.getAutonomyRun(runId)!,ledger=repo.db.prepare('SELECT * FROM value_ledger WHERE rowid>? AND rowid<=? ORDER BY rowid').all(snapshot.start_ledger_id,snapshot.end_ledger_id??Number.MAX_SAFE_INTEGER) as {kind:string;unit:string;amount:number;category:string;from_account:string|null;to_account:string|null}[],events=repo.eventsBetweenIds(run.startEventId,run.endEventId??repo.latestEventId()),count=(type:string)=>events.filter(e=>e.type===type).length;
  const sum=(category:string)=>ledger.filter(r=>r.category===category).reduce((sum,r)=>sum+r.amount,0);
  const reservations=repo.db.prepare("SELECT r.amount,j.amount consumed,j.transition FROM value_reservations r JOIN reservation_journal j ON j.reservation_id=r.id WHERE r.purpose='EXECUTION' AND j.created_at>=? AND j.created_at<=?").all(run.startedAt,run.endedAt??new Date().toISOString()) as {amount:number;consumed:number;transition:string}[];
  return {resourceModelVersion:2,initialCognitionCredits:snapshot.initial_cognition,remainingCognitionCredits:snapshot.ending_cognition??repo.economy.total('COGNITION_CREDIT'),cognitionCreditsConsumed:sum('COGNITION_CONSUMED'),initialLocalCompute:snapshot.initial_local,remainingLocalCompute:snapshot.ending_local??repo.economy.total('LOCAL_COMPUTE'),localComputeConsumed:sum('LOCAL_EXECUTION_CONSUMED'),localComputeReserved:reservations.filter(r=>r.transition==='RESERVED').reduce((s,r)=>s+r.amount,0),localComputeRefunded:reservations.filter(r=>r.transition!=='RESERVED').reduce((s,r)=>s+r.amount-r.consumed,0),capitalChanges:ledger.filter(r=>r.kind==='CAPITAL'),resourceTransfers:count('RESOURCE_TRANSFERRED'),purchaseRequests:count('RESOURCE_PURCHASE_REQUESTED'),purchaseSettlements:count('RESOURCE_PURCHASE_SETTLED'),dormancyTransitions:count('COGNITION_DORMANT'),restorationTransitions:count('COGNITION_RESTORED'),maxCognitionCredits:snapshot.max_cognition,maxLocalCompute:snapshot.max_local};
}
