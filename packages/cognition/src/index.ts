import { z } from 'zod';
import type { AgentRecord, CapabilityDescription, ExecutionRecord, MemoryRecord, MessageRecord, ToolSummary } from '../../shared/src/index.js';
import { AgentActionSchema, type AgentAction } from '../../tools/src/actions.js';

export interface Observation{tick:number;self:AgentRecord;nearbyOrRelevantEvents:{type:string;tick:number;summary:Record<string,unknown>}[];privateArtifacts:string[];sharedArtifacts:string[];receivedMessages:MessageRecord[];recentExecutions:ExecutionRecord[];accessibleResources:{computeCredits:number;storageBytes:number};kernelCapabilities:CapabilityDescription[];userlandTools:ToolSummary[];availableCapabilities:CapabilityDescription[];}
export interface CognitionInput{identity:{id:string;name:string;bootstrapInstruction:string};currentObservation:Observation;relevantMemories:MemoryRecord[];availableActions:CapabilityDescription[];currentResources:{computeCredits:number;storageBytes:number};recentMessages:MessageRecord[];}
export interface CognitionOutput{thoughtSummary:string;selectedAction:AgentAction;reasoningMetadata?:Record<string,unknown>|undefined;}
export interface CognitionProvider{think(input:CognitionInput):Promise<CognitionOutput>;}

export class DeterministicCognitionProvider implements CognitionProvider{
  constructor(private readonly actions:AgentAction[]|((input:CognitionInput)=>AgentAction)=[{type:'WAIT',ticks:1}]){}
  async think(input:CognitionInput):Promise<CognitionOutput>{const selectedAction=typeof this.actions==='function'?this.actions(input):(this.actions.shift()??{type:'WAIT',ticks:1});return{thoughtSummary:`Selected ${selectedAction.type}.`,selectedAction};}
}

