import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Command Code required Mod binds each Session and exits before inference on invalid Bootstrap', () => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-command-bootstrap-'));
  const module = new URL('../../crates/rovai-core/src/command_code/bootstrap.mjs', import.meta.url).href;
  const binding = (sessionId, bootstrap) => ({ schemaVersion: 1, sessionId, bootstrap,
    sha256: createHash('sha256').update(bootstrap).digest('hex') });
  try {
    mkdirSync(join(root, 'bindings'));
    for (const [id, text] of [['session-A', '甲的 Charter'], ['session-B', '乙的 Charter']]) {
      writeFileSync(join(root, 'bindings', `${id}.json`), JSON.stringify(binding(id, text)));
    }
    for (const [name, value] of [
      ['wrong-id', binding('session-A', 'private')],
      ['wrong-digest', { ...binding('wrong-digest', 'private'), sha256: 'wrong' }],
      ['empty', binding('empty', '')],
      ['oversize', binding('oversize', 'x'.repeat(32769))],
    ]) writeFileSync(join(root, 'bindings', `${name}.json`), JSON.stringify(value));
    const run = (ids, nonce) => {
      rmSync(join(root, 'ready.json'), { force: true });
      return spawnSync(process.execPath, ['--input-type=module', '-e', `
        import load from ${JSON.stringify(module)};
        let hooks;
        load({ hooks(value) { hooks = value; } });
        const replies = ${JSON.stringify(ids)}.map(sessionId => hooks.appendSystemPrompt({state:{sessionId}}));
        console.log(JSON.stringify(replies));
        console.log('MODEL_WOULD_RUN');
      `], { env: { ...process.env, ROVAI_COMMAND_CODE_BOOTSTRAP_ROOT: root,
        ROVAI_COMMAND_CODE_BOOTSTRAP_NONCE: nonce }, encoding: 'utf8' });
    };
    const valid = run(['session-A', 'session-B', 'session-A'], 'nonce-ok');
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout.split('\n')[0]), ['甲的 Charter', '乙的 Charter', '甲的 Charter']);
    assert.equal(JSON.parse(readFileSync(join(root, 'ready.json'), 'utf8')).nonce, 'nonce-ok');
    for (const id of ['missing', '../session-A', 'wrong-id', 'wrong-digest', 'empty', 'oversize']) {
      const invalid = run([id], 'nonce-negative');
      assert.equal(invalid.status, 78, id);
      assert.doesNotMatch(invalid.stdout, /MODEL_WOULD_RUN|private/);
      assert.equal(invalid.stderr, 'command_code_bootstrap_binding_invalid\n');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
