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
if (pageCount !== 66) problems.push(`Expected 66 published pages, found ${pageCount}`)

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
  for (const asset of ['Rovai-AI-0.4.1-arm64.dmg', 'Rovai-AI-0.4.1-x64.dmg', 'Rovai-AI-0.4.1-x64.exe']) {
    if (!download.includes(`/releases/download/v0.4.1/${asset}`)) problems.push(`${lang}/download: missing ${asset}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Checked ${pageCount} website pages, internal links, assets, anchors, and v0.4.1 downloads.`)
}
