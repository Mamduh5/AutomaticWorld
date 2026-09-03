import { z } from 'zod';
import type { AgentRecord, MemoryRecord, MessageRecord } from '../../shared/src/index.js';
import { AgentActionSchema, type AgentAction } from '../../tools/src/actions.js';

export interface Observation { tick:number; self:AgentRecord; nearbyOrRelevantEvents:{type:string;tick:number}[]; visibleArtifacts:string[]; receivedMessages:MessageRecord[]; accessibleResources:{computeCredits:number;storageBytes:number}; availableCapabilities:string[]; }
export interface CognitionInput { identity:{id:string;name:string;bootstrapInstruction:string}; currentObservation:Observation; relevantMemories:MemoryRecord[]; availableActions:string[]; currentResources:{computeCredits:number;storageBytes:number}; recentMessages:MessageRecord[]; }
export interface CognitionOutput { thoughtSummary:string; selectedAction:AgentAction; reasoningMetadata?:Record<string,unknown>|undefined; }
export interface CognitionProvider { think(input:CognitionInput):Promise<CognitionOutput>; }

export class DeterministicCognitionProvider implements CognitionProvider {
  constructor(private readonly actions: AgentAction[] | ((input:CognitionInput)=>AgentAction) = [{type:'WAIT'}]) {}
  async think(input:CognitionInput):Promise<CognitionOutput>{ const selectedAction=typeof this.actions==='function'?this.actions(input):(this.actions.shift()??{type:'WAIT'}); return {thoughtSummary:`Selected ${selectedAction.type}.`,selectedAction}; }
}

const OutputSchema=z.object({thoughtSummary:z.string().min(1).max(2000),selectedAction:AgentActionSchema,reasoningMetadata:z.record(z.string(),z.unknown()).optional()});
export class OpenAICompatibleCognitionProvider implements CognitionProvider {
  constructor(private readonly apiKey=process.env.OPENAI_API_KEY,private readonly baseUrl=process.env.OPENAI_BASE_URL??'https://api.openai.com/v1',private readonly model=process.env.OPENAI_MODEL??'gpt-5-mini'){}
  async think(input:CognitionInput):Promise<CognitionOutput>{
    if(!this.apiKey) throw new Error('OPENAI_API_KEY is required for --live');
    const response=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.model,response_format:{type:'json_object'},messages:[{role:'system',content:input.identity.bootstrapInstruction+'\nReturn only JSON matching {thoughtSummary, selectedAction}.'},{role:'user',content:JSON.stringify(input)}]})});
    if(!response.ok) throw new Error(`Cognition provider failed: ${response.status}`);
    const body=await response.json() as any; return OutputSchema.parse(JSON.parse(body.choices[0].message.content));
  }
}
