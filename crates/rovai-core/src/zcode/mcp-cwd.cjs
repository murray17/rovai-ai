// Fixed argv-only launcher for native MCP definitions with their own cwd.
// The official Host's Windows Job owns this process and its server descendants.
const { spawn } = require('node:child_process')
const [, cwd, command, ...args] = process.argv
if (!cwd || !command) process.exit(64)
const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false })
child.once('error', () => { process.exitCode = 1 })
child.once('exit', (code) => { process.exitCode = code ?? 1 })
