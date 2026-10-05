// Loaded through Command Code's official mods.paths, before ACP initialize.
// Every hook resolves its own immutable Session binding, never an active global
// Session pointer. A broken binding must stop the process: the native Mod host
// catches ordinary exceptions and would otherwise continue without Bootstrap.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.ROVAI_COMMAND_CODE_BOOTSTRAP_ROOT;
const nonce = process.env.ROVAI_COMMAND_CODE_BOOTSTRAP_NONCE;
const revision = 'command-code-system-bootstrap-v1';
const hash = value => createHash('sha256').update(value).digest('hex');

export default function (cmd) {
  if (!root || !nonce) throw new Error('command_code_bootstrap_environment_missing');
  cmd.hooks({
    appendSystemPrompt({ state }) {
      try {
        const sessionId = state?.sessionId;
        if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) throw new Error();
        const raw = readFileSync(join(root, 'bindings', `${sessionId}.json`));
        if (raw.length > 64 * 1024) throw new Error();
        const binding = JSON.parse(raw);
        if (binding.schemaVersion !== 1 || binding.sessionId !== sessionId ||
            typeof binding.bootstrap !== 'string' || !binding.bootstrap.trim() ||
            Buffer.byteLength(binding.bootstrap) > 32 * 1024 ||
            hash(binding.bootstrap) !== binding.sha256) throw new Error();
        return binding.bootstrap;
      } catch {
        process.stderr.write('command_code_bootstrap_binding_invalid\n');
        process.exit(78);
      }
    },
  });
  // Last statement: proves that registration completed in this native process.
  writeFileSync(join(root, 'ready.json'), JSON.stringify({ revision, nonce, pid: process.pid }), { mode: 0o600, flag: 'wx' });
}
