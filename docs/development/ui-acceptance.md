---
document_type: development-guide
authority: desktop-ui-acceptance-infrastructure
last_updated: 2026-08-30
---

# 桌面 UI 验收与隔离数据

本文只说明长期稳定的桌面验收基础设施。当前版本必须覆盖哪些页面、主题、尺寸和状态，
以当前版本 `implementation-plan.md` 为准；不要把版本专属断言复制回本文。

## 当前 macOS 验收入口

```bash
pnpm package:mac
```

后续示例都从仓库根目录执行：

```bash
ROVAI_APP="$(pwd)/dist/mac-arm64/Rovai AI.app"
```

## 隔离 `userData`

所有桌面验收都必须使用显式隔离目录；`capture-desktop.mjs` 缺少该目录或解析到日常数据目录时会
在启动 App 前拒绝执行：

```bash
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_CAPTURE_USER_DATA_DIR="$FIXTURE_ROOT/user-data" \
node scripts/capture-desktop.mjs "$ROVAI_APP" "$FIXTURE_ROOT/capture"
```

不要省略 `ROVAI_CAPTURE_USER_DATA_DIR`，也不要把它指向日常目录或其符号链接别名。

打包 App 默认仍只允许一个实例。仓库验收脚本在收到独立
`ROVAI_CAPTURE_USER_DATA_DIR` 后，会为子进程设置
`ROVAI_ALLOW_ISOLATED_INSTANCE=1`。Main 只有在这两个条件同时成立时才放行验收实例；
单独设置环境变量不能绕过日常实例锁。

手动启动隔离实例时使用同一双重条件：

```bash
ROVAI_ALLOW_ISOLATED_INSTANCE=1 \
"$ROVAI_APP/Contents/MacOS/Rovai AI" \
  --user-data-dir="$FIXTURE_ROOT/user-data"
```

`capture-desktop.mjs` 支持的主题、窗口、Runtime、Camp 和管理 selector 以脚本顶部的
环境变量读取为准。通用尺寸示例：

```bash
ROVAI_CAPTURE_USER_DATA_DIR="$FIXTURE_ROOT/user-data" \
ROVAI_CAPTURE_WIDTH=1040 \
ROVAI_CAPTURE_HEIGHT=700 \
node scripts/capture-desktop.mjs "$ROVAI_APP" "$FIXTURE_ROOT/compact"
```

通用页面验收会在隔离目录缺少状态时写入 `completed(existing_installation)` 的私有
`onboarding.json`，以继续覆盖原有 App Shell；它不会修改已有 onboarding 状态。只有下文的
`accept:onboarding-ui` 使用真正全新的状态并拥有首次安装语义。

## 手动飞书终态卡片预览

用户明确要求向自己发送模拟卡片并允许重启后，可以在已安装 App 的本次启动参数中使用：

```text
--feishu-execution-preview=<request-uuid>/<agent-id>/<command-count>[,<command-count>]
```

这是 Main-only、默认关闭的手动预览入口，不是 Renderer IPC 或 Agent 工具。最多两张卡，每张 1～200 条模拟 command，
每次新预览使用新的 request UUID；同一 request/App/count 使用稳定发送 UUID。普通启动不读预览身份、不发送示例。
自动化验收仍使用隔离 `userData`；不能把这个参数当作操作日常 App 或发真实飞书消息的默认授权。

预览只复用指定已发布队员的现有长连接，向该 App 冻结且本机已记录的 Owner 发送。不会创建应用、改变发布配置、启动
第二条 WebSocket、运行示例 command，或写入 Camp、Message、Turn、Run、Outbox/console fixture。它只读 Core 当前数据目录
中 exact Bot/Owner identity，不读取 credential payload；发送使用 Main 已有的 SDK client。

模拟 timeline 和已脱敏页面只保存在 Main 内存，所有卡片明确标为预览。每次翻页核对可信 callback operator、App、消息 ID、
本次预览 sequence、页码范围、六小时有效期与当前本机 Owner 绑定，并仅 patch 原消息一次。不持久化 pageIndex、nonce 或
viewVersion，不产生 Core 命令或 pump；真实 execution console 和项目卡继续走原来的 Core 授权。预览在 App 退出后失效，
不能把此入口的验收当作真实 Run 的 Core seal/admission/恢复证明。

## Windows 验收入口（设计已接受、工具待实现）

