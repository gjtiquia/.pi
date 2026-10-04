import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRemote } from './run.ts';
import { commandLine } from './display.ts';

async function withCli(script:string, fn:(root:string,cli:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'pi-remote-test-'));
 try {const cli=join(root,'remote-run');await writeFile(cli,'#!/usr/bin/env node\n'+script,{mode:0o700});await fn(root,cli);}
 finally {await rm(root,{recursive:true,force:true});}
}

test('abort signals the CLI, waits for cancellation/output and distinguishes unconfirmed cancellation',async()=>{
 for(const confirmed of [true,false])await withCli(`
 process.on('SIGTERM',()=>{console.error('remote-run: cancellation requested');
 ${confirmed?`console.error('remote-run: job job-cancel finished: state=cancelled runner="macbook"');`:''}
 process.stdout.write('FINAL_AFTER_CANCEL');setTimeout(()=>process.exit(130),25);});
 console.error('remote-run: job ID: job-cancel');
 console.error('remote-run: job job-cancel queued; waiting for an available runner');
 setInterval(()=>{},1000);
 `,async(root,cli)=>{
  const controller=new AbortController();
  const result=await runRemote({args:['bun','run','test:e2e']},{cwd:root,executable:cli,outputRoot:join(root,'output'),signal:controller.signal,onUpdate:d=>{if(d.phase==='queued')controller.abort();}});
  assert.equal(result.exitCode,130);assert.equal(result.jobId,'job-cancel');assert.equal(result.cancellationRequested,true);
  assert.equal(result.cancellationConfirmed,confirmed);assert.equal(result.status,confirmed?'cancelled':'cancellation_unconfirmed');
  assert.equal(await readFile(result.outputPath,'utf8'),'FINAL_AFTER_CANCEL');
 });
});

test('a force-stopped unresponsive CLI never counts as confirmed remote cancellation',async()=>{
 await withCli(`process.on('SIGTERM',()=>{});console.error('remote-run: job ID: job-stubborn');console.error('remote-run: job job-stubborn queued; waiting');setInterval(()=>{},1000);`,async(root,cli)=>{
  const controller=new AbortController();
  const result=await runRemote({args:['bun']},{cwd:root,executable:cli,outputRoot:join(root,'output'),signal:controller.signal,cancellationGraceMs:35,onUpdate:d=>{if(d.phase==='queued')controller.abort();}});
  assert.equal(result.status,'cancellation_unconfirmed');assert.equal(result.cancellationConfirmed,false);assert.equal(result.jobId,'job-stubborn');assert.equal(result.exitCode,null);
  assert.match(result.diagnostic??'',/not confirmed/);
 });
});

test('preflight failures preserve diagnostics and never rerun locally',async()=>{
 await withCli(`console.error('dirty/unpushed source: publish it yourself');process.exit(125);`,async(root,cli)=>{
  const result=await runRemote({args:['bun','run','test:e2e']},{cwd:root,executable:cli,outputRoot:join(root,'output')});
  assert.equal(result.status,'failed');assert.equal(result.exitCode,125);assert.equal(result.jobId,undefined);
  assert.equal(await readFile(result.outputPath,'utf8'),'');assert.match(await readFile(result.diagnosticsPath,'utf8'),/dirty\/unpushed/);
  assert.ok(!JSON.stringify(result).includes('publish it yourself'));
 });
});

test('missing binary is an actionable failure, not a cancellation or auto-install',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-remote-test-'));
 try {const result=await runRemote({args:['bun']},{cwd:root,executable:join(root,'not-installed'),outputRoot:join(root,'output')});
 assert.equal(result.status,'failed');assert.equal(result.jobId,undefined);assert.match(result.diagnostic??'',/not found/);}
 finally {await rm(root,{recursive:true,force:true});}
});

test('command display is one line and never reparses execution arguments',()=>{
 assert.equal(commandLine(['bun','run','test:e2e']),'bun run test:e2e');
 assert.equal(commandLine(['echo','space value']), "echo 'space value'");
 assert.ok(!commandLine(['echo','line\nbreak','\x1b[31m']).includes('\n'));
 assert.ok(!commandLine(['echo','\x1b[31m']).includes('\x1b'));
});

test('waits for the CLI, preserves argv/cwd, saves full output and exposes lifecycle metadata only', async () => {
 const root=await mkdtemp(join(tmpdir(),'pi-remote-test-'));
 try {
  const cli=join(root,'remote-run');
  await writeFile(cli,`#!/usr/bin/env node
console.error('remote-run: 2026/10/04 10:00:00 checking Git source (clean checkout and pushed branch)');
console.error('remote-run: 2026/10/04 10:00:00 job ID: job-42');
console.error('remote-run: 2026/10/04 10:00:00 job job-42 queued; waiting for an available runner');
console.error('remote-run: 2026/10/04 10:00:00 job job-42 running on runner="macbook"; waiting for completed output');
setTimeout(()=>{
 console.error('remote-run: 2026/10/04 10:00:01 job job-42 finished: state=succeeded runner="macbook"');
 console.error('remote-run: 2026/10/04 10:00:01 fetching completed output for job job-42');
 process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n'+'PRIVATE_PAYLOAD'.repeat(12000));
 console.error('remote-run: 2026/10/04 10:00:01 exit code: 0');
},40);
`,{mode:0o700});
  const updates:any[]=[];
  const result=await runRemote({args:['bun','run','test:e2e','space value',"quote'",'$literal']},{cwd:root,executable:cli,outputRoot:join(root,'output'),onUpdate:d=>updates.push(d)});
  assert.equal(result.status,'completed');assert.equal(result.exitCode,0);assert.equal(result.jobId,'job-42');assert.equal(result.runner,'macbook');
  const output=await readFile(result.outputPath,'utf8');
  const [header]=output.split('\n');
  assert.deepEqual(JSON.parse(header),{args:['-timeout','1800s','--','bun','run','test:e2e','space value',"quote'",'$literal'],cwd:root});
  assert.equal(output.slice(header.length+1),'PRIVATE_PAYLOAD'.repeat(12000));
  assert.ok(updates.some(d=>d.phase==='queued'));assert.ok(updates.some(d=>d.phase==='running'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_PAYLOAD'));
 } finally {await rm(root,{recursive:true,force:true});}
});
