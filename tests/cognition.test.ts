import { describe,expect,it,vi } from 'vitest';
import { OpenAICompatibleCognitionProvider,type CognitionInput } from '../packages/cognition/src/index.js';

const input={identity:{id:'a',name:'Mam',bootstrapInstruction:'You exist.'},currentObservation:{tick:1,self:{} as never,nearbyOrRelevantEvents:[],privateArtifacts:[],sharedArtifacts:[],receivedMessages:[],recentExecutions:[],accessibleResources:{computeCredits:1,storageBytes:0},availableCapabilities:[]},relevantMemories:[],availableActions:[],currentResources:{computeCredits:1,storageBytes:0},recentMessages:[]} satisfies CognitionInput;
const response=(body:unknown,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const validBody={choices:[{message:{content:JSON.stringify({thoughtSummary:'I will wait.',selectedAction:{type:'WAIT',ticks:2}})}}],usage:{total_tokens:12}};

describe('OpenAI-compatible provider contract',()=>{
  it('accepts a valid structured action and records usage metadata',async()=>{const fetcher=vi.fn(async()=>response(validBody)) as unknown as typeof fetch;const result=await new OpenAICompatibleCognitionProvider({apiKey:'test',fetcher}).think(input);expect(result.selectedAction).toEqual({type:'WAIT',ticks:2});expect(result.reasoningMetadata?.usage).toEqual({total_tokens:12});});
  it.each([
    ['malformed JSON',response('not json')],
    ['unsupported action',response({choices:[{message:{content:JSON.stringify({thoughtSummary:'x',selectedAction:{type:'SHELL'}})}}]})],
    ['empty output',response({choices:[{message:{content:''}}]})],
    ['invalid arguments',response({choices:[{message:{content:JSON.stringify({thoughtSummary:'x',selectedAction:{type:'WAIT',ticks:999}})}}]})],
    ['provider error',response({error:'bad'},503)],
    ['oversized output',response('x'.repeat(2_000))],
  ])('uses safe WAIT after bounded retries for %s',async(_name,reply)=>{const fetcher=vi.fn(async()=>reply) as unknown as typeof fetch;const result=await new OpenAICompatibleCognitionProvider({apiKey:'test',fetcher,maxRetries:1,maxOutputBytes:1_000}).think(input);expect(result.selectedAction).toEqual({type:'WAIT',ticks:1});expect(result.reasoningMetadata?.providerError).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(2);});
  it('turns a timeout into safe WAIT after bounded recovery',async()=>{const fetcher=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))) as unknown as typeof fetch;const result=await new OpenAICompatibleCognitionProvider({apiKey:'test',fetcher,timeoutMs:5,maxRetries:0}).think(input);expect(result.selectedAction.type).toBe('WAIT');expect(result.reasoningMetadata?.providerError).toMatch(/abort/i);});
});
