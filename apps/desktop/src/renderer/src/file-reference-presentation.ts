import { parseFileReference } from '../../file-preview-reference'

export type ResourceReferenceVisualKind =
  | 'web'
  | 'markdown'
  | 'html'
  | 'code'
  | 'config'
  | 'text'
  | 'image'
  | 'svg'
  | 'patch'
  | 'folder'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'notebook'
  | 'archive'
  | 'audio'
  | 'video'
  | 'database'
  | 'executable'
  | 'file'

const EXTENSION_KINDS: Readonly<Record<string, ResourceReferenceVisualKind>> = {
  md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown', mdx: 'markdown',
  html: 'html', htm: 'html',
  ts: 'code', tsx: 'code', mts: 'code', cts: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code',
  py: 'code', pyw: 'code', pyi: 'code', rb: 'code', rake: 'code', php: 'code', lua: 'code', rs: 'code',
  go: 'code', java: 'code', kt: 'code', kts: 'code', swift: 'code', dart: 'code', c: 'code', h: 'code',
  cc: 'code', cpp: 'code', cxx: 'code', hh: 'code', hpp: 'code', hxx: 'code', cs: 'code', m: 'code', mm: 'code',
  sh: 'code', bash: 'code', zsh: 'code', fish: 'code', ps1: 'code', psm1: 'code', bat: 'code', cmd: 'code',
  css: 'code', scss: 'code', sass: 'code', less: 'code', vue: 'code', svelte: 'code', hbs: 'code',
  handlebars: 'code', pug: 'code', sql: 'code', pgsql: 'code', graphql: 'code', gql: 'code', cypher: 'code',
  tf: 'code', tfvars: 'code', hcl: 'code', proto: 'code',
  json: 'config', jsonc: 'config', json5: 'config', yaml: 'config', yml: 'config', toml: 'config', env: 'config',
  ini: 'config', cfg: 'config', conf: 'config', properties: 'config', xml: 'config', xsd: 'config', xsl: 'config',
  plist: 'config',
  txt: 'text', log: 'text', csv: 'text', tsv: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image',
  ico: 'image', tif: 'image', tiff: 'image', heic: 'image',
  svg: 'svg',
  diff: 'patch', patch: 'patch',
  pdf: 'pdf',
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation',
  ipynb: 'notebook',
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive', '7z': 'archive', rar: 'archive',
  mp3: 'audio', m4a: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', opus: 'audio',
  mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video', m4v: 'video',
  sqlite: 'database', sqlite3: 'database', db: 'database',
  app: 'executable', dmg: 'executable', pkg: 'executable', exe: 'executable', msi: 'executable', deb: 'executable',
  rpm: 'executable', apk: 'executable'
}

const CONFIG_FILE_NAMES = new Set([
  '.editorconfig', '.env', '.gitattributes', '.gitignore', '.npmrc', '.prettierrc',
  'dockerfile', 'makefile'
])

function fallbackPath(target: string): string {
  return target
    .replace(/[?#].*$/u, '')
    .replace(/:(?:[1-9]\d*)(?::[1-9]\d*|-[1-9]\d*)?$/u, '')
}

export function resourceReferenceVisualKind(target: string): ResourceReferenceVisualKind {
  const trimmed = target.trim()
  if (/^https:\/\//iu.test(trimmed)) return 'web'

  const path = parseFileReference(trimmed)?.pathPart ?? fallbackPath(trimmed)
  if (/[\\/]$/u.test(path)) return 'folder'

  const fileName = path.replace(/\\/gu, '/').split('/').at(-1)?.toLowerCase() ?? ''
  if (CONFIG_FILE_NAMES.has(fileName) || fileName.startsWith('.env.')) return 'config'
  const extension = fileName.includes('.') ? fileName.split('.').at(-1) ?? '' : ''
  return EXTENSION_KINDS[extension] ?? 'file'
}