const OutputSchema=z.object({thoughtSummary:z.string().min(1).max(2_000),selectedAction:AgentActionSchema,reasoningMetadata:z.record(z.string(),z.unknown()).optional()}).strict();
export type CognitionProviderIdentity='openai'|'openrouter';
export type CognitionEndpointIdentity='OpenAI'|'OpenRouter';
export interface ProviderOptions{identity?:CognitionProviderIdentity;endpointIdentity?:CognitionEndpointIdentity;apiKey?:string|null;baseUrl?:string;model?:string|null;readinessPath?:string;missingConfigurationMessage?:string;defaultHeaders?:Record<string,string>;timeoutMs?:number;maxRetries?:number;maxOutputBytes?:number;fetcher?:typeof fetch;}
export interface ProviderReadiness{configured:boolean;provider:CognitionProviderIdentity;endpointIdentity:CognitionEndpointIdentity;modelIdentifier:string;connected:boolean;inferenceVerified:false;error?:string;}
export interface ConfiguredCognitionProvider{selected:CognitionProviderIdentity|null;provider:OpenAICompatibleCognitionProvider|null;endpointIdentity:CognitionEndpointIdentity|null;modelIdentifier:string|null;error?:string;}
export const sanitizeCognitionProviderError=(error:unknown):string=>{if(error instanceof DOMException&&error.name==='AbortError')return'Provider request timed out';const message=error instanceof Error?error.message:'';if(/^Provider HTTP \d{3}$/.test(message)||message.startsWith('Provider response exceeded')||message.startsWith('Provider action output exceeded')||message==='Provider returned empty output')return message;return'Provider request or response validation failed';};
const normalizeBaseUrl=(value:string):string=>value.replace(/\/+$/,'');
function validTrustedBaseUrl(value:string):boolean{try{const url=new URL(value);return(url.protocol==='https:'||(url.protocol==='http:'&&(url.hostname==='127.0.0.1'||url.hostname==='localhost')))&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}}
export class OpenAICompatibleCognitionProvider implements CognitionProvider{
  private readonly identity:CognitionProviderIdentity;private readonly endpointIdentity:CognitionEndpointIdentity;private readonly apiKey:string|undefined;private readonly baseUrl:string;private readonly model:string;private readonly readinessPath:string;private readonly missingConfigurationMessage:string;private readonly defaultHeaders:Record<string,string>;private readonly timeoutMs:number;private readonly maxRetries:number;private readonly maxOutputBytes:number;private readonly fetcher:typeof fetch;
  constructor(options:ProviderOptions={}){this.identity=options.identity??'openai';this.endpointIdentity=options.endpointIdentity??'OpenAI';this.apiKey=options.apiKey===null?undefined:options.apiKey??process.env.OPENAI_API_KEY;this.baseUrl=normalizeBaseUrl(options.baseUrl??process.env.OPENAI_BASE_URL??'https://api.openai.com/v1');this.model=options.model===null?'':options.model??process.env.OPENAI_MODEL??'gpt-5-mini';this.readinessPath=options.readinessPath??`/models/${encodeURIComponent(this.model)}`;this.missingConfigurationMessage=options.missingConfigurationMessage??'OPENAI_API_KEY and OPENAI_MODEL are required';this.defaultHeaders=options.defaultHeaders??{};this.timeoutMs=options.timeoutMs??20_000;this.maxRetries=options.maxRetries??1;this.maxOutputBytes=options.maxOutputBytes??64*1024;this.fetcher=options.fetcher??fetch;}
  configuration():{provider:CognitionProviderIdentity;endpointIdentity:CognitionEndpointIdentity;modelIdentifier:string;configured:boolean}{return{provider:this.identity,endpointIdentity:this.endpointIdentity,modelIdentifier:this.model,configured:!!this.apiKey&&!!this.model&&validTrustedBaseUrl(this.baseUrl)};}
  private headers(contentType=false):Record<string,string>{return{...this.defaultHeaders,Authorization:`Bearer ${this.apiKey??''}`,...(contentType?{'Content-Type':'application/json'}:{})};}
  async verifyConnectivity():Promise<ProviderReadiness>{const config=this.configuration();if(!config.configured)return{...config,connected:false,inferenceVerified:false,error:this.missingConfigurationMessage};const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(this.timeoutMs,10_000));try{const response=await this.fetcher(`${this.baseUrl}${this.readinessPath}`,{method:'GET',redirect:'error',signal:controller.signal,headers:this.headers()});return response.ok?{...config,connected:true,inferenceVerified:false}:{...config,connected:false,inferenceVerified:false,error:`Provider HTTP ${response.status}`};}catch(error){return{...config,connected:false,inferenceVerified:false,error:sanitizeCognitionProviderError(error)};}finally{clearTimeout(timer);}}
  async think(input:CognitionInput):Promise<CognitionOutput>{
    if(!this.configuration().configured)throw new Error('Cognition provider configuration is incomplete');let lastError='Provider output was invalid';const started=Date.now();
    for(let attempt=0;attempt<=this.maxRetries;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try{
        const response=await this.fetcher(`${this.baseUrl}/chat/completions`,{method:'POST',redirect:'error',signal:controller.signal,headers:this.headers(true),body:JSON.stringify({model:this.model,response_format:{type:'json_object'},messages:[{role:'system',content:`${input.identity.bootstrapInstruction}\nReturn only JSON matching {thoughtSummary, selectedAction}. Do not include hidden reasoning.`},{role:'user',content:JSON.stringify(input)}]})});
        if(!response.ok)throw new Error(`Provider HTTP ${response.status}`);const raw=await response.text();if(Buffer.byteLength(raw)>this.maxOutputBytes)throw new Error('Provider response exceeded output limit');const body=JSON.parse(raw) as any,content=body?.choices?.[0]?.message?.content;if(typeof content!=='string'||content.length===0)throw new Error('Provider returned empty output');if(Buffer.byteLength(content)>this.maxOutputBytes)throw new Error('Provider action output exceeded limit');const parsed=OutputSchema.parse(JSON.parse(content)),usage=body.usage??null,inputTokens=Number(usage?.prompt_tokens??usage?.input_tokens??0),outputTokens=Number(usage?.completion_tokens??usage?.output_tokens??0);return{thoughtSummary:parsed.thoughtSummary,selectedAction:parsed.selectedAction,reasoningMetadata:{usage,inputTokens:Number.isFinite(inputTokens)?inputTokens:0,outputTokens:Number.isFinite(outputTokens)?outputTokens:0,providerLatencyMs:Date.now()-started,providerRequestSucceeded:true,providerAttempts:attempt+1}};
      }catch(error){lastError=sanitizeCognitionProviderError(error);}finally{clearTimeout(timer);}
    }
    return{thoughtSummary:'Cognition output could not be validated; safely waited.',selectedAction:{type:'WAIT',ticks:1},reasoningMetadata:{providerError:lastError,inputTokens:0,outputTokens:0,providerLatencyMs:Date.now()-started,providerRequestSucceeded:false,providerAttempts:this.maxRetries+1}};
  }
}

