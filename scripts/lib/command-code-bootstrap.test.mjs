import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Command Mod registers before ready and replaces instructions only after valid control input', () => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-command-bootstrap-'));
  const module = new URL('../../crates/rovai-core/src/command_code/bootstrap.mjs', import.meta.url).href;
  try {
    for (const registrationFails of [false, true]) {
      rmSync(join(root, 'ready.json'), { force: true });
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import load from ${JSON.stringify(module)};
        import assert from 'node:assert/strict';
        import { existsSync } from 'node:fs';
        let hooks, command;
        let active = ['read_file', 'ask_user_question', 'shell_command', 'mcp__docs__search'];
        load({
          addCommand(value) {
            if (${registrationFails}) throw new Error('registration failed');
            assert.equal(value.name, 'rovai-bootstrap');
            command = value;
          },
          hooks(value) {
            assert.ok(command);
            assert.equal(existsSync(${JSON.stringify(join(root, 'ready.json'))}), false);
            hooks = value;
          },
          getActiveTools() { return active; }, setActiveTools(value) { active = value; },
        });
        hooks.onSessionStart();
        assert.deepEqual(active, ['read_file', 'shell_command', 'mcp__docs__search']);
        const a = '甲的 Charter', b = '乙的 Charter';
        // A→B→A proves replacement; every update returns no model prompt/message.
        for (const text of [a, b, a, '  中文\\n"quotes" \\\\ = \${literal}  ',
            '😀'.repeat(65536), '"'.repeat(256 * 1024),
            JSON.stringify({ professionalResponsibilities: String.fromCharCode(0).repeat(30000) })]) {
          assert.equal(command.handler({ args: JSON.stringify(text) }), undefined);
          assert.equal(hooks.appendSystemPrompt(), text);
        }
        command.handler({ args: JSON.stringify(a) });
        for (const args of ['PRIVATE_INVALID_JSON', 'null', '42', '{}', '[]',
            JSON.stringify(''), JSON.stringify('  '), JSON.stringify('😀'.repeat(65536) + 'x')]) {
          assert.throws(() => command.handler({ args }), { message: 'command_code_bootstrap_invalid' });
          assert.equal(hooks.appendSystemPrompt(), a);
        }
      `], { env: { ...process.env, ROVAI_COMMAND_CODE_BOOTSTRAP_ROOT: root,
        ROVAI_COMMAND_CODE_BOOTSTRAP_NONCE: 'nonce-ok' }, encoding: 'utf8' });
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_INVALID_JSON|甲的 Charter/);
      if (registrationFails) {
        assert.notEqual(result.status, 0);
        assert.deepEqual(readdirSync(root), []);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.deepEqual(readdirSync(root), ['ready.json']);
        const ready = JSON.parse(readFileSync(join(root, 'ready.json'), 'utf8'));
        assert.equal(ready.revision, 'command-code-system-bootstrap-v2');
        assert.equal(ready.nonce, 'nonce-ok');
        assert.ok(ready.pid > 0);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
