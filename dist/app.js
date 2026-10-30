import { runBasic, gradePuzzle } from './engine.js';
import { puzzles } from './puzzles.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'the-last-save-progress-v1';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let saved = { index: 0, sources: {}, solved: [], revealed: [] };
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && raw.length < 100000) {
    const value = JSON.parse(raw);
    const validIds = new Set(puzzles.map((p) => p.id));
    saved.index = Number.isInteger(value.index) && value.index >= 0 && value.index < puzzles.length ? value.index : 0;
    saved.solved = Array.isArray(value.solved) ? value.solved.filter((id) => validIds.has(id)) : [];
    saved.revealed = Array.isArray(value.revealed) ? value.revealed.filter((id) => validIds.has(id)) : [];
    for (const p of puzzles) if (typeof value.sources?.[p.id] === 'string' && value.sources[p.id].length <= 12000) saved.sources[p.id] = value.sources[p.id];
  }
} catch { $('storage-status').textContent = 'Browser storage unavailable. You can still play.'; }
let currentIndex = saved.index;
let lastRun = null;
let busyHint = false;
let browserModelReady = false;
let hintRequest = 0;
let modelModulePromise;
const getModelModule = () => modelModulePromise ||= import('./hints.js');
const puzzle = () => puzzles[currentIndex];
const persist = () => {
  saved.index = currentIndex;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
  catch { $('storage-status').textContent = 'Progress cannot be saved in this browser.'; }
};
const displayOutput = (output) => Array.isArray(output) && output.length ? output.join('\n') : '(no output)';
const errorMessage = (error) => !error ? '' : typeof error === 'string' ? error : `${error.line ? `Line ${error.line}: ` : ''}${error.message || error.code || 'The program stopped.'}`;
const setRunStatus = (text, kind = '') => {
  $('run-status').textContent = text;
  $('run-status').className = `run-status${kind ? ` is-${kind}` : ''}`;
};

function renderDisks() {
  $('disk-list').replaceChildren();
  puzzles.forEach((p, index) => {
    const completed = saved.solved.includes(p.id);
    const button = el('button', `disk${completed ? ' completed' : ''}`);
    if (index === currentIndex) button.setAttribute('aria-current', 'step');
    button.setAttribute('aria-label', `Memory ${index + 1}: ${p.title}${completed ? ', restored' : ''}`);
    const shape = el('span', 'disk-shape'); shape.setAttribute('aria-hidden', 'true');
    const words = el('span');
    words.append(el('span', 'disk-label', `DISK ${String(index + 1).padStart(2, '0')}`), el('span', 'disk-title', p.title));
    button.append(shape, words);
    button.addEventListener('click', () => selectPuzzle(index));
    $('disk-list').append(button);
  });
  const count = new Set(saved.solved).size;
  $('solved-count').textContent = String(count);
  $('progress-fill').style.width = `${count / puzzles.length * 100}%`;
  $('progress-copy').textContent = count === puzzles.length ? 'the archive is whole again' : 'memories recovered';
  $('ending').hidden = count !== puzzles.length;
}

function clearRun() {
  lastRun = null;
  $('actual-output').textContent = 'READY.\nPress RUN to begin.';
  $('run-indicator').textContent = 'STANDBY';
  $('run-indicator').className = 'monitor-badge';
  setRunStatus('The machine is waiting for you.');
  $('test-results').replaceChildren(); $('test-results').hidden = true;
  $('trace-body').replaceChildren();
  $('trace-table-wrap').hidden = true; $('trace-empty').hidden = false;
  $('trace-summary').textContent = 'Run a program to see its path.';
}

