import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function projectReviewFiles({
  projectPath,
  projectionId,
  machineFileName,
  machineValue,
  markdown,
  sourceRaw = null
}) {
  await mkdir(projectPath, { recursive: true, mode: 0o755 })
  await preserveExistingProjection(projectPath, machineFileName)
  const reportDirectory = join(projectPath, 'reports', safePathSegment(projectionId))
  await mkdir(reportDirectory, { recursive: true, mode: 0o755 })
  const raw = sourceRaw ?? `${JSON.stringify(machineValue, null, 2)}\n`
  await writeFile(join(projectPath, machineFileName), raw, { mode: 0o644 })
  await writeFile(join(projectPath, 'README.md'), markdown, { mode: 0o644 })
  await writeFile(join(reportDirectory, machineFileName), raw, { mode: 0o644 })
  await writeFile(join(reportDirectory, 'README.md'), markdown, { mode: 0o644 })
  return reportDirectory
}

async function preserveExistingProjection(projectPath, machineFileName) {
  let raw
  try {
    raw = await readFile(join(projectPath, machineFileName), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const existing = JSON.parse(raw)
  const id = existing.runId ?? existing.benchmarkId
  if (typeof id !== 'string' || id === '') return
  const archive = join(projectPath, 'reports', safePathSegment(id))
  await mkdir(archive, { recursive: true, mode: 0o755 })
  await writeFile(join(archive, machineFileName), raw, { mode: 0o644 })
  try {
    const markdown = await readFile(join(projectPath, 'README.md'), 'utf8')
    await writeFile(join(archive, 'README.md'), markdown, { mode: 0o644 })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function safePathSegment(value) {
  if (!/^[a-zA-Z0-9._-]+$/u.test(value)) throw new Error('benchmark ID is unsafe for a report directory')
  return value
}
