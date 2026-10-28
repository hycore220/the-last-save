import test from 'node:test';
import assert from 'node:assert/strict';
import { runBasic, gradePuzzle } from '../dist/engine.js';
import { puzzles } from '../dist/puzzles.js';

test('arithmetic precedence, parentheses, unary signs and case-insensitive variables', () => {
  const result = runBasic('10 LET x = -(2 + 3) * 4 + 18 / 3\n20 PRINT X\n30 END');
  assert.deepEqual(result.output, ['-14']);
  assert.equal(result.error, null);
  assert.equal(result.halted, true);
  assert.deepEqual(result.trace[0].variables, { X: -14 });
});

test('numeric source ordering, IF branches, GOTO and literal PRINT', () => {
  const source = '70 END\n20 IF N <> 2 THEN 60\n10 INPUT N\n30 PRINT "TWO"\n40 GOTO 70\n60 PRINT "OTHER"';
  assert.deepEqual(runBasic(source, { inputs: [2] }).output, ['TWO']);
  assert.deepEqual(runBasic(source, { inputs: [3] }).output, ['OTHER']);
});

test('all comparison operators return numeric truth values', () => {
  assert.deepEqual(runBasic('10 PRINT 2 = 2\n20 PRINT 2 <> 2\n30 PRINT 1 < 2\n40 PRINT 2 <= 2\n50 PRINT 3 > 4\n60 PRINT 4 >= 4').output, ['1', '0', '1', '1', '0', '1']);
});

test('escaped quotes are text and never executed', () => {
  const result = runBasic('10 PRINT "<script>throw 1</script>"\n20 PRINT "SAY ""HELLO"""\n30 END');
  assert.deepEqual(result.output, ['<script>throw 1</script>', 'SAY "HELLO"']);
  assert.equal(runBasic('10 LET X = globalThis.process.exit()').error.code, 'syntax');
  assert.equal(runBasic('10 PRINT fetch("https://example.com")').error.code, 'syntax');
});

test('a loop is stopped by a caller budget and trace preserves its last executed line', () => {
  const result = runBasic('10 LET X = X + 1\n20 GOTO 10', { maxSteps: 8 });
  assert.equal(result.error.code, 'step_limit');
  assert.equal(result.steps, 8);
  assert.equal(result.halted, false);
  assert.equal(result.trace.at(-1).variables.X, 4);
  assert.equal(runBasic('10 GOTO 10', { maxSteps: 999999 }).error.code, 'step_limit');
});

test('missing, duplicated and invalid lines are rejected before execution', () => {
  assert.equal(runBasic('10 GOTO 50\n20 END').error.code, 'missing_target');
  assert.equal(runBasic('10 END\n10 PRINT 1').error.code, 'duplicate_line');
  assert.equal(runBasic('PRINT 3').error.code, 'syntax');
  assert.equal(runBasic('0 END').error.code, 'line_number');
  assert.equal(runBasic('').error.code, 'empty_program');
});

test('numeric and input errors give the failing BASIC line', () => {
  const zero = runBasic('10 PRINT 5 / 0');
  assert.equal(zero.error.code, 'division_by_zero');
  assert.equal(zero.error.line, 10);
  assert.equal(runBasic('10 INPUT X').error.code, 'input_exhausted');
  assert.equal(runBasic('10 INPUT X', { inputs: ['2'] }).error.code, 'number_limit');
  assert.equal(runBasic('10 INPUT X', { inputs: [Infinity] }).error.code, 'number_limit');
  assert.equal(runBasic('10 PRINT 1000000000000 * 10').error.code, 'number_limit');
});

test('resource limits constrain output, source and parser recursion', () => {
  assert.equal(runBasic('10 PRINT "X"\n20 GOTO 10').error.code, 'output_limit');
  assert.equal(runBasic('10 REM ' + 'x'.repeat(12000)).error.code, 'source_limit');
  assert.equal(runBasic('10 PRINT ' + '('.repeat(25) + '1' + ')'.repeat(25)).error.code, 'expression_limit');
  assert.equal(runBasic('10 INPUT X', { inputs: new Array(33).fill(0) }).error.code, 'input_limit');
});

for (const puzzle of puzzles) {
  test(`${puzzle.id}: broken program fails and repair passes all varied inputs`, () => {
    const broken = gradePuzzle(puzzle.source, puzzle);
    const repaired = gradePuzzle(puzzle.solution, puzzle);
    assert.ok(broken.passed < broken.total);
    assert.equal(repaired.total, 3);
    assert.equal(repaired.passed, repaired.total);
    assert.deepEqual(runBasic(puzzle.solution, { inputs: puzzle.inputs }).output, puzzle.expectedOutput);
    assert.ok(runBasic(puzzle.source, { inputs: puzzle.inputs }).trace.length > 0);
  });
}

test('a hardcoded answer cannot pass the varied-input checks', () => {
  for (const puzzle of puzzles.filter(p => p.id !== 'warm-room')) {
    const hardcoded = puzzle.expectedOutput.map((value, index) => `${10 + index * 10} PRINT "${value}"`).join('\n');
    const grade = gradePuzzle(hardcoded, puzzle);
    assert.ok(grade.passed < grade.total, puzzle.id);
  }
});