function renderMemory() {
  const p = puzzle();
  const solved = saved.solved.includes(p.id);
  $('memory-panel').hidden = !solved;
  $('memory-title').textContent = p.title;
  $('memory-text').textContent = p.recoveredMessage;
  const next = puzzles.findIndex((item, index) => index > currentIndex && !saved.solved.includes(item.id));
  const anyRemaining = puzzles.some((item) => !saved.solved.includes(item.id));
  $('next-puzzle').textContent = anyRemaining ? 'Next memory →' : 'The archive is restored ✓';
  $('next-puzzle').disabled = !anyRemaining;
  $('next-puzzle').dataset.next = String(next >= 0 ? next : puzzles.findIndex((item) => !saved.solved.includes(item.id)));
}

function selectPuzzle(index) {
  if (!Number.isInteger(index) || index < 0 || index >= puzzles.length) return;
  currentIndex = index;
  hintRequest++;
  busyHint = false;
  $('ask-hint').disabled = false;
  $('ask-hint').textContent = 'Ask for a clue ↗';
  const p = puzzle();
  $('puzzle-number').textContent = String(index + 1).padStart(2, '0');
  $('puzzle-subtitle').textContent = p.subtitle || 'A damaged memory';
  $('puzzle-title').textContent = p.title;
  $('puzzle-story').textContent = p.story;
  $('editor').value = saved.sources[p.id] ?? p.source;
  $('input-values').textContent = p.inputs?.length ? p.inputs.join(', ') : 'No input';
  $('expected-output').textContent = displayOutput(p.expectedOutput);
  $('hint-text').textContent = 'A clue can point you toward the fault. The interpreter decides whether the repair works.';
  $('hint-meta').textContent = $('hint-mode').value === 'recorded' ? 'Recorded Gemma clue · original program' : 'Live clue · generated when requested';
  $('hint-evidence').hidden = true;
  clearRun(); renderDisks(); renderMemory(); persist();
}

function renderTrace(run) {
  const trace = Array.isArray(run.trace) ? run.trace : [];
  $('trace-body').replaceChildren();
  $('trace-table-wrap').hidden = !trace.length;
  $('trace-empty').hidden = !!trace.length;
  const limit = 160;
  const shown = trace.length > limit ? [...trace.slice(0, 120), ...trace.slice(-40)] : trace;
  shown.forEach((step, index) => {
    if (trace.length > limit && index === 120) {
      const skipped = el('tr'); const cell = el('td', '', `… ${trace.length - limit} intermediate steps omitted …`); cell.colSpan = 4; skipped.append(cell); $('trace-body').append(skipped);
    }
    const realIndex = trace.length > limit && index >= 120 ? trace.length - 40 + index - 120 : index;
    const variables = Object.entries(step.variables || {}).map(([name, value]) => `${name} = ${typeof value === 'string' ? JSON.stringify(value) : value}`).join('   ') || '—';
    const row = el('tr');
    row.append(el('td', '', String(realIndex + 1).padStart(2, '0')), el('td', '', String(step.line)), el('td', '', step.statement), el('td', '', variables));
    $('trace-body').append(row);
  });
  $('trace-summary').textContent = `${run.steps ?? trace.length} steps · ${run.error ? 'stopped with an error' : run.halted ? 'program ended' : 'execution stopped'}${trace.length > limit ? ' · trace shortened' : ''}`;
}

