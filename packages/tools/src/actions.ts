import { z } from 'zod';

const relativePath = z.string().min(1).max(240);
const content = z.string().max(64 * 1024);

export const AgentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WAIT') }),
  z.object({ type: z.literal('SEND_MESSAGE'), to: z.string().min(1).max(100), content: z.string().min(1).max(8_000) }),
  z.object({ type: z.literal('CREATE_TEXT_FILE'), path: relativePath, content }),
  z.object({ type: z.literal('READ_FILE'), path: relativePath, area: z.enum(['private', 'shared']).default('private') }),
  z.object({ type: z.literal('LIST_FILES'), path: z.string().max(240).default('.'), area: z.enum(['private', 'shared']).default('private') }),
  z.object({ type: z.literal('WRITE_FILE'), path: relativePath, content, area: z.enum(['private', 'shared']).default('private') }),
  z.object({ type: z.literal('APPEND_FILE'), path: relativePath, content, area: z.enum(['private', 'shared']).default('private') }),
  z.object({ type: z.literal('CREATE_DIRECTORY'), path: relativePath, area: z.enum(['private', 'shared']).default('private') }),
  z.object({ type: z.literal('INSPECT_WORLD') }),
  z.object({ type: z.literal('INSPECT_SELF') }),
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

export interface ActionResult {
  success: boolean;
  actionId: string;
  agentId: string;
  tick: number;
  effects: Record<string, unknown>[];
  error?: string;
}
