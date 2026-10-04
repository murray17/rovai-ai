import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { validateBilingualReleaseNotesSource } from './release-notes-localization.mjs'
import { assertUpdateInfoReleaseNotes } from './release-notes.mjs'

const VERSION = '0.0.3'
const NOTES = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\n## What’s new\n\nEnglish\n\n<!-- lang:zh-CN -->\n\n## 更新内容\n\n中文\n'

test('仓库发布源具有中英文正文，校验不改写源或更新清单', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const source = await readFile(resolve(root, 'build/release-notes.md'), 'utf8')
  assert.equal(validateBilingualReleaseNotesSource(source, version), source)
  assert.equal(validateBilingualReleaseNotesSource(NOTES, VERSION), NOTES)
  assert.doesNotThrow(() => assertUpdateInfoReleaseNotes({
    updateInfo: { releaseNotes: NOTES }, releaseNotes: NOTES, version: VERSION, manifestName: 'latest.yml'
  }))
})

test('新发布拒绝缺失、空白或仅注释的语言正文', () => {
  for (const source of [
    '# Rovai AI v0.0.3\n\nHistorical single-language notes',
    '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nEnglish',
    NOTES.replace('## 更新内容\n\n中文\n', '  \n'),
    NOTES.replace('## 更新内容\n\n中文\n', '<!-- Coming soon -->\n'),
    NOTES.replace('## 更新内容\n\n中文\n', '[docs]: https://example.com\n'),
    NOTES.replace('## 更新内容\n\n中文\n', '> <!-- Coming soon -->\n'),
    NOTES.replace('## 更新内容\n\n中文\n', '> [docs]: https://example.com\n'),
    NOTES.replace('## 更新内容\n\n中文\n', '- <!-- Coming soon -->\n'),
    NOTES.replace('## 更新内容\n\n中文\n', '[^details]: Hidden footnote\n'),
    NOTES.replace('## 更新内容\n\n中文\n', '![Hidden image](https://example.com/image.png)\n')
  ]) assert.throws(() => validateBilingualReleaseNotesSource(source, VERSION), /language markers|non-empty/)
})

test('新发布拒绝仅含跨语言引用图片的正文，保留可见引用链接', () => {
  const source = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nEnglish\n\n[img]: https://example.com/image.png\n\n<!-- lang:zh-CN -->\n\n![Hidden image][img]'
  assert.throws(() => validateBilingualReleaseNotesSource(source, VERSION), /non-empty zh-cn/)
  const linked = source.replace('![Hidden image][img]', '[中文说明][img]')
  assert.equal(validateBilingualReleaseNotesSource(linked, VERSION), linked)
})

test('新发布拒绝重复、畸形及代码示例中的伪语言段', () => {
  for (const source of [
    `${NOTES}\n<!-- lang:EN -->\n\nDuplicate`,
    NOTES.replace('lang:zh-CN', 'lang:zh_CN'),
    '# Rovai AI v0.0.3\n\n```md\n<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh-CN -->\n\n中文\n```'
  ]) assert.throws(() => validateBilingualReleaseNotesSource(source, VERSION), /language markers/)
})

test('双语门禁仍拒绝版本漂移，并使用原有文档长度上限', () => {
  assert.throws(() => validateBilingualReleaseNotesSource(NOTES, '0.0.4'), /must begin/)
  assert.throws(() => validateBilingualReleaseNotesSource(`${NOTES}${'x'.repeat(100_000)}`, VERSION), /exceeds/)
})

test('新发布拒绝中英文段之间混入的行内语言标记', () => {
  for (const mixed of [
    '说明文字 <!-- lang:fr -->\nContenu français.',
    '说明文字 <!-- lang:zh_CN -->',
    '# 说明文字 <!-- lang:fr -->',
    '**说明文字 <!-- lang:fr -->**',
    '| 内容 |\n| --- |\n| 说明文字 <!-- lang:fr --> |'
  ]) {
    const source = NOTES.replace('English\n', `English\n\n${mixed}\n`)
    assert.throws(() => validateBilingualReleaseNotesSource(source, VERSION), /language markers/)
  }
})
