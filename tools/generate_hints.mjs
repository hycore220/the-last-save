/* Reproduce actual local-model clues, preserving raw responses and trace inputs. */
import {writeFile, readFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {puzzles} from '../dist/puzzles.js';
import {runBasic} from '../dist/engine.js';
import {buildHintContext,buildHintMessages,canonicalSource,cleanHint,executionFingerprint} from '../dist/hints.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const model=process.env.LASTSAVE_MODEL||'gemma4:e4b';
const hash=text=>createHash('sha256').update(text).digest('hex');
const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
const thinking=process.argv.includes('--thinking');
let clues=[];const attempts=[];
if(only){try{clues=JSON.parse(await readFile(resolve(root,'dist/recorded-hints.json'),'utf8')).clues.filter(x=>x.puzzle_id!==only);}catch(err){if(err.code!=='ENOENT')throw err;}}
let previousRuns=[];
try { const prior=JSON.parse(await readFile(resolve(root,'reports/hint-evaluation.json'),'utf8')); previousRuns=[...(prior.previous_runs||[]),{generated_at:prior.generated_at,attempts:prior.attempts}]; } catch(err) { if(err.code!=='ENOENT')throw err; }
for(const puzzle of puzzles.filter(p=>!only||p.id===only)){
  const run=runBasic(puzzle.source,{inputs:puzzle.inputs,maxSteps:1000});
  const args={puzzle,source:puzzle.source,run,level:1};
  const context=buildHintContext(args);const messages=buildHintMessages(args);
  const started=performance.now();
  const request_options={model,stream:false,think:thinking,messages,options:{temperature:0,seed:17,num_predict:thinking?3072:120}};
  const response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request_options),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error('Ollama returned '+response.status);
  const result=await response.json();
  const raw=result.message?.content||'';
  let text=null,error=null;
  try{text=cleanHint(raw);}catch(e){error=e.message;}
  const generated_at=new Date().toISOString();
  const row={puzzle_id:puzzle.id,source_sha256:hash(canonicalSource(puzzle.source)),context_sha256:hash(JSON.stringify(context)),generated_at,
    context,messages,request_options:{think:thinking,temperature:0,seed:17,num_predict:thinking?3072:120},raw_response:raw,format_valid:!error,error,
    metrics:{elapsed_ms:Math.round(performance.now()-started),prompt_tokens:result.prompt_eval_count,completion_tokens:result.eval_count,total_duration_ns:result.total_duration},
    review:{status:'pending',useful:null,grounded:null,notes:null}};
  attempts.push(row);
  if(text)clues.push({puzzle_id:puzzle.id,source_sha256:row.source_sha256,context_sha256:row.context_sha256,trace_sha256:hash(executionFingerprint(context)),generated_at,text,reviewed:false,trace_lines:[...new Set([...context.trace.first,...context.trace.last].map(x=>x.line))]});
  console.log(JSON.stringify({puzzle:puzzle.id,text,error,ms:row.metrics.elapsed_ms}));
}
await mkdir(resolve(root,'reports'),{recursive:true});
await writeFile(resolve(root,'reports/hint-evaluation.json'),JSON.stringify({kind:'real-local-Gemma-on-original-puzzle-traces',model,generated_at:new Date().toISOString(),held_out:false,contest_score:null,browser_inference_verified:false,previous_runs:previousRuns,attempts},null,2)+'\n');
await writeFile(resolve(root,'dist/recorded-hints.json'),JSON.stringify({schema_version:1,model,kind:'recorded-real-local-inference',clues},null,2)+'\n');
