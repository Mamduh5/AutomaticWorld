export { EconomyService,RESOURCE_TYPES,formatCapital } from './economy.js';
export type { ResourceType,Balance,ValueKind } from './economy.js';
export interface ResourceRules {
  initialLocalCompute:number;
  storageLimitBytes:number;
  cognitionCreditCostPerLogicalTurn:1;
  executionBaseCost:number;
  executionMaxCost:number;
}
