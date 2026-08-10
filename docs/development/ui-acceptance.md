---
document_type: development-guide
authority: desktop-ui-acceptance-infrastructure
last_updated: 2026-08-06
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

所有会创建 Camp、修改设置、写 SQLite 或执行删除的桌面验收都必须使用隔离目录：

```bash
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_CAPTURE_USER_DATA_DIR="$FIXTURE_ROOT/user-data" \
node scripts/capture-desktop.mjs "$ROVAI_APP" "$FIXTURE_ROOT/capture"
```

不要省略 `ROVAI_CAPTURE_USER_DATA_DIR` 后对日常 App 执行带写入、发送、管理或删除参数
的 capture 命令。

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
pnpm accept:structured-mentions-ui
pnpm accept:task-card-ui
pnpm accept:runtime-activity-ui
pnpm accept:diagnostics-ui
```

它们分别覆盖长期记忆、成员头像、成员生命周期、应用内通知、统一侧栏、结构化提及和
Task 单卡原地更新、九 Runtime Canonical Activity 工具名称与 run-level 诚实降级、A2A 消息
Scheme C 转交 footer，以及诊断中心双尺寸、只读自检、MCP 权限修复复检与 v5 脱敏的桌面回归。
具体 Schema/Migration 编号属于测试 fixture 和版本证据，不是本文的常青要求。

### A2A 消息 footer 门禁

Renderer 的权威行为见 [Arctic Dawn：A2A 会话消息](../ui/arctic-dawn.md#a2a-会话消息)。修改
Agent 公共正文头部、消息 Delivery footer 或相关 CSS 后，至少运行：

```bash
pnpm package:mac
pnpm accept:runtime-activity-ui
```

受控夹具必须证明：消息正文内不存在 `.message-run-origin`；消息下方不存在
`.delivery-status-list.is-compact`；双收件人按冻结顺序进入唯一 `.message-delivery-footer`；
`settled` 不显示“已送达”，失败收件人同时显示 `!` 与“投递失败”；footer 保持透明、零圆角，
短转交折线使用 1px Arctic Dawn 结构线，且 footer 边界与正文边界的垂直间距不超过 4px，不能形成
空白行。验收还必须切换到 1040×700，证明 document、timeline
和 footer 无横向溢出且 footer 留在时间线可视区内。完整 Delivery 列表继续只在执行详情中显示。

### 结构化 Mention 门禁

Renderer 的权威行为见
[Arctic Dawn：不得回退的交互合同](../ui/arctic-dawn.md#不得回退的交互合同)。修改会话
Mention 的结构、样式、点击、键盘或复制行为后，至少运行：

```bash
pnpm package:mac
pnpm accept:structured-mentions-ui
```

该验收使用三位带角色的队员和无模型安全 Runtime fixture，必须同时证明：

- Composer Mention 是默认无底色的蓝色、不可拆分原子行内文字，耐久 Draft 与发送后的
  Structured Content 保持同一稳定身份；
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

脚本成功时输出 JSON 证据，并生成
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
| `scripts/capture-desktop.mjs` | 通用页面、Runtime 和 Camp 流程 | 写入场景必须设置隔离 `userData` |

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
