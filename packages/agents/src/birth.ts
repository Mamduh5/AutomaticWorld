import type { AgentRecord } from '../../shared/src/index.js';
export interface AgentBirthDraft { parentIds:string[]; generation:number; inheritedTendencies:Record<string,unknown>; partialCulturalKnowledge:string[]; mutations:Record<string,unknown>; resourceCost:{computeCredits:number;storageBytes:number}; }
export interface AgentBirthService { createDraft(parents:AgentRecord[]):Promise<AgentBirthDraft>; }
