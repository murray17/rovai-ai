# 文件预览区设计稿

本目录保存 Rovai 独立文件预览区的交互与视觉评审稿。

- [`index.html`](index.html)：可交互设计稿，可切换 macOS/Windows、Day/Night、宽/中/紧凑布局、
  会话/Review 来源、文件类型，以及首次打开、外部更新、主动刷新和错误状态；会话、文件标签与 Sidecar 标签共用紧凑顶栏，文件标签
  采用 Codex toolbar 风格，关闭按钮在 hover/focus 时出现；顶栏与正文无横向分割线，Sidecar 使用不随面板卸载的常驻折叠入口，
  文件 Tabs 下方增加随当前文件更新的项目相对路径行；整条路径从左侧自然排列，超长时才从目录中部省略，
  不出现滚动条，并只在路径行与 Viewer 之间保留细线。Viewer 不增加顶部操作。外部更新只显示轻量提示，
  主动刷新期间继续保留旧内容；不支持的格式不创建预览 Tab，沿用默认应用打开行为。
  Windows 投影复用同一页面，仅叠加当前顶层菜单、Segoe UI、`Ctrl+K` 和资源管理器文案；
  原型不伪造系统 caption buttons。
- [`PROJECT_DESIGN.md`](PROJECT_DESIGN.md)：构图、响应式、文件类型、状态和无障碍判断。

直接用浏览器打开 `index.html` 即可。顶部“设计稿控制区”不属于生产 UI；下方 App Shell 才是拟议界面。
URL 参数 `platform=darwin|win32` 可直接打开指定平台，例如 `?platform=win32&theme=day&layout=wide`。

该原型不是当前产品 Authority。正式实施仍以 `DESIGN.md`、`docs/ui/`、当前 Architecture、Contracts 和
唯一 current 版本文档为准。
