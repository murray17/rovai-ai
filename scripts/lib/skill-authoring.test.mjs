import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateSkillDirectory } from './skill-authoring.mjs'

async function writeFixture(root, {
  name = 'example-skill',
  description = 'Use when the user needs an example workflow. Ordinary unrelated tasks do not use it.',
  body = 'Read [guide](references/guide.md).',
  shortDescription = 'Guide an example workflow with clear boundaries',
} = {}) {
  const directory = join(root, 'example-skill')
  await mkdir(join(directory, 'agents'), { recursive: true })
  await mkdir(join(directory, 'references'), { recursive: true })
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  )
  await writeFile(join(directory, 'references', 'guide.md'), '# Guide\n')
  await writeFile(
    join(directory, 'agents', 'openai.yaml'),
    [
      'interface:',
      '  display_name: "Example Skill"',
      `  short_description: "${shortDescription}"`,
      '  default_prompt: "Use $example-skill for this example workflow."',
      '',
    ].join('\n'),
  )
  return directory
}

test('Skill authoring validation accepts a complete self-contained bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-skill-authoring-'))
  try {
    const directory = await writeFixture(root)
    assert.deepEqual(await validateSkillDirectory(directory), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Skill authoring validation reports routing, metadata, and link failures together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-skill-authoring-'))
  try {
    const directory = await writeFixture(root, {
      name: 'wrong-name',
      description: 'Use when gather_completed resumes this workflow, then run rovai send.',
      body: 'Read [missing guide](references/missing.md).',
      shortDescription: 'Too short',
    })
    const errors = await validateSkillDirectory(directory)
    assert(errors.some((error) => error.includes('name must match directory')))
    assert(errors.some((error) => error.includes('internal token gather_completed')))
    assert(errors.some((error) => error.includes('command syntax rovai send')))
    assert(errors.some((error) => error.includes('short_description must be 25–64')))
    assert(errors.some((error) => error.includes('relative link target does not exist')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Skill authoring validation ignores example links inside code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-skill-authoring-'))
  try {
    const directory = await writeFixture(root, {
      body: [
        'Read [guide](references/guide.md).',
        '',
        'Inline example: `[missing](references/inline-example.md)`.',
        '',
        '```markdown',
        '[missing](references/fenced-example.md)',
        '```',
      ].join('\n'),
    })
    assert.deepEqual(await validateSkillDirectory(directory), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
