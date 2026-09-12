import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
export async function buildRemoteConnectionReview(output = join(root, 'out/review-delivery/remote-connection')) {
  await mkdir(output, { recursive: true })
  const result = await build({ configFile: false, root: join(root, 'scripts/fixtures/remote-connection'), base: './', logLevel: 'warn', plugins: [react()],
    resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
    build: { write: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } } })
  const bundle = (Array.isArray(result) ? result[0] : result).output
  const css = bundle.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n')
  const js = bundle.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const product = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>远程连接 · 设计稿</title><style>'
    + css + '</style></head><body><div id="root"></div><script type="module">' + js.replaceAll('</script', '<\\/script') + '</script></body></html>'
  const productPath = join(output, 'remote-connection.html')
  await writeFile(productPath, product)
  const viewer = `<!doctype html><html lang="zh-CN" data-theme="day"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rovai AI · 远程连接设计稿</title><style>${css}
  html,body{height:auto;overflow:auto;min-height:100%}body{background:var(--canvas)}
  .review-toolbar{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap;padding:16px 24px;border-bottom:1px solid var(--line);background:var(--surface);position:sticky;top:0;z-index:1}
  .review-toolbar strong{font-size:14px;font-weight:600;margin-right:8px}.review-toolbar label{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}
  .review-toolbar select,.review-toolbar button{border:1px solid var(--line);border-radius:6px;padding:6px 9px;background:var(--input);color:var(--ink);font:inherit;font-size:12px}
  .review-note{margin:0;padding:10px 24px;color:var(--muted);font-size:12px;line-height:1.6}.review-stage{padding:8px 24px 24px;width:max-content;min-width:100%}iframe{display:block;border:1px solid var(--line);margin:auto;background:var(--home-surface)}
  </style></head><body><div class="review-toolbar"><strong>远程连接 · 设置页设计稿</strong>
  <label>入口 <select id="surface"><option value="desktop">Desktop · 管理访问</option><option value="web">Web · 当前连接</option></select></label>
  <label>状态 <select id="state"><option value="enabled">已开启 / 已连接</option><option value="off">尚未开启</option><option value="loading">读取中</option><option value="error">读取失败</option><option value="offline">连接中断 · Web</option><option value="expired">登录失效 · Web</option></select></label>
  <label>主题 <select id="theme"><option value="day">Porcelain Day</option><option value="night">Steel Night</option></select></label>
  <label>视口 <select id="viewport"><option value="1440x920">1440 × 920</option><option value="1040x700">1040 × 700</option><option value="2560x1440">2560 × 1440</option></select></label>
  <button id="reset" type="button">重置交互</button></div>
  <p class="review-note">固定模拟数据，不连接 Host，不开启服务，不保存真实令牌。设置侧栏、通用页、外观页与控件样式直接复用生产代码。此工具栏不属于产品。</p>
  <p id="note" class="review-note" role="status">可点击设置中的「通用」「外观」与新菜单「远程连接」比较风格。</p>
  <div class="review-stage"><iframe id="product" title="远程连接设置设计稿，固定模拟数据"></iframe></div>
  <script>
  const product=${JSON.stringify(product).replaceAll('<', '\\u003c')};
  const byId=id=>document.getElementById(id);
  function render(){const theme=byId('theme').value;document.documentElement.dataset.theme=theme;const [width,height]=byId('viewport').value.split('x');byId('product').width=width;byId('product').height=height;byId('product').srcdoc=product.replace('<html lang="zh-CN">','<html lang="zh-CN" data-review-theme="'+theme+'" data-review-surface="'+byId('surface').value+'" data-review-state="'+byId('state').value+'">')}
  byId('surface').onchange=()=>{byId('state').value='enabled';render()};byId('state').onchange=()=>{if(['offline','expired'].includes(byId('state').value))byId('surface').value='web';else if(['off','error'].includes(byId('state').value))byId('surface').value='desktop';render()};byId('theme').onchange=render;byId('viewport').onchange=render;byId('reset').onclick=render;
  addEventListener('message',event=>{if(event.source===byId('product').contentWindow&&event.data?.type==='remote-review-note')byId('note').textContent=event.data.message});render();
  </script></body></html>`
  const viewerPath = join(output, 'remote-connection-review.html')
  await writeFile(viewerPath, viewer)
  return { productPath, viewerPath, output }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildRemoteConnectionReview()
  process.stdout.write(`远程连接交互稿：${result.viewerPath}\n模拟数据；不启动 Host 或 Runtime。\n`)
}
