import assert from 'node:assert/strict'
import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchAcceptanceBrowser,pause } from './lib/host-web-browser.mjs'
const dir=resolve(process.argv[2] ?? '/tmp/rovai-references-ui')
const profile=await mkdtemp(join(tmpdir(),'rovai-reference-design-check-'))
const b=await launchAcceptanceBrowser({executable:process.env.ROVAI_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank']})
const report={scope:'Production Renderer, isolated fixture data and browser profile. No Core, Runtime, OS clipboard, or physical-device validation.',checks:[],metrics:[],errors:[]}
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name)}
const key=async(name,code,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await b.send('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:code,modifiers});await pause(80)}
const go=async(scene='long',width=1440,height=920,surface='desktop',theme='day')=>{
  await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
  await b.evaluate("if (location.protocol === 'file:') localStorage.clear()")
  await b.send('Page.navigate',{url:pathToFileURL(join(dir,'thread-references.html')).href+`?scene=${scene}&surface=${surface}&theme=${theme}`})
  await b.wait("Boolean(document.querySelector('#camp-message[contenteditable=true]'))")
  await pause(400)
}
const capture=async(name)=>b.capture(join(dir,name+'.png'))
const historyFits = () => b.evaluate(`Array.from(document.querySelectorAll('.ref-message-link')).every(ref => {
  const label = ref.querySelector('.reference-token-label');
  const icon = ref.querySelector('svg');
  const root = ref.closest('[data-message-quote-body]');
  const bounds = ref.getBoundingClientRect(), container = root.getBoundingClientRect();
  return getComputedStyle(ref).display === 'inline-grid' && bounds.width <= 288.5
    && bounds.left >= container.left && bounds.right <= container.right + 1
    && label.scrollWidth > label.clientWidth && icon.getBoundingClientRect().width === 13
    && ref.getAttribute('aria-label').includes(label.textContent);
})`)
const metric=()=>b.evaluate(`(()=>{
 const editor=document.querySelector('#camp-message');
 const ref=editor.querySelector('.thread-reference');
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
 return {viewport:innerWidth,mobile:document.documentElement.dataset.mobileWeb,editor:rect(editor),editorClient:editor.clientWidth,editorScroll:editor.scrollWidth,pageClient:document.documentElement.clientWidth,pageScroll:document.documentElement.scrollWidth,paragraph:rect(ref?.parentElement??editor),reference:ref?rect(ref):null,aria:ref?.getAttribute('aria-label'),label:ref?.textContent,labelClient:ref?.querySelector('.reference-token-label')?.clientWidth,labelScroll:ref?.querySelector('.reference-token-label')?.scrollWidth,icon:ref?getComputedStyle(ref,'::before').width:null};})()`)
try {
  await b.send('Emulation.setFocusEmulationEnabled',{enabled:true})
  await go()
  let m=await metric();report.metrics.push(m)
  check('long title is visually ellipsized, full title and accessible name retained',m.labelScroll>m.labelClient&&m.aria.includes(m.label)&&m.reference.width<=288.5)
  check('long draft does not overflow',m.editorScroll<=m.editorClient+1)
  check('historical labels ellipsize with full names and visible icons', await historyFits())
  const object = await b.send('Runtime.evaluate', { expression: "document.querySelector('#camp-message .thread-reference')", returnByValue: false })
  const accessibility = await b.send('Accessibility.getPartialAXTree', { objectId: object.result.objectId, fetchRelatives: false })
  check('browser accessibility tree keeps the complete reference name', accessibility.nodes.some(node => !node.ignored && node.name?.value.includes(m.label)))
  await capture('02-desktop-long')
  await b.click("document.querySelector('.ref-message-link')")
  await b.wait("Boolean(document.querySelector('.ref-popover-title'))")
  check('history detail exposes full title',await b.evaluate("document.querySelector('.ref-popover-title').textContent===window.__referenceLayout.titles.thread"))
  await capture('03-history-detail')
  await key('Escape',27)
  check('history preview restores focus to its button',await b.evaluate("document.activeElement.classList.contains('ref-message-link')"))
  await b.click("document.querySelector('#camp-message .thread-reference')")
  await b.wait("Boolean(document.querySelector('.ref-popover-title'))")
  await key('Escape',27)
  check('draft preview returns focus to editor',await b.evaluate("document.activeElement.id==='camp-message'"))
  for (const [name, title] of [
    ['80 scalar thread title', '题'.repeat(80)],
    ['continuous English title', 'API'.repeat(26)],
    ['mixed emoji and Markdown', '登录🔑 [Web] *Desktop* / 版本 1.2 '.repeat(2)],
    ['Renderer-only 300 character stress', 'x'.repeat(300)]
  ]) {
    await b.evaluate(`(() => {
      const {catalog,model} = window.__references;
      const id = document.querySelector('#camp-message .thread-reference').dataset.referenceId;
      catalog.find(item => item.id === id).title = ${JSON.stringify(title)};
      model.invalidateReferences({referencesChanged:true});
    })()`)
    await b.wait(`document.querySelector('#camp-message .reference-token-label').textContent === ${JSON.stringify(title)}`)
    m = await metric()
    check(name + ' stays full in data and bounded in layout', m.label === title && m.aria.includes(title) && m.labelScroll > m.labelClient && m.reference.width <= 288.5 && m.editorScroll <= m.editorClient + 1)
  }
  for(const width of [300,260,220]){
    await b.evaluate(`document.querySelector('#camp-message').style.width='${width}px'`)
    m=await metric();report.metrics.push(m)
    check('composer width '+width+' respects container minus reserve',m.reference.width<=width-16+.5&&m.editorScroll<=m.editorClient+1)
    await b.evaluate(`document.querySelector('.ref-message-link').closest('[data-message-quote-body]').style.width='${width}px'`)
    check('history width '+width+' keeps references inside the message', await historyFits())
  }
  await go('short')
  m=await metric();report.metrics.push(m)
  const baseline=await b.evaluate(`(()=>{const r=document.querySelector('#camp-message .reference-token-label');const p=r.parentElement.parentElement;const bounds=n=>{const range=document.createRange();range.selectNodeContents(n);const b=range.getBoundingClientRect();return{top:b.top,bottom:b.bottom}};return{label:bounds(r),texts:[...p.childNodes].filter(n=>n!==r.parentElement&&n.textContent.trim()).map(bounds),height:p.getBoundingClientRect().height}})()`)
  report.baseline=baseline
  check('short title baseline within 1px and one-line height preserved',baseline.height<21&&baseline.texts.every(t=>Math.abs(t.bottom-baseline.label.bottom)<=1))
  await capture('04-short-baseline')
  await go('tabs')
  await b.click("document.querySelector('#camp-message')")
  await key('End',35)
  await b.wait("Boolean(document.querySelector('.ref-filters'))")
  check('member category initially selected',await b.evaluate("document.querySelector('.ref-filters [aria-selected=true]').textContent==='队员'"))
  await key('Tab',9)
  await b.wait("document.querySelector('.ref-filters [aria-selected=true]')?.textContent==='对话' && !document.querySelector('.ref-search-state')")
  check('Tab switches category without inserting',await b.evaluate("document.querySelector('#camp-message').textContent==='@' && document.activeElement.id==='camp-message'"))
  await capture('05-tab-thread')
  await key('Tab',9)
  await b.wait("document.querySelector('.ref-filters [aria-selected=true]')?.textContent==='使命' && !document.querySelector('.ref-search-state')")
  await capture('06-tab-mission')
  await key('Tab',9,8)
  await b.wait("document.querySelector('.ref-filters [aria-selected=true]')?.textContent==='对话'")
  check('Shift Tab reverses category',true)
  await b.send('Input.insertText',{text:'登录'})
  await b.wait("!document.querySelector('.ref-search-state') && Boolean(document.querySelector('.ref-thread-option'))")
  check('query stays in manually selected category',await b.evaluate("document.querySelector('#camp-message').textContent==='@登录' && document.querySelector('.ref-filters [aria-selected=true]').textContent==='对话'"))
  await key('Enter',13)
  await b.wait("Boolean(document.querySelector('#camp-message .thread-reference')) && !document.querySelector('.ref-filters')")
  check('Enter inserts atom rather than sending',await b.evaluate("window.__references.model.sent.length===0"))
  await key('Backspace',8);await key('Backspace',8)
  check('Backspace removes reference as one atom',await b.evaluate("!document.querySelector('#camp-message .thread-reference')"))
  await go('tabs')
  await b.click("document.querySelector('#camp-message')");await key('End',35)
  await b.send('Input.insertText',{text:'不存在的内容'})
  await b.wait("document.querySelector('.structured-mention-empty')?.textContent==='无匹配结果'")
  await key('Tab',9)
  await b.wait("document.querySelector('.ref-filters [aria-selected=true]')?.textContent==='对话'")
  check('empty state supports category switching',true)
  await key('Escape',27);await key('Tab',9)
  check('Escape releases Tab to normal focus navigation',await b.evaluate("document.activeElement.id!=='camp-message' && !document.querySelector('.ref-filters')"))
  await go('renamed')
  check('renamed source updates draft title',await b.evaluate("document.querySelector('#camp-message .thread-reference').textContent===window.__referenceLayout.titles.renamed"))
  await b.click("document.querySelector('.ref-message-link')")
  await b.wait("Boolean(document.querySelector('.ref-popover-title'))")
  check('renamed source never replaces historical detail title',await b.evaluate("document.querySelector('.ref-popover-title').textContent===window.__referenceLayout.titles.thread"))
  await capture('07-renamed-history')
  await key('Escape',27)
  await b.click("document.querySelector('#camp-message .thread-reference')")
  await b.wait("document.querySelector('.ref-popover-title')?.textContent===window.__referenceLayout.titles.renamed")
  await capture('08-renamed-draft')
  check('draft detail shows current source title',true)
  await go('unavailable')
  check('long unavailable reference retains marker',await b.evaluate("getComputedStyle(document.querySelector('#camp-message .thread-reference'),'::after').content==='\"!\"'"))
  await b.click("document.querySelector('#camp-message .thread-reference')")
  await b.wait("document.querySelector('.ref-unavailable-text')?.textContent==='引用不可用'")
  await capture('09-unavailable')
  check('unavailable detail retains full title and remove action',await b.evaluate("document.querySelector('.ref-popover-title').textContent===window.__referenceLayout.titles.thread && [...document.querySelectorAll('.ref-popover button')].some(e=>e.textContent==='移除引用')"))
  await b.click("[...document.querySelectorAll('.ref-popover button')].find(button=>button.textContent==='重新选择')")
  await b.wait("Boolean(document.querySelector('.ref-filters'))")
  check('replacement returns the caret to a new query without restoring a deleted node', await b.evaluate("document.activeElement.id==='camp-message' && !document.querySelector('#camp-message [data-composer-atom=thread_reference]') && document.querySelector('#camp-message').textContent.includes('@')"))
  for(const [width,height] of [[375,812],[320,740],[740,360],[960,800]]){
    await go('long',width,height,'web')
    m=await metric();report.metrics.push(m)
    check('correct web/mobile mode '+width, width<768 ? m.mobile==='true' : !m.mobile)
    check('web/mobile no overflow '+width+'x'+height,m.editorScroll<=m.editorClient+1&&m.pageScroll<=m.pageClient+1)
    check('web/mobile history references stay inside the bubble '+width, await historyFits())
    await capture('10-layout-'+width+'x'+height)
    if(width===375||width===320){
      await b.click("document.querySelector('#camp-message .mission-reference')")
      await b.wait("Boolean(document.querySelector('.ref-popover-title'))")
      check('mobile detail within visible viewport '+width,await b.evaluate("(()=>{const r=document.querySelector('.ref-popover').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1})()"))
      await capture('11-detail-'+width)
    }
  }
  await go('long',1440,920,'desktop','night');await capture('12-night')
  await go('skills')
  await b.click("document.querySelector('#camp-message')");await key('End',35)
  await b.wait("Boolean(document.querySelector('.simple-skill-option'))")
  await capture('13-skills')
  await key('Tab',9)
  await b.wait("Boolean(document.querySelector('#camp-message .skill-mention'))")
  check('Skills retains Tab selection',true)
 await go()
 const projected=await b.evaluate(`(()=>{const root=document.querySelector('.ref-message-link').closest('[data-message-quote-body]');const m=window.__references.model.get().snapshot.messages.find(m=>m.id===root.dataset.messageQuoteBody);return window.__referenceChecks.readMessageQuoteText(root)})()`)
 check('quote projection includes full title without hidden URI',projected.includes('关于整个项目运行恢复')&&!projected.includes('rovai://')&&!projected.includes('…'))
 const selection=await b.evaluate(`(()=>{const label=document.querySelector('.ref-message-link .reference-token-label');const root=label.closest('[data-message-quote-body]');const range=document.createRange();range.setStart(label.firstChild,2);range.setEnd(label.firstChild,8);const s=getSelection();s.removeAllRanges();s.addRange(range);const result=window.__referenceChecks.readMessageQuoteSelection(s,root.dataset.quoteOwner,id=>window.__references.model.get().snapshot.messages.find(m=>m.id===id));return{expected:label.textContent.slice(2,8),actual:result?.selection.text,messageId:result?.selection.messageId}})()`)
 check('partial quote keeps selected text and optional message ID',selection.actual===selection.expected&&!!selection.messageId)
 await b.evaluate("getSelection().removeAllRanges();window.rovai={clipboard:{write:async data=>{window.__copied=data.text}}}")
 await b.click("document.querySelector('.ref-message-link').closest('.message-surface').querySelector('.message-copy-button')")
 await b.wait("typeof window.__copied==='string'")
 check('whole-message copy preserves full titles and both URI kinds',await b.evaluate("window.__copied.includes(window.__referenceLayout.titles.thread)&&window.__copied.includes(window.__referenceLayout.titles.mission)&&window.__copied.includes('rovai://thread/')&&window.__copied.includes('rovai://mission/')&&!window.__copied.includes('…')"))
 await b.click("document.querySelector('#camp-message').closest('form').querySelector('.composer-primary-action.is-send')")
 await b.wait("window.__references.model.sent.length===1")
 check('send keeps full references in the submitted document and history',await b.evaluate(`(() => {
   const {model} = window.__references;
   const expected = window.__referenceLayout.document;
   const sent = model.sent[0].content;
   const published = model.get().snapshot.messages.at(-1).content.filter(s=>s.kind.endsWith('_reference'));
   return JSON.stringify(sent) === JSON.stringify(expected)
     && published.length === 2 && published[0].titleAtSend === window.__referenceLayout.titles.thread
     && published[1].titleAtSend === window.__referenceLayout.titles.mission;
 })()`))
 await go('short')
 await b.click("document.querySelector('#camp-message')")
 await b.evaluate(`(()=>{const e=document.querySelector('#camp-message');const a=e.querySelector('.thread-reference');const r=document.createRange();r.setStart(a.nextSibling.firstChild??a.nextSibling,0);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'))})()`)
 await pause(100)
 await key('ArrowLeft',37)
 await b.wait("Boolean(document.querySelector('#camp-message .thread-reference[data-composer-selected=true]'))")
 await key('Enter',13)
 await b.wait("Boolean(document.querySelector('.ref-popover'))")
 check('Enter opens detail for a keyboard-selected reference without sending',await b.evaluate("window.__references.model.sent.length===0&&document.querySelector('.ref-popover-title').textContent==='登录改造'"))
 await key('Escape',27)
 check('Escape restores selected reference and editor focus',await b.evaluate("document.activeElement.id==='camp-message'&&Boolean(document.querySelector('#camp-message [data-composer-selected=true]'))"))
 await key('Delete',46)
 check('Delete removes whole selected reference',await b.evaluate("!document.querySelector('#camp-message .thread-reference')"))
 await key('z',90,4)
 await b.wait("Boolean(document.querySelector('#camp-message .thread-reference'))")
 check('undo restores full reference',await b.evaluate("document.querySelector('#camp-message .thread-reference').textContent==='登录改造'"))
 await b.click("document.querySelector('#camp-message .thread-reference')")
 await b.wait("Boolean(document.querySelector('.ref-popover'))")
 await b.click("[...document.querySelectorAll('.ref-popover button')].find(button=>button.textContent==='移除引用')")
 await b.wait("!document.querySelector('.ref-popover')")
 check('detail removal keeps editor focus and removes the complete atom',await b.evaluate("document.activeElement.id==='camp-message' && !document.querySelector('#camp-message .thread-reference')"))
 await b.send('Input.insertText',{text:'继续'})
 check('typing after removal uses the resulting caret',await b.evaluate("document.querySelector('#camp-message').textContent.includes('继续')"))
 await go('long',740,360,'web')
 await b.evaluate(`(()=>{const m=window.__references.catalog.find(x=>x.kind==='mission');m.title='验'.repeat(200);window.__references.model.invalidateReferences({referencesChanged:true})})()`)
 await b.wait("document.querySelector('#camp-message .mission-reference').textContent.length===200")
 await b.click("document.querySelector('#camp-message .mission-reference')")
 await b.wait("document.querySelector('.ref-popover-title')?.textContent.length===200")
 check('200-scalar detail scrolls within landscape viewport',await b.evaluate("(()=>{const p=document.querySelector('.ref-popover');const r=p.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&p.scrollHeight>p.clientHeight&&getComputedStyle(p).overflowY==='auto'})()"))
 await b.evaluate("document.querySelector('.ref-popover').scrollTop=9999")
 check('landscape detail actions remain reachable',await b.evaluate("(()=>{const p=document.querySelector('.ref-popover');const a=p.querySelector('.ref-popover-actions').getBoundingClientRect();return a.top>=p.getBoundingClientRect().top&&a.bottom<=innerHeight})()"))
 await b.capture(join(dir,'14-landscape-scroll.png'))

  check('browser reports no runtime exceptions',b.errors.length===0)
}catch(error){report.errors.push(String(error));report.failureFocus=await b.evaluate('document.activeElement.outerHTML.slice(0,500)');await capture('layout-failure');throw error}
finally{report.errors.push(...b.errors);await writeFile(join(dir,'layout-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.checks.length,errors:report.errors}));await b.close();await rm(profile,{recursive:true,force:true})}
