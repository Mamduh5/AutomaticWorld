import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll,describe,expect,it } from 'vitest';
import { DockerExecutionSandbox } from '../packages/sandbox/src/docker.js';

const available=await DockerExecutionSandbox.available(),dirs:string[]=[];
afterAll(async()=>{for(const dir of dirs)await rm(dir,{recursive:true,force:true});});
describe.skipIf(!available)('Docker execution integration',()=>{
  it('executes real Node and Python programs with actual output',async()=>{const workspace=await mkdtemp(path.join(tmpdir(),'ai-world-docker-'));dirs.push(workspace);await writeFile(path.join(workspace,'math.js'),'console.log(21 * 2);');await writeFile(path.join(workspace,'math.py'),'print(7 * 6)');const sandbox=new DockerExecutionSandbox();const node=await sandbox.execute({runtime:'node',workspacePath:workspace,entrypoint:'math.js',args:[],stdin:''}),python=await sandbox.execute({runtime:'python',workspacePath:workspace,entrypoint:'math.py',args:[],stdin:''});expect(node).toMatchObject({success:true,exitCode:0,stdout:'42\n'});expect(python).toMatchObject({success:true,exitCode:0,stdout:'42\n'});});
  it('enforces wall timeout',async()=>{const workspace=await mkdtemp(path.join(tmpdir(),'ai-world-docker-timeout-'));dirs.push(workspace);await writeFile(path.join(workspace,'forever.js'),'setInterval(() => {}, 1000);');const sandbox=new DockerExecutionSandbox({timeoutMs:500,outputBytes:1024,memory:'64m',cpus:'0.25',pids:16,stdinBytes:1024});const result=await sandbox.execute({runtime:'node',workspacePath:workspace,entrypoint:'forever.js',args:[],stdin:''});expect(result.timedOut).toBe(true);expect(result.success).toBe(false);});
});
