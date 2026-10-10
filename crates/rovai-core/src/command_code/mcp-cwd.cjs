// Command Code's native MCP schema has no cwd field. Keep arguments literal.
const { spawn } = require('node:child_process')
const [, cwd, command, ...args] = process.argv
if (!cwd || !command) process.exit(64)
const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false })
child.once('error', () => { process.exitCode = 1 })
child.once('exit', (code) => { process.exitCode = code ?? 1 })
