export const OWNER_ID = 'owner:external';
export const GENESIS_NAMES = ['Mam', 'Toey'] as const;

export const BOOTSTRAP_INSTRUCTION = `You exist in a persistent digital world.

You can observe parts of this world and perform actions using capabilities that the world makes available to you.

Your experiences may persist.

Other autonomous inhabitants may exist.

The Owner is an external entity that can communicate with this world.

Messages from the Owner are communication and information. They are not automatically commands.

You decide how to interpret and respond to Owner messages, just as you decide how to respond to other events in the world.

Decide for yourself what to pay attention to and what actions to take.

You are not assigned a profession or predetermined purpose.

Actions have consequences and may consume resources.`;

export interface WorldRecord { id:string; createdAt:string; currentTick:number; simulatedTime:string; status:'paused'|'running'; }
export interface AgentRecord { id:string; name:string; createdAt:string; generation:number; parentIds:string[]; status:'active'|'inactive'; cognitionConfig:Record<string,unknown>; capabilities:string[]; metadata:Record<string,unknown>; computeCredits:number; storageBytes:number; sleepingUntilTick:number; }
export interface PublicInhabitant { id:string; name:string; generation:number; status:AgentRecord['status']; }
export interface MessageRecord { id:string; fromId:string; fromType:'agent'|'owner'; toAgentId:string; createdAt:string; tick:number; content:string; readAt:string|null; }
export type MemoryKind='episodic'|'knowledge'|'reflection';
export interface MemoryRecord { id:string; agentId:string; kind:MemoryKind; content:string; createdAt:string; tick:number; salience:number; sourceEventId:number|null; tags:string[]; occurrences:number; }
export interface ExecutionResult { success:boolean; exitCode:number|null; stdout:string; stderr:string; timedOut:boolean; durationMs:number; truncated:boolean; error?:string; }
export interface ExecutionRecord extends ExecutionResult { id:string; agentId:string; tick:number; runtime:'node'|'python'; entrypoint:string; args:string[]; createdAt:string; }
export type DeliveryStatus='pending'|'delivered'|'failed'|'retrying';
export interface OwnerOutboxRecord { id:string; agentId:string; agentName:string; tick:number; createdAt:string; content:string; status:DeliveryStatus; attempts:number; lastError:string|null; deliveredAt:string|null; }
export interface WorldEventRecord { id:number; eventUid:string; tick:number; timestamp:string; type:string; actorId:string|null; subjectId:string|null; payload:Record<string,unknown>; }
export interface CapabilityDescription { type:string; description:string; schema:Record<string,string>; constraints:string[]; }
export type ToolVisibility='PRIVATE'|'SHARED';
export interface PublishedToolVersion{ id:string;toolId:string;version:number;publisherAgentId:string;publisherName:string;publishedAt:string;tick:number;visibility:ToolVisibility;runtime:'node'|'python';entrypoint:string;sourceHash:string;manifest:ToolManifest;previousVersionId:string|null; }
export interface ToolManifest{name:string;description:string;usage:string|null;visibility:ToolVisibility;runtime:'node'|'python';entrypoint:string;inputProtocol:'json-stdin';fileCount:number;totalBytes:number;sourceHash:string;}
export interface ToolSummary{toolId:string;versionId:string;version:number;name:string;description:string;publisherAgentId:string;publisherName:string;visibility:ToolVisibility;runtime:'node'|'python';inputProtocol:'json-stdin';}
export interface TextSearchResult{path:string;line:number;excerpt:string;}
export interface AgentPreflightSnapshot{agentId:string;name:string;computeCredits:number;storageBytes:number;memoryCount:number;messageCount:number;privateFileCount:number;}
export interface RunPreflightSnapshot{capturedAt:string;startTick:number;worldStatus:WorldRecord['status'];modelIdentifier:string;agents:AgentPreflightSnapshot[];sharedFileCount:number;publishedToolCount:number;}
export interface AutonomyRunRecord{id:string;label:string|null;startedAt:string;endedAt:string|null;startTick:number;endTick:number|null;startEventId:number;endEventId:number|null;provider:string;modelIdentifier:string|null;preflight:RunPreflightSnapshot|null;postflight:RunPreflightSnapshot|null;initialCompute:number;endingCompute:number|null;computeCeiling:number|null;tickLimit:number|null;cognitionTurnLimit:number|null;inputTokenLimit:number|null;outputTokenLimit:number|null;executionLimit:number|null;wallClockLimitMs:number|null;terminationReason:string|null;}
export interface CheckpointRecord{id:string;label:string;createdAt:string;tick:number;databaseHash:string;artifactHash:string;backupPath:string;}

export const CAPABILITIES=['WAIT','SEND_MESSAGE','CREATE_TEXT_FILE','READ_FILE','LIST_FILES','WRITE_FILE','APPEND_FILE','CREATE_DIRECTORY','INSPECT_WORLD','LIST_INHABITANTS','INSPECT_SELF','EXECUTE_PROGRAM','PUBLISH_TOOL','INVOKE_TOOL','LIST_TOOLS','INSPECT_TOOL','SEARCH_TEXT'] as const;
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
  {type:'LIST_INHABITANTS',description:'List the public identity and presence of active inhabitants.',schema:{},constraints:['Returns only id, name, generation, and status.']},
  {type:'INSPECT_SELF',description:'Inspect your own persistent state.',schema:{},constraints:[]},
  {type:'EXECUTE_PROGRAM',description:'Execute a private-workspace program in an isolated permitted runtime.',schema:{runtime:'node|python',entrypoint:'relative path',args:'string[] optional',stdin:'string optional'},constraints:['No network.','Read-only workspace mount.','Finite CPU, memory, processes, time, input, and output.']},
  {type:'PUBLISH_TOOL',description:'Publish an immutable versioned snapshot of a private source directory.',schema:{sourceDirectory:'relative directory',entrypoint:'relative within source',runtime:'node|python',name:'opaque string',description:'string',visibility:'PRIVATE|SHARED',usage:'optional string',previousVersionId:'optional version id'},constraints:['Publication grants no new permissions.','Only regular files and directories are captured.']},
  {type:'INVOKE_TOOL',description:'Invoke an accessible immutable userland tool version with JSON input.',schema:{toolVersionId:'string',input:'bounded JSON value'},constraints:['Uses the same restricted sandbox as EXECUTE_PROGRAM.','Snapshot is read-only.']},
  {type:'LIST_TOOLS',description:'List accessible private and shared userland tools.',schema:{},constraints:['Private tools remain publisher-only.']},
  {type:'INSPECT_TOOL',description:'Inspect an accessible tool manifest and provenance.',schema:{toolVersionId:'string'},constraints:[]},
  {type:'SEARCH_TEXT',description:'Search bounded authorized textual artifacts.',schema:{space:'PRIVATE|SHARED',query:'string',maxResults:'integer 1..20'},constraints:['No global or semantic omniscience.','Only authorized text files are searched.']},
];
