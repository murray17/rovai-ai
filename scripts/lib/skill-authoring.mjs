import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import YAML from 'yaml'

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INTERNAL_ROUTING_TOKEN_PATTERN =
  /\b(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z][A-Za-z0-9]*(?:Id|Generation|Disposition)|effectiveRecipients)\b/
const DESCRIPTION_COMMAND_PATTERN =
  /(?:^|[\s`])(?:rovai\s+[a-z][a-z-]*(?:\s+[a-z][a-z-]*)?|--[a-z][a-z-]*)/

function add(errors, file, message) {
  errors.push(`${file}: ${message}`)
}

function parseFrontMatter(text, file, errors) {
  if (!text.startsWith('---\n')) {
    add(errors, file, 'must start with YAML frontmatter')
    return null
  }
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) {
    add(errors, file, 'frontmatter must end with a standalone --- line')
    return null
  }
  try {
    const value = YAML.parse(text.slice(4, end), { uniqueKeys: true })
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      add(errors, file, 'frontmatter must be a mapping')
      return null
    }
    return value
  } catch (error) {
    add(errors, file, `invalid YAML frontmatter: ${error.message}`)
    return null
  }
}

function validateDescription(description, file, errors) {
  if (typeof description !== 'string' || description.trim() !== description) {
    add(errors, file, 'description must be a trimmed string')
    return
  }
  const length = [...description].length
  if (length < 20 || length > 1000 || description.includes('\n')) {
    add(errors, file, 'description must be one line and 20–1000 characters')
  }
  const internal = description.match(INTERNAL_ROUTING_TOKEN_PATTERN)?.[0]
  if (internal) {
    add(errors, file, `description must not route on internal token ${internal}`)
  }
  const command = description.match(DESCRIPTION_COMMAND_PATTERN)?.[0]?.trim()
  if (command) {
    add(errors, file, `description must not contain command syntax ${command}`)
  }
}

function markdownTargets(text) {
  const targets = []
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim()
    if (target.startsWith('<')) {
      const closing = target.indexOf('>')
      if (closing >= 0) target = target.slice(1, closing)
    } else {
      target = target.split(/\s+["']/u, 1)[0]
    }
    targets.push(target)
  }
  return targets
}

async function collectMarkdownFiles(skillDirectory, errors) {
  const markdown = []
  const pending = [skillDirectory]
  while (pending.length > 0) {
    const directory = pending.pop()
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        add(errors, path, 'Skill bundles must not contain symbolic links')
      } else if (entry.isDirectory()) {
        pending.push(path)
      } else if (entry.isFile()) {
        if (extname(entry.name).toLowerCase() === '.md') markdown.push(path)
      } else {
        add(errors, path, 'Skill bundles may contain only directories and regular files')
      }
    }
  }
  return markdown
}

async function validateMarkdownLinks(skillDirectory, markdownFiles, errors) {
  for (const file of markdownFiles) {
    const text = await readFile(file, 'utf8')
    for (const rawTarget of markdownTargets(text)) {
      const [pathPart] = rawTarget.split('#', 1)
      if (
        !pathPart ||
        pathPart.startsWith('/') ||
        /^[a-z][a-z0-9+.-]*:/i.test(pathPart)
      ) {
        continue
      }
      let decoded
      try {
        decoded = decodeURIComponent(pathPart)
      } catch {
        add(errors, file, `contains an invalid encoded link target: ${rawTarget}`)
        continue
      }
      const target = resolve(dirname(file), decoded)
      const boundary = relative(skillDirectory, target)
      if (boundary === '..' || boundary.startsWith(`..${sep}`)) {
        add(errors, file, `relative link escapes the Skill bundle: ${rawTarget}`)
        continue
      }
      try {
        const metadata = await lstat(target)
        if (!metadata.isFile() && !metadata.isDirectory()) {
          add(errors, file, `relative link is not a regular file or directory: ${rawTarget}`)
        }
      } catch {
        add(errors, file, `relative link target does not exist: ${rawTarget}`)
      }
    }
  }
}

async function validateOpenAiMetadata(skillDirectory, name, errors) {
  const file = join(skillDirectory, 'agents', 'openai.yaml')
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    add(errors, file, 'is required')
    return
  }
  let parsed
  try {
    parsed = YAML.parse(text, { uniqueKeys: true })
  } catch (error) {
    add(errors, file, `invalid YAML: ${error.message}`)
    return
  }
  const values = parsed?.interface
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    add(errors, file, 'must contain an interface mapping')
    return
  }
  for (const key of ['display_name', 'short_description', 'default_prompt']) {
    if (typeof values[key] !== 'string' || !values[key].trim()) {
      add(errors, file, `interface.${key} must be a non-empty string`)
    }
  }
  if (typeof values.short_description === 'string') {
    const length = [...values.short_description].length
    if (length < 25 || length > 64) {
      add(errors, file, 'interface.short_description must be 25–64 characters')
    }
    const internal = values.short_description.match(INTERNAL_ROUTING_TOKEN_PATTERN)?.[0]
    if (internal) {
      add(errors, file, `short_description must not expose internal token ${internal}`)
    }
  }
  if (
    typeof values.default_prompt === 'string' &&
    !values.default_prompt.includes(`$${name}`)
  ) {
    add(errors, file, `interface.default_prompt must invoke $${name}`)
  }
}

export async function validateSkillDirectory(skillDirectory) {
  const directory = resolve(skillDirectory)
  const errors = []
  const skillFile = join(directory, 'SKILL.md')
  let text
  try {
    text = await readFile(skillFile, 'utf8')
  } catch {
    add(errors, skillFile, 'is required')
    return errors
  }
  const frontMatter = parseFrontMatter(text, skillFile, errors)
  const directoryName = basename(directory)
  if (!SKILL_NAME_PATTERN.test(directoryName)) {
    add(errors, directory, 'directory name must use lowercase hyphen-case')
  }
  if (frontMatter) {
    const keys = Object.keys(frontMatter).sort()
    if (JSON.stringify(keys) !== JSON.stringify(['description', 'name'])) {
      add(errors, skillFile, 'frontmatter may contain only name and description')
    }
    if (frontMatter.name !== directoryName) {
      add(errors, skillFile, `name must match directory ${directoryName}`)
    }
    if (typeof frontMatter.name !== 'string' || !SKILL_NAME_PATTERN.test(frontMatter.name)) {
      add(errors, skillFile, 'name must use lowercase hyphen-case')
    }
    validateDescription(frontMatter.description, skillFile, errors)
    await validateOpenAiMetadata(directory, frontMatter.name, errors)
  }
  const markdownFiles = await collectMarkdownFiles(directory, errors)
  await validateMarkdownLinks(directory, markdownFiles, errors)
  return errors.sort()
}

export async function discoverSkillDirectories(root) {
  const directory = resolve(root)
  try {
    const directSkill = await lstat(join(directory, 'SKILL.md'))
    if (directSkill.isFile()) return [directory]
  } catch {
    // Treat the argument as a collection root.
  }
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .sort()
}
