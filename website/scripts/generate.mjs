import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'scripts', 'source')
const site = join(root, 'site')
const origin = 'https://rovai.dev'
const scripts = Object.fromEntries(await Promise.all(
  ['docs-content.js', 'docs-details.js', 'docs-tutorials.js', 'site.js'].map(async name =>
    [name, await readFile(join(source, name), 'utf8')]
  )
))

function makeWindow(page, lang, topic = '') {
  const prefix = lang === 'zh' ? '/zh' : ''
  const url = `${origin}${prefix}/${page === 'home' ? '' : `${page}/index.html`}${topic ? `#${topic}` : ''}`
  const dom = new JSDOM(`<!doctype html><html lang="${lang === 'zh' ? 'zh-CN' : 'en-US'}"><body data-page="${page}" data-lang="${lang}"><div id="app"></div></body></html>`, {
    url,
    runScripts: 'outside-only'
  })
  dom.window.scrollTo = () => {}
  Object.defineProperty(dom.window.document, 'currentScript', {
    configurable: true,
    get: () => ({ src: `${origin}/assets/site.js` })
  })
  for (const name of ['docs-content.js', 'docs-details.js', 'docs-tutorials.js']) {
    dom.window.eval(scripts[name])
  }
  dom.window.eval(scripts['site.js'])
  return dom
}

function rewriteLinks(dom, lang, page) {
  const doc = dom.window.document
  const prefix = lang === 'zh' ? '/zh' : ''
  const topicIds = new Set(Object.keys(dom.window.RovaiDocs?.topics || {}))
  for (const link of doc.querySelectorAll('a[href]')) {
    const original = link.getAttribute('href')
    if (original.startsWith('#')) {
      if (page === 'docs' && topicIds.has(original.slice(1))) {
        link.setAttribute('href', `${prefix}/docs/${original.slice(1)}.html`)
      }
      continue
    }
    const url = new URL(original, dom.window.location.href)
    if (url.origin !== origin) continue
    const article = url.pathname.match(/^(\/zh)?\/docs\/index\.html$/)
    if (article && url.hash && topicIds.has(url.hash.slice(1))) {
      link.setAttribute('href', `${article[1] || ''}/docs/${url.hash.slice(1)}.html`)
    } else if (url.pathname.endsWith('/index.html')) {
      link.setAttribute('href', url.pathname.slice(0, -'index.html'.length) + url.hash)
    } else {
      link.setAttribute('href', url.pathname + url.hash)
    }
  }
  for (const image of doc.querySelectorAll('[src]')) {
    const src = new URL(image.getAttribute('src'), dom.window.location.href)
    if (src.origin === origin) image.setAttribute('src', src.pathname)
  }
  for (const element of doc.querySelectorAll('[data-image]')) {
    const src = new URL(element.getAttribute('data-image'), dom.window.location.href)
    if (src.origin === origin) element.setAttribute('data-image', src.pathname)
  }
  const localeLink = doc.querySelector('.language-link')
  if (localeLink && page === 'docs') {
    const current = dom.window.location.hash.slice(1)
    localeLink.setAttribute('href', `${lang === 'zh' ? '' : '/zh'}/docs/${current ? `${current}.html` : ''}`)
  }
}

function frontmatter(title, description) {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n`
}

async function generate(page, lang, topic = '') {
  const dom = makeWindow(page, lang, topic)
  rewriteLinks(dom, lang, page)
  const doc = dom.window.document
  const data = dom.window.RovaiDocs
  const localized = pair => pair?.[lang === 'zh' ? 1 : 0] || ''
  const topicData = topic ? data.topics[topic] : null
  const title = topicData ? localized(topicData.title) : page === 'home'
    ? (lang === 'zh' ? 'Rovai AI — 组建一支长期协作的 Agent 队伍' : 'Rovai AI — Your Agents. One lasting team.')
    : page === 'download' ? (lang === 'zh' ? '下载 Rovai AI' : 'Download Rovai AI')
      : (lang === 'zh' ? 'Rovai AI 文档' : 'Rovai AI documentation')
  const description = topicData ? localized(topicData.lead) : page === 'home'
    ? (lang === 'zh' ? '把编程智能体带到同一个桌面工作台，组织长期队员、会话和任务。' : 'Bring your coding Agents together in a desktop workspace for lasting teammates, conversations and tasks.')
    : page === 'download' ? (lang === 'zh' ? '下载 Rovai AI macOS 或 Windows 安装包。' : 'Download Rovai AI for macOS or Windows.')
      : (lang === 'zh' ? '了解 Rovai AI 的队员、协作、执行、扩展和设置。' : 'Learn how to use teammates, collaboration, execution, extensions and settings in Rovai AI.')
  const app = doc.getElementById('app')
  for (const pre of app.querySelectorAll('pre')) pre.innerHTML = pre.innerHTML.replaceAll('\n', '&#10;')
  const content = `<div id="rovai-site">${app.innerHTML.replaceAll('\n', '')}</div>`
  const prefix = lang === 'zh' ? 'zh/' : ''
  const path = page === 'home' ? `${prefix}index.md` : page === 'download' ? `${prefix}download/index.md`
    : topic ? `${prefix}docs/${topic}.md` : `${prefix}docs/index.md`
  const output = join(site, path)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, frontmatter(title, description) + content + '\n')
  dom.window.close()
  return path
}

const topicsWindow = makeWindow('docs', 'en')
const topics = Object.keys(topicsWindow.window.RovaiDocs.topics)
topicsWindow.window.close()
const written = []
for (const lang of ['en', 'zh']) {
  written.push(await generate('home', lang))
  written.push(await generate('download', lang))
  written.push(await generate('docs', lang))
  for (const topic of topics) written.push(await generate('docs', lang, topic))
}
console.log(`Generated ${written.length} VitePress pages (${topics.length} topics in two languages).`)
