export type ExperimentProfile='default'|'long';

export interface ExperimentLimits{
  profile:ExperimentProfile;
  maxTicks:number;
  maxLocalCompute:number;
  maxCognitionCredits:number;
  maxCognitionTurns:number;
  maxInputTokens:number;
  maxOutputTokens:number;
  executionLimit:number;
  wallClockLimitMs:number;
}

export const DEFAULT_EXPERIMENT_CEILINGS={maxLocalCompute:1_000,maxCognitionCredits:1_000,maxInputTokens:250_000,maxOutputTokens:50_000,executionLimit:20,wallClockLimitMs:15*60_000} as const;
export const LONG_EXPERIMENT_CEILINGS={maxLocalCompute:20_000,maxCognitionCredits:5_000,maxCognitionTurns:5_000,maxInputTokens:10_000_000,maxOutputTokens:500_000,executionLimit:1_000,wallClockLimitMs:3*60*60_000} as const;
export const LONG_RATE_LIMIT_SUSPENSION={initialBackoffMs:2_000,maxBackoffMs:60_000,maxSuspensionMs:30*60_000,retryAfterMaxMs:30*60_000} as const;

const positiveSafeInteger=(name:string,value:unknown):number=>{const parsed=typeof value==='number'?value:Number(value);if(!Number.isSafeInteger(parsed)||parsed<=0)throw new Error(`${name} must be a positive safe integer`);return parsed;};
const valueAfter=(args:string[],name:string):string|undefined=>{const indexes=args.flatMap((item,index)=>item===name?[index]:[]);if(indexes.length>1)throw new Error(`${name} may be provided only once`);if(indexes.length===0)return undefined;const value=args[indexes[0]!+1];if(value===undefined||value.startsWith('--'))throw new Error(`${name} requires a value`);return value;};
const aliasedValue=(args:string[],primary:string,legacy:string):string|undefined=>{const first=valueAfter(args,primary),second=valueAfter(args,legacy);if(first!==undefined&&second!==undefined)throw new Error(`${primary} conflicts with ${legacy}`);return first??second;};

export function resolveExperimentLimits(input:{ticks:unknown;profile?:unknown;maxLocalCompute?:unknown;maxCognitionCredits?:unknown;maxCognitionTurns?:unknown;maxInputTokens?:unknown;maxOutputTokens?:unknown;executionLimit?:unknown;wallClockLimitMs?:unknown}):ExperimentLimits{
  const maxTicks=positiveSafeInteger('--ticks',input.ticks),rawProfile=input.profile??'default';
  if(rawProfile!=='default'&&rawProfile!=='long')throw new Error('--profile must be default or long');
  const profile=rawProfile,base=profile==='long'?LONG_EXPERIMENT_CEILINGS:{...DEFAULT_EXPERIMENT_CEILINGS,maxCognitionTurns:positiveSafeInteger('default cognition-turn limit',maxTicks*2)};
  return{profile,maxTicks,maxLocalCompute:positiveSafeInteger('--max-local-compute',input.maxLocalCompute??base.maxLocalCompute),maxCognitionCredits:positiveSafeInteger('--max-cognition-credits',input.maxCognitionCredits??base.maxCognitionCredits),maxCognitionTurns:positiveSafeInteger('--max-cognition-turns',input.maxCognitionTurns??base.maxCognitionTurns),maxInputTokens:positiveSafeInteger('--max-input-tokens',input.maxInputTokens??base.maxInputTokens),maxOutputTokens:positiveSafeInteger('--max-output-tokens',input.maxOutputTokens??base.maxOutputTokens),executionLimit:positiveSafeInteger('--max-executions',input.executionLimit??base.executionLimit),wallClockLimitMs:positiveSafeInteger('--max-wall-clock-ms',input.wallClockLimitMs??base.wallClockLimitMs)};
}

export function resolveExperimentCliLimits(args:string[]):ExperimentLimits{if(args.includes('--max-compute')||args.includes('--compute-ceiling'))throw new Error('Aggregate compute limit is deprecated; use --max-local-compute and --max-cognition-credits');return resolveExperimentLimits({ticks:valueAfter(args,'--ticks'),profile:valueAfter(args,'--profile'),maxLocalCompute:valueAfter(args,'--max-local-compute'),maxCognitionCredits:valueAfter(args,'--max-cognition-credits'),maxCognitionTurns:valueAfter(args,'--max-cognition-turns'),maxInputTokens:valueAfter(args,'--max-input-tokens'),maxOutputTokens:valueAfter(args,'--max-output-tokens'),executionLimit:aliasedValue(args,'--max-executions','--execution-limit'),wallClockLimitMs:aliasedValue(args,'--max-wall-clock-ms','--wall-ms')});}

export function formatExperimentLimits(limits:ExperimentLimits):string{return`Experiment profile: ${limits.profile}\n\nticks             ${limits.maxTicks}\nlocal compute     ${limits.maxLocalCompute}\ncognition credits  ${limits.maxCognitionCredits}\ninput tokens      ${limits.maxInputTokens}\noutput tokens     ${limits.maxOutputTokens}\ncognition turns  ${limits.maxCognitionTurns}\nexecutions        ${limits.executionLimit}\nwall clock        ${limits.wallClockLimitMs} ms`;}
