import { randomUUID } from 'node:crypto';
import type { WorldEngine } from './engine.js';

export interface RunnerOptions{tickMs:number;maxTicks?:number;computeCeiling?:number;signal?:AbortSignal;}
const delay=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve)=>{if(signal?.aborted){resolve();return;}const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});

export class ContinuousWorldRunner{
  constructor(private readonly engine:WorldEngine){}
  async run(options:RunnerOptions):Promise<{ticks:number;reason:string}>{
    const token=randomUUID(),world=this.engine.repo.getWorld();if(!world)throw new Error('World does not exist');if(world.status!=='running')throw new Error('World is paused; run resume first');if(!this.engine.repo.acquireRunnerLease(token,this.engine.config.runnerLeaseMs))throw new Error('Another runner holds the world lease');
    const initialCompute=this.engine.repo.listAgents().reduce((sum,a)=>sum+a.computeCredits,0);let ticks=0,reason='stopped';this.engine.repo.addEvent('RUNNER_STARTED',world.currentTick,null,null,{token,tickMs:options.tickMs});
    try{while(!options.signal?.aborted){if(options.maxTicks!==undefined&&ticks>=options.maxTicks){reason='maximum ticks reached';break;}const latest=this.engine.repo.getWorld();if(latest?.status!=='running'){reason='world paused';break;}if(!this.engine.repo.renewRunnerLease(token,this.engine.config.runnerLeaseMs)){reason='runner lease lost';this.engine.repo.addEvent('RUNNER_LEASE_LOST',latest?.currentTick??0,null,null,{token});break;}await this.engine.tick();ticks++;if(options.computeCeiling!==undefined){const remaining=this.engine.repo.listAgents().reduce((sum,a)=>sum+a.computeCredits,0);if(initialCompute-remaining>=options.computeCeiling){reason='compute ceiling reached';break;}}if(options.tickMs>0)await delay(options.tickMs,options.signal);}if(options.signal?.aborted)reason='shutdown signal';return{ticks,reason};}
    finally{const tick=this.engine.repo.getWorld()?.currentTick??world.currentTick;this.engine.repo.releaseRunnerLease(token);this.engine.repo.addEvent('RUNNER_STOPPED',tick,null,null,{token,ticks,reason});}
  }
}
