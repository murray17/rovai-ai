---
document_type: implementation-plan
version: v1.72
lifecycle: current
authority: message-export-implementation
last_updated: 2026-11-08
---

# 消息导出实施记录

User 确认 B 方案（复选框 + 中性灰行底）、移除预览汇总/规则入口，并授权独立 worktree 实现。
HTML/PNG 的头像、作者、时间、发送对象默认勾选；Markdown 不提供头像，其余三项默认勾选。
当前规范归[会话工作区](../../ui/components/conversation-workspace.md#消息导出)。

## 实现边界

- `MessageExport` 拥有会话内选择、范围选择、预览与格式选项；正文仍由 `ThreadWorkspace` 的现有结构化
  消息渲染路径提供。Composer 保持挂载；Thread 切换清理选择并取消未完成导出。
- `message-export` 投影可导出消息与 Markdown，生成独立 HTML 和 PNG。快照仅遍历导出阅读面，
  不遍历公屏执行区；内部动作转为静态元素，清洗消息 HTML，仅 HTTP(S) 链接保留可跳转行为。
  原图经既有 `ImageGallery` 受控附件/输出图读取和 Blob 缓存进入导出，不新增路径读取或上传接口。
- HTML 内嵌栅格图片原始字节与计算后的主题样式，保留可重排的正文布局，提供固定复制代码/图片放大行为。
  PNG 从固定 720px 阅读面生成，超限明确失败而不截断；Markdown 保留原围栏，结构化引用复用正文链接投影。
  文件／目录使用短名称与完整 URI，对话／使命使用完整标题与原目标；普通文本中非 HTTP(S) 链接仍降为静态文字。
- `MessageQuotes` 的原生选区浮条只保留引用，不改引用保存、复制与定位语义。
- `ConversationExportReader` 从新的 `threads.open` 连续尾部开始分页穷尽历史，固定消息序号上界，
  独立于浏览缓存、远端定位窗口和主会话滚动。任务代际隔离取消、切换与迟到响应；撤回/删除或重同步
  立即隐藏旧内容并在原上界内重读，用户重试重新确定上界，不把事件水位当历史快照。
- `ConversationExport` 复用真实正文组件、时间线构造器与共享导出条目投影，基于完整集合构造回复、
  连续消息相邻关系和旧 Run 输出图片；头像与附件沿用受控读取。
  旧消息缺少 Turn 且可能跨 Run 分组时，仅补读必要的只读 Run 资料（最多四个并发）；资料不可用时保留独立时间，不猜测分组。
- `ThreadNavigation` 四种菜单入口共用“复制会话 ID”下方的“导出会话”；不导航、不标记已读。
  直接打开既有预览，等待超过 350ms 才出现小转圈，不显示读取文案或进度数字；读取未完成、失败、空集合均不能下载。
- MobileUI 的 HTML 阅读面按可用宽度重排，页脚操作至少 44px；PNG 继续使用 720px 阅读面。
  原有抽屉结构抽为共享 `MobileConversationDrawer`，BusinessApp 与验收夹具使用同一组件，保留滚动和焦点返回。
- 五套主题增加 `--conversation-selection-surface`；使用现有动作色绘制复选框，没有新增外观设置。
- 无 Rust、Schema、DTO、授权或 Runtime 改动，不涉及模型上下文变化与真实模型验收。

## 验证归属

纯函数用例归 `message-export.test.ts`：默认选项、发布边界/顺序、范围选择、结构化投影、文件名、原相邻消息时间。
`conversation-export-reader.test.ts` 验证完整分页、超过 1000 条、固定上界、失败重试、取消/迟到响应、
撤回与重同步；`conversation-export-entries.test.ts` 验证旧回复、已撤回父消息不泄漏、引用、附件、关联输出图及源相邻关系。
浏览器行为归 `scripts/lib/message-export.test.mjs`，命令 `pnpm test:message-export-ui`：
使用现有生产 Renderer 夹具与独立临时 Chrome profile，拦截下载链接以检查三种格式 Blob，覆盖 HTML 离线图片/链接/放大、
PNG 像素中确有图片、缺图卡片、超长失败、元信息开关、日/夜中性灰、窄/矮视口、选文只保留引用、草稿及跨会话清理。
`scripts/lib/conversation-export.test.mjs` 使用同一生产夹具验证侧栏四类入口、菜单顺序、500/1240 条完整读取、
导航缺口、未打开 Thread、独立预览的取消/错误/重试/空状态、撤回重读和 PNG 超限。
`scripts/lib/message-export-mobile.test.mjs` 通过正式手机抽屉与长按菜单验证预览层级、五套主题、
窄屏排版和触控尺寸、格式切换、HTML 文件内容与 PNG 1440px 输出，以及关闭返回、取消和失败重试；三组均由 `pnpm test:message-export-ui` 运行。
回归覆盖任务列表状态、持续加载超时与重试、日/夜代码块计算样式对照、连续/跳选消息时间、默认/自定义标题，
以及下载后的独立 HTML 在 375 / 720 / 1440px 宽度重新排版且图标与引用标题同行。
新 Blob 图片挂载后在同一浏览器任务内立即调用生产快照/清洗/PNG 路径，检查初始 0×0、
解码后的图片与父卡片尺寸，以及第一次 PNG 的实际图片像素；不先等图片加载完再下载。
真实 `MemberAvatar` 接收带 `displayCrop` 的合成图片，比较独立 HTML 的裁剪尺寸、位移与 maxWidth。
长代码在三档宽度下检查复制按钮位于正文之外，且代码滚动区不与按钮相交；覆盖复制成功与失败时的完整选文。
夹具使用合成消息和图片，不启动 Core、Runtime 或日常用户实例。

`pnpm accept:message-export [App 路径]` 启动打包 Desktop 与生产 Host，使用全新临时 userData、
Skill 库和合成消息；确认数据库位于隔离目录后才写入样本。不拦截链接点击或 Blob API，通过 Electron
实际下载链路保存 HTML / PNG / Markdown，检查落盘字节与内容。没有真实模型 Run，也不安装或重启日常 App。

消息操作栏保留多选入口，会话顶栏不再提供导出按钮；引用语义继续由 `pnpm test:message-quotes` 拥有。
预览保留标题编辑入口和文档标题，三种格式移除重复来源行；默认会话名截为前 40 个字素并加省略号，编辑和导出使用同一短标题，正文完整保留。
类型、全量 Vitest、桌面构建、主题/英文词表和通用文档治理作为交付检查，不将模拟 transport 误作真实 Runtime 证据。

初始多选导出交付时 `pnpm typecheck`、全量 `pnpm exec vitest run`（265 文件、3086 项通过、2 项跳过）、
`pnpm test:rust:pr`（484 项通过、1 项忽略）、`pnpm test:message-export-ui`、
`pnpm build:desktop` 及三项文档治理通过。
浏览器夹具生成 1440 × 2312 PNG，并验证内嵌图片区域有实际像素；即时 Blob 用例从 0×0 开始，
第一次快照保留 400×200 图片、222px 父卡片和 320000 个对应的 2 倍 PNG 色块像素。
裁剪头像的放大尺寸、负位移与 maxWidth 均与生产预览相同；独立 HTML 在 375 / 720 / 1440px
均无页面横向溢出。App 内预览另覆盖 375 × 812 与 844 × 390、日/夜主题。

arm64 打包 Desktop 的 `pnpm accept:message-export` 通过：三种文件实际落盘，HTML 保留两种任务状态，
1440 × 1086 PNG 目视确认勾选状态和代码样式，Markdown 保留任务语法和 `diff` 围栏。
脚本等待刷新后的新页面与启动遮罩退出，再使用鼠标操作；下载不拦截点击或 Blob API。
本项启动了隔离的生产 Core/Host，没有启动真实 Runtime，也没有安装或重启日常 App。

## 审查修复

- GFM 任务复选框先转为静态 SVG 标记，再清理通用控件，保留 checked 状态。
- 资源加载截止仍 pending 时阻止生成，保留当前预览、选择与重试入口。
- 全部图片解码前不克隆、不测量节点尺寸；解码后的布局同时决定图片、附件卡片和文档高度。
- 导出 Markdown 纳入同一组会话代码样式作用域；同时保留背景、边框、圆角与内边距。
- 默认标题使用当前 sourceTitle；手动标题单独保存，不被会话改名覆盖。
- 多选入口恢复双勾列表图标。连续发言沿用现有生产代码的末条时间，不采用审查中误述的首条时间。
  导出与原会话共用分段判断，并记录源时间线下一条 ID，避免跳选消息被误合并。
- HTML 排除计算后的宽高和网格像素轨道，恢复引用标签的相对网格；PNG 继续冻结阅读面尺寸。
- 头像及其子树保留原有尺寸、裁剪位移和最大宽度；正文与普通附件仍可重新排版。
- 独立 HTML 保留会话代码框的复制按钮和独立操作列，绑定离线复制/选文行为，不在 pre 上覆盖新按钮。

## Worktree 交接

2026-11-04 侧栏完整导出验证：

- `pnpm typecheck` 通过；`TZ=UTC pnpm exec vitest run` 共 268 文件、3107 项通过、2 项跳过。
  当前本机 Honolulu 时区下原有 About Updates 两项日期断言失败，固定 UTC 后通过；本轮没有修改这些测试或日期显示行为。
- `pnpm test:message-export-ui` 两组生产 Renderer 浏览器测试通过：500 条原始消息输出 498 条可导出消息，
  1240 条输出 1238 条，并验证 Markdown 文件正文和顺序；排除系统记录和已撤回消息。
  刚打开、带导航缺口和全部加载的结果一致；已选集合在补载与新消息后保持不变。
  同时覆盖旧回复/引用/附件/关联输出图、四类菜单入口（含两种键盘键）、取消、迟到、切换、重试与撤回重读。
  五套主题、375×812 / 844×390 / 720×620 预览不超出窗口；PNG 超限明确失败。
- Desktop/Web 构建与通用文档治理通过。浏览器只使用合成消息、独立 profile 和 Blob 内容检查，
  本轮没有启动真实 Core/Runtime，也没有新增打包 Desktop 的实际落盘验收。
- 完整 HTML 沿用内联计算样式的现有生成器，文件体积随消息和 DOM 复杂度增长：本轮含代码、图片的
  498 条样本约 36 MB；极长会话仍有浏览器内存与生成耗时边界。PNG 继续使用原有高度/像素限制，不静默截断。

2026-11-04 User 确认 Mobile 交互稿后，手机 HTML 阅读面与页脚触控尺寸已进入生产样式。
`TZ=UTC pnpm test`（含 Vitest 3107 项通过、2 项跳过）、类型检查、Desktop/Web 构建、三组
`pnpm test:message-export-ui` 与通用文档治理通过。正式手机抽屉/长按路径的五套主题和
375×812 / 390×844 / 430×932 均无页面或 HTML 阅读面横向溢出，页脚按钮至少 44px；
Mobile HTML 文件保留消息、图片和任务状态，PNG 实际生成 1440×3054 文件。
预览关闭返回原抽屉和来源行，保留草稿；读取取消、失败与重试通过。浏览器使用合成数据与独立 profile。

Work item: 侧栏完整会话导出与移除选文导出

Worktree: 仓库同级 `rovai-ai-sidebar-conversation-export`（绝对路径保留在线程交接）

Branch: `rovai/sidebar-conversation-export`

Base: `origin/main`，`25562d55f69a2e62c7d7f35005959e1f9fdda163`

Governance: none

Status: ready

Next: 按 User 授权完成 Mobile 适配、创建以 main 为 base 的 PR 并合入；确认远端合入后同步主 checkout，按 worktree 规则收口。
