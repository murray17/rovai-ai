---
document_type: development-guide
authority: desktop-ui-acceptance-infrastructure
last_updated: 2026-07-31
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
```

它们分别覆盖长期记忆、成员头像和成员生命周期的桌面交互回归。具体 Schema/Migration
编号属于测试 fixture 和版本证据，不是本文的常青要求。

其他直接脚本：

| 脚本 | 用途 | 隔离要求 |
| --- | --- | --- |
| `scripts/accept-new-conversation-ui.mjs` | 新对话 Dialog 与创建流程 | 使用脚本创建的独立 App 数据；精确参数见源码 |
| `scripts/capture-mcp.mjs` | MCP 设置完整操作链 | 脚本创建临时 Home、来源配置和 `userData` |
| `scripts/capture-skills.mjs` | Skill 页面截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR` |
| `scripts/capture-camp-inspectors.mjs` | 已有 Camp 的 Inspector 截图 | 必须设置 `ROVAI_CAPTURE_USER_DATA_DIR` |
| `scripts/capture-desktop.mjs` | 通用页面、Runtime 和 Camp 流程 | 写入场景必须设置隔离 `userData` |

## 从真实数据创建只读来源的隔离副本

需要复现已有 Camp 时，先彻底退出 Rovai-ai，并从应用诊断页确认 SQLite 路径。使用
SQLite Backup API 创建副本：

```bash
SOURCE_DB="<诊断页显示的 rovai.sqlite 路径>"
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