export function configuredCognitionProvider(env:NodeJS.ProcessEnv=process.env,fetcher?:typeof fetch):ConfiguredCognitionProvider{
  const selected=env.COGNITION_PROVIDER;
  if(selected==='openrouter'){
    const baseUrl=normalizeBaseUrl(env.OPENROUTER_BASE_URL??'https://openrouter.ai/api/v1');
    if(!validTrustedBaseUrl(baseUrl))return{selected,provider:null,endpointIdentity:'OpenRouter',modelIdentifier:env.OPENROUTER_MODEL??null,error:'OPENROUTER_BASE_URL is invalid'};
    if(new URL(baseUrl).hostname.toLowerCase()==='api.openai.com')return{selected,provider:null,endpointIdentity:'OpenRouter',modelIdentifier:env.OPENROUTER_MODEL??null,error:'OpenRouter endpoint is not allowed to target OpenAI'};
    const defaultHeaders:Record<string,string>={};if(env.OPENROUTER_HTTP_REFERER)defaultHeaders['HTTP-Referer']=env.OPENROUTER_HTTP_REFERER;if(env.OPENROUTER_APP_TITLE)defaultHeaders['X-OpenRouter-Title']=env.OPENROUTER_APP_TITLE;
    return{selected,endpointIdentity:'OpenRouter',modelIdentifier:env.OPENROUTER_MODEL??null,provider:new OpenAICompatibleCognitionProvider({identity:selected,endpointIdentity:'OpenRouter',apiKey:env.OPENROUTER_API_KEY??null,baseUrl,model:env.OPENROUTER_MODEL??null,readinessPath:'/key',missingConfigurationMessage:'OPENROUTER_API_KEY and OPENROUTER_MODEL are required',defaultHeaders,...(fetcher?{fetcher}:{})})};
  }
  if(selected==='openai'){
    const baseUrl=normalizeBaseUrl(env.OPENAI_BASE_URL??'https://api.openai.com/v1');
    if(!validTrustedBaseUrl(baseUrl))return{selected,provider:null,endpointIdentity:'OpenAI',modelIdentifier:env.OPENAI_MODEL??null,error:'OPENAI_BASE_URL is invalid'};
    return{selected,endpointIdentity:'OpenAI',modelIdentifier:env.OPENAI_MODEL??null,provider:new OpenAICompatibleCognitionProvider({identity:selected,endpointIdentity:'OpenAI',apiKey:env.OPENAI_API_KEY??null,baseUrl,model:env.OPENAI_MODEL??null,missingConfigurationMessage:'OPENAI_API_KEY and OPENAI_MODEL are required',...(fetcher?{fetcher}:{})})};
  }
  return{selected:null,provider:null,endpointIdentity:null,modelIdentifier:null,error:selected?'Unsupported cognition provider':'COGNITION_PROVIDER is required'};
}
