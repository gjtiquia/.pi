import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { commandLine, safeLine } from './display.ts';

export interface RunParams { args: string[]; timeoutSeconds?: number; cwd?: string }
export interface RunDetails {
 command: string; cwd: string; phase: string; startedAt: number; phaseStartedAt: number; lastProgressAt: number;
 status: 'running'|'completed'|'failed'|'cancelled'|'cancellation_unconfirmed';
 jobId?: string; runner?: string; jobState?: string; exitCode: number|null;
 outputPath: string; diagnosticsPath: string; diagnostic?: string;
 cancellationRequested: boolean; cancellationConfirmed: boolean; finishedAt?: number;
}
interface RunOptions {
 cwd: string; signal?: AbortSignal; onUpdate?: (details: RunDetails)=>void;
 executable?: string; outputRoot?: string; cancellationGraceMs?: number;
}

export async function runRemote(params: RunParams, options: RunOptions): Promise<RunDetails> {
 if (!params.args?.length || !params.args[0] || params.args.some(a=>typeof a!=='string'||a.includes('\0'))) throw new Error('args must contain an executable and literal arguments without NUL characters');
 const timeout=params.timeoutSeconds??1800;
 if (!Number.isSafeInteger(timeout)||timeout<=0) throw new Error('timeoutSeconds must be a positive integer');
 if(options.signal?.aborted) throw new Error('Remote run aborted before submission');
 const cwd=resolve(options.cwd,params.cwd??'.');
 const root=options.outputRoot??join(homedir(),'.remote-runners','pi-output');
 await mkdir(root,{recursive:true,mode:0o700});
 const dir=await mkdtemp(join(root,'run-'));
 const now=Date.now();
 const details:RunDetails={command:commandLine(params.args),cwd,phase:'starting',startedAt:now,phaseStartedAt:now,lastProgressAt:now,status:'running',exitCode:null,outputPath:join(dir,'output.log'),diagnosticsPath:join(dir,'diagnostics.log'),cancellationRequested:false,cancellationConfirmed:false};
 const emit=()=>options.onUpdate?.({...details});
 const phase=(value:string)=>{if(value!==details.phase){details.phase=value;details.phaseStartedAt=Date.now();}emit();};
 emit();
 const child=spawn(options.executable??'remote-run',['-timeout',`${timeout}s`,'--',...params.args],{cwd,stdio:['ignore','pipe','pipe']});
 let grace:ReturnType<typeof setTimeout>|undefined;
 let processError:Error|undefined;
 let streamError:Error|undefined;
 const abort=()=>{
  if(details.cancellationRequested||details.finishedAt!==undefined)return;
  details.cancellationRequested=true;
  phase('requesting cancellation');
  child.kill('SIGTERM'); // The CLI requests coordinator cancellation and collects available output.
  grace=setTimeout(()=>{child.kill('SIGKILL');},options.cancellationGraceMs??35000);
  grace.unref();
 };
 options.signal?.addEventListener('abort',abort,{once:true});
 if(options.signal?.aborted)abort();
 const refresh=setInterval(emit,1000);refresh.unref(); // UI clock only, not backend progress.
 const parse=(line:string)=>{
  const text=line.replace(/^remote-run: (?:\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} )?/,'');
  details.lastProgressAt=Date.now();
  const id=text.match(/^job ID: (\S+)/);if(id)details.jobId=safeLine(id[1]);
  const runner=text.match(/runner=("(?:[^"\\]|\\.)*")/);if(runner){try{details.runner=safeLine(JSON.parse(runner[1]));}catch{}}
  const state=text.match(/finished: state=(\w+)/);if(state)details.jobState=state[1];
  if(details.cancellationRequested){emit();return;}
  if(text.startsWith('checking Git source'))phase('checking Git source');
  else if(text.startsWith('submitting job'))phase('submitting');
  else if(/job \S+ queued/.test(text))phase('queued');
  else if(/job \S+ running on/.test(text))phase('running');
  else if(text.startsWith('fetching completed output'))phase('retrieving completed output');
  else emit();
 };
 const decoder=new StringDecoder('utf8');let buffer='';
 child.stderr!.on('data',(chunk:Buffer)=>{
  buffer+=decoder.write(chunk);
  let index:number;
  while((index=buffer.indexOf('\n'))>=0){parse(buffer.slice(0,index));buffer=buffer.slice(index+1);}
  // Full diagnostics go to disk; never buffer a pathological stderr line in RAM.
  if(buffer.length>65536)buffer='';
 });
 const streamFailure=(error:unknown)=>{streamError=error instanceof Error?error:new Error(String(error));abort();};
 const output=pipeline(child.stdout!,createWriteStream(details.outputPath,{mode:0o600})).catch(streamFailure);
 const diagnostics=pipeline(child.stderr!,createWriteStream(details.diagnosticsPath,{mode:0o600})).catch(streamFailure);
 try {
  const closed=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolveClose=>{
   child.once('error',error=>{processError=error;});
   child.once('close',(code,signal)=>resolveClose({code,signal}));
  });
  await Promise.all([output,diagnostics]);
  buffer+=decoder.end();if(buffer)parse(buffer);
  details.exitCode=closed.code;
  details.cancellationConfirmed=details.jobState==='cancelled';
  details.status=processError ? 'failed' : details.cancellationRequested ? (details.cancellationConfirmed?'cancelled':'cancellation_unconfirmed') : closed.code===0&&!streamError?'completed':'failed';
  if(processError)details.diagnostic=processError.message.includes('ENOENT')?'remote-run executable not found on PATH; install/provide the CLI yourself. Nothing was submitted.':'Could not start remote-run; read diagnostics and inspect jobs before retrying.';
  else if(streamError)details.diagnostic='Output/diagnostics could not be saved completely; cancellation was requested. Inspect the job and diagnostics before retrying.';
  else if(details.cancellationRequested&&!details.cancellationConfirmed)details.diagnostic='Cancellation requested but not confirmed. Inspect the job ID; do not assume it stopped.';
  else if(closed.code!==0)details.diagnostic='Remote run did not succeed. Read diagnostics.log and output.log; no automatic local fallback or retry.';
  details.finishedAt=Date.now();phase(details.status);
  await writeFile(join(dir,'result.json'),JSON.stringify(details,null,2)+'\n',{mode:0o600});
  return {...details};
 } finally {
  clearInterval(refresh);if(grace)clearTimeout(grace);
  options.signal?.removeEventListener('abort',abort);
 }
}
