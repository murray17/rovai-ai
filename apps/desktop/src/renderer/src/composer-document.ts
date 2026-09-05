import type {
  ComposerAtom,
  ComposerDocument,
  ComposerSegment,
  StructuredCampMessageContent
} from '@contracts'
import type { ComposerSkillOption } from './composer-skill-picker'

export const COMPOSER_DOCUMENT_VERSION = 2 as const
export const MAX_TYPEAHEAD_QUERY_LENGTH = 128
export const ROVAI_COMPOSER_CLIPBOARD_MIME = 'application/x-rovai-composer+json'

const MAX_COMPOSER_SEGMENTS = 4_096
const MAX_COMPOSER_TEXT_LENGTH = 1_048_576
const MAX_COMPOSER_IDENTITY_LENGTH = 256
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export interface ComposerCatalogMember {
  agentId: string
  displayName: string
  mentionable?: boolean
}

export interface ComposerLocalStatus {
  hasContent: boolean
  hasExplicitRecipient: boolean
  hasUnavailableAtom: boolean
}

export function emptyComposerDocument(): ComposerDocument {
  return { version: COMPOSER_DOCUMENT_VERSION, segments: [] }
}

export function composerDocumentFromText(text: string): ComposerDocument {
  return {
    version: COMPOSER_DOCUMENT_VERSION,
    segments: text ? [{ kind: 'text', text }] : []
  }
}

export function normalizeComposerDocument(document: ComposerDocument): ComposerDocument {
  const segments: ComposerSegment[] = []
  for (const segment of document.segments) {
    if (segment.kind === 'text') {
      if (!segment.text) continue
      const previous = segments.at(-1)
      if (previous?.kind === 'text') previous.text += segment.text
      else segments.push({ kind: 'text', text: segment.text })
      continue
    }
    segments.push({ kind: 'atom', atom: cloneComposerAtom(segment.atom) })
  }
  return { version: COMPOSER_DOCUMENT_VERSION, segments }
}

export function cloneComposerDocument(document: ComposerDocument): ComposerDocument {
  return normalizeComposerDocument({
    version: COMPOSER_DOCUMENT_VERSION,
    segments: document.segments.map((segment) => segment.kind === 'text'
      ? { kind: 'text', text: segment.text }
      : { kind: 'atom', atom: cloneComposerAtom(segment.atom) })
  })
}

function cloneComposerAtom(atom: ComposerAtom): ComposerAtom {
  if (atom.type === 'member') {
    return atom.labelFallback === undefined
      ? { type: 'member', agentId: atom.agentId }
      : { type: 'member', agentId: atom.agentId, labelFallback: atom.labelFallback }
  }
  if (atom.type === 'skill') {
    return { type: 'skill', skillId: atom.skillId, nameAtSend: atom.nameAtSend }
  }
  return { type: 'all_members' }
}

export function composerDocumentsEqualDirect(
  left: ComposerDocument,
  right: ComposerDocument
): boolean {
  if (left.version !== right.version || left.segments.length !== right.segments.length) {
    return false
  }
  for (let index = 0; index < left.segments.length; index += 1) {
    const leftSegment = left.segments[index]
    const rightSegment = right.segments[index]
    if (!leftSegment || !rightSegment || leftSegment.kind !== rightSegment.kind) return false
    if (leftSegment.kind === 'text') {
      if (rightSegment.kind !== 'text' || leftSegment.text !== rightSegment.text) return false
      continue
    }
    if (rightSegment.kind !== 'atom' || !composerAtomsEqual(leftSegment.atom, rightSegment.atom)) {
      return false
    }
  }
  return true
}

function composerAtomsEqual(left: ComposerAtom, right: ComposerAtom): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'all_members') return true
  if (left.type === 'member') {
    return right.type === 'member'
      && left.agentId === right.agentId
      && left.labelFallback === right.labelFallback
  }
  return right.type === 'skill'
    && left.skillId === right.skillId
    && left.nameAtSend === right.nameAtSend
}

export function validateComposerDocument(value: unknown): value is ComposerDocument {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['version', 'segments'])
    || value.version !== COMPOSER_DOCUMENT_VERSION) return false
  if (!Array.isArray(value.segments) || value.segments.length > MAX_COMPOSER_SEGMENTS) return false
  let textLength = 0
  for (const segment of value.segments) {
    if (!isRecord(segment)) return false
    if (segment.kind === 'text') {
      if (!hasOnlyKeys(segment, ['kind', 'text']) || typeof segment.text !== 'string') return false
      textLength += utf8Length(segment.text)
      if (textLength > MAX_COMPOSER_TEXT_LENGTH) return false
      continue
    }
    if (segment.kind !== 'atom'
      || !hasOnlyKeys(segment, ['kind', 'atom'])
      || !validateComposerAtom(segment.atom)) return false
    if (segment.atom.type === 'member' && segment.atom.labelFallback) {
      textLength += utf8Length(segment.atom.labelFallback)
      if (textLength > MAX_COMPOSER_TEXT_LENGTH) return false
    }
  }
  return true
}

export function parseComposerClipboardDocument(value: string): ComposerDocument | null {
  if (!value || value.length > MAX_COMPOSER_TEXT_LENGTH * 2) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return validateComposerDocument(parsed)
      ? normalizeComposerDocument(cloneComposerDocument(parsed))
      : null
  } catch {
    return null
  }
}

