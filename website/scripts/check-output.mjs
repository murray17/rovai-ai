import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'site', '.vitepress', 'dist')
const htmlFiles = []
const problems = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.html')) htmlFiles.push(path)
  }
}

walk(dist)
const pageCount = htmlFiles.filter(path => !path.includes('/examples/') && !path.endsWith('/404.html')).length
if (pageCount !== 78) problems.push(`Expected 78 published pages, found ${pageCount}`)

for (const path of htmlFiles) {
  const route = '/' + relative(dist, path).replaceAll('\\', '/')
  const html = readFileSync(path, 'utf8')
  const doc = new JSDOM(html).window.document
  if (doc.querySelector('meta[name="robots"][content*="noindex"]')) problems.push(`${route}: noindex is set`)
  if (html.includes('/Users/murray.xue/')) problems.push(`${route}: local filesystem path is present`)

  for (const element of doc.querySelectorAll('[href], [src], [data-image]')) {
    for (const name of ['href', 'src', 'data-image']) {
      const value = element.getAttribute(name)
      if (!value || value.startsWith('data:') || value.startsWith('mailto:')) continue
      const url = new URL(value, `https://rovai.dev${route}`)
      if (url.origin !== 'https://rovai.dev') continue
      const target = resolve(dist, '.' + url.pathname, url.pathname.endsWith('/') ? 'index.html' : '')
      if (!target.startsWith(dist + '/') && target !== dist) {
        problems.push(`${route}: link escapes the site: ${value}`)
      } else if (!existsSync(target)) {
        problems.push(`${route}: missing ${name} target ${value}`)
      } else if (url.hash && target.endsWith('.html') && !url.pathname.includes('/examples/')) {
        const targetDoc = target === path ? doc : new JSDOM(readFileSync(target, 'utf8')).window.document
        if (!targetDoc.getElementById(decodeURIComponent(url.hash.slice(1)))) problems.push(`${route}: missing anchor ${value}`)
      }
    }
  }
}

for (const lang of ['', '/zh']) {
  const home = new JSDOM(readFileSync(join(dist, lang, 'index.html'), 'utf8')).window.document
  const download = readFileSync(join(dist, lang, 'download', 'index.html'), 'utf8')
  if (!home.querySelector('.hero-figure img')) problems.push(`${lang || '/'}: hero product image is missing`)
  for (const asset of ['Rovai-AI-0.4.6-arm64.dmg', 'Rovai-AI-0.4.6-x64.dmg', 'Rovai-AI-0.4.6-x64.exe']) {
    if (!download.includes(`/releases/download/v0.4.6/${asset}`)) problems.push(`${lang}/download: missing ${asset}`)
  }
  for (const target of ['linux-x64.tar.gz','macos-arm64.tar.gz','macos-x64.tar.gz','windows-x64.zip']) {
    if (!download.includes(`/releases/download/v0.4.6/rovai-server-0.4.6-${target}`)) problems.push(`${lang}/download: missing Server asset ${target}`)
  }
  for (const topic of ['remote','desktop-web','server-install','lan-access','tailscale','public-https','server-maintenance']) {
    const article = new JSDOM(readFileSync(join(dist, lang, 'docs', topic + '.html'), 'utf8')).window.document
    const counterpart = `${lang ? '' : '/zh'}/docs/${topic}.html`
    if (article.querySelector('.language-link')?.getAttribute('href') !== counterpart) problems.push(`${lang}/docs/${topic}: locale counterpart missing`)
  }
  const install = new JSDOM(readFileSync(join(dist, lang, 'docs', 'server-install.html'), 'utf8')).window.document
  const commands = [...install.querySelectorAll('.doc-code pre')].map(pre => pre.textContent)
  if (!commands[0]?.includes(' -o install-server.sh\nsh install-server.sh --version 0.4.6')) {
    problems.push(`${lang}/docs/server-install: Unix installer commands lost their line break`)
  }
  if (!commands[1]?.includes('-OutFile install-server.ps1\n.\\install-server.ps1 -Version 0.4.6')) {
    problems.push(`${lang}/docs/server-install: PowerShell installer commands lost their line break`)
  }
  if (!commands[2]?.includes(' \\\n  --data-dir')) {
    problems.push(`${lang}/docs/server-install: shell continuation lost its line break`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Checked ${pageCount} website pages, internal links, assets, anchors, Desktop 0.4.6 / Server 0.4.6 downloads, and deployment locale routes.`)
}
