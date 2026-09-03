#!/usr/bin/env node
import { OpenAICompatibleCognitionProvider } from '../../../packages/cognition/src/index.js';
import { configuredOwnerGateways,ConsoleOwnerGateway,OwnerGatewayDispatcher } from '../../../packages/messaging/src/index.js';
import { DockerExecutionSandbox } from '../../../packages/sandbox/src/docker.js';
import { WorldEngine,defaultConfig } from '../../../packages/world/src/engine.js';
import { ContinuousWorldRunner } from '../../../packages/world/src/runner.js';

const args=process.argv.slice(2),command=args[0]??'help',live=args.includes('--live'),engine=new WorldEngine(defaultConfig(),live?new OpenAICompatibleCognitionProvider():undefined,new DockerExecutionSandbox());
const option=(name:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const integerOption=(name:string,fallback?:number)=>{const raw=option(name);if(raw===undefined&&fallback!==undefined)return fallback;const value=Number(raw);if(!Number.isInteger(value)||value<0)throw new Error(`${name} must be a non-negative integer`);return value;};
const fmt=(n:number)=>n===0?'0 B':n<1024?`${n} B`:`${(n/1024).toFixed(1)} KB`;
function printStatus(){const world=engine.repo.getWorld();if(!world){console.log('No world. Run: pnpm world genesis');return;}const agents=engine.repo.listAgents();console.log(`AI WORLD\n\nWorld age: ${world.currentTick} ticks\nSimulated time: ${world.simulatedTime}\nStatus: ${world.status}\n\nPopulation: ${agents.length}\n\nAgents\n------------------------------------------------`);for(const agent of agents)console.log(`${agent.name.padEnd(9)} generation ${agent.generation}      ${agent.status}${agent.sleepingUntilTick>world.currentTick?` (waiting until ${agent.sleepingUntilTick})`:''}`);console.log('\nResources\n------------------------------------------------');for(const agent of agents)console.log(`${agent.name.padEnd(9)} compute: ${agent.computeCredits}     storage: ${fmt(agent.storageBytes)}`);console.log('\nRecent events\n------------------------------------------------');for(const event of engine.repo.listEvents(10))console.log(`#${event.id} [tick ${event.tick}] ${event.type} ${event.actorId??''}`);}
function activity(limit:number){for(const event of engine.repo.listEvents(limit).reverse()){const actor=event.actorId?engine.repo.getAgent(event.actorId)?.name??event.actorId:'world';const detail=event.payload.path??event.payload.entrypoint??event.payload.outboxId??'';console.log(`#${event.id}\tT${event.tick}\t${actor}\t${event.type}${detail?`\t${String(detail)}`:''}`);}}

try{
  switch(command){
    case'genesis':{const result=await engine.genesis();console.log(result.created?'Genesis initialized.':'Genesis already exists; no changes made.');for(const agent of result.agents)console.log(`${agent.name}: ${agent.id}`);break;}
    case'status':printStatus();break;
    case'agents':for(const agent of engine.repo.listAgents())console.log(`${agent.name}\t${agent.id}\tgeneration ${agent.generation}\t${agent.status}`);break;
    case'inspect':{const agent=engine.repo.getAgent(args[1]??'');if(!agent)throw new Error('Agent not found');console.log(JSON.stringify({...agent,messages:engine.repo.messagesFor(agent.id),memories:engine.repo.memoriesFor(agent.id),executions:engine.repo.executionsFor(agent.id)},null,2));break;}
    case'pause':engine.pause();console.log('World paused.');break;
    case'resume':engine.resume();console.log('World resumed.');break;
    case'tick':{const results=await engine.tick();if(engine.repo.getWorld()?.status==='paused')console.log('World is paused; no cycle performed.');else console.log(JSON.stringify(results,null,2));break;}
    case'run':{
      if(args.includes('--continuous')){const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());const runner=new ContinuousWorldRunner(engine);const result=await runner.run({tickMs:integerOption('--tick-ms',5_000),...(option('--ticks')!==undefined?{maxTicks:integerOption('--ticks')}:{}),...(option('--compute-ceiling')!==undefined?{computeCeiling:integerOption('--compute-ceiling')}:{}),signal:controller.signal});console.log(`Runner stopped: ${result.reason}; ${result.ticks} tick(s) completed.`);
      }else{const ticks=integerOption('--ticks',1);if(ticks<1||ticks>10_000)throw new Error('--ticks must be from 1 to 10000');const results=await engine.run(ticks);console.log(`Completed ${results.length} tick(s)${live?' using live cognition':''}.`);printStatus();}break;}
    case'events':console.log(JSON.stringify(engine.repo.listEvents(100),null,2));break;
    case'activity':activity(integerOption('--last',50));break;
    case'memories':{const agent=engine.repo.getAgent(args[1]??'');if(!agent)throw new Error('Agent not found');const query=option('--query');console.log(JSON.stringify(query?engine.repo.relevantMemories(agent.id,query,engine.repo.getWorld()?.currentTick??0,100):engine.repo.memoriesFor(agent.id,100),null,2));break;}
    case'messages':{const agent=engine.repo.getAgent(args[1]??'');if(!agent)throw new Error('Agent not found');console.log(JSON.stringify(engine.repo.messagesFor(agent.id,100),null,2));break;}
    case'executions':{const agent=engine.repo.getAgent(args[1]??'');if(!agent)throw new Error('Agent not found');console.log(JSON.stringify(engine.repo.executionsFor(agent.id,100),null,2));break;}
    case'files':{const agent=engine.repo.getAgent(args[1]??'');if(!agent)throw new Error('Agent not found');console.log((await engine.files.list(agent.id,'.',args.includes('--shared')?'shared':'private')).join('\n'));break;}
    case'message':{const to=args[1],content=args.slice(2).join(' ');if(!to||!content)throw new Error('Usage: pnpm world message <agent> <content>');engine.ownerMessage(to,content);console.log(`Owner message sent to ${to}.`);break;}
    case'owner-outbox':console.log(JSON.stringify(engine.repo.listOutbox(),null,2));break;
    case'gateway':{if(args[1]!=='dispatch')throw new Error('Usage: pnpm world gateway dispatch [--console]');const gateways=configuredOwnerGateways();if(args.includes('--console')&&!gateways.some((gateway)=>gateway.name==='console'))gateways.push(new ConsoleOwnerGateway());const result=await new OwnerGatewayDispatcher(engine.repo,gateways).dispatch();console.log(`Owner outbox: ${result.delivered} delivered, ${result.failed} failed.`);break;}
    default:console.log('Commands: genesis | status | agents | inspect <name> | pause | resume | tick | run --ticks N | run --continuous [--tick-ms N] [--ticks N] [--compute-ceiling N] | events | activity --last N | memories <name> [--query text] | messages <name> | executions <name> | files <name> [--shared] | message <name> <text> | owner-outbox | gateway dispatch [--console]');
  }
}finally{engine.close();}
