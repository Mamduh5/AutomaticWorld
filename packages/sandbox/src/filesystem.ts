import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ExecutionResult } from '../../shared/src/index.js';

export class SandboxViolation extends Error {}
export class ConcurrentWriteError extends Error {}
export type WriteFailpoint='after-stage'|'before-rename';
export interface FilesystemHooks{onWriteStage?(point:WriteFailpoint):Promise<void>|void;}
export interface FileMutation{before:number;after:number;hash:string;}
export interface TreeSnapshotFile{relativePath:string;content:Buffer;bytes:number;}
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

export class AgentFilesystem{
  constructor(readonly worldDataRoot:string,readonly maxFileBytes=64*1024,private readonly hooks:FilesystemHooks={}){}
  root(agentId:string,space:'private'|'shared'):string{return space==='shared'?path.resolve(this.worldDataRoot,'shared'):path.resolve(this.worldDataRoot,'agents',agentId,'workspace');}
  private split(requested:string):string[]{
    if(!requested||requested.includes('\0'))throw new SandboxViolation('Malformed path');
    const portable=requested.replaceAll('\\','/');
    if(portable.startsWith('/')||portable.startsWith('//')||/^[a-zA-Z]:/.test(portable))throw new SandboxViolation('Absolute paths are forbidden');
    const segments=portable.split('/').filter((part)=>part!==''&&part!=='.');
    if(segments.some((part)=>part==='..'||part.includes(':')))throw new SandboxViolation('Path traversal is forbidden');
    if(segments.some((part)=>part.startsWith('.aw-stage-')||part.includes('.aw-backup-')))throw new SandboxViolation('Kernel-reserved staging path is forbidden');
    return segments;
  }
  private async assertNoRedirection(base:string,segments:string[],allowMissing:boolean):Promise<string>{
    await fs.mkdir(base,{recursive:true});const baseStat=await fs.lstat(base);if(baseStat.isSymbolicLink())throw new SandboxViolation('Capability root cannot be a symbolic link, junction, or reparse point');
    const canonicalBase=await fs.realpath(base), target=path.resolve(base,...segments);
    if(target!==base&&!target.startsWith(base+path.sep))throw new SandboxViolation('Path escapes permitted workspace');
    let current=base;
    for(let i=0;i<segments.length;i++){
      current=path.join(current,segments[i]!);
      try{
        const stat=await fs.lstat(current);
        if(stat.isSymbolicLink())throw new SandboxViolation('Symbolic links, junctions, and reparse traversal are forbidden');
        const real=await fs.realpath(current);
        if(real!==canonicalBase&&!real.startsWith(canonicalBase+path.sep))throw new SandboxViolation('Canonical path escapes permitted workspace');
      }catch(error){
        if(error instanceof SandboxViolation)throw error;
        const code=(error as NodeJS.ErrnoException).code;
        if(code==='ENOENT'&&allowMissing)break;
        throw error;
      }
    }
    return target;
  }
  async resolve(agentId:string,requested:string,space:'private'|'shared'='private',allowMissing=false):Promise<string>{return this.assertNoRedirection(this.root(agentId,space),this.split(requested),allowMissing);}
  async initializeAgent(agentId:string):Promise<void>{await fs.mkdir(this.root(agentId,'private'),{recursive:true});}
  async initializeShared():Promise<void>{await fs.mkdir(this.root('','shared'),{recursive:true});}
  private assertContent(content:string):void{if(Buffer.byteLength(content)>this.maxFileBytes)throw new SandboxViolation(`File exceeds ${this.maxFileBytes} byte limit`);}
  private async current(target:string):Promise<{content:string;bytes:number;hash:string}|null>{try{const stat=await fs.lstat(target);if(stat.isSymbolicLink()||!stat.isFile())throw new SandboxViolation('Target must be a regular file');const content=await fs.readFile(target,'utf8');return{content,bytes:stat.size,hash:sha256(content)};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  async inspectFile(agentId:string,requested:string,space:'private'|'shared'='private'):Promise<{content:string;bytes:number;hash:string}|null>{const target=await this.resolve(agentId,requested,space,true);return this.current(target);}
  private async replaceStaged(target:string,content:string,exclusive:boolean):Promise<FileMutation>{
    this.assertContent(content);await fs.mkdir(path.dirname(target),{recursive:true});const prior=await this.current(target);if(exclusive&&prior)throw new Error('File already exists');
    const staged=path.join(path.dirname(target),`.aw-stage-${randomUUID()}`),buffer=Buffer.from(content);
    let handle:Awaited<ReturnType<typeof fs.open>>|undefined;
    try{handle=await fs.open(staged,'wx',0o600);await handle.writeFile(buffer);await handle.sync();await handle.close();handle=undefined;await this.hooks.onWriteStage?.('after-stage');await this.hooks.onWriteStage?.('before-rename');
      try{await fs.rename(staged,target);}catch(error){const code=(error as NodeJS.ErrnoException).code;if(!prior||!['EEXIST','EPERM'].includes(code??''))throw error;const backup=`${target}.aw-backup-${randomUUID()}`;await fs.rename(target,backup);try{await fs.rename(staged,target);await fs.rm(backup,{force:true});}catch(renameError){await fs.rename(backup,target);throw renameError;}}
      return{before:prior?.bytes??0,after:buffer.byteLength,hash:sha256(buffer)};
    }finally{if(handle)await handle.close().catch(()=>undefined);await fs.rm(staged,{force:true}).catch(()=>undefined);}
  }
  async create(agentId:string,requested:string,content:string,space:'private'|'shared'='private'):Promise<FileMutation>{const target=await this.resolve(agentId,requested,space,true);return this.replaceStaged(target,content,true);}
  async write(agentId:string,requested:string,content:string,space:'private'|'shared'='private',expectedHash?:string):Promise<FileMutation>{const target=await this.resolve(agentId,requested,space,true),prior=await this.current(target);if(space==='shared'&&prior&&expectedHash!==prior.hash)throw new ConcurrentWriteError('Shared file changed; expectedHash is required and must match');return this.replaceStaged(target,content,false);}
  async append(agentId:string,requested:string,content:string,space:'private'|'shared'='private',expectedHash?:string):Promise<FileMutation>{const target=await this.resolve(agentId,requested,space,true),prior=await this.current(target);if(space==='shared'&&prior&&expectedHash!==prior.hash)throw new ConcurrentWriteError('Shared file changed; expectedHash is required and must match');return this.replaceStaged(target,(prior?.content??'')+content,false);}
  async read(agentId:string,requested:string,space:'private'|'shared'='private'):Promise<{content:string;hash:string;bytes:number}>{const target=await this.resolve(agentId,requested,space);const value=await this.current(target);if(!value)throw new Error('File not found');return value;}
  async mkdir(agentId:string,requested:string,space:'private'|'shared'='private'):Promise<void>{const target=await this.resolve(agentId,requested,space,true);await fs.mkdir(target,{recursive:true});await this.resolve(agentId,requested,space);}
  async list(agentId:string,requested='.',space:'private'|'shared'='private'):Promise<string[]>{const base=this.root(agentId,space),target=await this.resolve(agentId,requested,space);const entries=await fs.readdir(target,{withFileTypes:true});const output:string[]=[];for(const entry of entries){if(entry.name.startsWith('.aw-stage-')||entry.name.includes('.aw-backup-'))continue;if(entry.isSymbolicLink())throw new SandboxViolation('Symbolic links, junctions, and reparse traversal are forbidden');const full=path.join(target,entry.name);await this.assertNoRedirection(base,path.relative(base,full).split(path.sep),false);output.push(path.relative(base,full).replaceAll('\\','/')+(entry.isDirectory()?'/':''));}return output;}
  async assertExecutable(agentId:string,entrypoint:string):Promise<string>{const target=await this.resolve(agentId,entrypoint,'private');const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw new SandboxViolation('Entrypoint must be a regular private-workspace file');await fs.access(target,fsConstants.R_OK);return target;}
  async snapshotTree(agentId:string,sourceDirectory:string,limits={maxFiles:100,maxBytes:512*1024}):Promise<TreeSnapshotFile[]>{const root=await this.resolve(agentId,sourceDirectory,'private'),rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new SandboxViolation('Tool source must be a regular directory');const files:TreeSnapshotFile[]=[];let total=0;const walk=async(directory:string):Promise<void>=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const full=path.join(directory,entry.name),relative=path.relative(root,full).replaceAll('\\','/');await this.resolve(agentId,path.posix.join(sourceDirectory.replaceAll('\\','/'),relative),'private');const stat=await fs.lstat(full);if(stat.isSymbolicLink())throw new SandboxViolation('Tool snapshots cannot contain links or reparse points');if(stat.isDirectory())await walk(full);else if(stat.isFile()){const content=await fs.readFile(full);total+=content.length;if(files.length+1>limits.maxFiles||total>limits.maxBytes)throw new SandboxViolation('Tool snapshot exceeds file-count or total-size limit');files.push({relativePath:relative,content,bytes:content.length});}else throw new SandboxViolation('Tool snapshots accept only regular files and directories');}};await walk(root);return files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));}
  async searchText(agentId:string,query:string,space:'private'|'shared',maxResults:number):Promise<{path:string;line:number;excerpt:string}[]>{const root=this.root(agentId,space),results:{path:string;line:number;excerpt:string}[]=[];let scanned=0;const needle=query.toLocaleLowerCase();const walk=async(directory:string):Promise<void>=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(results.length>=maxResults||scanned>=200)return;if(entry.name.startsWith('.aw-stage-')||entry.name.includes('.aw-backup-'))continue;const full=path.join(directory,entry.name),relative=path.relative(root,full).replaceAll('\\','/');await this.resolve(agentId,relative,space);const stat=await fs.lstat(full);if(stat.isSymbolicLink())throw new SandboxViolation('Text search refuses links and reparse points');if(stat.isDirectory())await walk(full);else if(stat.isFile()&&stat.size<=this.maxFileBytes){scanned++;const content=await fs.readFile(full);if(content.includes(0))continue;const lines=content.toString('utf8').split(/\r?\n/);for(let index=0;index<lines.length&&results.length<maxResults;index++){const line=lines[index]!;if(line.toLocaleLowerCase().includes(needle))results.push({path:relative,line:index+1,excerpt:line.slice(0,500)});}}else if(!stat.isFile())throw new SandboxViolation('Text search accepts only regular files and directories');}};await walk(root);return results;}
  async countFiles(agentId:string,space:'private'|'shared'):Promise<number>{const root=this.root(agentId,space);let count=0;const walk=async(directory:string):Promise<void>=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(entry.name.startsWith('.aw-stage-')||entry.name.includes('.aw-backup-'))continue;const target=path.join(directory,entry.name),relative=path.relative(root,target).replaceAll('\\','/');await this.resolve(agentId,relative,space);const stat=await fs.lstat(target);if(stat.isSymbolicLink())throw new SandboxViolation('File counting refuses links and reparse points');if(stat.isDirectory())await walk(target);else if(stat.isFile())count++;else throw new SandboxViolation('File counting accepts only regular files and directories');}};try{await walk(root);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return count;}
  async cleanupKernelStaging(agentIds:string[]):Promise<number>{const roots=[this.root('','shared'),...agentIds.map((id)=>this.root(id,'private'))];let removed=0;const walk=async(root:string):Promise<void>=>{for(const entry of await fs.readdir(root,{withFileTypes:true})){const target=path.join(root,entry.name);if(entry.isSymbolicLink())continue;if(entry.name.startsWith('.aw-stage-')||entry.name.includes('.aw-backup-')){await fs.rm(target,{recursive:true,force:true});removed++;}else if(entry.isDirectory())await walk(target);}};for(const root of roots){try{await walk(root);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}return removed;}
}

export interface ExecutionRequest{runtime:'node'|'python';workspacePath:string;entrypoint:string;args:string[];stdin:string;}
export interface ExecutionSandbox{execute(request:ExecutionRequest):Promise<ExecutionResult>;}
export class DisabledExecutionSandbox implements ExecutionSandbox{async execute():Promise<ExecutionResult>{return{success:false,exitCode:null,stdout:'',stderr:'',timedOut:false,durationMs:0,truncated:false,error:'Docker execution is not enabled'};}}
