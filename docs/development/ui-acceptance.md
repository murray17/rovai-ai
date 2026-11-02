---
document_type: development-guide
authority: desktop-ui-acceptance-infrastructure
last_updated: 2026-10-30
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

`capture-desktop.mjs` 支持的主题、窗口、Runtime、Thread 和管理 selector 以脚本顶部的
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
第二条 WebSocket、运行示例 command，或写入 Thread、Message、Turn、Run、Outbox/console fixture。它只读 Core 当前数据目录
中 exact Bot/Owner identity，不读取 credential payload；发送使用 Main 已有的 SDK client。

模拟 timeline 和已脱敏页面只保存在 Main 内存，所有卡片明确标为预览。每次翻页核对可信 callback operator、App、消息 ID、
本次预览 sequence、页码范围、六小时有效期与当前本机 Owner 绑定，并仅 patch 原消息一次。不持久化 pageIndex、nonce 或
viewVersion，不产生 Core 命令或 pump；真实 execution console 和项目卡继续走原来的 Core 授权。预览在 App 退出后失效，
不能把此入口的验收当作真实 Run 的 Core seal/admission/恢复证明。

## Windows 验收入口

Windows 构建使用 `pnpm package:windows:x64`；安装与关闭验收使用
`pnpm accept:windows:installer` 和 `pnpm accept:windows:installer-shutdown`。
运行平台、参数及发布步骤见 [Windows 打包与验收](packaging-windows.md)，命令以 `package.json#scripts` 为准。

Windows lane 使用与生产 `%LOCALAPPDATA%\Rovai AI` 同构但完全隔离的绝对 data root，分别隔离 Core、Electron
User Data、Session Data、Logs、CrashDumps 和 Skill 文件目录；拒绝日常目录、junction/symlink 别名、UNC、
network/removable/non-NTFS 目标。unpacked App 与 installed App 使用不同 fixture。

