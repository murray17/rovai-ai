import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('./rovai-scheduled-tasks-prototype-v34.html', import.meta.url), 'utf8');
const library = html.match(/<script id="cronValidationLibrary">([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({});
vm.runInContext(library, context);
const { validateCron } = context.RovaiCronValidation;

test('reports the field and range for the user regression', () => {
  assert.equal(validateCron('600 9 * * *'), '分钟需在 0–59 之间，当前填写为 600。');
});

test('rejects out-of-range values in all five fields', () => {
  for (const expression of ['60 9 * * *', '0 24 * * *', '0 9 0 * *', '0 9 32 * *', '0 9 * 0 *', '0 9 * 13 *', '0 9 * * 8']) {
    assert.ok(validateCron(expression), expression);
  }
});

test('rejects malformed values, zero steps, and non-five-field expressions', () => {
  for (const expression of ['', '   ', '* * * *', '0 0 9 * * *', '0 0 9 * * * 2027', '@daily', '*/0 9 * * *', '0 9 * * 1,,2', '0 9 * * 5-1', 'x 9 * * *', '0-60 9 * * *', '0,600 9 * * *']) {
    assert.ok(validateCron(expression), expression);
  }
});

test('accepts bounds, lists, ranges, steps, names and combined day fields', () => {
  for (const expression of ['0 9 * * *', '59 23 31 12 7', '*/5 9-18 * * 1-5', '0,30 9,17 * * MON-FRI', '0 9 * JAN,MAR MON', '0 9 1 * MON', '*/1 * * * *', '  0   9\t* * *  ']) {
    assert.equal(validateCron(expression), '', expression);
  }
});
