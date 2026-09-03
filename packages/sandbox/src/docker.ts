import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ExecutionResult } from '../../shared/src/index.js';
import type { ExecutionRequest, ExecutionSandbox } from './filesystem.js';

export interface DockerLimits{timeoutMs:number;outputBytes:number;memory:string;cpus:string;pids:number;stdinBytes:number;}
export const DEFAULT_DOCKER_LIMITS:DockerLimits={timeoutMs:5_000,outputBytes:64*1024,memory:'128m',cpus:'0.5',pids:64,stdinBytes:16*1024};
export const RUNTIME_POLICIES={
  node:{tag:'node:22.14.0-alpine3.21',digest:'sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944',reference:'node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944'},
  python:{tag:'python:3.13.2-alpine3.21',digest:'sha256:323a717dc4a010fee21e3f1aac738ee10bb485de4e7593ce242b36ee48d6b352',reference:'python:3.13.2-alpine3.21@sha256:323a717dc4a010fee21e3f1aac738ee10bb485de4e7593ce242b36ee48d6b352'},
} as const;
export const RUNTIME_IMAGES={node:RUNTIME_POLICIES.node.reference,python:RUNTIME_POLICIES.python.reference} as const;

export interface DockerInvocation{file:'docker';args:string[];containerName:string;}
export interface DockerCommandResult{exitCode:number|null;stdout:string;stderr:string;timedOut:boolean;error?:string;}
export function executeDockerCommand(args:string[],timeoutMs=5_000):Promise<DockerCommandResult>{return new Promise((resolve)=>{const child=spawn('docker',args,{shell:false,windowsHide:true,env:{PATH:process.env.PATH??''},stdio:['ignore','pipe','pipe']});let stdout='',stderr='',settled=false,timedOut=false;const finish=(exitCode:number|null,error?:string)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({exitCode,stdout,stderr,timedOut,...(error?{error}:{})});};child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString('utf8');});child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString('utf8');});child.on('error',(error)=>finish(null,error.message));child.on('close',(code)=>finish(code));const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);});}
export function buildDockerInvocation(request:ExecutionRequest,limits:DockerLimits=DEFAULT_DOCKER_LIMITS,id:string=randomUUID()):DockerInvocation{
  if(!path.isAbsolute(request.workspacePath))throw new Error('Workspace mount must be an absolute kernel-controlled path');
  const portable=request.entrypoint.replaceAll('\\','/');
  if(portable.startsWith('/')||portable.split('/').includes('..'))throw new Error('Invalid container entrypoint');
  const containerName=`automaticworld-exec-${id}`;
  const program=request.runtime==='node'?'node':'python3';
  return{file:'docker',containerName,args:['run','--rm','-i','--name',containerName,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit',String(limits.pids),'--memory',limits.memory,'--cpus',limits.cpus,'--user','65532:65532','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--mount',`type=bind,source=${request.workspacePath},target=/workspace,readonly`,'--workdir','/workspace',RUNTIME_IMAGES[request.runtime],program,`/workspace/${portable}`,...request.args]};
}

function runDocker(args:string[],stdin:string,limits:DockerLimits):Promise<ExecutionResult>{return new Promise((resolve)=>{
  const started=Date.now(),child=spawn('docker',args,{shell:false,windowsHide:true,env:{PATH:process.env.PATH??''},stdio:['pipe','pipe','pipe']});let stdout:Buffer<ArrayBufferLike>=Buffer.alloc(0),stderr:Buffer<ArrayBufferLike>=Buffer.alloc(0),timedOut=false,truncated=false,settled=false;
  const finish=(exitCode:number|null,error?:string)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({success:!error&&!timedOut&&exitCode===0,exitCode,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),timedOut,durationMs:Date.now()-started,truncated,...(error?{error}:{})});};
  const collect=(current:Buffer<ArrayBufferLike>,other:Buffer<ArrayBufferLike>,chunk:Buffer<ArrayBufferLike>):Buffer<ArrayBufferLike>=>{const available=limits.outputBytes-current.length-other.length;if(available<=0){truncated=true;child.kill();return current;}if(chunk.length>available){truncated=true;child.kill();return Buffer.concat([current,chunk.subarray(0,available)]);}return Buffer.concat([current,chunk]);};
  child.stdout.on('data',(chunk:Buffer)=>{stdout=collect(stdout,stderr,chunk);});child.stderr.on('data',(chunk:Buffer)=>{stderr=collect(stderr,stdout,chunk);});
  child.on('error',(error)=>finish(null,`Docker unavailable: ${error.message}`));child.on('close',(code)=>finish(code,truncated?'Sandbox output limit exceeded':undefined));
  const timer=setTimeout(()=>{timedOut=true;child.kill();},limits.timeoutMs);
  child.stdin.end(Buffer.from(stdin).subarray(0,limits.stdinBytes));
});}

export class DockerExecutionSandbox implements ExecutionSandbox{
  constructor(readonly limits:DockerLimits=DEFAULT_DOCKER_LIMITS,private readonly verifyImage:(runtime:'node'|'python')=>Promise<{verified:boolean;resolved:string|null;error?:string}>=DockerExecutionSandbox.verifyRuntimeImage){}
  static async verifyRuntimeImage(runtime:'node'|'python'):Promise<{verified:boolean;resolved:string|null;error?:string}>{const policy=RUNTIME_POLICIES[runtime],result=await executeDockerCommand(['image','inspect','--format','{{join .RepoDigests "\\n"}}',policy.reference],15_000);if(result.exitCode!==0)return{verified:false,resolved:null,error:result.error??(result.stderr.trim()||'Runtime image is not locally available')};const resolved=result.stdout.trim();return{verified:resolved.includes(policy.digest),resolved,...(!resolved.includes(policy.digest)?{error:'Resolved image digest does not match kernel policy'}:{})};}
  async execute(request:ExecutionRequest):Promise<ExecutionResult>{const identity=await this.verifyImage(request.runtime);if(!identity.verified)return{success:false,exitCode:null,stdout:'',stderr:'',timedOut:false,durationMs:0,truncated:false,error:`Runtime image identity not verified: ${identity.error??'unknown identity'}`};const invocation=buildDockerInvocation(request,this.limits);const result=await runDocker(invocation.args,request.stdin,this.limits);if(result.timedOut||result.truncated){spawn('docker',['rm','-f',invocation.containerName],{shell:false,windowsHide:true,env:{PATH:process.env.PATH??''},stdio:'ignore'}).unref();}return result;}
  static async available():Promise<boolean>{return new Promise((resolve)=>{const child=spawn('docker',['version','--format','{{.Server.Version}}'],{shell:false,windowsHide:true,stdio:'ignore'});const timer=setTimeout(()=>{child.kill();resolve(false);},2_000);child.on('error',()=>{clearTimeout(timer);resolve(false);});child.on('close',(code)=>{clearTimeout(timer);resolve(code===0);});});}
}

export class FakeExecutionSandbox implements ExecutionSandbox{
  constructor(private readonly handler:(request:ExecutionRequest)=>ExecutionResult|Promise<ExecutionResult>){}
  execute(request:ExecutionRequest):Promise<ExecutionResult>{return Promise.resolve(this.handler(request));}
}
