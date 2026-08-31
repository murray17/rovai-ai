# Rovai 文件预览区 · 设计说明

## 设计判断

文件预览不是新的 IDE、文件管理器或浏览器，而是 Camp 阅读流旁边的一块只读证据面。它复用
Rovai 当前的 Porcelain Day / Steel Night 视觉世界：固定 270px 导航、开放会话阅读面、中性 Evidence
表面、低饱和 Steel 选择态、系统字体、紧凑控件和 4/8px 节奏。原先偏高的工作区顶栏在本稿中收拢
为 38px，并成为会话、文件预览和 Inspector 共用的一行。

本稿使用 UI/UX Pro Max 的本地检索结果校准键盘焦点与 Tab 顺序，并对照本机 Codex 应用静态资源中
`toolbar` Tabs 的真实规则校准标签：小间距、圆角次级 surface 选中态、透明未选中态、无逐项边框和
无品牌色下划线。仓库 `DESIGN.md`、主题合同、Camp 会话组件合同和生产 token 始终优先。

## 构图

- 文件预览与 Conversation、Inspector 平级，不进入 Inspector，也不复制 Sidecar。
- 会话上下文、文件 Tabs 和“任务 / 队员”Tabs 位于同一工作区顶栏，并与下方三列严格对齐。
- 会话槽位只保留项目、会话标题和日期状态，不放置分享或更多操作。
- 文件预览在 Tabs 下仅保留一行只读文件路径和 Viewer，Inspector 正文只承载当前选中的 Sidecar 面板；
  两者都不再重复标题栏或操作栏。
- 共享顶栏统一使用会话区 surface，并与正文连续衔接，不画横向分割线；三列之间只保留低对比
  `workspace-divider`，表达工作区关系但不形成厚重栏框。
- “任务 / 队员”右侧保留常驻 `SidecarToggle`；它是工作区顶栏的独立兄弟控件，不随 Sidecar 容器卸载。折叠后仍停留在顶栏最右侧，并切换为展开图标。
- Tabs 使用 Codex 的紧凑 toolbar 语法，不模拟传统 IDE 的连续矩形标签格。
- 文件名、阅读内容和当前状态是主层级；Viewer 不显示预览/源码切换、复制图标或更多菜单。
- 文件路径使用当前项目目录的相对路径，例如 `apps > desktop > … > CampWorkspace.tsx`，末段突出当前文件；
  整条路径从左侧自然排列，文件名紧跟目录而不是被推到最右侧。目录段不可点击；空间不足时才从目录中部
  省略并优先完整保留最后的文件名，不出现水平滚动条。完整相对路径仍通过悬停提示和可访问名称提供。
  路径行与 Viewer 之间保留一条细线，路径行与共享 Tabs 顶栏之间不画线。
- 文件 Tab 的关闭按钮保留固定占位但默认隐藏，hover 或 focus-within 时出现；触摸环境持续可见，避免把关键动作做成 hover-only。
- 代码、Diff、路径、行号和文件元数据使用 Evidence token 与等宽字体；品牌色不进入证据正文。
- 不属于首版预览支持矩阵的文件不创建 Tab、不改变预览布局，点击后沿用现有默认应用打开行为。

## 响应式矩阵

| 模式 | 布局 | 返回行为 |
|---|---|---|
| 宽 | 会话 + 文件预览 + Inspector | 会话触发器保留；预览不抢焦点 |
| 中 | 会话 + 文件预览 | Inspector 仅隐藏并保留状态 |
| 紧凑 / 200% | 文件预览替换会话 | Tab 栏前导显示“返回会话” |
| Review 来源 | 文件预览替换 Files Changed Review | 前导显示“返回文件变更”，恢复原文件与滚动 |

模式由 Camp 内容容器可用宽度决定，而不是设备名称。设计稿控制条用于展示矩阵，不属于生产界面。

## 宿主平台投影

macOS 与 Windows 共用同一套 App Shell、WorkspaceHeader、文件 Tabs、Viewer、Sidecar、状态和主题
Token；平台切换不是第二套产品稿，也不复制文件预览状态机。

