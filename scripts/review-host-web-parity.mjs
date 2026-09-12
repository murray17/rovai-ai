import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const repository = resolve(import.meta.dirname, '..')
export async function buildHostWebParity(outDirectory = join(repository, 'out/review-delivery/host-web-parity')) {
  await mkdir(outDirectory, { recursive: true })
  const result = await build({ configFile: false, root: join(repository, 'scripts/fixtures/host-web-parity'),
    base: './', logLevel: 'warn', plugins: [react()],
    resolve: { alias: { '@contracts': join(repository, 'packages/contracts/src/index.ts') } },
    build: { write: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } } } })
  const bundle = (Array.isArray(result) ? result[0] : result).output
  const js = bundle.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const css = bundle.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n')
  const product = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>生产组件对照 · 固定模拟数据</title><style>' + css + '</style></head><body><div id="root"></div><script type="module">'
    + js.replaceAll('</script', '<\\/script') + '</script></body></html>'
  const productPath = join(outDirectory, 'production-components.html')
  await writeFile(productPath, product)
  const viewer = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Rovai Desktop / Web 宽屏交互对照稿</title>
  <style>${css}
  html,body{height:auto;min-height:100%;overflow:auto}body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--font-ui,system-ui)}
  .review-controls{padding:14px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface);z-index:2}
  .review-controls strong{font-size:14px}.review-controls label{display:flex;gap:6px;align-items:center}.review-controls select,.review-controls button{padding:6px 10px;border:1px solid var(--line);border-radius:6px;color:inherit;background:var(--surface)}
  .review-notice{padding:10px 20px;margin:0;font-size:12px;color:var(--muted)}.review-frame{width:1440px;height:920px;border:0;display:block;margin:0 auto 24px}.review-frame[hidden]{display:block;position:absolute;top:0;left:-100000px;visibility:hidden;pointer-events:none}.review-stage{position:relative;min-width:1480px}
  </style></head><body><div class="review-controls"><strong>Desktop / Web 宽屏对照稿</strong>
  <label>入口 <select id="surface"><option value="web">Web · 共享组件提案</option><option value="desktop">Desktop · 生产组件基准</option></select></label>
  <label>路径 <select id="scenario"><option value="camp">已有 Camp</option><option value="new">新建 Camp</option><option value="running">运行中 / 工具详情</option><option value="approval">等待审批 / 提交 / 已处理</option><option value="file">附件与文件预览</option><option value="member">队员 / Runtime 配置</option></select></label>
  <label>主题 <select id="theme"><option value="day">Porcelain Day</option><option value="night">Steel Night</option></select></label>
  <label><input id="offline" type="checkbox">模拟离线</label><button id="reset">重置当前路径</button></div>
  <p class="review-notice">固定模拟数据 · 每个内容视口 1440×920 · 复用生产 React 组件 · 未连接 Host，未启动 Runtime。切换入口保留各自的页面编辑。</p>
  <p id="status" class="review-notice" role="status">可点击导航、Composer、审批、附件和运行配置。未覆盖路径会明确提示。</p>
  <div class="review-stage"><iframe class="review-frame" id="desktop" title="Desktop 生产组件基准，模拟数据"></iframe><iframe class="review-frame" id="web" title="Web 共享组件提案，模拟数据"></iframe></div>
  <script>
  const product=${JSON.stringify(product).replaceAll('<', '\\u003c')};
  const byId=id=>document.getElementById(id);const notes={};const offline={};
  for(const s of ['desktop','web'])byId(s).onload=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'instant'})));
  function show(){byId('offline').checked=offline[byId('surface').value]===true;for(const s of ['desktop','web'])byId(s).hidden=s!==byId('surface').value;byId('status').textContent=notes[byId('surface').value]||'固定模拟数据；尚未发生操作。'}
  function reset(){byId('offline').checked=false;document.documentElement.dataset.theme=byId('theme').value;for(const s of ['desktop','web']){notes[s]='固定模拟数据；尚未发生操作。';offline[s]=false;byId(s).srcdoc=product.replace('<html lang="zh-CN">','<html lang="zh-CN" data-review-surface="'+s+'" data-review-scenario="'+byId('scenario').value+'" data-review-theme="'+byId('theme').value+'">')}show()}
  byId('surface').onchange=show;byId('scenario').onchange=reset;byId('theme').onchange=reset;byId('reset').onclick=reset;
  byId('offline').onchange=()=>byId(byId('surface').value).contentWindow.postMessage({type:'rovai-parity-offline',offline:byId('offline').checked},'*');
  window.addEventListener('message',event=>{if(event.data?.type!=='rovai-parity-status')return;const s=event.data.surface;if(!['desktop','web'].includes(s)||event.source!==byId(s).contentWindow)return;notes[s]=event.data.note;offline[s]=event.data.offline===true;show()});reset();
  </script></body></html>`
  const viewerPath = join(outDirectory, 'rovai-desktop-web-parity.html')
  await writeFile(viewerPath, viewer)
  return { viewerPath, productPath, outDirectory }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildHostWebParity()
  process.stdout.write(`Open the standalone review: ${result.viewerPath}\nSimulation only; no Core, Runtime or network writes.\n`)
}
