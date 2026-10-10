(() => {
  const base = new URL('../', document.currentScript.src);
  const lang = document.body.dataset.lang;
  const zh = lang === 'zh';
  const page = document.body.dataset.page;
  const choose = (en, cn) => zh ? cn : en;
  const asset = path => new URL(`assets/${path}`, base).href;
  const route = (target = 'home', locale = lang, hash = '') => new URL(`${locale === 'zh' ? 'zh/' : ''}${target === 'home' ? '' : target + '/'}index.html${hash}`, base).href;
  const github = 'https://github.com/murray17/rovai-ai';
  const paths = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    external: '<path d="M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    agents: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
    missions: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16M5 8h2m4 0h2m4 0h2M5 11h2m4 0h2m-2 3h2"/>',
    memory: '<path d="M12 6c-2-5-7-3-7 1-4 1-3 6 0 7-2 5 4 8 7 4V6Zm0 0c2-5 7-3 7 1 4 1 3 6 0 7 2 5-4 8-7 4M7 8c3 0 5 2 5 4m5 0c-3 0-5 2-5 4M5 14h3"/>',
    automations: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-9 3v3l3 2"/>',
    skills: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-4a3 3 0 0 0-3 3m7-3v15h-3m-10-11h3m-3 4h3m6-4h2m-2 4h2"/>',
    mcp: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    book: '<path d="M4 4h6a2 2 0 0 1 2 2v15a4 4 0 0 0-4-2H4V4Zm16 0h-6a2 2 0 0 0-2 2m8-2v15h-4a4 4 0 0 0-4 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    apple: '<path d="M15.1 5c.8-1 1.2-2.3 1.1-3.5-1.3.1-2.7.8-3.5 1.8-.7.8-1.3 2.1-1.1 3.3 1.3.1 2.6-.6 3.5-1.6Z" fill="currentColor" stroke="none"/><path d="M19.3 13.4c0-2.3 1.9-3.5 2-3.6-1.1-1.7-2.9-1.9-3.5-2-1.5-.2-3 1-3.8 1-.9 0-2.2-1-3.5-1-1.8 0-3.5 1.1-4.4 2.7-1.9 3.3-.5 8.2 1.3 10.8.8 1.2 1.8 2.5 3.1 2.5 1.3-.1 1.8-.8 3.4-.8 1.6 0 2.1.8 3.5.8s2.3-1.3 3.1-2.5c.9-1.4 1.3-2.7 1.4-2.8-.1 0-2.6-1-2.6-4.1Z" transform="translate(-1 -3) scale(.94)" fill="currentColor" stroke="none"/>',
    windows: '<path d="M3 5l8-1v8H3V5Zm10-1 8-1v9h-8V4ZM3 14h8v7l-8-1v-6Zm10 0h8v9l-8-1v-8Z" fill="currentColor" stroke="none"/>',
    github: '<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1.1.1 1.6 1.1 1.6 1.1 1 .1 1.6 1.7 3.1.7.1-.7.4-1.2.7-1.5-2.3-.3-4.7-1.2-4.7-5A3.9 3.9 0 0 1 6.7 8.3c-.1-.3-.5-1.3.1-2.7 0 0 .9-.3 2.8 1a9.7 9.7 0 0 1 5.1 0c1.9-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.8-2.3 4.7-4.7 5 .4.3.7.9.7 1.8V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" fill="currentColor" stroke="none"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  const mark = `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 13.16 7.3 17.76 8.84 13.16 10.38 12 15.68 10.84 10.38 6.24 8.84 10.84 7.3Z" fill="currentColor"/><path d="M3 20.96Q12 15.96 21 20.96" fill="none" stroke="currentColor" stroke-width="2.08" stroke-linecap="round"/><circle cx="12" cy="18.46" r="1.05" fill="var(--ember)"/></svg>`;
  const docLink = (id, label) => `<a class="text-link" href="${route('docs', lang, '#' + id)}">${label}${icon('arrow')}</a>`;
  const features = [
    ['agents', 'agents', 'Agents', '智能体', 'Choose the coding Agent and model each teammate works with.', '接入已有的编程智能体，为队员选择模型与权限。'],
    ['missions', 'missions', 'Mission board', '使命板', 'Keep goals, ownership, and progress in one place.', '围绕长期目标，查看负责人、进展与交付。'],
    ['memory', 'memory', 'Memory', '协作记忆', 'Carry useful decisions and lessons into the next task.', '保留重要决定与经验，让后续工作有所参考。'],
    ['automations', 'automations', 'Scheduled tasks', '定时任务', 'Assign recurring work to a teammate on your schedule.', '指定队员，让重复工作按计划执行。'],
    ['skills', 'skills', 'Skills', 'Skills', 'Give teammates reusable methods for the work at hand.', '为队员配置可复用的工作方法。'],
    ['mcp', 'mcp', 'MCP', 'MCP', 'Connect the external tools and information your team needs.', '连接工作需要的外部工具与信息来源。']
  ];
  const docsData = window.RovaiDocs;
  if (page === 'docs' && !docsData) throw new Error('Documentation content failed to load');
  const docTopics = docsData?.topics ?? {};
  const localize = pair => choose(pair[0], pair[1]);
  const docText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  function header() { return `<a class="skip" href="#main">${choose('Skip to content','跳到正文')}</a><header class="site-header"><div class="nav-shell"><a href="${route()}" class="brand" aria-label="Rovai AI ${choose('home','首页')}">${mark}<span>Rovai AI</span></a><nav aria-label="${choose('Main navigation','主导航')}"><a class="nav-docs ${page === 'docs' ? 'active' : ''}" href="${route('docs')}">${choose('Docs','文档')}</a><a class="github-link icon-link" href="${github}" target="_blank" rel="noopener" aria-label="GitHub">${icon('github')}</a><span class="nav-rule"></span><a class="language-link" href="${route(page, zh ? 'en' : 'zh', location.hash)}" lang="${zh ? 'en' : 'zh-CN'}" aria-label="${choose('切换为中文','Switch to English')}">${icon('globe')}<span>${choose('中文','EN')}</span></a><a class="button nav-download" href="${route('download')}">${choose('Download','下载')}${icon('download')}</a></nav></div></header>`; }
  function footer(dark = false) { return `<footer class="footer ${dark ? 'footer-dark' : ''}"><div class="footer-inner"><div><a class="brand" href="${route()}">${mark}<span>Rovai AI</span></a><p>${choose('A shared workspace. A lasting team.','同一个工作台，一支长期协作的队伍。')}</p></div><div class="footer-links"><a href="${github}/releases" target="_blank" rel="noopener">${choose('Release notes','更新日志')}</a><a href="${github}/issues" target="_blank" rel="noopener">${choose('Feedback','问题反馈')}</a><a href="${github}" target="_blank" rel="noopener">GitHub${icon('external')}</a></div><span class="license">© 2026 Rovai AI · MIT</span></div></footer>`; }
  function figure(scene, description, hero = false) {
    const [width,height] = {workspace:[1440,820],members:[1170,900],remote:[1480,1020]}[scene];
    const src=asset('screens/'+(scene==='workspace'?'workspace-team-ready.png':scene+'-en.png'));
    return `<figure class="product-figure ${hero?'hero-figure':''}"><button class="image-expand" data-image="${src}" aria-label="${choose('Enlarge image: ','放大图片：')}${description}"><img src="${src}" alt="${description}" width="${width}" height="${height}" loading="${hero?'eager':'lazy'}" fetchpriority="${hero?'high':'auto'}"><span class="expand-cue">${icon('expand')}</span></button></figure>`;
  }
  function home() {return `${header()}<main id="main">
    <section class="hero section-shell">
      <div class="hero-copy">
        <h1>${choose('Your Agents.<br>One lasting team.','你的智能体，<br>一支长期协作的队伍。')}</h1>
        <div class="hero-summary">
          <p class="hero-description">${choose('Bring your coding Agents into one desktop workspace. Work together, see every step, and carry the context forward.','把你已有的编程智能体带到同一个桌面工作台。一起讨论、执行任务，留下值得记住的经验。')}</p>
        </div>
      </div>
      ${figure('workspace',choose('Four teammates in a shared conversation, with execution cards in the right-hand Overview','四位队员在同一会话中协作，右侧 Overview 展示执行卡片'),true)}<div class="hero-example">${docLink('collaboration',choose('See how team collaboration works','了解队员如何协作'))}</div>
      <div class="hero-download"><div class="hero-actions"><a class="button button-large" href="${route('download')}">${choose('Download Rovai AI','下载 Rovai AI')}${icon('download')}</a><a class="button button-quiet button-large" href="${route('docs')}">${choose('Explore the docs','查看使用文档')}${icon('arrow')}</a></div><p class="platforms">macOS <span>·</span> Windows <span>·</span> ${choose('Open source','开源')}</p></div>
    </section>
    <section id="members" class="showcase section-shell">
      <div class="showcase-copy"><h2>${choose('Teammates who<br>stay with you.','长期队员，<br>熟悉你的工作方式。')}</h2><div class="showcase-description"><p>${choose('Give your teammates their own roles, responsibilities, and ways of working. Bring them from one project to the next, and choose the Agent that fits each job.','为队员设置各自的身份、职责和工作方式。带着熟悉的伙伴进入下一个项目，再为当前工作选择合适的智能体。')}</p>${docLink('members',choose('Build your team','了解队员配置'))}</div></div>
      ${figure('members',choose('Teammate profile and Agent configuration','队员资料与智能体配置'))}
    </section>
    <section id="remote" class="showcase section-shell">
      <div class="showcase-copy"><h2>${choose('Stay connected.<br>Wherever you work.','远程连接，<br>随时回到协作中。')}</h2><div class="showcase-description"><p>${choose('Continue a conversation through a browser connected to your host. With Rovai Desktop, you can also send requests and receive results through Feishu, Lark, or DingTalk.','通过浏览器连接主机，继续已有会话。使用 Rovai 桌面端时，也能从飞书、Lark 或钉钉发起请求并接收结果。')}</p><div class="inline-links">${docLink('remote',choose('Deployment & remote access','部署与远程访问'))}${docLink('channels',choose('Connect a channel','渠道接入'))}</div></div></div>
      ${figure('remote',choose('Mobile conversation and desktop Channels settings','移动端会话与桌面渠道设置'))}
    </section>
    <section class="capabilities section-shell" id="capabilities" aria-labelledby="capabilities-title">
      <div class="capability-intro"><h2 id="capabilities-title">${choose('Inside Rovai','工作台功能')}</h2><p>${choose('A guide to your Agents, tasks, and tools.','了解智能体、任务与工具的配置和用法。')}</p><a class="text-link" href="${route('docs')}">${choose('All documentation','浏览全部文档')}${icon('arrow')}</a></div>
      <ul class="capability-list">${features.map(([id,ico,en,cn,descEn,descCn])=>`<li><a class="capability-link" href="${route('docs',lang,'#'+id)}"><div class="capability-name">${icon(ico)}<h3>${choose(en,cn)}</h3></div><p>${choose(descEn,descCn)}</p>${icon('arrow','capability-arrow')}</a></li>`).join('')}</ul>
    </section>
    <section class="closing"><div class="closing-inner"><div><h2>${choose('Download Rovai AI','下载 Rovai AI')}</h2><p class="closing-platforms">macOS <span>·</span> Windows <span>·</span> ${choose('Open source','开源')}</p></div><a class="button button-light button-large" href="${route('download')}">${choose('Choose your download','选择安装包')}${icon('download')}</a></div>${footer(true)}</section>
  </main><dialog class="lightbox" aria-label="${choose('Expanded product image','放大产品图片')}"><div class="lightbox-bar"><button class="icon-button" aria-label="${choose('Close image','关闭图片')}">${icon('close')}</button></div><div class="lightbox-media"></div></dialog>`;}
  const docGroups = docsData?.groups ?? [];
  const docOrder = docGroups.flatMap(group => group.ids);
  const currentTopic = () => {
    const id = location.hash.slice(1);
    const aliases = {
      runtimes: 'agents', camps: 'conversations', concepts: 'tour',
      handoffs: 'collaboration', dingtalk: 'channels',
      examples: 'quickstart', troubleshooting: 'recovery'
    };
    const resolved = aliases[id] ?? id;
    return Object.hasOwn(docTopics, resolved) ? resolved : 'index';
  };
  const topicTitle = id => localize(docTopics[id].title);
  const groupTitle = group => choose(group.en, group.zh);
  const docImage = (image, title, caption) => {
    const filename = Array.isArray(image) ? localize(image) : image;
    return `<figure class="doc-figure"><a class="doc-visual" href="${asset('screens/' + filename)}" target="_blank" rel="noopener" aria-label="${docText(choose('Open full-size screenshot: ', '打开原尺寸截图：') + title)}"><img src="${asset('screens/' + filename)}" alt="${docText(title)}" loading="lazy"></a><figcaption>${docText(caption || title)}</figcaption></figure>`;
  };
  function renderDocSection(item, topic) {
    const kind = item.kind ?? (item.steps ? 'steps' : 'prose');
    if (kind === 'markdown') return `<section class="doc-section doc-markdown">${localize(item.body)}</section>`;
    if (kind === 'aside') return `<aside class="doc-section doc-aside"><p>${docText(localize(item.body))}</p></aside>`;
    const title = docText(localize(item.title));
    let content = '';
    if (kind === 'gallery') content = `<p>${docText(localize(item.body))}</p><div class="doc-layout-gallery">${item.images.map(i=>`<details><summary>${docText(localize(i.label))}</summary>${docImage(i.image,localize(i.alt),localize(i.caption))}</details>`).join('')}</div>`;
    if (kind === 'steps') content = `<ol class="doc-steps">${localize(item.steps).map(step => `<li>${docText(step)}</li>`).join('')}</ol>`;
    if (kind === 'prose') content = item.paragraphs ? localize(item.paragraphs).map(p => `<p>${docText(p)}</p>`).join('') : `<p>${docText(localize(item.body))}</p>`;
    if (kind === 'fields') content = `<dl class="doc-field-list">${item.rows.map(row => `<div class="doc-field-row"><dt>${docText(localize(row.label))}</dt><dd>${docText(localize(row.text))}</dd></div>`).join('')}</dl>`;
    if (kind === 'points') content = `<ul class="doc-points">${localize(item.points).map(point => `<li>${docText(point)}</li>`).join('')}</ul>`;
    if (kind === 'shot' && !item.caption) content = `<p>${docText(localize(item.body))}</p>`;
    if (kind === 'prompt') content = `<div class="doc-prompt"><pre>${docText(localize(item.body))}</pre><button class="prompt-copy" type="button" aria-label="${choose('Copy request','复制请求')}">${choose('Copy request','复制请求')}</button></div>`;
    if (kind === 'code') content = `<div class="doc-prompt doc-code"><pre><code>${docText(localize(item.body))}</code></pre><button class="prompt-copy" type="button" aria-label="${choose('Copy code','复制代码')}">${choose('Copy code','复制代码')}</button></div>`;
    if (kind === 'table') content = `<div class="doc-table-wrap" role="region" tabindex="0" aria-label="${title}"><table><thead><tr>${localize(item.columns).map(c=>`<th scope="col">${docText(c)}</th>`).join('')}</tr></thead><tbody>${localize(item.rows).map(row=>`<tr>${row.map((c,i)=>i===0?`<th scope="row">${docText(c)}</th>`:`<td>${docText(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (kind === 'links') content = `<ul class="doc-related">${item.links.map(link=>`<li><a href="${docText(link.url || (link.file ? new URL(link.file,base).href : '#'+link.id))}"${link.url||link.file?' target="_blank" rel="noopener"':''}${link.file?.endsWith('.zip')?' download':''}>${docText(localize(link.label))}${icon('arrow')}</a></li>`).join('')}</ul>`;
    if (kind === 'diagram-file') content = `<figure class="doc-diagram-figure"><a href="${asset('diagrams/'+item.file+'-'+lang+'.svg')}" target="_blank" rel="noopener"><img src="${asset('diagrams/'+item.file+'-'+lang+'.svg')}" alt="${docText(localize(item.alt))}" loading="lazy"></a><figcaption>${docText(localize(item.caption))} <a href="${asset('diagrams/'+item.file+'-'+lang+'.mmd')}" download>${choose('Mermaid source','Mermaid 源文件')}</a></figcaption></figure>`;
    if (kind === 'diagram') content = `<div class="doc-session-diagram" role="img" aria-label="${docText(choose('One project conversation contains a public team transcript and separate private one-on-one sessions for each teammate.', '一个项目会话包含一条公共消息流，以及每位队员各自独立的单聊。'))}">
      <div class="diagram-parent"><strong>${choose('Project / workspace', '项目 / 工作目录')}</strong><span>${choose('Shared file context', '共享文件上下文')}</span></div>
      <div class="diagram-connector" aria-hidden="true"></div>
      <div class="diagram-parent"><strong>${choose('Conversation', '会话')}</strong><span>${choose('Team and lead', '参与队员与队长')}</span></div>
      <div class="diagram-branches" aria-hidden="true"><span></span><span></span></div>
      <div class="diagram-children"><div><strong>${choose('Public team session', '公共会话')}</strong><span>${choose('Public transcript · deliveries · runs', '公屏消息 · 投递 · 执行')}</span></div><div><strong>${choose('One-on-one · teammate A', '单聊 · 队员 A')}</strong><span>${choose('Private transcript · draft · queue · run', '私聊记录 · 草稿 · 队列 · 执行')}</span></div><div><strong>${choose('One-on-one · teammate B', '单聊 · 队员 B')}</strong><span>${choose('Own private transcript and queue', '另有独立私聊记录与队列')}</span></div></div>
    </div>`;
    if (item.image) content += docImage(item.image, localize(item.alt || (kind === 'steps' ? topic.title : item.title)), item.caption ? localize(item.caption) : null);
    return `<section class="doc-section doc-${kind}"><h2>${title}</h2>${content}</section>`;
  }
  function topicBody(id) {
    if (id === 'index') return `<div class="doc-index">
      <h1>${choose('Rovai AI documentation','Rovai AI 文档')}</h1>
      <p class="doc-lead">${choose('Start with one Agent and one teammate, or go straight to the part of your workspace you want to understand.','从一种智能体和一位队员开始，也可以直接查找你想了解的工作台功能。')}</p>
      <div class="doc-entrypoints">
        ${[['understanding',choose('Meet Rovai','认识 Rovai')],['quickstart',choose('Your first task','完成第一次任务')],['collaboration',choose('Work with two teammates','多队员协作与交接')]].map(([topic,label])=>`<a href="#${topic}">${label}${icon('arrow')}</a>`).join('')}
      </div>
      <div class="doc-directory">${docGroups.map(group=>`<section class="doc-directory-group"><h2>${groupTitle(group)}</h2><ul>${group.ids.map(topic=>`<li><a href="#${topic}">${topicTitle(topic)}${icon('arrow')}</a></li>`).join('')}</ul></section>`).join('')}</div>
      <p class="doc-preview-note">${choose('These guides describe the current workspace. Available features depend on your installed release.','这些指南介绍当前工作台。可用功能以实际安装的版本为准。')}</p>
    </div>`;
    const topic = docTopics[id];
    const group = docGroups.find(item => item.ids.includes(id));
    const next = docOrder[docOrder.indexOf(id)+1];
    return `<nav class="doc-breadcrumb" aria-label="${choose('Breadcrumb','面包屑导航')}"><a href="${route('docs')}">${choose('Docs','文档')}</a><span aria-hidden="true">/</span><span>${groupTitle(group)}</span></nav>
      <h1>${localize(topic.title)}</h1><p class="doc-lead">${localize(topic.lead)}</p>
      <div class="doc-article-body">${topic.sections.map(item => renderDocSection(item, topic)).join('')}</div>
      ${id === 'installation' ? `<a class="button doc-download" href="${route('download')}">${choose('Choose an installer','选择安装包')}${icon('arrow')}</a>` : ''}
      <nav class="doc-bottom" aria-label="${choose('Guide navigation','文档导航')}"><a class="text-link" href="${route('docs')}">${icon('book')}${choose('All guides','全部文档')}</a>${next?`<a class="text-link doc-next" href="#${next}"><span>${choose('Next: ','下一篇：')}${topicTitle(next)}</span>${icon('arrow')}</a>`:''}</nav>`;
  }
  function docs() {
    const current = currentTopic();
    return `${header()}<main id="main" class="docs-layout section-shell">
      <aside class="docs-sidebar"><nav aria-label="${choose('Documentation topics','文档目录')}">${docGroups.map(group=>`<div class="docs-nav-group"><span>${groupTitle(group)}</span>${group.ids.map(id=>`<a href="#${id}" data-topic="${id}" class="${current===id?'selected':''}">${topicTitle(id)}</a>`).join('')}</div>`).join('')}</nav>
        <a class="docs-repo" href="${github}" target="_blank" rel="noopener">${icon('github')}${choose('Contribute on GitHub','参与开源项目')}${icon('external')}</a>
      </aside>
      <div class="doc-content-wrap"><label class="mobile-doc-select">${choose('Choose a guide','选择文档')}<select aria-label="${choose('Choose a guide','选择文档')}"><option value="index">${choose('All guides','全部文档')}</option>${docGroups.map(group=>`<optgroup label="${groupTitle(group)}">${group.ids.map(id=>`<option value="${id}" ${id===current?'selected':''}>${topicTitle(id)}</option>`).join('')}</optgroup>`).join('')}</select></label><article class="doc-content">${topicBody(current)}</article></div>
    </main>${footer()}`;
  }
  function download() {const version='0.4.7';const serverVersion=version;return `${header()}<main id="main" class="download-page section-shell"><p class="eyebrow">${choose('YOUR TEAM IS WAITING','你的队伍，在这里等你')}</p><h1>${choose('Make room for<br>your next team.','为下一支队伍，<br>留一个位置。')}</h1><p class="download-lead">${choose('Download Rovai AI and bring your coding Agents together.','下载 Rovai AI，把你的编程智能体带到一起。')}</p><h2 class="download-form-title">Rovai Desktop</h2><div class="release-label"><span></span>v${version}<span class="release-separator">/</span>${choose('Public release','公开发布版')}<a href="${github}/releases/tag/v${version}" target="_blank" rel="noopener">${choose('Release notes','版本说明')}${icon('external')}</a></div><div class="download-grid"><section class="download-card"><div class="os-heading">${icon('apple')}<h2>macOS</h2></div><p>${choose('For Apple Silicon and Intel Macs.','适用于 Apple 芯片与 Intel Mac。')}</p><a class="installer" href="${github}/releases/download/v${version}/Rovai-AI-${version}-arm64.dmg"><span><strong>Apple Silicon</strong><small>M1 / M2 / M3 / M4 / ${choose('and later','及更新芯片')}</small></span><span>DMG ${icon('download')}</span></a><a class="installer" href="${github}/releases/download/v${version}/Rovai-AI-${version}-x64.dmg"><span><strong>Intel</strong><small>x64</small></span><span>DMG ${icon('download')}</span></a><p class="install-note">${choose('Open the DMG, drag Rovai AI into Applications, and launch it from there.','打开 DMG，将 Rovai AI 拖入“应用程序”，再从那里启动。')}</p></section><section class="download-card"><div class="os-heading">${icon('windows')}<h2>Windows</h2></div><p>${choose('For Windows PCs with an x64 processor.','适用于采用 x64 处理器的 Windows 电脑。')}</p><a class="installer" href="${github}/releases/download/v${version}/Rovai-AI-${version}-x64.exe"><span><strong>Windows x64</strong><small>${choose('Per-user installer','当前用户安装程序')}</small></span><span>EXE ${icon('download')}</span></a><p class="install-note">${choose('Run the installer and follow the setup wizard.','运行安装程序，按向导完成安装。')}</p><p class="signing-note">${choose('This Windows release is unsigned. The installer may show an unknown-publisher notice.','当前 Windows 安装包未签名，安装时可能显示未知发布者提示。')}</p></section></div><p class="release-footnote">${choose('Mac v0.4.0 and earlier need a one-time manual upgrade to v0.4.7: quit Rovai, open the DMG for your chip, drag the app into Applications, and choose Replace. Reopen it and check your conversations and settings. Do not remove user data.','Mac v0.4.0 及更早版本升级到 v0.4.7 时，请先完成手头工作并退出 Rovai，打开对应芯片的 DMG，将应用拖入“应用程序”并选择“替换”。重新打开后检查原有会话和设置；不要清理用户数据。')} <a href="${github}/releases" target="_blank" rel="noopener">${choose('All releases','查看全部版本')}${icon('external')}</a></p><section class="server-download" aria-labelledby="server-download-title"><div class="server-download-heading"><div><p class="eyebrow">${choose('YOUR OWN HOST','运行在自己的主机上')}</p><h2 id="server-download-title">Rovai Server</h2><p>${choose('An independent workspace, accessed through your browser. Install Agents and keep projects on the host.','通过浏览器使用独立工作台；智能体与项目配置在服务主机。')}</p></div><span class="server-version">v${serverVersion}</span></div><p class="server-release-note">${choose('Desktop and Server share this release. The native package includes its Web UI; no source build is needed.','Server 与 Desktop 同版发布。原生包包含 Web 界面，普通安装无需源码构建。')}</p><p class="server-package-issue">${choose('Server 0.4.7 includes the bundled Skill resources missing from the earlier 0.4.0 package. Agent compatibility remains a separate requirement; see the installation guide.','Server 0.4.7 已补齐早期 0.4.0 包缺失的内置 Skill 资源。智能体兼容性仍需单独确认，详见安装指南。')}</p><div class="server-assets">${[['linux-x64','Linux x64','GNU · glibc 2.35+','tar.gz'],['macos-arm64','macOS','Apple Silicon','tar.gz'],['macos-x64','macOS','Intel x64','tar.gz'],['windows-x64','Windows','x64 · Visual C++ v14','zip']].map(([target,os,detail,ext])=>`<a class="server-asset" href="${github}/releases/download/v${serverVersion}/rovai-server-${serverVersion}-${target}.${ext}"><span><strong>${os}</strong><small>${detail}</small></span><span>${ext.toUpperCase()} ${icon('download')}</span></a>`).join('')}</div><div class="server-download-links">${docLink('server-install',choose('Installation guide','安装与启动指南'))}${docLink('remote',choose('Choose a deployment and connection','选择部署与连接方式'))}<a class="text-link" href="${github}/releases/tag/v${serverVersion}">${choose('Server release & installer scripts','Server 发布说明与安装脚本')}${icon('external')}</a></div><p class="install-note">${choose('Linux packages target Ubuntu 22.04+ / Debian 12+ on x64 GNU. Agent compatibility is assessed separately. Upgrade macOS 0.4.0 installations to restore the normal command entry.','Linux 包面向 x64 GNU 的 Ubuntu 22.04+ / Debian 12+；智能体兼容性单独判断。macOS 0.4.0 安装建议升级，以恢复正常命令入口。')}</p></section><div class="download-help"><div><h2>${choose('The first task is a good place to start.','从第一次任务开始。')}</h2><p>${choose('Prepare an Agent, choose a teammate, and make something useful.','准备智能体、选择队员，完成一个有用的小任务。')}</p></div>${docLink('quickstart',choose('Quick start','快速开始'))}</div></main>${footer()}`;}
  document.getElementById('app').innerHTML=page==='docs'?docs():page==='download'?download():home();
  function updateLocaleLink(){const link=document.querySelector('.language-link');if(link)link.href=route(page,zh?'en':'zh',location.hash);}
  if(page==='docs'){
    const update=()=>{
      const id=currentTopic();
      document.querySelector('.doc-content').innerHTML=topicBody(id);
      document.querySelectorAll('[data-topic]').forEach(link=>{
        const selected=link.dataset.topic===id;
        link.classList.toggle('selected',selected);
        if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
      });
      document.querySelector('.mobile-doc-select select').value=id;
      document.title=`${id==='index'?choose('Docs','使用文档'):topicTitle(id)} · Rovai AI`;
      updateLocaleLink();
      const selected=document.querySelector('.docs-sidebar [aria-current="page"]');
      const sidebar=document.querySelector('.docs-sidebar');
      if(selected){
        const item=selected.getBoundingClientRect(),view=sidebar.getBoundingClientRect();
        if(item.top<view.top+40||item.bottom>view.bottom-20)sidebar.scrollTop+=item.top-view.top-80;
      }
      window.scrollTo({top:0,behavior:'instant'});
    };
    addEventListener('hashchange',update);
    document.querySelector('.mobile-doc-select select').addEventListener('change',event=>{
      if(event.target.value==='index')location.href=route('docs');else location.hash=event.target.value;
    });
    update();
  }else{addEventListener('hashchange',updateLocaleLink);}
  document.addEventListener('click', async event => { const button=event.target.closest('.prompt-copy'); if(!button)return; const value=button.previousElementSibling.textContent; try { await navigator.clipboard.writeText(value); button.textContent=choose('Copied','已复制'); } catch { const range=document.createRange(); range.selectNodeContents(button.previousElementSibling); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); button.textContent=choose('Selected — copy with keyboard','已选中，请用键盘复制'); } });
  const box=document.querySelector('.lightbox');
  if(box){document.querySelectorAll('[data-image]').forEach(button=>button.addEventListener('click',()=>{const img=new Image();img.src=button.dataset.image;img.alt=button.querySelector('img').alt;box.querySelector('.lightbox-media').replaceChildren(img);box.showModal();document.body.classList.add('modal-open');}));box.querySelector('button').addEventListener('click',()=>box.close());box.addEventListener('click',event=>{if(event.target===box)box.close();});box.addEventListener('close',()=>document.body.classList.remove('modal-open'));}
})();