function runProgram() {
  const p = puzzle(); const source = $('editor').value;
  const refreshClueStatus = lastRun === null;
  saved.sources[p.id] = source; persist();
  try {
    lastRun = runBasic(source, { inputs: p.inputs || [], maxSteps: 1200 });
    $('actual-output').textContent = displayOutput(lastRun.output);
    const grade = gradePuzzle(source, p);
    const passed = typeof grade.passed === 'number' ? grade.passed : grade.passed ? grade.total : 0;
    const solved = grade.total > 0 && passed === grade.total;
    $('run-indicator').textContent = solved ? 'RESTORED' : lastRun.error ? 'INTERRUPTED' : 'REPAIR NEEDED';
    $('run-indicator').className = `monitor-badge ${solved ? 'is-success' : 'is-error'}`;
    setRunStatus(solved ? `All ${grade.total} input checks passed. A memory has returned.` : lastRun.error ? errorMessage(lastRun.error) : `${passed} of ${grade.total} input checks passed. Follow the trace and try another repair.`, solved ? 'success' : 'error');
    $('test-results').replaceChildren();
    for (const result of grade.results || []) {
      const input = result.inputs?.length ? result.inputs.join(', ') : 'no input';
      const chip = el('span', `test-chip${result.passed ? '' : ' failed'}`, `${result.passed ? '✓' : '×'} ${input}`);
      chip.title = `Expected: ${displayOutput(result.expected || result.expectedOutput)}\nActual: ${displayOutput(result.actual || result.output)}${result.error ? `\n${errorMessage(result.error)}` : ''}`;
      $('test-results').append(chip);
    }
    $('test-results').hidden = false;
    if (solved && !saved.solved.includes(p.id)) { saved.solved.push(p.id); persist(); }
    renderTrace(lastRun); renderDisks(); renderMemory();
    if (refreshClueStatus) {
      $('hint-meta').textContent = $('hint-mode').value === 'recorded'
        ? 'Recorded Gemma clue · exact original program only'
        : 'Live clue · based on the current run when requested';
    }
  } catch (error) {
    $('run-indicator').textContent = 'INTERRUPTED';
    $('run-indicator').className = 'monitor-badge is-error';
    setRunStatus(error.message || 'The interpreter could not run this program.', 'error');
  }
}

$('editor').addEventListener('input', () => {
  hintRequest++; busyHint = false; $('ask-hint').disabled = false; $('ask-hint').textContent = 'Ask for a clue ↗';
  saved.sources[puzzle().id] = $('editor').value;
  persist();
  lastRun = null;
  $('run-indicator').textContent = 'EDITED';
  $('run-indicator').className = 'monitor-badge';
  setRunStatus('Your edit is saved here. Run it to refresh the output and trace.');
  $('hint-text').textContent = 'You changed the program. Ask again to inspect the current version.';
  $('hint-evidence').hidden = true;
  $('hint-meta').textContent = 'The program changed. Run it before asking about the new trace.';
});
$('editor').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); runProgram(); }
});
$('run-program').addEventListener('click', runProgram);
$('reset-code').addEventListener('click', () => {
  if ($('editor').value !== puzzle().source && !window.confirm('Restore this program to its original damaged version? Your current edits to this disk will be replaced.')) return;
  delete saved.sources[puzzle().id]; selectPuzzle(currentIndex);
});
$('reset-all').addEventListener('click', () => {
  if (!window.confirm('Start a fresh recovery? This clears this game’s saved edits and recovered memories in this browser.')) return;
  saved = { index: 0, sources: {}, solved: [], revealed: [] }; selectPuzzle(0);
});
$('next-puzzle').addEventListener('click', () => {
  const next = Number($('next-puzzle').dataset.next); selectPuzzle(next);
  $('puzzle-title').scrollIntoView({ block: 'start', behavior: 'auto' });
});
$('reveal-repair').addEventListener('click', () => {
  if (!window.confirm('Reveal a working repair for this memory? It will replace your current code, and you can inspect its execution.')) return;
  saved.sources[puzzle().id] = puzzle().solution;
  if (!saved.revealed.includes(puzzle().id)) saved.revealed.push(puzzle().id);
  $('editor').value = puzzle().solution; persist(); runProgram();
  $('hint-text').textContent = 'A working repair is loaded. Follow the trace to see why it passes each input check.';
  $('hint-meta').textContent = 'Authored solution · not an AI response';
  $('hint-evidence').hidden = true;
});

