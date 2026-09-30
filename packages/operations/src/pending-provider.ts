import { configuredCognitionProvider,type CognitionProviderIdentity } from '../../cognition/src/index.js';
import type { TickScheduleRecord,WorldRepository } from '../../persistence/src/repository.js';

const modelKey:Record<CognitionProviderIdentity,string>={openai:'OPENAI_MODEL',openrouter:'OPENROUTER_MODEL','opencode-zen':'OPENCODE_ZEN_MODEL'};

/** Owner operation. The network probe is read-only; the fenced scheduler change is atomic. */
export async function migratePendingProvider(repo:WorldRepository,target:{provider:string;modelIdentifier:string},env:NodeJS.ProcessEnv=process.env,fetcher?:typeof fetch):Promise<{schedule:TickScheduleRecord;changed:boolean}>{
  if(!target.provider||!target.modelIdentifier)throw new Error('Explicit --provider and --model are required');
  const pending=repo.tickSchedule(),lease=repo.runnerLeaseDiagnostic();
  if(lease.active||lease.malformed)throw new Error('Cannot migrate while a runner lease is active or malformed');
  if(!pending||!pending.pendingAgentId||!pending.pendingContext)throw new Error('No frozen pending cognition is available for migration');
  if(pending.provider===target.provider&&pending.modelIdentifier===target.modelIdentifier)return repo.migratePendingProvider(target.provider,target.modelIdentifier);
  if(!(target.provider in modelKey))throw new Error('Unsupported target cognition provider');
  const selected=configuredCognitionProvider({...env,COGNITION_PROVIDER:target.provider,[modelKey[target.provider as CognitionProviderIdentity]]:target.modelIdentifier},fetcher);
  if(!selected.provider||!selected.provider.configuration().configured)throw new Error(selected.error??'Target provider configuration is incomplete');
  const readiness=await selected.provider.verifyConnectivity();
  if(!readiness.connected||readiness.modelAvailable===false)throw new Error(readiness.error??'Target provider is unavailable');
  return repo.migratePendingProvider(target.provider,target.modelIdentifier);
}
