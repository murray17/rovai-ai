import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import english from './locales/en.json'
import { CAMP_WORLD_MAP_AMBIENT_BEATS } from './camp-world-map-ambient-copy'
import { agentRunPresentation, agentRunWaitDetail } from '../../shared/execution-presentation'
import { translateUi } from './interface-language'

const rendererDirectory = fileURLToPath(new URL('.', import.meta.url))
const han = /[\u3400-\u9fff]/u

function catalogKeysUsedByRenderer(): Set<string> {
  const keys = new Set<string>()
  for (const file of readdirSync(rendererDirectory).filter((name) => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name))) {
    const path = join(rendererDirectory, file)
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && ['t', 'uiAttribute', 'translateUi', 'localizedChannelCopy'].includes(node.expression.text)) {
        const phrase = node.arguments[0]
        if (phrase && ts.isStringLiteralLike(phrase) && han.test(phrase.text)) keys.add(phrase.text.trim())
      }
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
        && node.tagName.getText(source) === 'UiText') {
        const attribute = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(source) === 'zh')
        if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          const phrase = attribute.initializer.expression
          if (phrase && ts.isStringLiteralLike(phrase) && han.test(phrase.text)) keys.add(phrase.text.trim())
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  for (const beat of CAMP_WORLD_MAP_AMBIENT_BEATS) keys.add(beat.text)
  return keys
}

describe('English interface catalog', () => {
  it('covers every static Renderer phrase and preserves interpolation fields', () => {
    const entries: Record<string, string> = english
    const missing = [...catalogKeysUsedByRenderer()].filter((key) => !Object.hasOwn(entries, key))
    const malformed = Object.entries(entries).filter(([source, target]) => {
      const placeholders = (value: string): string[] => [...value.matchAll(/\{\d+\}/g)].map(([match]) => match).sort()
      return han.test(target) || placeholders(source).join('|') !== placeholders(target).join('|')
    }).map(([source]) => source)
    expect(missing).toEqual([])
    expect(malformed).toEqual([])
  })

  it('covers shared Run states and wait explanations shown by the Thread Renderer', () => {
    const run = (status: Parameters<typeof agentRunPresentation>[0]['status'], waitReason: string | null = null) =>
      ({ status, waitReason })
    const cases: Array<Parameters<typeof agentRunPresentation>[0]> = [
      run('queued'), run('running'), run('succeeded'), run('failed'), run('cancelled'),
      { ...run('failed'), terminalReasonCode: 'runtime_interrupted' },
      { ...run('cancelled'), terminalReasonCode: 'planned_shutdown_cancelled' },
      {
        ...run('running'),
        failure: {
          runtimeKind: 'codex-cli', origin: 'runtime', phase: 'execution',
          code: 'runtime_network_interrupted', summary: 'Connection lost',
          detail: null, retryable: true
        }
      },
      ...[
        'delivery_unknown', 'runtime_recovery', 'network_recovery',
        'network_recovery_blocked', 'recovery_blocked', 'approval', 'user_input',
        'unknown_reason'
      ].map((reason) => run('waiting', reason))
    ]
    const phrases = [
      ...cases.map((entry) => agentRunPresentation(entry).label),
      agentRunPresentation(run('running'), true).label,
      ...cases.flatMap((entry) => agentRunWaitDetail(entry.waitReason) ?? [])
    ]
    expect(phrases.filter((phrase) => !Object.hasOwn(english, phrase))).toEqual([])
    expect(phrases.filter((phrase) => han.test(translateUi('en', phrase)))).toEqual([])
  })
})
