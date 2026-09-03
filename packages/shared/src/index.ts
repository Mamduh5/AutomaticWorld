export const OWNER_ID = 'owner:external';
export const GENESIS_NAMES = ['Mam', 'Toey'] as const;

export const BOOTSTRAP_INSTRUCTION = `You exist in a persistent digital world.

You can observe parts of this world and perform actions using capabilities that the world makes available to you.

Your experiences may persist.

Other autonomous inhabitants may exist.

Decide for yourself what to pay attention to and what actions to take.

You are not assigned a profession or predetermined purpose.

Actions have consequences and may consume resources.`;

export interface WorldRecord { id:string; createdAt:string; currentTick:number; simulatedTime:string; status:'paused'|'running'; }
export interface AgentRecord { id:string; name:string; createdAt:string; generation:number; parentIds:string[]; status:'active'|'inactive'; cognitionConfig:Record<string,unknown>; capabilities:string[]; metadata:Record<string,unknown>; computeCredits:number; storageBytes:number; sleepingUntilTick:number; }
export interface MessageRecord { id:string; fromId:string; fromType:'agent'|'owner'; toAgentId:string; createdAt:string; tick:number; content:string; readAt:string|null; }
export type MemoryKind='episodic'|'knowledge'|'reflection';
export interface MemoryRecord { id:string; agentId:string; kind:MemoryKind; content:string; createdAt:string; tick:number; salience:number; sourceEventId:number|null; tags:string[]; occurrences:number; }
export interface ExecutionResult { success:boolean; exitCode:number|null; stdout:string; stderr:string; timedOut:boolean; durationMs:number; truncated:boolean; error?:string; }
export interface ExecutionRecord extends ExecutionResult { id:string; agentId:string; tick:number; runtime:'node'|'python'; entrypoint:string; args:string[]; createdAt:string; }
export type DeliveryStatus='pending'|'delivered'|'failed'|'retrying';
export interface OwnerOutboxRecord { id:string; agentId:string; agentName:string; tick:number; createdAt:string; content:string; status:DeliveryStatus; attempts:number; lastError:string|null; deliveredAt:string|null; }
export interface WorldEventRecord { id:number; eventUid:string; tick:number; timestamp:string; type:string; actorId:string|null; subjectId:string|null; payload:Record<string,unknown>; }
export interface CapabilityDescription { type:string; description:string; schema:Record<string,string>; constraints:string[]; }

export const CAPABILITIES=['WAIT','SEND_MESSAGE','CREATE_TEXT_FILE','READ_FILE','LIST_FILES','WRITE_FILE','APPEND_FILE','CREATE_DIRECTORY','INSPECT_WORLD','INSPECT_SELF','EXECUTE_PROGRAM'] as const;
export const CAPABILITY_DESCRIPTIONS:CapabilityDescription[]=[
  {type:'WAIT',description:'Take no world action and optionally sleep for future ticks.',schema:{ticks:'integer 1..100, optional'},constraints:['A direct message wakes the recipient.']},
  {type:'SEND_MESSAGE',description:'Persist a message to an inhabitant name/id or owner:external.',schema:{to:'string',content:'string'},constraints:['Maximum message size applies.','Owner delivery is quota-controlled.']},
  {type:'CREATE_TEXT_FILE',description:'Create a new text artifact.',schema:{space:'PRIVATE|SHARED',path:'relative path',content:'string'},constraints:['No overwrite.','No links or traversal.']},
  {type:'READ_FILE',description:'Read a permitted artifact and its content hash.',schema:{space:'PRIVATE|SHARED',path:'relative path'},constraints:['Private means your workspace only.']},
  {type:'LIST_FILES',description:'List permitted artifacts.',schema:{space:'PRIVATE|SHARED',path:'relative path, optional'},constraints:['No links or traversal.']},
  {type:'WRITE_FILE',description:'Atomically replace or create an artifact.',schema:{space:'PRIVATE|SHARED',path:'relative path',content:'string',expectedHash:'hash, required to replace shared file'},constraints:['Staged atomic replacement.','Storage quota applies.']},
  {type:'APPEND_FILE',description:'Atomically append to an artifact.',schema:{space:'PRIVATE|SHARED',path:'relative path',content:'string',expectedHash:'hash, required for existing shared file'},constraints:['Staged atomic replacement.']},
  {type:'CREATE_DIRECTORY',description:'Create a directory.',schema:{space:'PRIVATE|SHARED',path:'relative path'},constraints:['No links or traversal.']},
  {type:'INSPECT_WORLD',description:'Inspect visible world status and population count.',schema:{},constraints:['Does not expose the database.']},
  {type:'INSPECT_SELF',description:'Inspect your own persistent state.',schema:{},constraints:[]},
  {type:'EXECUTE_PROGRAM',description:'Execute a private-workspace program in an isolated permitted runtime.',schema:{runtime:'node|python',entrypoint:'relative path',args:'string[] optional',stdin:'string optional'},constraints:['No network.','Read-only workspace mount.','Finite CPU, memory, processes, time, input, and output.']},
];
