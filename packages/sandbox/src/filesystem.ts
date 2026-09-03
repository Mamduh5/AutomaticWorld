import { promises as fs } from 'node:fs';
import path from 'node:path';

export class SandboxViolation extends Error {}

export class AgentFilesystem {
  constructor(readonly worldDataRoot: string, readonly maxFileBytes = 64 * 1024) {}

  private root(agentId: string, area: 'private' | 'shared'): string {
    return area === 'shared' ? path.resolve(this.worldDataRoot, 'shared') : path.resolve(this.worldDataRoot, 'agents', agentId, 'workspace');
  }
  resolve(agentId: string, requested: string, area: 'private' | 'shared' = 'private'): string {
    if (path.isAbsolute(requested) || requested.includes('\0')) throw new SandboxViolation('Absolute or malformed paths are forbidden');
    const base = this.root(agentId, area);
    const target = path.resolve(base, requested);
    if (target !== base && !target.startsWith(base + path.sep)) throw new SandboxViolation('Path escapes permitted workspace');
    return target;
  }
  async initializeAgent(agentId: string): Promise<void> { await fs.mkdir(this.root(agentId, 'private'), { recursive: true }); }
  async initializeShared(): Promise<void> { await fs.mkdir(this.root('', 'shared'), { recursive: true }); }
  private assertContent(content: string): void { if (Buffer.byteLength(content) > this.maxFileBytes) throw new SandboxViolation(`File exceeds ${this.maxFileBytes} byte limit`); }
  async create(agentId: string, requested: string, content: string, area: 'private'|'shared'='private'): Promise<number> { this.assertContent(content); const target=this.resolve(agentId,requested,area); await fs.mkdir(path.dirname(target),{recursive:true}); const handle=await fs.open(target,'wx'); try { await handle.writeFile(content,'utf8'); } finally { await handle.close(); } return Buffer.byteLength(content); }
  async write(agentId: string, requested: string, content: string, area: 'private'|'shared'='private'): Promise<{before:number;after:number}> { this.assertContent(content); const target=this.resolve(agentId,requested,area); let before=0; try { before=(await fs.stat(target)).size; } catch { before=0; } await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,content,'utf8'); return {before,after:Buffer.byteLength(content)}; }
  async append(agentId: string, requested: string, content: string, area: 'private'|'shared'='private'): Promise<{before:number;after:number}> { const target=this.resolve(agentId,requested,area); let before=0; try { before=(await fs.stat(target)).size; } catch { before=0; } if(before+Buffer.byteLength(content)>this.maxFileBytes) throw new SandboxViolation(`File exceeds ${this.maxFileBytes} byte limit`); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.appendFile(target,content,'utf8'); return {before,after:before+Buffer.byteLength(content)}; }
  async read(agentId:string,requested:string,area:'private'|'shared'='private'):Promise<string>{ return fs.readFile(this.resolve(agentId,requested,area),'utf8'); }
  async mkdir(agentId:string,requested:string,area:'private'|'shared'='private'):Promise<void>{ await fs.mkdir(this.resolve(agentId,requested,area),{recursive:true}); }
  async list(agentId:string,requested='.',area:'private'|'shared'='private'):Promise<string[]>{ const base=this.root(agentId,area), target=this.resolve(agentId,requested,area); const entries=await fs.readdir(target,{withFileTypes:true}); return entries.map((e)=>path.relative(base,path.join(target,e.name)).replaceAll('\\','/')+(e.isDirectory()?'/':'')); }
}

export interface ExecutionSandbox { execute(request: { artifactPath: string; args: string[] }): Promise<{ exitCode: number; stdout: string; stderr: string }>; }
export class DisabledExecutionSandbox implements ExecutionSandbox { async execute(): Promise<never> { throw new SandboxViolation('Code execution is not enabled'); } }
