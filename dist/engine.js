/** A deliberately small BASIC interpreter. It never evaluates JavaScript. */
const LIMITS = Object.freeze({ source: 12000, lines: 200, inputs: 32, steps: 5000, output: 80, text: 240, value: 1e12 });

class BasicError extends Error {
  constructor(code, message, line = null) { super(message); this.code = code; this.line = line; }
}

function numeric(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > LIMITS.value) {
    throw new BasicError('number_limit', 'A number is not finite or exceeds the supported magnitude of 1e12.');
  }
  return Object.is(value, -0) ? 0 : value;
}

function tokens(expression) {
  const result = [];
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const space = /^\s+/.exec(rest);
    if (space) { offset += space[0].length; continue; }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)|^[A-Za-z][A-Za-z0-9_]*|^(?:<>|<=|>=|[+*/()=<>-])/.exec(rest);
    if (!match) throw new BasicError('syntax', `Unsupported expression near “${rest.slice(0, 24)}”.`);
    result.push(match[0].toUpperCase());
    offset += match[0].length;
    if (result.length > 160) throw new BasicError('expression_limit', 'An expression has too many parts.');
  }
  return result;
}

function expressionTree(expression) {
  const list = tokens(expression);
  let at = 0;
  let depth = 0;
  const peek = () => list[at];
  const take = () => list[at++];
  function primary() {
    if (++depth > 24) throw new BasicError('expression_limit', 'Parentheses or unary operators are nested too deeply.');
    let node;
    const token = take();
    if (token === '+' || token === '-') {
      node = { op: 'unary', sign: token, value: primary() };
    } else if (token === '(') {
      node = comparison();
      if (take() !== ')') throw new BasicError('syntax', 'A closing parenthesis is missing.');
    } else if (token && /^(?:\d|\.)/.test(token)) {
      node = { op: 'number', value: numeric(Number(token)) };
    } else if (token && /^[A-Z][A-Z0-9_]*$/.test(token)) {
      node = { op: 'variable', name: token };
    } else {
      throw new BasicError('syntax', 'Expected a number, variable, or parenthesized expression.');
    }
    depth--;
    return node;
  }
  function product() {
    let node = primary();
    while (peek() === '*' || peek() === '/') node = { op: take(), left: node, right: primary() };
    return node;
  }
  function sum() {
    let node = product();
    while (peek() === '+' || peek() === '-') node = { op: take(), left: node, right: product() };
    return node;
  }
  function comparison() {
    let node = sum();
    if (['=', '<>', '<', '<=', '>', '>='].includes(peek())) node = { op: take(), left: node, right: sum() };
    return node;
  }
  const tree = comparison();
  if (at !== list.length) throw new BasicError('syntax', `Unexpected “${list[at]}” after the expression.`);
  return tree;
}

function evaluate(tree, variables) {
  if (tree.op === 'number') return tree.value;
  if (tree.op === 'variable') return variables[tree.name] ?? 0;
  if (tree.op === 'unary') return numeric((tree.sign === '-' ? -1 : 1) * evaluate(tree.value, variables));
  const a = evaluate(tree.left, variables), b = evaluate(tree.right, variables);
  switch (tree.op) {
    case '+': return numeric(a + b);
    case '-': return numeric(a - b);
    case '*': return numeric(a * b);
    case '/':
      if (b === 0) throw new BasicError('division_by_zero', 'Division by zero stopped this run.');
      return numeric(a / b);
    case '=': return Number(a === b);
    case '<>': return Number(a !== b);
    case '<': return Number(a < b);
    case '<=': return Number(a <= b);
    case '>': return Number(a > b);
    case '>=': return Number(a >= b);
    default: throw new BasicError('syntax', 'Unknown expression operator.');
  }
}

function compileStatement(statement) {
  if (/^REM(?:\s|$)/i.test(statement)) return { op: 'REM' };
  if (/^END$/i.test(statement)) return { op: 'END' };
  let match;
  if ((match = /^LET\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/i.exec(statement))) {
    return { op: 'LET', name: match[1].toUpperCase(), expression: expressionTree(match[2]) };
  }
  if ((match = /^INPUT\s+([A-Za-z][A-Za-z0-9_]*)$/i.exec(statement))) return { op: 'INPUT', name: match[1].toUpperCase() };
  if ((match = /^GOTO\s+(\d+)$/i.exec(statement))) return { op: 'GOTO', target: Number(match[1]) };
  if ((match = /^IF\s+(.+?)\s+THEN\s+(?:GOTO\s+)?(\d+)$/i.exec(statement))) {
    return { op: 'IF', expression: expressionTree(match[1]), target: Number(match[2]) };
  }
  if ((match = /^PRINT\s+(.+)$/i.exec(statement))) {
    const text = /^"((?:[^"]|"")*)"$/.exec(match[1]);
    if (text) {
      const value = text[1].replace(/""/g, '"');
      if (value.length > LIMITS.text) throw new BasicError('text_limit', `PRINT text must be at most ${LIMITS.text} characters.`);
      return { op: 'PRINT', text: value };
    }
    return { op: 'PRINT', expression: expressionTree(match[1]) };
  }
  throw new BasicError('syntax', 'Use REM, LET, INPUT, PRINT, IF … THEN line, GOTO, or END. One statement per numbered line.');
}

