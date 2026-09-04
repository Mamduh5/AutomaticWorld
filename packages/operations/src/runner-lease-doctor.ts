import type { WorldRepository } from '../../persistence/src/repository.js';

export interface RunnerLeaseDoctorCheck{name:string;passed:boolean;detail:string;}

export function runnerLeaseDoctorChecks(repo:WorldRepository):RunnerLeaseDoctorCheck[]{
  const lease=repo.runnerLeaseDiagnostic();
  const state=!lease.present?'none':lease.malformed?'malformed':lease.active?'active valid':lease.expired?'expired stale':'inactive';
  const healthy=!lease.malformed||lease.recoverable;
  const detail=lease.present?`${state}; runner=${lease.runnerId??'unknown'}; expires=${lease.expiresAt??'unknown'}${lease.recoverable?'; recoverable by atomic replacement':''}`:'none';
  const probe=repo.probeRunnerLeaseRoundTrip();
  return[
    {name:'Runner lease',passed:healthy,detail},
    {name:'Runner lease acquire/release',passed:probe.passed,detail:probe.detail},
  ];
}
