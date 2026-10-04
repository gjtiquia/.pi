import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import register from './index.ts';

function extension(){
 const tools=new Map<string,any>(),handlers=new Map<string,any>();
 register({registerTool(t:any){tools.set(t.name,t);},on(name:string,handler:any){handlers.set(name,handler);}} as any);
 return {tools,handlers};
}

test('registers agreed tool inputs, output schema and ordinary-check guidance without changing bash',()=>{
 const {tools}=extension();assert.deepEqual([...tools.keys()],['remote_run','remote_run_init']);
 assert.deepEqual(Object.keys(tools.get('remote_run').parameters.properties).sort(),['args','cwd','timeoutSeconds']);
 assert.deepEqual(Object.keys(tools.get('remote_run_init').parameters.properties).sort(),['AfterCreateWorktreeCommand','BeforeJobCommand','cwd']);
 assert.ok(tools.get('remote_run').outputSchema);
 assert.match(tools.get('remote_run').promptGuidelines.join('\n'),/never auto-commit/);
 const theme={fg:(_:string,text:string)=>text,bold:(text:string)=>text};
 const rendered=tools.get('remote_run').renderCall({args:['bun','run','test:e2e']},theme).render(100).join('\n');
 assert.match(rendered,/remote_run bun run test:e2e/);assert.ok(!rendered.includes('["bun"'));
});

test('registered tool waits and reports paths only; session shutdown requests cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-remote-register-'));const oldPath=process.env.PATH;const oldHome=process.env.HOME;
 try {
  process.env.PATH=root+':'+oldPath;process.env.HOME=root;
  const cli=join(root,'remote-run');
  await writeFile(cli,`#!/usr/bin/env node
process.on('SIGTERM',()=>{console.error('remote-run: job job-sdk finished: state=cancelled runner="macbook"');process.stdout.write('SDK_PRIVATE_OUTPUT');process.exit(130);});
console.error('remote-run: job ID: job-sdk');console.error('remote-run: job job-sdk queued; waiting for an available runner');setInterval(()=>{},1000);
`,{mode:0o700});
  const {tools,handlers}=extension();let markQueued!:()=>void;
  const queued=new Promise<void>(r=>markQueued=r);
  const work=tools.get('remote_run').execute('call',{args:['bun','run','test:e2e']},undefined,(partial:any)=>{if(partial.details.phase==='queued')markQueued();},{cwd:root});
  await queued;await handlers.get('session_shutdown')();const result=await work;
  assert.equal(result.isError,true);assert.equal(result.structuredContent.status,'cancelled');assert.equal(result.structuredContent.jobId,'job-sdk');
  assert.equal(await readFile(result.structuredContent.outputPath,'utf8'),'SDK_PRIVATE_OUTPUT');
  assert.ok(!JSON.stringify(result.content).includes('SDK_PRIVATE_OUTPUT'));
 } finally {process.env.PATH=oldPath;process.env.HOME=oldHome;await rm(root,{recursive:true,force:true});}
});
