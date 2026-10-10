import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'
import MarkdownIt from 'markdown-it'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'scripts', 'source')
const site = join(root, 'site')
const origin = 'https://rovai.dev'
const scripts = Object.fromEntries(await Promise.all(
  ['docs-content.js', 'docs-details.js', 'docs-tutorials.js', 'docs-deployment.js', 'site.js'].map(async name =>
    [name, await readFile(join(source, name), 'utf8')]
  )
))

const markdown = new MarkdownIt({ html: false })
markdown.core.ruler.push('guide_heading_ids', state => {
  for (let i = 0; i < state.tokens.length; i++) {
    if (state.tokens[i].type !== 'heading_open') continue
    const inline = state.tokens[i + 1]
    const match = inline.content.match(/\s+\{#([^}]+)\}$/)
    if (!match) continue
    state.tokens[i].attrSet('id', match[1])
    inline.content = inline.content.replace(/\s+\{#[^}]+\}$/, '')
    const last = inline.children.at(-1)
    if (last?.type === 'text') last.content = last.content.replace(/\s+\{#[^}]+\}$/, '')
  }
})

const agentSetup = { title: [], lead: [], description: [], sections: [{ kind: 'markdown', body: [] }] }
for (const lang of ['en', 'zh']) {
  const text = await readFile(join(source, 'guides', `agent-setup.${lang}.md`), 'utf8')
  const dom = new JSDOM(`<article>${markdown.render(text)}</article>`)
  const doc = dom.window.document
  const article = doc.querySelector('article')
  const title = article.querySelector('h1')
  const lead = title.nextElementSibling
  agentSetup.title.push(title.textContent)
  agentSetup.lead.push(lead.innerHTML)
  agentSetup.description.push(lead.textContent)
  title.remove()
  lead.remove()
  article.querySelector('p').classList.add('guide-version')
  for (const pre of article.querySelectorAll('pre')) {
    const wrapper = doc.createElement('div')
    wrapper.className = 'doc-prompt doc-code'
    pre.replaceWith(wrapper)
    wrapper.append(pre)
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'prompt-copy'
    button.textContent = lang === 'zh' ? '复制代码' : 'Copy code'
    wrapper.append(button)
  }
  for (const table of article.querySelectorAll('table')) {
    const wrapper = doc.createElement('div')
    wrapper.className = 'doc-table-wrap'
    wrapper.setAttribute('role', 'region')
    wrapper.setAttribute('tabindex', '0')
    wrapper.setAttribute('aria-label', table.previousElementSibling.textContent)
    table.replaceWith(wrapper)
    wrapper.append(table)
    for (const th of table.querySelectorAll('th')) th.setAttribute('scope', 'col')
  }
  agentSetup.sections[0].body.push(article.innerHTML)
  dom.window.close()
}

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
  for (const name of ['docs-content.js', 'docs-details.js', 'docs-tutorials.js', 'docs-deployment.js']) {
    dom.window.eval(scripts[name])
  }
  const { topics, groups } = dom.window.RovaiDocs
  topics['agent-setup'] = agentSetup
  const agentGroup = groups.find(group => group.ids.includes('agents'))
  agentGroup.ids.splice(agentGroup.ids.indexOf('agents') + 1, 0, 'agent-setup')
  const related = topics.agents.sections.findLast(section => section.kind === 'links')
  related.links.push({ id: 'agent-setup', label: agentSetup.title })
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
  const description = topicData ? localized(topicData.description || topicData.lead) : page === 'home'
    ? (lang === 'zh' ? '把编程智能体带到同一个桌面工作台，组织长期队员、会话和任务。' : 'Bring your coding Agents together in a desktop workspace for lasting teammates, conversations and tasks.')
    : page === 'download' ? (lang === 'zh' ? '下载 Rovai Desktop，或为自己的主机安装独立 Rovai Server。' : 'Download Rovai Desktop or install standalone Rovai Server on your own host.')
      : (lang === 'zh' ? '了解 Rovai AI 的队员、协作、执行、扩展和设置。' : 'Learn how to use teammates, collaboration, execution, extensions and settings in Rovai AI.')
  const app = doc.getElementById('app')
  // Encode preformatted line breaks after serialization: assigning entities to
  // innerHTML decodes them again before the outer whitespace removal runs.
  const contentHtml = app.innerHTML.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>|\n/g,
    part => part === '\n' ? '' : part.replaceAll('\n', '&#10;'))
  const content = `<div id="rovai-site">${contentHtml}</div>`
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
