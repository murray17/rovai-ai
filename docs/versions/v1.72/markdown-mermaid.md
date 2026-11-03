---
document_type: implementation-plan
version: v1.72
authority: markdown-mermaid-implementation-and-acceptance
status: complete
last_updated: 2026-11-03
---

# Markdown Mermaid 审阅交付

范围来自 [#979](https://github.com/murray17/rovai-ai/issues/979) 及本轮确认：完成文档和消息图表审阅，包含宽图、
长图、源码、复制、主题、失败回退和手动重试。消息增量以 `faadca7a43dbd1b0bc74dc18b727438c7befbfd6` 为实施基线，
逐块闭合后立即出图，不等待整条回复结束。编辑、图片导出及退出应用后的状态恢复不作为完成门槛。
固定离线加载路径是内部验证顺序，不单独交付缺少阅读交互的基础版。

合并前硬门槛：与 `277b562f178c62b38a8f50dfe81282118566786f` 在同平台、架构、构建与签名配置下比较，
实际安装分发包和安装后的 App 文件逻辑大小均须净增不大于 0。本轮已重新构建并通过此门槛，精确字节数见下表；旧验收的约 16.6 MB 增量不能作为可接受结果。

当前行为归[架构](../../architecture/file-preview.md#markdown-图表渲染)与
[UI](../../ui/components/file-preview.md#markdown-图表阅读)。这是局部可逆实现，不新增 Version Decision、
Core 合同或数据库 Migration。

## 实现

- `DocumentMarkdown` 和 `MessageMarkdown` 向 `SafeMarkdown` 注入稳定代码块组件；普通消息代码保持原有 children 与样式。
- 执行控制台从轻量 context 消费预览能力，不再因 Provider 间接打包文件查看器、语法引擎与 Mermaid。
- `MarkdownMermaidBlock` 拥有请求序号、当前结果和用户视图偏好；候选图片先解码再提交。
- `mermaid-renderer` 统一串行、身份校验和整代重置；`mermaid-sandbox` 仅执行可信本地资源。
- 锁定 Mermaid 12.2.0 与 DOMPurify 3.4.17，使用 Vite 原生 asset URL 和动态 import。Desktop/Web 由一个多入口构建共享资源与公共模块。
  HTTP 加载 nonce 经典脚本；Desktop 读取同一资源后置入 nonce 页面壳。正式宿主 CSP 保持不变。
- `PreviewImage` 从原图片 Viewer 提取，复用缩放、尺寸和错误处理，溢出区域由可聚焦滚动容器承接。普通图片的位置保存/恢复使用实际滚动节点，
  同一图源的主题换图以稳定内容身份保留大图比例、尺寸与滚动位置。
- Desktop 只缓存成功读取的脚本文本；旧代未完成读取不会阻塞新请求。

## 验证

定向 Vitest 覆盖精确分发、源码保留、引擎串行、超限、加载失败重试、超时后结算当前及排队任务、伪造与迟到响应。
`pnpm test:markdown-mermaid` 使用同一生产组件的正式 Vite 构建，在 HTTP 浏览器与 Electron file 入口检查：
flowchart、graph、sequence、class、state、ER、中文、宽图、长图和坏图；大图键盘/滚动/焦点；源码选择保持、
复制与文件查找；图片解码失败、实例丢失后手动重试、过期候选及卸载 URL 回收。

HTTP 夹具沿用正式 Host CSP。网络验收使用可达的受控 HTTP 地址，包含图中图片、HTML、CSS、click、frontmatter 和 init 覆盖输入，
不使用网络 abort/断网替代产品边界。此夹具不启动 Core 或真实 Runtime。

### 正式入口与回归结果（2026-11-02，修订验收）

`pnpm accept:markdown-mermaid` 在本轮 DMG 经 `ditto` 复制出的 macOS arm64 ad-hoc App 中启动独立 userData/Skill 目录，
从真实项目目录打开同一篇混合文档；随后登录该安装包 Host 自带的 Web UI，重复文档与大图操作。
两端均有 8 张正常图和 1 张局部失败图，中文、源码切换及大图正常；Desktop 主题切换和文件监视刷新保留
源码选择。Desktop 实际读取 `Resources/web-ui/assets` 的三份脚本，Web 通过同一安装目录的 `/assets`
静态入口读取，未放宽 CSP 或增加资源服务。实际安装产物没有连接日常数据或启动模型 Run。这是 macOS Desktop 与 Chrome Web 验收，
不等同于 Windows/Linux 整机验收。

- 真实 Mermaid 专项：Web（正式 CSP）与 Electron file 两端通过；常见图种逐一检查 SVG 文本标签。
  恶意输入从引擎渲染到最终图片展示全程观察可达服务器，外部资源请求为 0。
- 新回归通过：普通 PNG 图片在 125% 缩放、横向 420px / 纵向 310px 滚动后重建预览，比例与位置恢复。
- 新回归通过：首次本地脚本读取持续等待，旧代超时后手动重试，实际再次读取并成功渲染。
- 新回归通过：宽图与长图的大图在主题换图后保留比例与滚动位置。
- 类型检查通过；Vitest 262 个文件、3058 项通过，2 项跳过。并行打包时两项文件 IO 测试超时，
  结束打包后定向及全量重跑均通过，未增加超时或放宽断言。
- 默认 Node 测试 365 项通过，2 项跳过；文档测试 10 项通过；Skill 与 Electron sandbox 能力门禁通过。
- `pnpm test:rust:pr` 本轮全量通过（484 项，1 项忽略）。
- 原代码复制浏览器回归通过。原文件布局浏览器回归在宽表格滚动断言失败；将 SafeMarkdown、FilePreviewPane、
  styles 与语言资源恢复为基线 `277b562f1` 后，同一测试仍在同一断言失败，记录为既有问题，未改动其断言。
- 文档版本及 Decision 治理门禁在包含本次变更的干净索引快照通过。本机被忽略的 `docs/prototypes/` 有历史
  断链，直接运行 `pnpm test` 会先在文档扫描处停止；保留这些本地文件，未为本功能增加检查例外。

### 安装体积：零净增已通过

以 `277b562f178c62b38a8f50dfe81282118566786f` 的干净源码归档重新构建基线，与本轮产物在同一台
macOS 26.6 / arm64、Node 26.12.1、pnpm 11.20.0、Electron 43.1.1、electron-builder 26.15.3 环境比较。
两份锁文件均冻结安装；Rust 源码和 Cargo.lock 未改变，使用同一次 Release arm64 构建的相同 sidecar 字节，
分别完成前端构建、组装、签名和分发包生成。两边均为 `identity=-` ad-hoc、hardened runtime，未公证；
压缩均为 electron-builder 默认 `normal`（DMG UDZO，ZIP Deflate），未用不同压缩或签名配置抵消增量。

| 项目 | 基线精确字节数 | 本轮精确字节数 | 差额 |
| --- | ---: | ---: | ---: |
| 实际 DMG | 157,619,877 B | 154,640,892 B | **−2,978,985 B** |
| 实际更新 ZIP | 157,667,231 B | 154,678,297 B | **−2,988,934 B** |
| 从各自 DMG 复制安装的 App | 410,944,692 B | 402,043,961 B | **−8,900,731 B** |

App 口径为逐个普通文件的逻辑 `st_size` 合计，不计目录块分配，不沿符号链接重复累加目标。
两份安装 App 均通过 `codesign --verify --deep --strict`。该表取代旧验收的目录型 App 估算，不跨口径相减。
分发包与 App 分别满足净增不大于 0；未以首屏或按需加载数字替代安装体积。

控制台现在只有 `execution.js`（996,943 B）和 `execution.css`（735,291 B）两个固定资源，无 document 脚本
或 worker 悬空引用。最终 ASAR 不包含 `out/renderer`；生产多入口构建在现有 `web-ui` 内共享公共依赖、样式和
可信离线资产，保留 `desktop.html` / `index.html` 两个入口。没有删除图种、中文、图片阅读或现有前端功能，
没有 CDN、首次下载或新资源协议。开发 HMR 仍沿用原入口。

| Mermaid 相关资源（均在 `Contents/Resources/web-ui/assets`） | 实际副本数 | 总字节数 |
| --- | ---: | ---: |
| `mermaid.min-CDSj-a4E.js`（完整引擎） | 1 | 5,494,801 B |
| `purify.min-B6fOEg_O.js` | 1 | 29,828 B |
| `mermaid-sandbox-entry-BWXONEOb.js` | 1 | 4,408 B |
| `mermaid-sandbox-CoPjuEoh.js`（异步加载模块） | 1 | 1,334 B |
| 合计 | 每项一份，Desktop/Web 共用 | **5,530,371 B** |

复现：两端冻结安装后 `pnpm build:desktop`，使用相同 Release sidecar，运行
`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg zip --arm64 --publish never -c.mac.identity=-`。
挂载各自 DMG 后用 `ditto` 复制 App，再按上述口径统计。验收运行
`pnpm test:markdown-mermaid`、`ROVAI_FILE_PREVIEW_CASE=image-reading pnpm test:file-preview-layout`、
`node scripts/accept-markdown-mermaid.mjs /absolute/path/to/installed/App.app`。
设置 `ROVAI_MERMAID_OUTPUT` 可保存截图、离线资源路径、真实 SVG 样例和 JSON 结果。

### 消息与流式增量（2026-11-03）

沿用既有引擎、隔离模块、队列、恢复、大图与共享离线资源。本轮仅泛化代码块插槽、记录现有解析器的围栏 token，
补充展示层正文完成信息、接入消息调用点，并在单聊添加通用尺寸跟随与同回合正文交接。
保持 Markdown 原始行尾；全文获取不等于正文完成，未知、中断及截断预览均保守等待显式闭合。
闭合行末尾尚未收到行结束符时继续显示源码，后续只追加换行即可准入；不采用防抖或新增 Core 字段。

单聊只在同一 Run 内存在唯一、相同正文时复用已挂载容器，最终回复发布不重建图表或大图；
不跨消息匹配，不增加全局图形缓存。消息布局、复制、Mention、链接、搜索和存储保留原有真源。

新增验证：解析器覆盖反引号、波浪线、不同长度、列表、引用、CR/LF/CRLF、隐式 EOF 与不合法闭合；
浏览器分批输入实际正文，在未完成状态收到闭合行换行后检查图形已显示，追加其他正文及未完成图块不重绘旧图。
完整单聊面板验证源码选择、大图实例与滚动位置跨最终回复交接，并延迟真实图片解码验证跟随最新及历史阅读。
结构化 Mention 位于图块外时，图形视图中的现有复制按钮直接使用该块原始源码；块内的结构化节点保留原 children，
不把合成占位符交给引擎。未就绪、已闭合、完成和主题变化均不覆盖用户主动选择的源码视图。

本轮实际 DMG、更新 ZIP 与从该 DMG 复制的安装 App 如下。原基线和 `faadca7a4` 使用上轮保留的安装分发产物，
重新核对精确大小、SHA-256 和签名；与本轮使用同一 macOS 26.6 / arm64、Node 26.12.1、pnpm 11.20.0、
Electron 43.1.1、electron-builder 26.15.3。锁文件、依赖、Rust 源码与 Cargo.lock 均未改变，使用相同 Release sidecar 字节。
三者均为 ad-hoc `identity=-`、hardened runtime、未公证，默认 `normal` 压缩（DMG UDZO、ZIP Deflate）。
App 仍按不跟随符号链接的普通文件逻辑大小统计，均通过 `codesign --verify --deep --strict`。

| 产物 | 原基线 `277b562f1` | 增量基线 `faadca7a4` | 本轮 | 相对原基线 | 相对增量基线 |
| --- | ---: | ---: | ---: | ---: | ---: |
| DMG | 157,619,877 B | 154,640,892 B | 154,632,028 B | −2,987,849 B | −8,864 B |
| 更新 ZIP | 157,667,231 B | 154,678,297 B | 154,680,625 B | −2,986,606 B | +2,328 B |
| 安装 App | 410,944,692 B | 402,043,961 B | 402,048,155 B | −8,896,537 B | +4,194 B |

三项均满足相对原基线零净增。引擎、DOMPurify、sandbox 启动脚本及异步模块仍各一份，合计 **5,530,371 B**，
位于 `Resources/web-ui/assets`，Desktop 的 `desktop.html` 与 Host Web 的 `index.html` 共用；异步模块文件名随构建
hash 改变，体积仍为 1,334 B。执行控制台仍只有固定 JS/CSS，无引擎引用；ASAR 无文档资源副本或 `out/renderer`。

本轮验收已通过：

- 类型检查；全量 Vitest 264 个文件、3078 项通过、2 项跳过；最终复制修正后相关 56 项重跑通过。
- Web 与 Electron Mermaid 专项，包括真实分批输入、嵌套列表/引用闭合、未完成与隐式 EOF、旧请求失效、
  Mention 消息中图形视图复制、源码偏好、错误恢复和原文档阅读回归。
- 单聊面板、返回最新与 Mermaid 交接三项原生回归；代码复制两项及消息引用专项通过。
- 最终 DMG 安装 App 与自带 Host Web 正式入口通过：文档 8 张正常图 / 1 张局部失败图；消息 3 张正常图 / 1 张局部失败图，
  源码、大图、宽度限制、异步出现后的跟随最新及历史阅读位置均通过。完整资源路径仍指向同一安装目录。
- 默认 Node 测试 365 项通过、2 项跳过；Rust workspace 484 项通过、1 项忽略；Skill 与 Electron sandbox 门禁通过。
- 文档单测 10 项通过；包含本次修改的受管文件索引快照通过版本、链接和 Decision 门禁，diff-aware base 为同步后的
  `origin/main`（`393a56f67`）。工作区直接运行 `pnpm test` 会在被忽略的 `docs/prototypes/` 既有断链处中断；
  后续默认测试阶段分别运行通过。本次没有修改这些原型或为检查器添加例外。

另提供独立离线 HTML 前后交互稿：以同步后的 `main`（`22fa81c8f`）为 UI 行为对照，比较本分支
`faadca7a4`。同一份 Markdown 在 main 中显示为普通代码块，在本分支中自动绘图；main 不展示图形切换、
大图或渲染重试入口。稿件复用两端的生产样式、现有界面 DOM 和真实 SVG，支持源码与复制、宽图与长图、
主题和失败回退；预渲染图形与模拟加载失败均有明确说明。1440px / 390px 浏览器验证通过，无外部资源请求。
它不参与构建或替代生产验收。

### 图表阅读交互落实（2026-11-03）

在 `b64cce588` 上落实确认后的交互稿，并补齐 `7d044a3bc` 的评审反馈。块头部保留 Mermaid 标题，复用文件视图图标切换，
图形、源码、展开和复制常驻；点击图形也可打开大图。正文图形和源码区高度上限为 360px，
大图内复用 `ReadonlyCodeViewer`、`PreviewImage` 和 `MarkdownCodeFrame`，切换时保留两个视口的局部阅读状态。
生成中主动选择源码仍优先；准入失效关闭当前大图，恢复准入后不自动重新打开。
共享源码查看器的主题锚点同时保存横向位置，在原纵向可见行恢复完成后还原 `scrollLeft`。图表操作
保留共享键盘焦点样式，图片入口增加同色内侧轮廓。失败图可以展开已有源码，继续复用同一弹窗；
展开源码记录主动源码选择，重试成功不强制切回图形。未闭合的流式块仍等待闭合。

没有新增依赖、引擎副本、渲染状态系统或资源服务。源码大图不加入背后文件的查找范围，关闭后仍保留
原文件的查找适配器。手动复制恢复弹窗独立消费 Escape，避免同时关闭下层大图；焦点返回实际操作入口。
文件和 HTML 原有切换保持幂等，重复点击已选中的图标不会切到另一视图。规范归
[图表阅读合同](../../ui/components/file-preview.md#markdown-图表阅读)。

复用同一 macOS 26.6 / arm64、Node 26.12.1、pnpm 11.20.0、Electron 43.1.1、electron-builder 26.15.3，
冻结安装。Rust 源码、Cargo.lock 和 JS 锁文件未改，使用与对照产物相同的 Release sidecar 字节。
全部为 ad-hoc `identity=-`、hardened runtime、未公证，默认 `normal` 压缩（DMG UDZO、ZIP Deflate）。
旧产物重新核对大小与 SHA-256；本轮 App 从实际 DMG 用 `ditto` 复制安装。App 均按不跟随符号链接的
普通文件 `st_size` 合计，四份 App 均通过 `codesign --verify --deep --strict`。

| 产物 | 原基线 `277b562f1` | 增量基线 `faadca7a4` | 本轮 | 相对原基线 | 相对增量基线 |
| --- | ---: | ---: | ---: | ---: | ---: |
| DMG | 157,619,877 B | 154,640,892 B | 154,628,910 B | −2,990,967 B | −11,982 B |
| 更新 ZIP | 157,667,231 B | 154,678,297 B | 154,682,620 B | −2,984,611 B | +4,323 B |
| 安装 App | 410,944,692 B | 402,043,961 B | 402,058,292 B | −8,886,400 B | +14,331 B |

三项继续满足相对原基线零净增。相对本轮直接基线 `b64cce588`，DMG 为 −3,118 B、ZIP 为 +1,995 B、
安装 App 为 +10,137 B。三处评审修正相对 `7d044a3bc` 的 DMG / ZIP / App 差额分别为 +623 B / −258 B / +232 B。引擎、DOMPurify、sandbox 启动脚本及异步模块仍各一份，总计 **5,530,371 B**，
全部在 `Resources/web-ui/assets`，Desktop / Host Web 共用。ASAR 无上述资源或 `out/renderer` 副本；
执行控制台仍只有固定 JS/CSS，无引擎引用。

验证结果：

- 类型检查、默认前端/Node/文档/Skill 门禁通过；Vitest 264 个文件、3078 项通过、2 项跳过，
  默认 Node 测试 365 项通过、2 项跳过；Rust workspace 484 项通过、1 项忽略。
- Mermaid Web 与 Electron 专项通过：实际流式分片、未完成源码选择、隐式 EOF、超时恢复、原有安全边界、
  复制失败恢复、大图图形/源码切换、主题换图、两个方向的阅读位置、实际焦点返回、文件查找保持及窄屏布局。
  新增的 30,827 B 长行源码用例在未修复版本两端均复现 `scrollLeft: 240 → 3`；修复后日/夜往返均为
  `240 → 240`，可见行与 Editor 实例保持。真实 Tab 导航验证源码、展开、图片和关闭入口都有 2px 可见轮廓；
  语法错误、长度超限和解码失败均可展开并复制完整源码，不重绘，关闭后焦点返回。
- 单聊布局、返回最新、逐步正文交接三项通过；现有 App 与网站的代码复制回归分别通过。
- 从最终 DMG 安装的 Desktop 与同安装目录 Host Web 入口通过；文档 8 张有效图 / 1 张局部失败图，
  消息 3 张有效图 / 1 张局部失败图；两端大图源码切换、失败源码展开、宽图位置及公屏跟随最新/历史阅读均通过。
- 共享文件预览专项的源码主题/选择检查通过，完整专项在静态 Markdown 的 `tableScrolls` 断言失败；
  未修改的 `b64cce588` 于相同环境复现 `main.cjs:524` 的同一失败，未改动该表格断言或扩大修复范围。
- HTML 专项新增的重复选择检查通过；完整专项 3 项通过、2 项失败。未修改的 `b64cce588` 在相同环境
  复现同两项失败：`runs History initialization and a query-addressed nested canvas independently` 与
  `recovers diagnostic loss without replacing the page`。前者涉及既有路径/诊断动作与刷新断言，后者涉及诊断恢复。
  本轮不修改这些断言或扩大 HTML 预览实现，不能将完整 HTML 专项表述为全部通过。