- macOS 保留系统字体优先、`⌘K` 与“在 Finder 中显示”；
- Windows 使用 `Segoe UI` 优先、`Ctrl+K` 与“在文件资源管理器中显示”；
- Windows 顶部增加 `File / Edit / View / Window` 四个 Renderer 菜单入口，视觉与当前生产
  `WindowsApplicationMenu` 对齐；入口只代表调用 Electron 原生 submenu，不在 Renderer 重建命令；
- Windows 菜单行右侧预留 Window Controls Overlay 空间，侧栏顶部预留收至 8px；本地 HTML 不伪造
  最小化、最大化或关闭按钮，真实 caption controls、Snap Layout、DPI 和系统阴影仍须在 Windows 真机验收；
- Day / Night、三列布局、Sidecar 折叠恢复、Tabs 与 Viewer 行为在两个平台保持一致。

## 文件类型覆盖

| 类型 | 稿中状态 | 生产方向 |
|---|---|---|
| TypeScript / 代码 | 行号、高亮、定位、选区附加 | 只读 Code Viewer |
| Markdown | 单一安全渲染视图、本地资源提示 | 独立 Markdown Viewer；超限才回退分页原文 |
| HTML | 单一沙箱视图、隔离说明 | sandbox iframe；超限/失败才回退原文 |
| 图片 | 适应区域、透明背景 | 受控 asset URL；不增加正文复制控件 |
| SVG | 单一图片式视图 | 不注入宿主 DOM；不提供源码切换 |
| Diff / Patch | 文件、hunk、加减行 | 通用 Patch Viewer |
| 大型日志 | 有界页、绝对行号、页范围 | Paged Text Viewer |
| PDF | 不进入文件预览；使用默认应用打开 | 首版不内嵌解析 |
| Office | 不进入文件预览；使用默认应用打开 | 首版不内嵌解析 |
| 音频 / 视频 | 不进入文件预览；使用默认应用打开 | 首版不内嵌播放 |
| 压缩包 / 数据库 / 二进制 | 不进入文件预览；使用默认应用打开 | 不展开、不猜测内容 |

## 状态覆盖

- opening：仅首次读取较慢时显示轻量 Loading；
- ready：直接显示内容，界面不出现 `Ready` 标签；
- external update：Tab 显示安静圆点，当前 Viewer 显示“有更新 / 重新加载”，不自动覆盖旧内容；
- refreshing：用户主动重新加载后仍显示旧内容，只让轻量刷新入口进入加载态；
- refresh error：继续保留旧内容，并显示“重新加载失败 / 重试”；
- opening error：首次打开失败时显示“无法打开文件 / 重试”；
- empty：最后一个 Tab 关闭后返回会话，不保留空白文件面。

句柄、Capability、Token、watcher 和 generation 均为实现细节，不映射成用户可见状态。文件系统事件只表示
“文件可能已更新”；原型用本地状态切换模拟，不读取文件，也不建设文件同步状态机。

## 键盘与无障碍

- Tabs 使用手动激活：方向键移动焦点，Home/End 到首尾，Enter/Space 激活；
- 关闭按钮在鼠标 hover、Tab focus-within 和无 hover 设备上可见；`Delete` 提供不依赖按钮可见性的键盘替代；
- 关闭 Tab 后聚焦相邻项，紧凑返回后恢复文件触发器；
- Sidecar Tabs 使用方向键与 Home/End 自动切换，选中面板和焦点顺序一致；
- `SidecarToggle` 有独立可访问名称、`aria-controls` 与 `aria-expanded`，层级高于文件 Tabs，折叠后仍可点击、可聚焦且焦点不会丢失；
- 图标按钮均有可访问名称，装饰图标从可访问树隐藏；
- 焦点采用主题 `--focus` 的 2px ring，不被状态条遮挡；
- 状态更新通过 polite live region 宣布，错误通过 alert 语义宣布；
- 动效只用于 120–160ms 的状态反馈，`prefers-reduced-motion` 下取消非必要过渡。

## 原型边界

本目录是设计评审稿，不是生产事实、Architecture、Contract 或实现证据。所有路径、文件内容、
Evidence 统计和消息均为合成 fixture；按钮只改变本地 DOM，不读取磁盘、不调用 Main/Core，也不执行
示例 HTML。控制区选择不支持的格式只模拟“交给默认应用”反馈，不会真的启动外部应用。Windows 菜单入口
的提示只说明生产路由，不能替代 Electron 原生菜单或 Windows 真机证据。
