import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { resolve } from 'node:path';
import { initProjectHooks } from './init.ts';
import { runRemote, type RunDetails } from './run.ts';
import { commandLine, duration, safeLine } from './display.ts';

const resultSchema=Type.Object({
 status:Type.String(),exitCode:Type.Union([Type.Integer(),Type.Null()]),
 jobId:Type.Optional(Type.String()),runner:Type.Optional(Type.String()),jobState:Type.Optional(Type.String()),
 outputPath:Type.String(),diagnosticsPath:Type.String(),diagnostic:Type.Optional(Type.String()),
 cancellationRequested:Type.Boolean(),cancellationConfirmed:Type.Boolean(),
});

export default function (pi:ExtensionAPI) {
 const active=new Map<AbortController,Promise<unknown>>();
 pi.on('session_shutdown',async()=>{
  for(const controller of active.keys())controller.abort();
  await Promise.allSettled([...active.values()]);
 });
 pi.registerTool({
  name:'remote_run',label:'Remote run',
  exposure:'model-only',
  description:'Run an executable and literal arguments through the installed remote-run CLI using a clean, pushed Git checkout. Waits for completion. Use for heavy E2E tests/builds, not searches or tiny checks. Full output and CLI diagnostics are saved to the returned paths; the result contains status metadata and paths, not command output. Requires local coordinator and remote-run on PATH; installs nothing.',
  promptSnippet:'Offload heavy checks from clean, pushed Git source; wait and receive output file paths.',
  promptGuidelines:['Use remote_run for ordinary heavy tests/builds without per-job confirmation. Destructive commands still require the user\'s explicit approval.','For remote_run recovery, never automatically commit, push, retry, or fall back locally. A dirty/unpushed checkout is an error; report it.','After failures, use read on outputPath and diagnosticsPath before reporting.'],

  parameters:Type.Object({args:Type.Array(Type.String(),{minItems:1,description:'Executable and literal arguments, e.g. ["bun","run","test:e2e"]. No shell parsing.'}),timeoutSeconds:Type.Optional(Type.Integer({minimum:1,default:1800,description:'Remote preparation/hooks/execution timeout; queue waiting is excluded.'})),cwd:Type.Optional(Type.String({description:'Local checkout directory, absolute or relative to Pi cwd; defaults to Pi cwd.'}))}),
  outputSchema:resultSchema,
  async execute(_id,params,signal,onUpdate,ctx){
   const controller=new AbortController();
   const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
   const work=runRemote(params,{cwd:ctx.cwd,signal:combined,onUpdate:details=>onUpdate?.({content:[{type:'text',text:`remote_run ${details.command} · ${details.phase}`}],details})});
   active.set(controller,work);
   try {
    const details=await work;
    const data={status:details.status,exitCode:details.exitCode,jobId:details.jobId,runner:details.runner,jobState:details.jobState,outputPath:details.outputPath,diagnosticsPath:details.diagnosticsPath,diagnostic:details.diagnostic,cancellationRequested:details.cancellationRequested,cancellationConfirmed:details.cancellationConfirmed};
    return {content:[{type:'text',text:JSON.stringify(data,null,2)}],details,structuredContent:JSON.parse(JSON.stringify(data)),isError:details.status!=='completed'};
   } finally {active.delete(controller);}
  },
  renderCall(args,theme){return new Text(theme.fg('toolTitle',theme.bold('remote_run '))+theme.fg('accent',commandLine(args.args??[])),0,0);},
  renderResult(result,{isPartial},theme){
   const details=result.details as RunDetails|undefined;
   if(!details)return new Text(result.content.find(c=>c.type==='text')?.text??'',0,0);
   const now=details.finishedAt??Date.now();
   const location=[details.jobId,details.runner?`on ${safeLine(details.runner)}`:undefined].filter(Boolean).join(' · ');
   let text=`${isPartial?'↳':details.status==='completed'?'✓':'!'} ${duration(now-details.startedAt)} · ${details.phase}${location?' · '+location:''}`;
   if(isPartial)text+=` · phase ${duration(now-details.phaseStartedAt)}`;
   else text+=` · exit ${details.exitCode??'unknown'}\noutput: ${safeLine(details.outputPath)}\ndiagnostics: ${safeLine(details.diagnosticsPath)}${details.diagnostic?'\n'+details.diagnostic:''}`;
   return new Text(theme.fg(isPartial?'muted':details.status==='completed'?'success':'warning',text),0,0);
  },
 });
 pi.registerTool({
  name:'remote_run_init',label:'Initialize remote hooks',
  description:'Create/update project-root .remote-runner.json by supplying at least one hook: AfterCreateWorktreeCommand or BeforeJobCommand. Optional cwd selects the checkout (defaults to Pi cwd). Omitted hooks stay unchanged; empty string clears a hook. Preserves unrelated fields. Never executes hooks, infers commands, commits or pushes. The config must be committed and pushed before remote jobs can use it.',
  parameters:Type.Object({
   cwd:Type.Optional(Type.String({description:'Local path to the checkout; defaults to Pi cwd.'})),
   AfterCreateWorktreeCommand:Type.Optional(Type.String({description:'Command to configure a newly created worktree.'})),
   BeforeJobCommand:Type.Optional(Type.String({description:'Command to run before the remote job.'})),
  }),
  async execute(_id,params,_signal,_update,ctx){
   const result=await initProjectHooks(resolve(ctx.cwd,params.cwd??'.'),params);
   return {content:[{type:'text',text:JSON.stringify({...result,note:'No hooks executed. Commit and push this file yourself before remote jobs can use it.'},null,2)}],details:result};
  },
  renderCall(args,theme){return new Text(theme.fg('toolTitle',theme.bold('remote_run_init '))+theme.fg('accent',safeLine(args.cwd??'current checkout')),0,0);},
 });
}
