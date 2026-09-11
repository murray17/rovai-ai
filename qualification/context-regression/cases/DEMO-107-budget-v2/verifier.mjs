import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const expected = {"sections": ["时间线", "影响", "原因", "后续措施"], "durationMinutes": 12, "affectedService": "api"}
let passed = false
try { const actual = JSON.parse(await readFile(join(process.argv[2], 'report.json'), 'utf8')); for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value); passed = true } catch {}
console.log(JSON.stringify({ schemaVersion: 2, checks: [{ checkId: 'CHK-DELIVERY', status: passed ? 'passed' : 'failed', evidence: [{ code: passed ? 'delivery.matches_required_facts' : 'delivery.missing_or_incorrect', summary: 'Required artifact fields are checked against disclosed task facts; extra explanation fields are allowed.' }] }] }))