当前 `package.json` 尚无可运行的 Windows package/accept 命令，下面是实现验收合同，不是可复制命令。脚本和
NSIS 落地后，命令名必须以 `package.json#scripts` 为真源，并在同一改动更新本文。

Windows lane 使用与生产 `%LOCALAPPDATA%\Rovai AI` 同构但完全隔离的绝对 data root，分别隔离 Core、Electron
User Data、Session Data、Logs、CrashDumps 和 Skill Library；它必须拒绝日常目录、junction/symlink 别名、UNC、
network/removable/non-NTFS 目标。验收覆盖 unpacked App 与 installed App，且不能共享 fixture。

自动化至少证明 hidden title strip、四个顶层菜单入口与受限 native submenu 路由、WCO/rail 双主题同色、
受控 Renderer drag region、8px Windows 侧栏顶部留白、平台快捷键/Explorer 文案、Runtime Platform Admission
与 Availability 正交、历史 Runtime 子对象精确保留、Forced Colors DOM/CSS 和 IME composition 不误提交。
真实客户端 OS 另外覆盖：

- Windows 10 22H2、Windows 11，`1040×700`、`1440×920`，100/125/150/200% display scale 与 200% page zoom；
- 顶层菜单与原生 submenu、Snap、最大化/还原、Alt+Space、多屏不同 DPI、Day/Night/System、High Contrast/Forced Colors；
- keyboard-only、NVDA、中文 IME、Explorer、local NTFS storage blocker；
- clean install、运行中 App upgrade、schema-incompatible downgrade、默认保留数据和显式删除数据的 uninstall。

固定 Windows Server runner 只提供 compile/package/automated evidence，不证明上述客户端 UI。完整边界见
[Windows Interaction Delta](../ui/windows-interaction-delta.md)和
[Windows x64 构建、打包与发布设计](packaging-windows.md)。

## 独立 UI 验收

以下 package scripts 自行创建或要求隔离 fixture，不调用模型：

```bash
pnpm accept:memory-ui
pnpm accept:member-avatar-ui
pnpm accept:member-lifecycle-ui
pnpm accept:notification-ui
pnpm accept:sidebar-ui
pnpm accept:conversation-find-ui
pnpm accept:composer-skill-picker-ui
pnpm accept:composer-skill-context
pnpm accept:structured-mentions-ui
pnpm accept:task-card-ui
pnpm accept:runtime-activity-ui
pnpm accept:diagnostics-ui
pnpm accept:app-updates-ui
pnpm accept:onboarding-ui
pnpm accept:bootstrap-shell-ui
```

它们分别覆盖长期记忆、队员头像、队员生命周期、应用内通知、统一侧栏（含 Project/Camp 置顶、
可恢复 Project 移除、跨重启隐藏、Quick Chat 焦点回退与 Core 数据保留）、结构化提及和
当前会话完整正文查找（含地图快捷返回、非 Camp 边界、旧消息 anchored 定位与双主题双尺寸）、
Task 创建操作行、完整表单聚焦、取消恢复与单卡原地更新、十三 Runtime Canonical Activity 工具名称与 Agent 级连续执行过程、A2A 消息
Scheme C 转交 footer，诊断中心双尺寸、只读自检、MCP 权限修复复检与 v5 脱敏，以及“关于与更新”
的真实 packaged 版本、确定性禁用网络自动检查、App Update v1 idle 快照，以及 Bootstrap Shell 在未知 authority 下
保留原文件、隔离业务树、显式重试不消耗 crash budget、Day/Night、1040×700、窄窗口、
200% 等效布局、reduced motion、键盘焦点和无横向溢出回归。available 到失败的完整状态/动作/fallback 矩阵由 Renderer
测试覆盖；签名 macOS/Windows 跨版本升级仍属于各平台 Release qualification。
当前 Neutral Porcelain + Steel 视觉迁移还必须按当前版本实施计划覆盖 2K Composer、八个设置页、
队员半身照与 Runtime 入口、记忆 Workbench、New Conversation 和各类 Dialog/Drawer。
具体 Schema/Migration 编号属于测试 fixture 和版本证据，不是本文的常青要求。

### 首次训练门禁

修改首次安装 admission、`onboarding.json`、三页 mandatory gate、Runtime/模型选择、provisioning、
`初次集结` 或第四页 starter 后，运行：

