# 多 Agent 协作架构图源

本目录保存[多 Agent 协作架构](../../system-views.md)的可编辑 SVG 图源和 PNG 导出。系统与技术组成采用彩色架构图，协作与上下文采用场景、层次和漫画，记忆以书架、演进面板和成长手册为场景，串起提报、读取与实践反馈的闭环。专题图各自聚焦一个问题，正文只补充必要边界，图框底部不放解释文案。

## 文件与配图

- `source/system-overview.mjs`：系统全景及共享配色、文字和连线工具。
- `source/member-execution.mjs`：咕咕的身份关系、三条 Conversation 中的执行交接。
- `source/collaboration-comics.mjs`：A2A 四格漫画、协作组织场景及共享手绘组件。图 05 覆盖轻量 Lead、直接协作、Task、Skill、Gather 与成果交接。
- `source/toolkit-stack.mjs`：CLI + Skill Toolkit 和技术栈架构。
- `source/context-memory.mjs`：三层 Bootstrap 与六层动态上下文、长会话漫画，以及记忆的主动提报与持续演进。书架区分共同记忆、队员记忆和队员间记忆；演进面板表达晋升、修订、替代与遗忘，回环连线将读取后的实践反馈带回提报。
- `source/run-lifecycle.mjs`：以 Codex 为例，按执行阶段展开收件人 FIFO 队列、Dispatch Pump、Scheduler、Warm Host 取得或冷启动、上下文交付与原生工具循环。执行结束后，可复用的常驻 Host 回到 IdleWarm，下一轮取得时轮换 Lease。
- `source/layouts.mjs`：按图号选择布局；`figures.json`：标题和可访问性描述。
- `render.mjs`：为 SVG 添加图框，并从同一 SVG 导出 1.5 倍 PNG。Rough.js 使用固定种子生成可复现的手绘线条。

| 图 | 可编辑图源 | SVG | PNG |
| --- | --- | --- | --- |
| 01 系统全景架构 | [布局](source/system-overview.mjs) | [矢量图](01-collaboration.svg) | [位图](01-collaboration.png) |
| 02 身份与 Runtime | [布局](source/member-execution.mjs) | [矢量图](02-identity-runtime.svg) | [位图](02-identity-runtime.png) |
| 03 会话与执行 | [布局](source/member-execution.mjs) | [矢量图](03-conversation-runs.svg) | [位图](03-conversation-runs.png) |
| 04 A2A 与成果交接 | [漫画图源](source/collaboration-comics.mjs) | [矢量图](04-a2a-handoff.svg) | [位图](04-a2a-handoff.png) |
| 05 协作组织与任务责任 | [漫画图源](source/collaboration-comics.mjs) | [矢量图](05-gather.svg) | [位图](05-gather.png) |
| 06 AgentRun 加载与执行 | [时序图源](source/run-lifecycle.mjs) | [矢量图](06-run-lifecycle.svg) | [位图](06-run-lifecycle.png) |
| 07 Rovai CLI Toolkit | [架构图源](source/toolkit-stack.mjs) | [矢量图](07-toolkit.svg) | [位图](07-toolkit.png) |
| 08 动态上下文层次 | [手绘图源](source/context-memory.mjs) | [矢量图](08-dynamic-context.svg) | [位图](08-dynamic-context.png) |
| 09 长会话输入 | [漫画图源](source/context-memory.mjs) | [矢量图](09-session-context.svg) | [位图](09-session-context.png) |
| 10 记忆提报与持续演进 | [手绘图源](source/context-memory.mjs) | [矢量图](10-memory-governance.svg) | [位图](10-memory-governance.png) |
| 11 技术栈架构 | [架构图源](source/toolkit-stack.mjs) | [矢量图](11-technology-stack.svg) | [位图](11-technology-stack.png) |

角色插图嵌入仓库内置的[叮叮](../../../../apps/desktop/src/renderer/src/assets/characters/luoke/icon-192.png)、[芝士](../../../../apps/desktop/src/renderer/src/assets/characters/muwa/icon-192.png)与[咕咕](../../../../apps/desktop/src/renderer/src/assets/characters/mianzhi/icon-192.png)头像，遵循[角色资产说明](../../../../apps/desktop/src/renderer/src/assets/characters/ASSET-NOTICE.md)。角色分工沿用各自资料，图中的协作请求是说明用场景。

[Codex 图标](../../../../apps/desktop/src/renderer/src/assets/runtime-logos/codex-color.svg)与 [Claude Code 图标](../../../../apps/desktop/src/renderer/src/assets/runtime-logos/claudecode-color.svg)来自仓库内置资源，来源及许可见 [Runtime 图标资产说明](../../../../apps/desktop/src/renderer/src/assets/runtime-logos/ASSET-NOTICE.md)。

## 重新生成

需要 Node.js、本机 Chrome/Chromium，以及支持中文的字体（PingFang SC、Microsoft YaHei 或 Noto Sans CJK SC）。依赖安装在独立目录中，在仓库根目录运行：

```bash
export ROVAI_DIAGRAM_TOOLS="${TMPDIR:-/tmp}/rovai-diagram-tools"
PUPPETEER_SKIP_DOWNLOAD=true npm install --prefix "$ROVAI_DIAGRAM_TOOLS" --no-audit --no-fund puppeteer@25.10.0 roughjs@4.6.6
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
node docs/architecture/assets/system-views/render.mjs
```

其他系统将 `CHROME_PATH` 改为本机浏览器路径。脚本使用独立的临时浏览器配置。只更新某张图时，在命令末尾追加文件名（不含扩展名），例如：

```bash
node docs/architecture/assets/system-views/render.mjs 10-memory-governance
```

修改内容先更新对应图源，调整标题更新 `figures.json`，然后重新生成并检查 SVG 与 PNG。正文使用 SVG；PNG 供不支持 SVG 的文档与分享场景使用。
