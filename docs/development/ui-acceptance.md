---
document_type: development-guide
authority: desktop-ui-acceptance-infrastructure
last_updated: 2026-08-14
---

# 桌面 UI 验收与隔离数据

本文只说明长期稳定的桌面验收基础设施。当前版本必须覆盖哪些页面、主题、尺寸和状态，
以当前版本 `implementation-plan.md` 为准；不要把版本专属断言复制回本文。

## 先生成 App

```bash
pnpm package:mac
```

后续示例都从仓库根目录执行：

```bash
ROVAI_APP="$(pwd)/dist/mac-arm64/Rovai-ai.app"
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
"$ROVAI_APP/Contents/MacOS/Rovai-ai" \
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

## 独立 UI 验收

以下 package scripts 自行创建或要求隔离 fixture，不调用模型：

```bash
pnpm accept:memory-ui
pnpm accept:member-avatar-ui
pnpm accept:member-lifecycle-ui
pnpm accept:notification-ui
pnpm accept:sidebar-ui
pnpm accept:composer-skill-picker-ui
pnpm accept:structured-mentions-ui
pnpm accept:task-card-ui
pnpm accept:runtime-activity-ui
pnpm accept:diagnostics-ui
```

它们分别覆盖长期记忆、队员头像、队员生命周期、应用内通知、统一侧栏（含 Project/Camp 置顶、
可恢复 Project 移除、跨重启隐藏、Quick Chat 焦点回退与 Core 数据保留）、结构化提及和
Task 创建操作行、完整表单聚焦、取消恢复与单卡原地更新、十 Runtime Canonical Activity 工具名称与 Agent 级连续执行过程、A2A 消息
Scheme C 转交 footer，以及诊断中心双尺寸、只读自检、MCP 权限修复复检与 v5 脱敏的桌面回归。
当前 Neutral Porcelain + Steel 视觉迁移还必须按当前版本实施计划覆盖 2K Composer、七个设置页、
队员半身照与 Runtime 入口、记忆 Workbench、New Conversation 和各类 Dialog/Drawer。
具体 Schema/Migration 编号属于测试 fixture 和版本证据，不是本文的常青要求。

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

验收必须证明：

- `before-quit` 显示无操作控件的 accessible modal；Day/Night、`1040×700`、200% zoom 与 reduced
  motion 下标题、unknown 说明和卡片边界均完整；
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

### 队员页来源返回门禁

修改成员页入口、名册顶部、Main Window Session 导航状态或离开保护后，至少运行：

```bash
pnpm package:mac
pnpm accept:member-lifecycle-ui
```

隔离夹具必须分别证明：从 directory Project Camp 与“快速对话”分组 Camp 进入时，
`.member-context-return` 显示真实上下文和 Camp 标题并返回同一稳定 Camp；从 Memory、Quick Chat
首页或启动直达进入时显示“返回 App”并回到 Quick Chat 首页。删除返回目标后必须安全降级为 App。
点击和 `⌘[` 都要经过现有未保存 Runtime 草稿确认；Dialog/Menu 打开时快捷键不得穿透。
验收同时覆盖 1440×920、1040×700、200% zoom、reduced motion、Forced Colors、长标题截断和
侧栏无横向溢出，并保留队员半身照、Runtime 入口、排序、筛选、创建/编辑/移除功能。

### Agent 执行过程门禁

Renderer 的权威行为见 [Run Process Detail Surface v3](../contracts/run-process-detail-surface-v3.md) 与
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
  回到底部后恢复，仍在跟随时终态最后输出只定位一次；后台 A2A、Runtime 事件、重载和恢复仍不打开
  Drawer、不改选队员/stage、不滚动公共消息时间线或抢焦点；关闭和 Drawer 内 Escape 将焦点返回真实
  原入口；
- Drawer 顶边必须存在可聚焦的水平 resize separator；真实鼠标拖拽、方向键、PageUp/PageDown、
  Home/End、Enter 恢复默认和 ARIA 数值均通过。用户高度在同一 Main Window Session 的收起重开、
  切换 Agent/Camp 后保持；调整不得改变所选 Agent/stage，sticky-bottom 仍跟随，手动上滚仍暂停；
  最大高度在 1040×700 与 200% zoom 下不覆盖消息历史、Agent 执行台、Approval Dock 或 Composer；
- Inspector 仅有“任务 / 队员”，不存在 Context Delivery/Approval/Activity/Audit Tab、旧 route/state
  或另一条过程时间线；“队员”读取真实 CampMember/AgentProfile，并用既有 Core 命令切换一个符合
  presence/leave 约束的 Default Lead；Task/停止结果入口按 Agent 打开过程，顶栏不存在执行入口；
- Approval Dock 是唯一普通审批决定 surface；顶栏与通知摘要只展开、定位并聚焦 Dock，不改变 Inspector
  显隐或页签。收起/展开不改变队列，解决最后一项后焦点返回 Composer；
- Drawer 不提供 Agent 或 Run 级 Stop/Cancel/Retry；唯一 CampTurn Stop、Approval Dock 与 Composer 在
  `2560×1440`、`1440×920`、`1040×700`、200% zoom 和 reduced motion 下均可见、可键盘到达且不互相遮挡；
- `2560×1440` 下 `.composer-box` 与会话工作列都接近 1040px，`Enter` keycap 位于发送按钮紧邻
  左侧；用户与所有 Agent 普通正文使用同一开放阅读表面，叙述保持约 76ch，代码、表格、Task
  和审批等现有结构化内容才可进入更宽工件通道，身份色只进入头像、名称或身份点；
- Canonical Activity 未报告工具时仍不补造 Tool 行；同一 Runtime 真实报告的 Tool 名称和 source 继续
  与 Runtime evidence 一致。
- 超过 Renderer 预览上限且由 Managed Blob 保存完整 Payload 的 Tool 输出只在原 Evidence `pre`
  中保留开头 10 行和明确截断提示；DOM 不包含中段或末尾。右上角只有一个 25px、无边框、具名的
  复制图标；真实点击必须按需读取完整 Evidence、只复制公开输出字段，并证明 8,000 行以上的中段与
  末尾都进入剪贴板而 Evidence 外层 JSON 不进入。读取成功后图标与可访问名称反馈“已复制完整输出”。

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
明确选择与纯 Text 草稿持久化后即结束；`accept:structured-mentions-ui` 继续追加原有 Mention、
发送、人物信息卡、原生选区与复制回归。两者都使用三位带角色的队员和无模型安全 Runtime
fixture，并共同证明：

- `/` 只在空 Composer（或完整正文替换）中打开真实 Skill 下拉；候选按当前 Lead 的
  Runtime 生效组过滤，菜单位于输入框上方且使用 Porcelain/Steel 层级；Enter 选择后写入
  普通 `/<skill-name> `、恢复 Composer 焦点并持久化为单个 Text，既不自动发送也不创建
  结构化 Skill Token；
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
禁用开关、投递范围或 locked badge。十个可配置 Skill 都由持久 `Skill.id` 经 FNV-1a 映射到
`--identity-1..8` 中一个 token（不要求十项覆盖八种颜色），六个短标签显示“Rovai”，四个固定上游
Skill 短标签显示“GitHub”；主行不存在来源明细，`DonkeyKing01/tasteful-ui-skill` / `159ccd47` 与
`mattpocock/skills` / `84fdeffd` 只在“详情”中出现。列表名称/简介/来源字号至少为
14/12.5/10.5px，列名固定为
“投递范围 / 状态 / 查看”，不存在旧三点菜单。34×20 Steel Switch 不显示“已启用 / 已停用 / 保存中”
文案，并保留 `role="switch"`、`aria-checked` 和动作型可访问名称。详情必须包含真实 Revision、安装或
更新时间、文件信息、内容摘要与固定副本说明，其 Steel rail/Porcelain background 在不同身份色之间
保持一致；official/固定上游 Skill 不出现删除。九个 Runtime 生效组及真实队员投影继续按原门禁操作。
专项脚本至少以 1440×920 默认比例和同一物理画布的 `ROVAI_CAPTURE_ZOOM_FACTOR=2` 各运行一次，
两种场景均不得产生页面或设置面板横向溢出。

## 从明确来源创建只读隔离副本

需要复现已有 Camp 时，先彻底退出 Rovai-ai。v0.51 起诊断中心和 v5 导出故意不显示绝对
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