```bash
pnpm package:mac
pnpm accept:onboarding-ui
```

脚本必须使用全新隔离 `userData` 和 packaged App，在 `1040×700` 下证明：欢迎页无 Skip/步骤导航；
队员页只有一张当前半身像与四条文字选择；重启分别恢复未完成的队员页和 Runtime 页。Configured 分支
必须证明真实 Runtime 状态与模型默认值可用，第三页完成后创建 Active Quick Chat `初次集结`，Camp 只有
所选成员且同一成员是 Default Lead；第四页默认显示三条 `A/B/C` starter，不得被地图偏好遮住或横向
滚动。点击 starter 后持久 Draft、Composer 焦点与末尾光标正确，CampMessage/AgentRun 数量保持不变；
再次重启仍保留 completed、同一 Camp 和未发送草稿。Deferred 分支必须使用确定性零 Runtime 隔离环境，
证明第三页显示三项结果边界、可展开安装说明、“重新扫描 / 进入 Rovai”，Day/Night 无溢出；重新扫描
返回真实进度，“进入 Rovai”落盘 `completed(runtime_deferred)` 且三个产品身份为空，不新增 onboarding
成员配置、Camp、Run 或 restore target，重启直接进入普通 App。两分支截图与 JSON report 输出到脚本报告的
隔离目录。

### 计划内关闭真实 Runtime 门禁

修改 Desktop quit、Core lifecycle coordinator、Runtime planned stop、terminal settlement、accepted-input
恢复或关闭等待面后，运行：

```bash
pnpm package:mac
pnpm accept:planned-shutdown
```

这个专项门禁会调用本机已认证的真实 Claude Code Runtime，因此不进入上面的无模型 UI 回归集合，也
不进入普通 commit 门禁。脚本自行创建临时 Git workspace、隔离 `userData` 和动态 DevTools port；固定
提示禁止工具、命令、文件读取与工作区修改，并在 Runtime input 变为 `accepted` 后立即请求 packaged
App 退出。macOS 验收按该隔离 App 的精确 PID 通过 `NSRunningApplication.terminate()` 发起正常 quit，
不得用可能占住 browser quit transaction 的 DevTools `Browser.close`，也不得匹配或关闭日常 App。
活跃 Run 实例只负责真实耗时、取消语义与进程回收；多主题截图由同一脚本使用另一份全新隔离数据，在
Core 首次启动仍进行本地初始化时触发慢退出，以免截图流程反过来拖慢或误判已经足够快的真实退出。

验收必须证明：

- `before-quit` 立即阻止新界面交互，前 400ms 不显示关闭反馈；慢退出显示无操作控件的 accessible busy
  modal，Day/Night、`1040×700`、200% zoom 与 reduced motion 下标题、条件取消说明和卡片边界均完整，
  背景不得出现关闭阶段的错误横幅或 Toast；
- Desktop 等待 Core 自行完成 drain 和子进程真实退出，App 以 `exit 0` 自然结束；只有验收清理失败
  分支才可对明确记录的隔离进程树发送信号；
- one-shot Runtime 进程中断不产生 Runtime cancellation acknowledgement：AgentRun 与
  CampTurn 均无取消 intent、无伪造 terminal source/reason，accepted Runtime Input Delivery
  保持不变；Core 使用 durable shutdown cycle 把未解决 Run product-fence 为 `cancelled`；
- 同一隔离数据目录重启后，原 Run 保持相同 execution epoch 与 terminal `cancelled`，
  不自动恢复或重发，不展示 spinner / recovery blocker，但 accepted input 不确定性继续
  通过“外部效果待确认”告警展示；
- 两次 packaged App 退出后，脚本观察到的 Core、Runtime 与 Electron helper 子进程全部被 reap。

成功时脚本输出 JSON report 与 Day/Night、200% zoom、terminal unknown-effect 四张截图；失败时保留
fixture 和截图路径用于排查。可用 `ROVAI_PLANNED_SHUTDOWN_ACCEPT_FIXTURE_ROOT`、
`ROVAI_PLANNED_SHUTDOWN_ACCEPT_OUTPUT_DIR` 指定绝对隔离位置，用
`ROVAI_KEEP_PLANNED_SHUTDOWN_FIXTURE=1` 保留成功 fixture；不得指向日常 App 数据目录。

### 队员页内容名册门禁

