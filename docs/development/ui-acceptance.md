---
document_type: development-guide
authority: desktop-ui-acceptance-infrastructure
last_updated: 2026-08-11
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
Task 单卡原地更新、九 Runtime Canonical Activity 工具名称与 Agent 级连续执行过程、A2A 消息
Scheme C 转交 footer，以及诊断中心双尺寸、只读自检、MCP 权限修复复检与 v5 脱敏的桌面回归。
当前 Neutral Porcelain + Steel 视觉迁移还必须按当前版本实施计划覆盖 2K Composer、七个设置页、
队员半身照与 Runtime 入口、记忆 Workbench、New Conversation 和各类 Dialog/Drawer。
具体 Schema/Migration 编号属于测试 fixture 和版本证据，不是本文的常青要求。

### Agent 执行过程门禁

Renderer 的权威行为见 [Run Process Detail Surface v3](../contracts/run-process-detail-surface-v3.md) 与
[当前 UI 详规：Camp 执行过程](../ui/arctic-dawn.md#camp-执行过程)。修改 AgentRun 分组、执行台、Drawer、
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

### A2A 消息 footer 门禁

Renderer 的权威行为见[当前 UI 详规：A2A 会话消息](../ui/arctic-dawn.md#a2a-会话消息)。修改
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
footer 保持透明、零圆角，短转交折线使用 1px Porcelain/Steel 结构线，且 footer 边界与最后一个
正文内容元素的垂直间距不超过 4px；验收必须同时证明透明复制入口不占据文档流，且键盘聚焦后
可见、不覆盖收件人，不能只测
包含隐藏控件的外层 surface。验收还必须切换到 1040×700，证明 document、timeline
和 footer 无横向溢出且 footer 留在时间线可视区内；2K 场景还须证明 Composer 扩展不改变 footer
阅读宽度或复制按钮定位。Run stage 也不得重新显示这些 Delivery 状态标签；
底层 Delivery、失败码与恢复事实继续保留在原有 Core Read Side。

### 结构化 Mention 门禁

Renderer 的权威行为见
[当前 UI 详规：不得回退的交互合同](../ui/arctic-dawn.md#不得回退的交互合同)。修改会话
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
- 整条消息复制入口仍只在 Hover/Focus 时出现，复制结果使用当前可见正文；
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
| `scripts/capture-skills.mjs` | Skill 页面截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR` |
| `scripts/capture-camp-inspectors.mjs` | 已有 Camp 的 Inspector 截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR` |
| `scripts/capture-desktop.mjs` | 通用页面、Runtime 和 Camp 流程 | 必须设置隔离 `userData`；省略或指向日常目录即拒绝启动 |

Skill 页面验收必须证明六个 official Skill 中五个显示“Rovai 内置”，固定上游的
`tasteful-ui` 显示“GitHub 三方”、`DonkeyKing01/tasteful-ui-skill` 可点击仓库与
`159ccd47` Revision；列表列名固定为“投递范围 / 状态 / 查看”，不存在旧三点菜单。
“详情”展开后必须包含真实 Revision、安装或更新时间、文件信息、内容摘要与固定副本说明，
且 official/固定上游 Skill 不出现删除；九个 Runtime 生效组及真实队员投影继续按原门禁操作。

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
