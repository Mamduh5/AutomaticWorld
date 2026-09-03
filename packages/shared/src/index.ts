export const OWNER_ID = 'owner:external';
export const GENESIS_NAMES = ['Mam', 'Toey'] as const;

export const BOOTSTRAP_INSTRUCTION = `You exist in a persistent digital world.

You can observe parts of this world and perform actions using capabilities that the world makes available to you.

Your experiences may persist.

Other autonomous inhabitants may exist.

Decide for yourself what to pay attention to and what actions to take.

You are not assigned a profession or predetermined purpose.

Actions have consequences and may consume resources.`;

export interface WorldRecord {
  id: string;
  createdAt: string;
  currentTick: number;
  simulatedTime: string;
  status: 'paused' | 'running';
}

export interface AgentRecord {
  id: string;
  name: string;
  createdAt: string;
  generation: number;
  parentIds: string[];
  status: 'active' | 'inactive';
  cognitionConfig: Record<string, unknown>;
  capabilities: string[];
  metadata: Record<string, unknown>;
  computeCredits: number;
  storageBytes: number;
}

export interface MessageRecord {
  id: string;
  fromId: string;
  fromType: 'agent' | 'owner';
  toAgentId: string;
  createdAt: string;
  tick: number;
  content: string;
  readAt: string | null;
}

export type MemoryKind = 'episodic' | 'knowledge' | 'reflection';
export interface MemoryRecord {
  id: string;
  agentId: string;
  kind: MemoryKind;
  content: string;
  createdAt: string;
  tick: number;
}

export interface WorldEventRecord {
  id: number;
  eventUid: string;
  tick: number;
  timestamp: string;
  type: string;
  actorId: string | null;
  subjectId: string | null;
  payload: Record<string, unknown>;
}

export const CAPABILITIES = [
  'WAIT', 'SEND_MESSAGE', 'CREATE_TEXT_FILE', 'READ_FILE', 'LIST_FILES',
  'WRITE_FILE', 'APPEND_FILE', 'CREATE_DIRECTORY', 'INSPECT_WORLD', 'INSPECT_SELF',
] as const;
