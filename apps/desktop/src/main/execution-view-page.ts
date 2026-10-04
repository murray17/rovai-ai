// The LAN service serves one public, read-only shell. Its JS and CSS are built
// from the same Renderer components as the desktop execution view.
export const EXECUTION_VIEW_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Rovai AI · 只读执行台</title>
  <script>document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day'</script>
  <link rel="stylesheet" href="/assets/execution.css">
  <script type="module" src="/assets/execution.js"></script>
</head>
<body>
  <div id="root"><main role="status">正在读取执行记录</main></div>
</body>
</html>`