function validateComposerAtom(value: unknown): value is ComposerAtom {
  if (!isRecord(value)) return false
  if (value.type === 'all_members') return Object.keys(value).length === 1
  if (value.type === 'member') {
    return hasOnlyKeys(value, ['type', 'agentId', 'labelFallback'])
      && canonicalIdentity(value.agentId)
      && (value.labelFallback === undefined
        || (typeof value.labelFallback === 'string'
          && value.labelFallback.length > 0
          && Array.from(value.labelFallback).length <= 120
          && value.labelFallback.trim() === value.labelFallback
          && !/[\u0000-\u001f\u007f]/u.test(value.labelFallback)))
  }
  if (value.type === 'skill') {
    return hasOnlyKeys(value, ['type', 'skillId', 'nameAtSend'])
      && canonicalIdentity(value.skillId)
      && typeof value.nameAtSend === 'string'
      && value.nameAtSend.length <= 64
      && SKILL_NAME_PATTERN.test(value.nameAtSend)
  }
  return false
}

function canonicalIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && utf8Length(value) <= MAX_COMPOSER_IDENTITY_LENGTH
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length <= allowed.length && keys.every((key) => allowed.includes(key))
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function recoverComposerClipboardDocument(
  document: ComposerDocument,
  members: readonly ComposerCatalogMember[],
  skills: readonly ComposerSkillOption[]
): ComposerDocument {
  const availableMembers = new Set(
    members.filter((member) => member.mentionable !== false).map((member) => member.agentId)
  )
  const availableSkills = new Set(skills.map((skill) => skill.id))
  const segments: ComposerSegment[] = []
  for (const segment of document.segments) {
    if (segment.kind === 'text') {
      segments.push({ kind: 'text', text: segment.text })
      continue
    }
    const atom = segment.atom
    if (atom.type === 'member' && !availableMembers.has(atom.agentId)) {
      segments.push({ kind: 'text', text: memberAtomPlainText(atom, null) })
      continue
    }
    if (atom.type === 'skill' && !availableSkills.has(atom.skillId)) {
      segments.push({ kind: 'text', text: `/${atom.nameAtSend}` })
      continue
    }
    segments.push({ kind: 'atom', atom: cloneComposerAtom(atom) })
  }
  return normalizeComposerDocument({ version: COMPOSER_DOCUMENT_VERSION, segments })
}

export function composerDocumentToPlainText(
  document: ComposerDocument,
  members: readonly ComposerCatalogMember[] = []
): string {
  const memberNames = new Map(members.map((member) => [member.agentId, member.displayName]))
  return document.segments.map((segment) => {
    if (segment.kind === 'text') return segment.text
    const atom = segment.atom
    if (atom.type === 'member') return memberAtomPlainText(atom, memberNames.get(atom.agentId) ?? null)
    if (atom.type === 'all_members') return '@所有队员'
    return `/${atom.nameAtSend}`
  }).join('')
}

function memberAtomPlainText(
  atom: Extract<ComposerAtom, { type: 'member' }>,
  currentName: string | null
): string {
  const label = currentName ?? atom.labelFallback ?? '不可用队员'
  return label.startsWith('@') ? label : `@${label}`
}

export function composerDocumentStatus(
  document: ComposerDocument,
  members: readonly ComposerCatalogMember[],
  skills: readonly ComposerSkillOption[]
): ComposerLocalStatus {
  const memberById = new Map(members.map((member) => [member.agentId, member]))
  const skillIds = new Set(skills.map((skill) => skill.id))
  let hasContent = false
  let hasExplicitRecipient = false
  let hasUnavailableAtom = false
  for (const segment of document.segments) {
    if (segment.kind === 'text') {
      if (segment.text.trim().length > 0) hasContent = true
      continue
    }
    hasContent = true
    const atom = segment.atom
    if (atom.type === 'all_members') {
      hasExplicitRecipient = true
      continue
    }
    if (atom.type === 'member') {
      hasExplicitRecipient = true
      if (memberById.get(atom.agentId)?.mentionable === false || !memberById.has(atom.agentId)) {
        hasUnavailableAtom = true
      }
      continue
    }
    if (!skillIds.has(atom.skillId)) hasUnavailableAtom = true
  }
  return { hasContent, hasExplicitRecipient, hasUnavailableAtom }
}

export function composerDocumentFromLegacyContent(
  content: StructuredCampMessageContent
): ComposerDocument {
  const segments: ComposerSegment[] = []
  for (const segment of content) {
    if (segment.kind === 'text') segments.push({ kind: 'text', text: segment.text })
    else if (segment.kind === 'member_mention') {
      segments.push({ kind: 'atom', atom: { type: 'member', agentId: segment.agentId } })
    } else if (segment.kind === 'all_members_mention') {
      segments.push({ kind: 'atom', atom: { type: 'all_members' } })
    } else if (segment.kind === 'skill_mention') {
      segments.push({
        kind: 'atom',
        atom: { type: 'skill', skillId: segment.skillId, nameAtSend: segment.nameAtSend }
      })
    } else {
      throw new Error(`Composer V2 cannot migrate the ${segment.kind} message segment`)
    }
  }
  return normalizeComposerDocument({ version: COMPOSER_DOCUMENT_VERSION, segments })
}

export function composerDocumentToStructuredContent(
  document: ComposerDocument
): StructuredCampMessageContent {
  return normalizeComposerDocument(document).segments.map((segment) => {
    if (segment.kind === 'text') return { kind: 'text', text: segment.text }
    const atom = segment.atom
    if (atom.type === 'member') {
      return { kind: 'member_mention', agentId: atom.agentId }
    }
    if (atom.type === 'all_members') return { kind: 'all_members_mention' }
    return {
      kind: 'skill_mention',
      skillId: atom.skillId,
      nameAtSend: atom.nameAtSend
    }
  })
}