自动化与真实客户端分别执行 [Windows 交互矩阵](../ui/windows-interaction-delta.md#7-可访问性与真机矩阵)，
主题覆盖遵循[全部配色矩阵](../ui/qa/theme-matrix.md)。固定 Windows Server runner 只提供构建、打包和自动化证据，
不能证明客户端原生菜单、DPI、Snap、NVDA、IME 或安装卸载体验。

## 独立 UI 验收

`pnpm review:remote-connection` 构建离线设置交互稿；`pnpm test:remote-connection-review`
使用独立 Chrome profile 验证[远程连接](../ui/host-remote-connection.md)的几何、状态与键盘交互，不启动 Core/Runtime。
`pnpm test:host-web` 验证实际授权、附件与命令回执；`pnpm test:host-web-live` 验证真实 Desktop/Web 页面。
模拟交互稿不能替代实际 Web 接入、网络与身份隔离验收。

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

这些入口覆盖对应页面的生产组件或 packaged App；测试 fixture 不能把模拟 Runtime 状态当作原生准入证据。
行为断言引用[当前组件规范](../ui/components/README.md)与[页面指引](../ui/README.md#页面局部-brief)，
尺寸、主题、键盘与缩放使用[全部配色矩阵](../ui/qa/theme-matrix.md)。当前交付范围从[版本索引](../versions/README.md)进入。
具体 Schema/Migration 编号属于 fixture 和版本证据，不作为长期 UI 要求；签名后的跨版本升级另做各平台 Release 验收。

### 首次训练门禁

修改首次安装 admission、`onboarding.json`、三页 mandatory gate、Runtime/模型选择、provisioning、
`初次集结` 或第四页 starter 后，运行：

```bash
pnpm package:mac
pnpm accept:onboarding-ui
```

使用全新隔离 `userData` 和 packaged App，按[首次训练 UI](../ui/components/first-run-onboarding.md)和
[First-run Onboarding](../contracts/first-run-onboarding-v7.md)验证 mandatory gate、字段、按钮与恢复行为。
至少覆盖以下两条路径，并在 `1040×700` 及主题矩阵下保存截图与 JSON report：

- Configured：Runtime/模型使用真实准入状态；分别在队员页和 Runtime 页重启恢复；完成后只创建所选队员的
  `初次集结`。点击 starter 只写本机草稿并恢复焦点/光标，消息与 Run 数量不变；重启恢复同一会话和未发送草稿。
- Deferred：使用确定性零 Runtime 环境，验证重新扫描、安装指南和“稍后配置”；保存 deferred 完成状态，
  不新增 onboarding 队员配置、Thread、Run 或 restore target，重启进入普通 App。

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

验收依据 [Planned Shutdown v8](../contracts/planned-shutdown-v8.md)、
[Public Composer](../architecture/camp-composer-draft.md)和[关闭等待面](../ui/components/conversation-workspace.md#thread-顶栏与关闭等待面)：

- 先保存草稿，再输入最后一段 Lexical 正文并立即正常退出；同一隔离目录重启后读回包含最后一段的本机快照，
  证明输入 flush 在 Core shutdown 前完成，不依赖 Core Draft revision。
- 验证准备阶段与全局锁定的边界、400ms 慢退出反馈、可访问 busy modal，以及关闭期间无错误横幅或 Toast；
  全部配色、`1040×700`、200% zoom 与 reduced motion 下内容完整。
- Desktop 等待 Core drain 和子进程真实退出，以 `exit 0` 自然结束；正常流程不能靠强杀通过。
  不把进程中断伪造为 Runtime cancellation acknowledgement；取消与 accepted-input 不确定性按当前合同留证。
- 重启后原 Run 保留精确身份和终态，不自动恢复或重发；内部不确定性不生成公屏“外部效果待确认”。
- 两次退出后 Core、Runtime 与 Electron helper 均被回收。只有验收清理失败分支才可向已记录的隔离进程树发送信号。

成功时保留 JSON report、关闭等待面及重启终态截图；失败时保留
fixture 和截图路径用于排查。可用 `ROVAI_PLANNED_SHUTDOWN_ACCEPT_FIXTURE_ROOT`、
`ROVAI_PLANNED_SHUTDOWN_ACCEPT_OUTPUT_DIR` 指定绝对隔离位置，用
`ROVAI_KEEP_PLANNED_SHUTDOWN_FIXTURE=1` 保留成功 fixture；不得指向日常 App 数据目录。

### 队员页内容名册门禁

修改成员页入口、内容名册、Runtime 快捷入口、排序或离开保护后，至少运行：

```bash
pnpm package:mac
pnpm accept:member-lifecycle-ui
```

布局与交互断言引用[队员页面指引](../ui/surfaces/member-workspace.md)及[队员身份与配置](../ui/components/member-identity.md)。
验证名册筛选、调宽/折叠、直接重排、Runtime 产品图标与定位、创建/编辑、Presence、移除和离页草稿保护。
覆盖 `1440×920`、`1040×700`、200% zoom、reduced motion、Forced Colors 及全部配色，不复制另一份尺寸或图标规范。

分区保存、跨队员草稿、冲突、部分成功和键盘焦点另跑 `node --test scripts/lib/member-editor.test.mjs`；
`ROVAI_KEEP_MEMBER_EDITOR_FIXTURE=1` 可保留截图。批量应用运行配置跑 `pnpm test:member-runtime-apply`，
覆盖未知回执、版本冲突及手机横竖屏。两者均使用隔离组件 fixture，不调用真实 Runtime 或日常数据。

### Agent 执行过程门禁

Renderer 的权威行为见 [Run Process Detail Surface v57](../contracts/run-process-detail-surface-v57.md) 与
[当前 UI 详规：Thread 执行过程](../ui/components/conversation-workspace.md#thread-执行过程)。修改 AgentRun 分组、执行台、Drawer、
Task Related execution、停止结果或 Inspector 页签后，至少运行：

```bash
pnpm package:mac
pnpm accept:runtime-activity-ui
```

只核对共享工具详情时，可补充运行 `ROVAI_RUNTIME_ACTIVITY_ACCEPT_TOOL_DETAILS_ONLY=1 pnpm accept:runtime-activity-ui`。
它在同一隔离夹具验证 Web 的 Canonical 步骤数、查询原文、类型图标与展开结果，以及无输出 Shell 命令的结果展开；
报告和截图与全量结果分开保存。此定向检查不能替代完整交互矩阵或把全量失败改报为通过。

Built-in 去重后的命令与输出另由 `pnpm test:command-view` 挂载生产 Tool 组件验证：隔离 Electron profile，
不启动 Core 或模型；覆盖唯一 Core 行、Shell Evidence 惰性读取、失败重试、长正文、多行命令、完整 JSON、
键盘滚动／Escape、Day/Night 与 200% zoom。`ROVAI_KEEP_COMMAND_VIEW_FIXTURE=1` 保留合成截图和 fixture。

需要把生产 App 留给人工检查时，可运行
`node scripts/accept-runtime-activity-ui.mjs "dist/mac-arm64/Rovai AI.app" --preview`。
它创建同样的隔离 fixture、打开明确标注“模拟数据”的执行 Thread 并等待用户关闭 App；不调用真实模型，
不执行自动交互矩阵，也不把人工预览报告记为自动验收通过。缺省每次使用新的临时 `userData` 和隔离 Skill 文件目录。

头像轨道的 8/12/20 位队员、176px 固定步长、键盘/滚轮、Tooltip、重复精确导航与滚动保留，
另由 `pnpm test:execution-avatar-rail` 在真实 Electron 中挂载生产 ThreadWorkspace 验证；该 fixture
使用隔离 `userData`、受控本机数据，不启动 Core 或真实 Runtime。

受控夹具至少包含同一队员的多个历史/当前 Run、8/12/20 位队员、单 Run 15 条以上 Tool operation，
以及 Claude Bash 公开 command 存在但 output 为 `null` 的情况。按当前 UI owner 覆盖：

| 覆盖类别 | 行为依据 |
| --- | --- |
| 按队员聚合、精确 Run 定位、发送后的选择与焦点、进入/后台事件边界 | [Thread 执行过程](../ui/components/conversation-workspace.md#thread-执行过程) |
| 头像轨道、滚轮/键盘、Drawer 调宽、同 DOM 的位置切换、偏好失败和阅读位置保留 | [Thread 执行过程](../ui/components/conversation-workspace.md#thread-执行过程) |
| 顶栏入口、浮层关闭、Approval Dock 和精确 Run Stop | [Thread 详情浮层](../ui/components/conversation-workspace.md#thread-详情浮层)与[Task、Approval 与停止](../ui/components/conversation-workspace.md#taskapproval-与停止) |
| Tool chronology、连续分组、类型/状态图标、Shell 展开、Built-in 去重、结果预算与惰性读取 | [Run Process Detail Surface](../contracts/run-process-detail-surface-v57.md)与[执行过程](../ui/components/conversation-workspace.md#thread-执行过程) |

验证真实焦点、滚动与最终可见位置，不能只检查外层 DOM 存在；精确 Run 停止直接提交，未知结果按原 commandId
核对且不重复发送。覆盖 `2560×1440`、`1440×920`、`1040×700`、200% zoom、reduced motion 和全部配色。
fixture 不启动真实 Runtime；真实执行、审批与停止结果由对应 Runtime 验收补齐。

### Task 详情门禁

Renderer 的权威行为见[当前 UI 详规：Thread 详情浮层](../ui/components/conversation-workspace.md#thread-详情浮层)。
修改 Task 首层入口、空状态、创建/编辑表单、列表或详情后，至少运行：

```bash
pnpm package:mac
pnpm accept:task-card-ui
```

隔离 fixture 必须同时覆盖无任务和已有任务两种列表状态，并证明：

- 标题栏“任务”直接入口打开按需浮层，状态筛选与新建入口可用；不恢复常驻侧栏、独立折叠按钮或解释性空状态；
- 列表和时间线卡片打开完整只读详情；新建/编辑使用标准 Dialog，标题输入框立即获得焦点；
- 关闭新建 Dialog 返回原列表并保留草稿，不写入 Task、ThreadMessage 或其他 Core 状态；跨详情切换和浮层收起
  后重开草稿仍在；并行修改其他字段后，提交仅写入用户实际编辑的字段；
- 编辑、取消任务均使用既有任务命令，取消必须填写原因，不启动或停止 AgentRun；
- Task 创建、五态原卡更新、terminal 详情、字段补丁、审计、Related execution、
  键盘打开与 `1440×920`、`1040×700`、200% zoom 无横向溢出继续通过。

### A2A 消息 footer 门禁

Renderer 的权威行为见[当前 UI 详规：A2A 会话消息](../ui/components/conversation-workspace.md#a2a-会话消息)。修改
Agent 公共正文头部、消息 Delivery footer 或相关 CSS 后，至少运行：

```bash
pnpm package:mac
pnpm accept:runtime-activity-ui
```

按[A2A 会话消息](../ui/components/conversation-workspace.md#a2a-会话消息)验证唯一收件人 footer、身份入口、
消息操作行、复制/回复与文件分区。fixture 包含双收件人、失效身份、超过 20 行的用户消息、短正文加附件及 Agent 产物。
检查实际可见按钮和内容；可用身份分别通过鼠标、Enter/Space 打开人物卡，Escape 返回原焦点，拖选不误激活。
在常规、`1040×700` 与 2K 场景验证 footer、正文、附件和 Composer 的独立宽度及无横向溢出。
底层 Delivery 事实保留，显示规则以当前 UI 为准，不从旧 fixture 恢复状态标签。

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
发送、人物信息卡、原生选区与复制回归。两项 UI 门禁都使用三位带角色的队员和无模型安全 Runtime
fixture。夹具固定本次 Host 的 Runtime 启动路径，并在退出后核对 Run 实际入口；历史安装快照不替代启动配置。
静态准入按 `installed_unverified` 且无 blocker 检查，不伪造本次协议验证成功。Thread 使用当前
`threads.*` API，本机草稿从隔离 Renderer 的 localStorage 读取。

两项 UI 门禁按[结构化 Mention](../ui/components/structured-mentions.md)和
[Skills 候选](../ui/components/skills-settings.md#thread-composer-的--候选)覆盖触发、IME、键盘选择、Atom 替换/持久化、
失效来源、人物卡、焦点返回和复制；不在验收流程重复定义颜色、字号或布局。

保留以下验证方法：

- 三位唯一收件人的发送按 `inputMessageIds` 与 `anchorMessageId` 核对受理消息，不要求独立领取的 Run 具有相同时间戳或 ThreadTurn。
- 真实鼠标跨 Mention 拖选并执行系统复制，确认完整可见文本和不误开人物卡；普通文本也继续支持原生选择。
- 打开人物卡前后仍停留当前 Thread，不进入队员管理页；分别保存 Composer 与已发送 Mention 的人物卡截图。
- 测试前的系统剪贴板按全部 flavor 完整恢复；隔离 `userData` 不污染日常 App。

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
| `scripts/accept-rebuilt-skills-ui.mjs` | 当前 Skills／工具箱隔离验收与截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR`；支持 Day／Night 与 200% 缩放 |
| `scripts/capture-camp-inspectors.mjs` | 已有 Thread 的 Inspector 截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR` |
| `scripts/capture-desktop.mjs` | 通用页面、Runtime 和 Thread 流程 | 必须设置隔离 `userData`；省略或指向日常目录即拒绝启动 |

当前页面合同见[Skills／工具箱／会话选择](../ui/components/skills-settings.md)。专项脚本给验收 App
配置独立 `userData`、Skill 文件目录和临时原生 Home，只读发现一项合成 Codex Skill，并核对正文预览。
它还验证五项工具箱及 `member-studio` 默认队员配置，通过界面切换一次 `campfire` 复选框并恢复；
分别留下 Skills 与工具箱截图及 JSON 报告。Day 常规比例与 Night 200% 缩放使用两份全新的隔离目录：

```bash
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_CAPTURE_USER_DATA_DIR="$FIXTURE_ROOT/user-data" \
  node scripts/accept-rebuilt-skills-ui.mjs "$ROVAI_APP" "$FIXTURE_ROOT/report"

FIXTURE_ROOT="$(mktemp -d)"
ROVAI_CAPTURE_USER_DATA_DIR="$FIXTURE_ROOT/user-data" \
ROVAI_CAPTURE_THEME=night ROVAI_CAPTURE_ZOOM_FACTOR=2 \
  node scripts/accept-rebuilt-skills-ui.mjs "$ROVAI_APP" "$FIXTURE_ROOT/report"
```

## 从明确来源创建只读隔离副本

需要复现已有 Thread 时，先彻底退出 Rovai AI。诊断导出不显示绝对 SQLite 路径；只使用用户明确提供、Electron 开发日志记录或隔离启动参数已证明的来源路径。然后使用 SQLite
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