function compile(source) {
  if (typeof source !== 'string' || source.length > LIMITS.source) throw new BasicError('source_limit', `Source must be text of at most ${LIMITS.source} characters.`);
  const rows = source.split(/\r?\n/).filter(row => row.trim());
  if (!rows.length) throw new BasicError('empty_program', 'The program is empty.');
  if (rows.length > LIMITS.lines) throw new BasicError('source_limit', `Use at most ${LIMITS.lines} numbered lines.`);
  const seen = new Set();
  const program = rows.map(row => {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(row);
    if (!match) throw new BasicError('syntax', `Each statement needs a line number: “${row.slice(0, 45)}”.`);
    const line = Number(match[1]);
    if (!Number.isSafeInteger(line) || line < 1 || line > 99999) throw new BasicError('line_number', 'Line numbers must be integers from 1 to 99999.');
    if (seen.has(line)) throw new BasicError('duplicate_line', `Line ${line} appears more than once.`, line);
    seen.add(line);
    try { return { line, statement: match[2], instruction: compileStatement(match[2]) }; }
    catch (error) { error.line = line; throw error; }
  }).sort((a, b) => a.line - b.line);
  const positions = new Map(program.map((row, index) => [row.line, index]));
  for (const row of program) {
    if (row.instruction.target !== undefined && !positions.has(row.instruction.target)) {
      throw new BasicError('missing_target', `Line ${row.instruction.target} does not exist.`, row.line);
    }
  }
  return { program, positions };
}

/** Run a bounded BASIC program. Numeric variables default to zero, as in many BASIC dialects. */
export function runBasic(source, options = {}) {
  const result = { output: [], trace: [], steps: 0, halted: false, error: null };
  let currentLine = null;
  try {
    if (!options || typeof options !== 'object') throw new BasicError('options', 'Run options must be an object.');
    const inputs = options.inputs ?? [];
    if (!Array.isArray(inputs) || inputs.length > LIMITS.inputs) throw new BasicError('input_limit', `Supply at most ${LIMITS.inputs} numeric inputs.`);
    inputs.forEach(numeric);
    const requestedSteps = options.maxSteps ?? 1000;
    if (!Number.isInteger(requestedSteps) || requestedSteps < 1 || requestedSteps > LIMITS.steps) {
      throw new BasicError('step_limit', `The step budget must be an integer from 1 to ${LIMITS.steps}.`);
    }
    const { program, positions } = compile(source);
    const variables = Object.create(null);
    let pc = 0, inputAt = 0;
    while (pc < program.length) {
      const row = program[pc];
      currentLine = row.line;
      if (result.steps >= requestedSteps) throw new BasicError('step_limit', `Stopped after ${requestedSteps} steps. A loop may not reach END.`, currentLine);
      result.steps++;
      const instruction = row.instruction;
      let next = pc + 1, ended = false;
      try {
        switch (instruction.op) {
          case 'REM': break;
          case 'LET': variables[instruction.name] = evaluate(instruction.expression, variables); break;
          case 'INPUT':
            if (inputAt >= inputs.length) throw new BasicError('input_exhausted', 'The program requested more input values than this test provides.');
            variables[instruction.name] = inputs[inputAt++];
            break;
          case 'PRINT': {
            if (result.output.length >= LIMITS.output) throw new BasicError('output_limit', `Stopped after ${LIMITS.output} output lines. Check the loop.`);
            const value = instruction.text ?? String(evaluate(instruction.expression, variables));
            result.output.push(value);
            break;
          }
          case 'GOTO': next = positions.get(instruction.target); break;
          case 'IF':
            if (evaluate(instruction.expression, variables) !== 0) next = positions.get(instruction.target);
            break;
          case 'END': ended = true; break;
        }
      } catch (error) {
        if (result.trace.length < 200) result.trace.push({ line: row.line, statement: row.statement, variables: { ...variables }, error: error.message });
        throw error;
      }
      if (result.trace.length < 200) result.trace.push({ line: row.line, statement: row.statement, variables: { ...variables } });
      if (ended) { result.halted = true; return result; }
      pc = next;
    }
    result.halted = true;
  } catch (error) {
    result.error = { code: error.code ?? 'runtime', message: error.message, line: error.line ?? currentLine };
  }
  return result;
}

/** Check the same repair against several public input/output examples. */
export function gradePuzzle(source, puzzle) {
  const checks = Array.isArray(puzzle?.tests) ? puzzle.tests : [];
  const results = checks.map(test => {
    const run = runBasic(source, { inputs: test.inputs, maxSteps: 1000 });
    const expected = test.output.map(String);
    const passed = run.halted && !run.error && JSON.stringify(run.output) === JSON.stringify(expected);
    return { inputs: [...test.inputs], expected, expectedOutput: expected, actual: run.output, output: run.output, passed, error: run.error, run };
  });
  return { passed: results.filter(row => row.passed).length, total: results.length, results };
}
