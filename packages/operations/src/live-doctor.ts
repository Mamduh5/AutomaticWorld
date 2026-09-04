import { constants as fsConstants,promises as fs } from 'node:fs';
import { configuredCognitionProvider,OpenAICompatibleCognitionProvider,type ProviderReadiness } from '../../cognition/src/index.js';
import type { WorldEngine } from '../../world/src/engine.js';
import { SandboxDoctor,type SandboxDoctorReport } from './doctor.js';
import { runnerLeaseDoctorChecks } from './runner-lease-doctor.js';

export interface ReadinessCheck{name:string;passed:boolean;required:boolean;detail:string;}
export interface LiveReadinessReport{readyForLiveExperiment:boolean;checks:ReadinessCheck[];sandbox:SandboxDoctorReport;provider:ProviderReadiness|null;}
const FOUNDER_IDS={Mam:'29c9d81e-d1d8-4807-893f-841cffce01fe',Toey:'eef2caca-cf78-4e90-a536-7115e8af1daf'} as const;
async function countSecretLeaks(root:string,secrets:string[]):Promise<number>{let leaks=0;const needles=secrets.filter((value)=>value.length>=4).map((value)=>Buffer.from(value));const walk=async(directory:string):Promise<void>=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const target=`${directory}/${entry.name}`,stat=await fs.lstat(target);if(stat.isSymbolicLink())continue;if(stat.isDirectory())await walk(target);else if(stat.isFile()){const content=await fs.readFile(target);if(needles.some((needle)=>content.includes(needle)))leaks++;}}};try{await walk(root);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return leaks;}

export class LiveReadinessDoctor{
  constructor(private readonly engine:WorldEngine,private readonly sandboxDoctor=new SandboxDoctor(),private readonly provider:OpenAICompatibleCognitionProvider|undefined=undefined,private readonly env:NodeJS.ProcessEnv=process.env,private readonly founderIds:Record<string,string>=FOUNDER_IDS){}
  async verify(options:{live:boolean;pull?:boolean}):Promise<LiveReadinessReport>{
    await this.engine.initialize();
    const checks:ReadinessCheck[]=[],add=(name:string,passed:boolean,detail:string,required=true)=>checks.push({name,passed,required,detail}),world=this.engine.repo.getWorld(),agents=this.engine.repo.listAgents(),integrity=this.engine.repo.databaseIntegrity();
    add('World database',!!world&&integrity==='ok',world?`integrity=${integrity}`:'missing');
    add('Population',agents.length===2,`${agents.length}`);
    add('Founder identities',agents.length===2&&agents.every((agent)=>this.founderIds[agent.name]===agent.id),agents.map((agent)=>`${agent.name}:${agent.id}`).join(', '));
    add('World state',world?.status==='running',world?.status??'missing');
    const lease=this.engine.repo.runnerLeaseDiagnostic();for(const check of runnerLeaseDoctorChecks(this.engine.repo))add(check.name,check.passed,check.detail);add('Runner lease availability',!lease.active,lease.active?'active valid lease prevents a second runner':'available for safe acquisition');
    const sandbox=await this.sandboxDoctor.verify(options.pull===undefined?{}:{pull:options.pull});add('Docker sandbox',sandbox.operationallyVerified,sandbox.operationallyVerified?'operationally verified':'not operationally verified');
    add('Available compute',agents.every((agent)=>agent.computeCredits>0),agents.map((agent)=>`${agent.name}=${agent.computeCredits}`).join(', '));
    add('Storage accounting',agents.every((agent)=>agent.storageBytes>=0&&agent.storageBytes<=this.engine.config.initialStorageBytes),agents.map((agent)=>`${agent.name}=${agent.storageBytes}`).join(', '));
    try{await fs.access(this.engine.config.dataDir,fsConstants.R_OK|fsConstants.W_OK);add('Storage health',true,'world-data readable and writable');}catch{add('Storage health',false,'world-data is not readable and writable');}
    const secretKeys=['OPENAI_API_KEY','OPENROUTER_API_KEY','WORLD_EMAIL_ADDRESS','WORLD_EMAIL_APP_PASSWORD','LINE_CHANNEL_ACCESS_TOKEN','LINE_CHANNEL_SECRET'] as const,secretLeaks=await countSecretLeaks(this.engine.config.dataDir,secretKeys.flatMap((key)=>this.env[key]?[this.env[key]!]:[]));add('Secret isolation',secretLeaks===0,secretLeaks===0?'no configured credentials found in world-data':`${secretLeaks} world-data file(s) contain configured credentials`);
    const incomplete=this.engine.repo.incompleteFilesystemOperations().length;add('Operation reconciliation',incomplete===0,`${incomplete} incomplete`);
    const versions=this.engine.repo.allToolVersions();let toolsHealthy=true;try{for(const version of versions)await this.engine.tools.executablePath(version);}catch{toolsHealthy=false;}add('Tool-store integrity',toolsHealthy,`${versions.length} published version(s)`);
    const emailKeys=['WORLD_EMAIL_ADDRESS','WORLD_EMAIL_APP_PASSWORD','WORLD_SMTP_HOST','OWNER_EMAIL_DESTINATION'] as const,emailPresent=emailKeys.filter((key)=>!!this.env[key]),emailComplete=emailPresent.length===emailKeys.length;add('World email identity',emailPresent.length===0||emailComplete&&this.env.WORLD_EMAIL_ADDRESS==='aychatkub@gmail.com',emailPresent.length===0?'not configured':emailComplete?(this.env.WORLD_EMAIL_ADDRESS==='aychatkub@gmail.com'?'configured world identity':'unexpected world identity'):'partial configuration',false);
    const lineKeys=['LINE_CHANNEL_ACCESS_TOKEN','LINE_OWNER_DESTINATION_ID','LINE_CHANNEL_SECRET','LINE_OWNER_SOURCE_ID'] as const,linePresent=lineKeys.filter((key)=>!!this.env[key]),lineComplete=linePresent.length===lineKeys.length;add('LINE configuration',linePresent.length===0||lineComplete,linePresent.length===0?'not configured':lineComplete?'configured':'partial configuration',false);
    const ownerConfigured=this.env.OWNER_CONSOLE_GATEWAY==='true'||emailComplete||linePresent.length>=2;add('Owner gateway configuration',ownerConfigured,ownerConfigured?'at least one outbound gateway configured':'none configured',false);
    let provider:ProviderReadiness|null=null;if(options.live){const selection=configuredCognitionProvider(this.env),selectionValid=selection.selected!==null&&!selection.error;add('Cognition provider selection',selectionValid,selection.selected??(this.env.COGNITION_PROVIDER?'unsupported':'missing'));if(selection.provider&&selectionValid)provider=await(this.provider??selection.provider).verifyConnectivity();add('Cognition provider configuration',provider?.configured===true,provider?.configured?`model=${provider.modelIdentifier}`:selection.error??'incomplete');add('Cognition endpoint',provider?.configured===true,provider?.endpointIdentity??selection.endpointIdentity??'unavailable');add('Provider authentication/connectivity',provider?.connected===true,provider?.connected?'succeeded; no inference request performed':provider?.error??selection.error??'connection failed');add('Real inference capability',false,'not verified; doctor performs no inference request',false);}
    return{readyForLiveExperiment:checks.filter((check)=>check.required).every((check)=>check.passed),checks,sandbox,provider};
  }
}
