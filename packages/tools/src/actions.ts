import { z } from 'zod';
const relativePath=z.string().min(1).max(240), content=z.string().max(64*1024);
const spaceFields={space:z.enum(['PRIVATE','SHARED']).optional(),area:z.enum(['private','shared']).optional()};
export const AgentActionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('WAIT'),ticks:z.number().int().min(1).max(100).default(1)}),
  z.object({type:z.literal('SEND_MESSAGE'),to:z.string().min(1).max(100),content:z.string().min(1).max(8_000)}),
  z.object({type:z.literal('CREATE_TEXT_FILE'),path:relativePath,content,...spaceFields}),
  z.object({type:z.literal('READ_FILE'),path:relativePath,...spaceFields}),
  z.object({type:z.literal('LIST_FILES'),path:z.string().max(240).default('.'),...spaceFields}),
  z.object({type:z.literal('WRITE_FILE'),path:relativePath,content,expectedHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),...spaceFields}),
  z.object({type:z.literal('APPEND_FILE'),path:relativePath,content,expectedHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),...spaceFields}),
  z.object({type:z.literal('CREATE_DIRECTORY'),path:relativePath,...spaceFields}),
  z.object({type:z.literal('EXECUTE_PROGRAM'),runtime:z.enum(['node','python']),entrypoint:relativePath,args:z.array(z.string().max(1_000)).max(32).default([]),stdin:z.string().max(16*1024).default('')}),
  z.object({type:z.literal('INSPECT_WORLD')}),z.object({type:z.literal('INSPECT_SELF')}),
]);
export type AgentAction=z.infer<typeof AgentActionSchema>;
export type FileSpace='private'|'shared';
export function actionSpace(action:{space?:'PRIVATE'|'SHARED'|undefined;area?:FileSpace|undefined}):FileSpace{return action.space?action.space.toLowerCase() as FileSpace:action.area??'private';}
export interface ActionResult{success:boolean;actionId:string;agentId:string;tick:number;effects:Record<string,unknown>[];error?:string;}
