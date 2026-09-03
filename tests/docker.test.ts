import path from 'node:path';
import { describe,expect,it } from 'vitest';
import { buildDockerInvocation,DEFAULT_DOCKER_LIMITS,RUNTIME_IMAGES } from '../packages/sandbox/src/docker.js';

describe('Docker isolation command construction',()=>{
  it('uses fixed images and aggressive isolation without shell interpolation',()=>{const request={runtime:'node' as const,workspacePath:path.resolve('safe-workspace'),entrypoint:'experiment/a.js',args:['a; rm -rf /'],stdin:''},invocation=buildDockerInvocation(request,DEFAULT_DOCKER_LIMITS,'fixed');expect(invocation.file).toBe('docker');expect(invocation.args).toContain(RUNTIME_IMAGES.node);expect(invocation.args).toEqual(expect.arrayContaining(['--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','64','--memory','128m','--cpus','0.5','--user','65532:65532']));expect(invocation.args.find((value)=>value.startsWith('type=bind'))).toContain('target=/workspace,readonly');expect(invocation.args).not.toContain('--privileged');expect(invocation.args.join(' ')).not.toContain('docker.sock');expect(invocation.args.at(-1)).toBe('a; rm -rf /');});
  it('rejects an untrusted container entrypoint',()=>{expect(()=>buildDockerInvocation({runtime:'python',workspacePath:path.resolve('x'),entrypoint:'../world.sqlite',args:[],stdin:''})).toThrow(/entrypoint/);});
});