修改成员页入口、内容名册、Runtime 快捷入口、排序或离开保护后，至少运行：

```bash
pnpm package:mac
pnpm accept:member-lifecycle-ui
```

隔离夹具必须证明：队员页继续显示普通 270px 全局侧栏及 Project / Camp 导航；内容区只有一份队员
名册，默认约 236px，并可显式收至约 76px且记住偏好。名册 Runtime 入口显示 `✓ / ! / …`，不显示
产品 Logo；点击后精确选择该队员并聚焦运行配置。排序模式显示真实拖拽和键盘把手，并通过既有
`members.reorder` 持久化。运行配置保持模型、权限和沙箱功能，运行参数默认展开，状态与版本使用
开放式行内排版而不是灰色卡片。通过全局导航离开时仍要经过现有未保存 Runtime 草稿确认。
验收同时覆盖 1440×920、1040×700、200% zoom、reduced motion、Forced Colors 和无横向溢出，并
保留队员半身照、筛选、创建、编辑、Presence 与移除功能。

### Agent 执行过程门禁

Renderer 的权威行为见 [Run Process Detail Surface v26](../contracts/run-process-detail-surface-v26.md) 与
[当前 UI 详规：Camp 执行过程](../ui/components/conversation-workspace.md#camp-执行过程)。修改 AgentRun 分组、执行台、Drawer、
Task Related execution、停止结果或 Inspector 页签后，至少运行：

```bash
pnpm package:mac
pnpm accept:runtime-activity-ui
```

受控夹具必须至少包含同一队员的多个历史/当前 AgentRun，并证明：

- `.run-pulse-chip` 按队员而不是 Run 创建；同一 `data-agent-id` 只出现一个入口，入口数等于有
  AgentRun 的队员数；
- 点击入口后 `.execution-drawer` 只显示该 Agent 的所有 Run stage，按创建时间升序保留，并显示
  独立的 AgentRun/CampTurn 边界、调用来源、A2A 深度（适用时）、Delivery 与证据 disclosure；
- 打开入口时定位最新 `running`，否则最新 non-terminal，最后最新 terminal Run；一次真实的显式多队员
  用户发送按 Core `agentRunIds` 顺序打开第一条精确 Run，并证明自动打开后 Composer 仍持有键盘焦点；
  已经聚焦任意 non-terminal Run 时，新提交不得改选；
- 聚焦 live Run 且位于 Drawer 底部时，新公开输出跟随到底部；手动上滚后 `data-following-latest=false`，
  回到底部后恢复，仍在跟随时终态最后输出只定位一次；从其他 Camp、一级页面或应用启动/恢复进入含
  running Run 的 Camp 时自动展开 `createdAt + id` 最新 Run，queued/waiting/terminal 不触发，且不把 DOM
  焦点移入执行台；已经停留在同一 workspace 后，后台 A2A、Runtime 事件和 refresh 仍不打开 Drawer、
  不改选队员/stage、不滚动公共消息时间线或抢焦点；关闭和 Drawer 内 Escape 将焦点返回真实原入口；
- Drawer 顶边必须存在可聚焦的水平 resize separator；真实鼠标拖拽、方向键、PageUp/PageDown、
  Home/End、Enter 恢复默认和 ARIA 数值均通过。用户高度在同一 Main Window Session 的收起重开、
  切换 Agent/Camp 后保持；调整不得改变所选 Agent/stage，sticky-bottom 仍跟随，手动上滚仍暂停；
  最大高度在 1040×700 与 200% zoom 下不覆盖消息历史、Agent 执行台、Approval Dock 或 Composer；
- 默认底部 placement 下 Inspector 仅有“队员 / 任务”；点击“移到右侧”后底部 Run Pulse/Drawer
  消失，Inspector 自动显示并增加、激活唯一且位于首位的“执行”Tab，完整顺序为“执行 / 队员 / 任务”。
  两处入口都只显示头像、最多两行名称和
  带形状的状态标记，不显示状态文字；右侧入口为全宽纵向列表、最多约四行且超出内部滚动，详情不显示
  resize separator。点击“移回底部”恢复横向 Run Pulse、底部 Drawer、原基础 Tab、selected Agent/
  focused Run 和底部高度偏好；移动前后必须是同一个 Drawer 与结果 DOM，并按比例保留 Drawer/结果
  阅读位置、disclosure 和加载状态；任一时刻不存在第二条过程时间线或重复入口；
- 全新或旧版 General Preferences 没有位置字段时从底部开始；显式移到右侧后，切换 Camp、进入其他
  一级页面再返回和完整应用重启都继续由 Inspector 承载，再显式移回底部后同一矩阵继续由底部承载；
  保存中重复点击被拒绝，注入偏好原子写失败后执行台和旧 snapshot 均保持原位并显示可重试错误，恢复
  Inspector 偏好时首个 Camp meaningful paint 不出现 bottom→inspector 闪跳；
- placement=inspector 与 Inspector hidden 可以同时成立：进入不含 running Run 的 Camp 和已挂载 workspace
  的后台事件不强制显示 Inspector，也不临时回退到底部；进入含 running Run 的 Camp 必须显示 Inspector、
  激活首个“执行”Tab，并定位最新 Run。Header 恢复、用户显式“移到右侧”与 Task/停止结果/世界地图等
  精确导航仍显示 Inspector、激活“执行”并定位目标；
- Context Delivery/Approval/Activity/Audit Tab、旧 route/state 不得返回；“队员”读取真实
  CampMember/AgentProfile，并用既有 Core 命令切换一个符合 presence/leave 约束的 Default Lead；
  Task/停止结果/世界地图入口在当前 placement 按 Agent 打开过程，顶栏不存在执行入口；
- Approval Dock 是唯一普通审批决定 surface；顶栏与通知摘要只展开、定位并聚焦 Dock，不改变 Inspector
  显隐或页签。收起/展开不改变队列，解决最后一项后焦点返回 Composer；
- Drawer 顶栏只为当前聚焦且可停止的 AgentRun 提供一个“停止”按钮；单击必须直接提交、立即进入停止态，
  不挂载确认 Dialog、“继续运行”动作或第二个提交按钮。Composer 继续拥有唯一 CampTurn Stop；两级停止、
  Approval Dock 与 Composer 在 `2560×1440`、`1440×920`、`1040×700`、200% zoom 和 reduced motion 下均可见、
  可键盘到达且不互相遮挡；
- `2560×1440` 下 `.composer-box` 与可见 `.composer-route-rail` 都接近 1440px、居中且同轴；Inspector
  显隐后仍不超过 1440px。`.timeline-track`、Approval/Recovery Dock 与会话宽轨保持约 1040px，
  `Enter` keycap 位于发送按钮紧邻左侧；用户与所有 Agent 普通正文使用同一开放阅读表面，叙述保持约
  76ch，代码、表格、Task 和审批等现有结构化内容才可进入既有工件通道，身份色只进入头像、名称或身份点；
- Canonical Activity 未报告工具时仍不补造 Tool 行；同一 Runtime 真实报告的 Tool 名称和 source 继续
  与 Runtime evidence 一致；Claude Bash fixture 必须覆盖 terminal output 为 `null` 的情况，并证明仅凭
  公开的 `tool_use.input.command` 仍渲染为可展开 disclosure，而不是不可操作的静态 Tool 行。同一
  AgentRun 的最大连续 Tool 默认进入收起组，narration、plan 与 diagnostic 必须截断分组；活动组摘要显示
  最后一条 running/waiting 操作且不同时追加累计数，终态组不把失败或 recorded 冒充成功。running Run 的
  尾组在 Tool 间隙必须保持“执行中 · <最近一条指令>”和 running 图标，不短暂切成终态，也不重复渲染
  “正在处理”；真实非 Tool 或 Run 边界到达后才收口。组 summary 与所有 Tool 行都必须保持
  `16px 类型图标 / 可缩略名称 / 16px 状态轨 / 20px disclosure 轨` 四列；不可展开行保留末轨
  占位，组图标与摘要文字共享 16px 中心线；Shell、File、Git、Network、Permission、Runtime、Plan、Tool 和 Unknown 使用统一 16px 单色
  线性 SVG，状态只由右侧带辅助名称的形状表达；打开组只显示完整 Tool chronology，不自动打开任一结果；
- Shell command disclosure 第一行精确为 `$ ` 加完整脱敏 command；公开 output 紧接下一行，不出现“命令 / 输出”
  标签或空白分隔行。Shell 结果面使用独立主题 token，左边界与 16px Terminal 图标左边界同轴；其他 Tool
  detail 的颜色和缩进保持不变；
- 同一 Run 至少 15 个 Canonical Tool operation 时，较早项、中间项和最后项全部按首次出现顺序保留；
  Built-in `camp.read/search` fixture 的顶层 `input/output` 为空、公共结果只在 `coreEnvelope.result` 时，
  两条 Tool 行仍可展开，完整结果不含 Envelope、request/receipt 或 canonical input。
- 超过 Renderer 原预览上限且由 Managed Blob 保存完整 Payload 的 Tool 输出在精确 Tool disclosure 打开前
  不读取、不把全文挂入 DOM；只打开外层 Tool 组仍必须保持零结果 region，打开精确 Tool 行后才按需读取并
  在固定最大高度的可聚焦结果 region 内完整渲染，
  首、中、末 8,000 行以上标记都存在，不显示截断提示或复制按钮。溢出使用内部滚动条，Arrow、
  Page Up/Down、Space、Home/End 可滚动，Escape 返回对应 summary 且不关闭 Drawer；读取失败保留精确
  错误与重试，成功后焦点进入结果。`1040×700` 与 200% zoom 下结果、执行台、Approval Dock 和 Composer
  无横向溢出或相互遮挡；DOM 不存在 standalone“查看完整工具调用”、`.complete-evidence-control` 或
  raw Payload 展开面。

### Task Inspector 门禁

Renderer 的权威行为见[当前 UI 详规：Camp 右侧详情栏](../ui/components/conversation-workspace.md#camp-右侧详情栏inspector)。
修改 Task 首层入口、空状态、创建/编辑表单、列表或详情后，至少运行：

```bash
pnpm package:mac
pnpm accept:task-card-ui
```

隔离 fixture 必须同时覆盖无任务和已有任务两种列表状态，并证明：

- “任务”Tab 下只有一条 42px“新建任务”操作行；不存在“长期事项”、工具栏说明、解释性空状态、
  虚线占位或 Tab 栏 Icon-only 创建入口；
- 点击操作行进入现有完整 Task editor，标题输入框立即获得焦点；不出现快速 Todo 表单、全局 `N`、
  `Command+Enter` 或可见快捷键提示；
- 同一操作行在创建态变为“返回任务列表”；返回后无任务 fixture 仍为空，已有任务 fixture 恢复原有
  列表数量和内容，不写入 Task、CampMessage 或其他 Core 状态；
- 原有 Task 创建、五态原卡更新、terminal 详情、version conflict 草稿、审计、Related execution、
  键盘打开与 `1440×920`、`1040×700`、200% zoom 无横向溢出继续通过。

### A2A 消息 footer 门禁

Renderer 的权威行为见[当前 UI 详规：A2A 会话消息](../ui/components/conversation-workspace.md#a2a-会话消息)。修改
Agent 公共正文头部、消息 Delivery footer 或相关 CSS 后，至少运行：

```bash
pnpm package:mac
pnpm accept:runtime-activity-ui
```

受控夹具必须证明：消息正文内不存在 `.message-run-origin`；消息下方不存在
`.delivery-status-list.is-compact`；双收件人按冻结顺序进入唯一 `.message-delivery-footer`；footer
可见文案为“发送给@队员”，不保留冒号，也不显示“已送达”“处理中”“排队中”“投递失败”、`!`
或任何 Delivery 状态。每个收件人都带 `@` 并使用飞书式蓝色 Mention；仍可用身份具有
`role="button"`、`aria-haspopup="dialog"`、Click/Enter/Space 人物信息卡与拖选不误触边界。
每条可用队员发言的头像与显示名也必须各自为键盘可达的原生按钮，具有精确可访问名称与
`aria-haspopup="dialog"`，并分别证明鼠标点击、Enter/Space 打开既有人物信息卡、`Esc` 的焦点返回及不导航边界；
已离开、已移除或不可解析作者不得渲染这两个按钮。
footer 保持透明、零圆角，短转交折线使用 1px Porcelain/Steel 结构线，且 footer 边界与最后一个
正文内容元素的垂直间距不超过 4px；验收必须同时证明透明复制入口不占据文档流，且键盘聚焦后
可见、不覆盖收件人，并与无 footer 消息共用消息内容列右上角锚点，不能只测
包含隐藏控件的外层 surface。验收还必须切换到 1040×700，证明 document、timeline
和 footer 无横向溢出且 footer 留在时间线可视区内；2K 场景还须证明 Composer 扩展不改变 footer
阅读宽度或复制按钮定位。Run stage 也不得重新显示这些 Delivery 状态标签；
底层 Delivery、失败码与恢复事实继续保留在原有 Core Read Side。

### 结构化 Mention 门禁

Renderer 的权威行为见
[当前 UI 详规：不得回退的交互合同](../ui/components/structured-mentions.md#不得回退的交互合同)。修改会话
Mention 的结构、样式、点击、键盘或复制行为后，至少运行：

```bash
pnpm package:mac
pnpm accept:composer-skill-picker-ui
pnpm accept:structured-mentions-ui
```

`accept:composer-skill-picker-ui` 是会话框 Skill 选择的专项成品门禁，在验证 Skill 菜单、
明确选择与结构化 Skill 草稿持久化后即结束；`accept:composer-skill-context` 使用不调用模型的最小本地
Runtime，继续证明 Picker → 发送 → send-time snapshot → Manifest resolution → exact
`CURRENT_INPUT.skills`；`accept:structured-mentions-ui` 追加原有 Mention、
发送、人物信息卡、原生选区与复制回归。两者都使用三位带角色的队员和无模型安全 Runtime
fixture，并共同证明：

- `/` 只在空 Composer（或完整正文替换）中打开真实 Skill 下拉；候选按当前 Lead 的
  Runtime 生效组过滤，菜单位于输入框上方且使用 Porcelain/Steel 层级；Enter 选择后写入
  原子 `skill_mention { skillId, nameAtSend }` 和普通尾随空格，恢复 Composer 焦点并按同一身份持久化；
  正文仍精确投影为 `/<skill-name> `，且不会自动发送；
- 手写、粘贴和旧 Draft 中看似 `/<skill-name>` 的内容始终保持 Text，不按当前 Skill 反解析或升级；
- Draft 中 Skill 后来 disabled、deleted、renamed 或对当前 Lead unassigned 时，token 保留冻结 Marker 并
  显示不可用状态；正文仍可发送，是否提供 `SKILL.md` 文件链接以发送时和 Run start-time 的 Core
  判定为准；
- Composer Mention 是默认无底色的蓝色、不可拆分原子行内文字，耐久 Draft 与发送后的
  Structured Content 保持同一稳定身份；
- 从队员或所有队员候选中选中 Mention 后自动补一个普通空格，光标位于该空格之后；
  替换范围后已有空白时不重复插入，模型单测覆盖复用与光标位置；
- 一条消息在同一 CampTurn 边界为三位唯一收件人创建各自的 AgentRun；
- Composer 和已发送 Member Mention 具有同一飞书式紧凑样式：`display: inline`、透明背景、
  无边框、`0 1px` 内边距和 3px 圆角；仅 Hover、Focus 或打开态显示轻量蓝色反馈；
- 两处当前队员 Mention 都具有 `role="button"`、`aria-haspopup="dialog"` 和精确可访问名称；
  单击、Enter、Space 打开锚定的非模态人物信息卡，且不出现全局 `.app-toast`；
- 人物信息卡具有 `role="dialog"`、`aria-modal="false"`，并采用 392px/128px/302px 的
  布局 2 侧边照结构；展示名称、角色、Presence、运行时、专业职责、工作准则和性格底色；
- 激活前后 `.camp-workspace` 保持存在且不出现 `.members-view`；点击外部或 `Esc` 关闭，
  键盘关闭后焦点返回原 Mention；
- 跨过 Mention 执行真实鼠标拖选可完整包含其可见文本，且不会误触发人物信息卡；普通消息
  文本也继续支持原生拖选和系统 `Command+C`；
- 整条消息复制入口仍只在 Hover/Focus 时出现，固定在消息内容列右上角，复制结果使用当前可见正文；
- 测试前的系统剪贴板按 flavor 完整恢复，隔离 `userData` 不污染日常 App。

专项脚本成功时输出 JSON 证据并生成 `composer-skill-picker.png`；完整脚本还会生成
`structured-mentions-composer.png`、`structured-mentions-sent.png`、
`structured-mentions-composer-popover.png`、`structured-mentions-member-popover.png`、
`structured-mentions-native-selection.png` 和 `structured-mentions-hover-copy.png`。其中
Composer 与历史消息的人物信息卡截图是此交互的必留视觉证据；若
脚本失败，fixture、Runtime 临时目录和截图目录会保留用于排查。

其他直接脚本：

| 脚本 | 用途 | 隔离要求 |
| --- | --- | --- |
| `scripts/accept-new-conversation-ui.mjs` | 新对话 Dialog 与创建流程 | 使用脚本创建的独立 App 数据；精确参数见源码 |
| `scripts/capture-mcp.mjs` | MCP 设置完整操作链 | 脚本创建临时 Home、来源配置和 `userData` |
| `scripts/capture-skills.mjs` | Skill 页面截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR`；200% 验收设置 `ROVAI_CAPTURE_ZOOM_FACTOR=2` |
| `scripts/capture-camp-inspectors.mjs` | 已有 Camp 的 Inspector 截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR` |
| `scripts/capture-desktop.mjs` | 通用页面、Runtime 和 Camp 流程 | 必须设置隔离 `userData`；省略或指向日常目录即拒绝启动 |

Skill 页面验收必须先证明 Core 返回十二项 official Skill，再证明列表只展示其中十项
`user_managed` Skill；`cli-operations` 与 `memory-stewardship` 两项 `system_required` Skill 不产生列表行、
禁用开关、生效范围或 locked badge。十个可配置 Skill 都由持久 `Skill.id` 经 FNV-1a 映射到
`--identity-1..8` 中一个 token（不要求十项覆盖八种颜色），六个短标签显示“Rovai”，四个固定上游
Skill 短标签显示“GitHub”；主行不存在来源明细，`DonkeyKing01/tasteful-ui-skill` / `159ccd47` 与
`mattpocock/skills` / `84fdeffd` 只在“详情”中出现。列表名称/简介/来源字号至少为
14/12.5/10.5px；宽窗列表的身份标记位留空，四个可见列名固定为
“Skill / 生效范围 / 状态 / 查看”，并与主行使用同一组 Grid 轨道，不存在旧三点菜单。34×20 Steel Switch 不显示“已启用 / 已停用 / 保存中”
文案，并保留 `role="switch"`、`aria-checked` 和动作型可访问名称。详情必须包含真实 Revision、安装或
更新时间、文件信息、内容摘要与固定副本说明，其 Steel rail/Porcelain background 在不同身份色之间
保持一致；official/固定上游 Skill 不出现删除。九个 Runtime 生效组及真实队员投影继续按原门禁操作。
专项脚本至少以 1440×920 默认比例和同一物理画布的 `ROVAI_CAPTURE_ZOOM_FACTOR=2` 各运行一次，
两种场景均不得产生页面或设置面板横向溢出。

## 从明确来源创建只读隔离副本

需要复现已有 Camp 时，先彻底退出 Rovai AI。v0.51 起诊断中心和 v5 导出故意不显示绝对
SQLite 路径；只使用用户明确提供、Electron 开发日志记录或隔离启动参数已证明的来源路径。然后使用 SQLite
Backup API 创建副本：

```bash
SOURCE_DB="<已明确确认的 rovai.sqlite 路径>"
FIXTURE_ROOT="$(mktemp -d)"
mkdir -p "$FIXTURE_ROOT/user-data"
sqlite3 "$SOURCE_DB" ".backup '$FIXTURE_ROOT/user-data/rovai.sqlite'"
```

之后只把副本传给验收脚本：

```bash
ROVAI_CAPTURE_USER_DATA_DIR="$FIXTURE_ROOT/user-data" \
node scripts/capture-camp-inspectors.mjs \
  "$ROVAI_APP" \
  "$FIXTURE_ROOT/camp"
```

禁止让验收脚本直接操作日常 SQLite，也不要根据文档猜测品牌迁移后的 `userData` 路径。

## 截图与结果

- 输出目录应位于临时目录或明确的验收证据目录，不提交无来源的大量截图。
- 成功脚本通常会输出 fixture 和截图位置；保留前确认其中不含凭据、用户正文或个人
  目录信息。
- Window size、主题、Reduced Motion、Zoom、页面矩阵和可访问性要求来自当前版本
  实施计划与 [UI 规范](../ui/README.md)。
- capture 脚本的 `RELAXED` 模式只能用于探索和视觉排查，不能替代严格验收。
- 测试结束后确认没有残留 Electron/Core 进程，再删除临时目录。
