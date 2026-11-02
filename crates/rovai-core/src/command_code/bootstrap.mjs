// Loaded through Command Code's official --mod, before ACP initialize.
// The existing Native Binding owns this Host. Core updates its instructions
// through the official command dispatcher before sending each Run's input.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.ROVAI_COMMAND_CODE_BOOTSTRAP_ROOT;
const revision = 'command-code-system-bootstrap-v2';

export default function (cmd) {
  const nonce = process.env.ROVAI_COMMAND_CODE_BOOTSTRAP_NONCE;
  if (!root || !nonce) throw new Error('command_code_bootstrap_environment_missing');
  let bootstrap = '';
  cmd.addCommand({
    name: 'rovai-bootstrap',
    description: 'Set instructions for the next Rovai Run.',
    handler({ args }) {
      let next;
      try {
        next = JSON.parse(args);
        if (typeof next !== 'string' || !next.trim() || Buffer.byteLength(next) > 256 * 1024) throw new Error();
      } catch {
        throw new Error('command_code_bootstrap_invalid');
      }
      bootstrap = next;
    },
  });
  cmd.hooks({
    onSessionStart() {
      cmd.setActiveTools(cmd.getActiveTools().filter(name => name !== 'ask_user_question'));
    },
    appendSystemPrompt() { return bootstrap; },
  });
  // Last statement: proves that registration completed in this native process.
  writeFileSync(join(root, 'ready.json'), JSON.stringify({ revision, nonce, pid: process.pid }), { mode: 0o600, flag: 'wx' });
}
