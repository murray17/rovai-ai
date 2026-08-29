---
document_type: ui-component-contract
authority: renderer-file-preview
status: accepted
last_updated: 2026-08-29
---

# Camp 文件预览区

## 结构与布局

文件预览与会话、任务/队员 Sidecar 平级。三列共用一行紧凑 `WorkspaceHeader`：左侧显示会话定位，文件 Tabs
直接占中间槽位，任务/队员 Tabs 与常驻折叠按钮占右侧槽位。顶栏使用会话 surface，与正文之间不画横线；列之间
只用低对比 workspace divider。会话槽位不显示分享或更多操作。

容器宽度满足三列时显示宽布局；只满足会话+预览时隐藏 Sidecar 但保留其状态；不足时预览替换会话，并在 Tab
栏前导位置显示“返回会话”。布局使用 ResizeObserver 或等价实测，不只依赖 viewport media query。预览宽度可拖动，
约束在 360px 与可用内容宽度 48% 之间；紧凑模式没有拖动手柄。任何模式都不得令应用产生水平滚动。

## 文件 Tabs

Tabs 使用 Codex toolbar 语法：小间距、无逐项边框、当前项用次级 surface 和文字对比表达，不使用品牌下划线。
文件名使用 UI 字体；重名时显示 `父目录/文件名`。关闭按钮预留固定宽度，默认透明且不响应指针，Tab hover、
focus-within 或粗指针环境下显示，因而文件名不位移且键盘/触摸始终可达。

Tablist 采用手动激活与 roving tabIndex：左右、Home/End 移动焦点，Enter/Space 激活，Delete 关闭，
Alt+Shift+左右重排。关闭后优先激活右侧，再回到左侧；最后一项关闭后返回有效触发器，否则返回会话主阅读区。
后台打开不抢焦点，只用 polite live region 宣布；紧凑替换后把焦点移到当前 Tab。

## 路径与 Viewer

Tabs 下只保留一行只读相对路径和 Viewer。路径格式为 `apps > desktop > … > filename`，整体从左侧自然排列，
文件名紧跟最后一个可见目录，不固定到最右侧。空间不足时从目录中部省略，优先完整保留文件名；无水平滚动。
完整相对路径进入 title 与可访问名称。路径与 Tabs 间无线，路径与正文间一条语义 divider。

Viewer 不显示预览/源码切换、右上角复制按钮、整行工具栏或 `Ready` 状态。每个类型只有一个规范阅读视图：

- Markdown 渲染安全 GFM；超出 4 MiB 显示分页原文；
- HTML 在 sandbox iframe 中执行；超限或初始化失败回退只读原文；
- 代码/文本只读显示行号、搜索、定位、选择与系统复制，大文件分页；
- 图片/SVG 提供适应、原始尺寸、缩放和重置，不把 SVG 注入宿主 DOM；
- Diff/Patch 按文件和 hunk 展示，解析失败回退文本。

不支持的 Office、PDF、音视频、压缩包、数据库、可执行文件和未知二进制不进入预览。显式点击继续调用系统默认
应用；当前 Tab、布局和焦点上下文保持不变。

## 更新与错误

首次打开只有 opening/ready/error；快速成功直接显示正文，耗时后才显示轻量 Loading，失败显示“无法打开文件 / 重试”。
外部变化只显示 Tab 圆点与当前 Viewer 的“有更新 / 重新加载”。主动刷新期间旧内容继续显示；失败显示
“重新加载失败 / 重试”且不销毁 Tab。句柄、Grant、token、watcher 和 generation 永远不是用户文案。

## Sidecar 与平台

任务/队员右侧折叠按钮始终挂载并暴露 `aria-controls/aria-expanded`；折叠后按钮切换为展开图标，Sidecar 状态保留。
macOS/Windows 复用同一 DOM、reducer、Viewer 和主题 token，只投影 `⌘/Ctrl`、Finder/文件资源管理器、系统字体和
既有 window chrome 差异。所有焦点状态使用现有 2px focus token，焦点不得被 sticky 内容完全遮挡。
