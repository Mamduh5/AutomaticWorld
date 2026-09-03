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
export interface ProviderOptions{apiKey?:string;baseUrl?:string;model?:string;timeoutMs?:number;maxRetries?:number;maxOutputBytes?:number;fetcher?:typeof fetch;}
export interface ProviderReadiness{configured:boolean;provider:string;modelIdentifier:string;connected:boolean;error?:string;}
const safeProviderError=(error:unknown):string=>{if(error instanceof DOMException&&error.name==='AbortError')return'Provider request timed out';const message=error instanceof Error?error.message:'';if(/^Provider HTTP \d{3}$/.test(message)||message.startsWith('Provider response exceeded')||message.startsWith('Provider action output exceeded')||message==='Provider returned empty output')return message;return'Provider request or response validation failed';};
export class OpenAICompatibleCognitionProvider implements CognitionProvider{
  private readonly apiKey:string|undefined;private readonly baseUrl:string;private readonly model:string;private readonly timeoutMs:number;private readonly maxRetries:number;private readonly maxOutputBytes:number;private readonly fetcher:typeof fetch;
  constructor(options:ProviderOptions={}){this.apiKey=options.apiKey??process.env.OPENAI_API_KEY;this.baseUrl=options.baseUrl??process.env.OPENAI_BASE_URL??'https://api.openai.com/v1';this.model=options.model??process.env.OPENAI_MODEL??'gpt-5-mini';this.timeoutMs=options.timeoutMs??20_000;this.maxRetries=options.maxRetries??1;this.maxOutputBytes=options.maxOutputBytes??64*1024;this.fetcher=options.fetcher??fetch;}
  configuration():{provider:string;modelIdentifier:string;configured:boolean}{return{provider:'openai-compatible',modelIdentifier:this.model,configured:!!this.apiKey&&!!this.model};}
  async verifyConnectivity():Promise<ProviderReadiness>{const config=this.configuration();if(!config.configured)return{...config,connected:false,error:'OPENAI_API_KEY and OPENAI_MODEL are required'};const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(this.timeoutMs,10_000));try{const response=await this.fetcher(`${this.baseUrl}/models/${encodeURIComponent(this.model)}`,{method:'GET',signal:controller.signal,headers:{Authorization:`Bearer ${this.apiKey}`}});return response.ok?{...config,connected:true}:{...config,connected:false,error:`Provider HTTP ${response.status}`};}catch(error){return{...config,connected:false,error:safeProviderError(error)};}finally{clearTimeout(timer);}}
  async think(input:CognitionInput):Promise<CognitionOutput>{
    if(!this.apiKey)throw new Error('OPENAI_API_KEY is required for --live');let lastError='Provider output was invalid';const started=Date.now();
    for(let attempt=0;attempt<=this.maxRetries;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try{
        const response=await this.fetcher(`${this.baseUrl}/chat/completions`,{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.model,response_format:{type:'json_object'},messages:[{role:'system',content:`${input.identity.bootstrapInstruction}\nReturn only JSON matching {thoughtSummary, selectedAction}. Do not include hidden reasoning.`},{role:'user',content:JSON.stringify(input)}]})});
        if(!response.ok)throw new Error(`Provider HTTP ${response.status}`);const raw=await response.text();if(Buffer.byteLength(raw)>this.maxOutputBytes)throw new Error('Provider response exceeded output limit');const body=JSON.parse(raw) as any,content=body?.choices?.[0]?.message?.content;if(typeof content!=='string'||content.length===0)throw new Error('Provider returned empty output');if(Buffer.byteLength(content)>this.maxOutputBytes)throw new Error('Provider action output exceeded limit');const parsed=OutputSchema.parse(JSON.parse(content)),usage=body.usage??null,inputTokens=Number(usage?.prompt_tokens??usage?.input_tokens??0),outputTokens=Number(usage?.completion_tokens??usage?.output_tokens??0);return{...parsed,reasoningMetadata:{...(parsed.reasoningMetadata??{}),usage,inputTokens:Number.isFinite(inputTokens)?inputTokens:0,outputTokens:Number.isFinite(outputTokens)?outputTokens:0,providerLatencyMs:Date.now()-started,providerRequestSucceeded:true,providerAttempts:attempt+1}};
      }catch(error){lastError=safeProviderError(error);}finally{clearTimeout(timer);}
    }
    return{thoughtSummary:'Cognition output could not be validated; safely waited.',selectedAction:{type:'WAIT',ticks:1},reasoningMetadata:{providerError:lastError,inputTokens:0,outputTokens:0,providerLatencyMs:Date.now()-started,providerRequestSucceeded:false,providerAttempts:this.maxRetries+1}};
  }
}