$('ask-hint').addEventListener('click', async () => {
  if (busyHint) return;
  const requestId = ++hintRequest; const p = puzzle(); const source = $('editor').value;
  if (!lastRun) runProgram();
  const run = lastRun; const mode = $('hint-mode').value;
  busyHint = true; $('ask-hint').disabled = true; $('ask-hint').textContent = 'Listening…';
  $('hint-text').textContent = 'Reading the execution trace…';
  $('hint-evidence').hidden = true;
  $('hint-meta').textContent = $('hint-mode').value === 'recorded' ? 'Finding a matching recorded clue…' : 'Generating a new clue locally…';
  try {
    const module = await getModelModule();
    if (requestId !== hintRequest) return;
    const result = await module.getHint({ puzzle: p, source, run, mode, level: 1 });
    if (requestId !== hintRequest) return;
    $('hint-text').textContent = result.text || 'No clue was returned. Follow the trace or try again.';
    const modeLabel = result.mode === 'recorded' ? 'Recorded model response' : result.mode === 'browser' ? 'Live browser inference' : result.mode === 'local' ? 'Live local inference' : result.mode || 'Clue';
    const verification = result.evidence?.matches_current_trace === true ? 'starting trace verified' : '';
    $('hint-meta').textContent = [modeLabel, result.model, verification, result.warning].filter(Boolean).join(' · ');
    $('hint-evidence').hidden = !result.evidence;
    $('hint-evidence-text').textContent = typeof result.evidence === 'string' ? result.evidence : JSON.stringify(result.evidence, null, 2);
  } catch (error) {
    if (requestId !== hintRequest) return;
    $('hint-text').textContent = error.message || 'The clue could not be loaded. You can keep repairing the program using its trace.';
    $('hint-meta').textContent = 'No new AI response was generated. The game remains playable.';
  } finally {
    if (requestId === hintRequest) { busyHint = false; $('ask-hint').disabled = false; $('ask-hint').textContent = 'Ask for a clue ↗'; }
  }
});
$('hint-mode').addEventListener('change', () => {
  hintRequest++; busyHint = false; $('ask-hint').disabled = false; $('ask-hint').textContent = 'Ask for a clue ↗';
  $('hint-text').textContent = 'The next clue will use the selected source.';
  $('hint-evidence').hidden = true;
  $('hint-meta').textContent = $('hint-mode').value === 'recorded' ? 'Recorded Gemma clue · exact original program only' : 'Live inference · your current code and execution trace';
});
$('load-model').addEventListener('click', async () => {
  if (browserModelReady) { $('hint-mode').value = 'browser'; return; }
  $('load-model').disabled = true; $('model-status').textContent = 'Checking the browser and loading the model…';
  try {
    const module = await getModelModule();
    if (module.MODEL_INFO?.downloadNote) $('model-download-note').textContent = module.MODEL_INFO.downloadNote;
    await module.loadBrowserModel((progress) => {
      $('model-status').textContent = typeof progress === 'string' ? progress : progress.text || progress.message || `Loading model${Number.isFinite(progress.progress) ? `: ${Math.round(progress.progress * 100)}%` : '…'}`;
    });
    browserModelReady = true;
    $('hint-mode').querySelector('[value="browser"]').disabled = false;
    $('hint-mode').value = 'browser';
    $('model-status').textContent = 'Gemma is ready. New clues now run on this device.';
    $('load-model').textContent = 'Browser model loaded ✓';
    $('hint-text').textContent = 'Gemma is ready on this device. Ask for a new clue about your current program.';
    $('hint-meta').textContent = 'Live browser Gemma · ready for your current program';
    $('hint-evidence').hidden = true;
  } catch (error) {
    $('model-status').textContent = error.message || 'This browser could not load the model. Recorded clues and the game still work.';
    $('load-model').disabled = false;
    $('load-model').textContent = 'Try loading the model again →';
  }
});

if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  const option = el('option', '', 'Live local Ollama'); option.value = 'local'; $('hint-mode').append(option);
}
const about = $('about-dialog');
$('about-open').addEventListener('click', () => about.showModal());
$('about-close').addEventListener('click', () => about.close());
$('about-start').addEventListener('click', () => about.close());
about.addEventListener('click', (event) => { if (event.target === about) { const rect = about.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) about.close(); } });

if (puzzles.length) selectPuzzle(currentIndex);
else setRunStatus('No programs are available in this build.', 'error');
