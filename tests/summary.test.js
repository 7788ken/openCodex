import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDefaultRunSchema, normalizeSummary, renderHumanSummary } from '../src/lib/summary.js';

test('renderHumanSummary prints string findings', () => {
  const output = renderHumanSummary({
    title: 'Run completed',
    result: 'Done.',
    highlights: ['Saved session.'],
    findings: ['One issue found.'],
    next_steps: ['Inspect artifacts.']
  });

  assert.match(output, /Findings:/);
  assert.match(output, /- One issue found\./);
});

test('renderHumanSummary prints structured findings with detail', () => {
  const output = renderHumanSummary({
    title: 'Review completed',
    result: 'Two issues found.',
    highlights: ['Codex review parsed.'],
    findings: [
      {
        priority: 'P1',
        title: 'Fix schema path resolution',
        location: {
          path: 'src/commands/run.js',
          start_line: 17,
          end_line: 17
        },
        detail: 'Resolve the bundled schema relative to the package.\nDo not read it from caller CWD.'
      }
    ],
    next_steps: ['Patch the command.']
  });

  assert.match(output, /Findings:/);
  assert.match(output, /- \[P1\] Fix schema path resolution \(src\/commands\/run\.js:17-17\)/);
  assert.match(output, /  Resolve the bundled schema relative to the package\./);
  assert.match(output, /  Do not read it from caller CWD\./);
});

test('normalizeSummary preserves structured findings', () => {
  const finding = {
    priority: 'P1',
    title: 'Keep structured findings',
    location: {
      path: 'src/lib/summary.js',
      start_line: 1,
      end_line: 1
    },
    detail: 'Do not drop object-shaped findings during normalization.'
  };

  const summary = normalizeSummary({
    title: 'Run completed',
    result: 'Done.',
    status: 'completed',
    highlights: [],
    next_steps: [],
    risks: [],
    validation: [],
    changed_files: [],
    findings: [finding]
  });

  assert.deepEqual(summary.findings, [finding]);
});

test('run summary schemas declare object-shaped findings items for Codex CLI validation', () => {
  const fileSchema = JSON.parse(readFileSync(new URL('../schemas/run-summary.schema.json', import.meta.url), 'utf8'));
  const jsSchema = createDefaultRunSchema();

  for (const schema of [fileSchema, jsSchema]) {
    const findingItem = schema.properties.findings.items;
    assert.equal(findingItem.type, 'object');
    assert.equal('oneOf' in findingItem, false);
    assert.equal(findingItem.additionalProperties, false);
    assert.deepEqual(findingItem.required, ['priority', 'title', 'location', 'detail']);
    assert.equal(findingItem.properties.location.type, 'object');
    assert.deepEqual(findingItem.properties.location.required, ['path', 'start_line', 'end_line']);
    assert.equal(findingItem.properties.location.properties.path.type, 'string');
    assert.equal(findingItem.properties.detail.type, 'string');
  }
});
