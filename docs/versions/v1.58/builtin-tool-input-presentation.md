---
document_type: implementation-record
version: v1.58
status: implemented
last_updated: 2026-09-12
---

# Built-in 工具入参展示

用户确认保留内部 operation，仅修改 UI，并授权 PR 合入 main 后打包安装。设计沿用现有工具行，覆盖七种状态；
结果、错误说明和正文占位均不展示。当前规则见 [Run Process Detail Surface v32](../../contracts/run-process-detail-surface-v32.md)。

## 实施

- 共享 execution presentation 将 Core Catalog 的 23 项操作映射为 CLI 显示名称，只使用已有公共 `canonicalInput`。
- 本地执行台与单聊复用 Tool 行；Built-in 不触发完整结果读取，空输入为静态行。
- 纯 CLI 的唯一成功输出、Core 可信来源及嵌套 Evidence 生命周期共同决定 Shell 载体折叠；不改变底层记录。
- Shell 标题与详情整体省略 send/gather 正文参数及 Rovai stdin 输入载体，保留独立命令和其他凭据脱敏。
- 映射、七种状态、空输入、Shell 输入形式和关联歧义由定向回归覆盖；普通工具的结果边界继续保留。

## 验证与交付

已通过 `pnpm typecheck`、`pnpm test`（175 个 Vitest 文件、1794 项；脚本测试 317 项通过，2 项 Windows-only 跳过）、
`pnpm build:desktop`、diff-aware 文档门禁，以及 Rust PR 的 553 项基础、35 项 CLI 和 309 项慢速测试。
Staged Rust 路由按没有 Rust 改动跳过。Clippy 与打包安装在发布步骤继续检查。

使用真实 `ToolCallRow`、共享投影和生产 CSS 的受控浏览器夹具，以 CUA 操作验证：七种状态展开共 7 个入参区域，
完整结果读取次数为 0；空输入 Send 无箭头；随后展开普通 Shell 才读取一次完整结果。Inspector 实测 440px，
工具行 28px，类型/状态/箭头为 16/16/20px，入参 10px；长输入 PageDown 内部滚动，Escape 返回对应 summary。
日间窄面板和夜间宽面板截图已保留。此处是生产组件的定向验证，不冒充全量 Runtime Activity 矩阵或真实模型运行。

本机证据目录：`/tmp/rovai-builtin-tool-input-ui.cOLLDK`，包含测试日志、生产组件夹具、验收记录与截图。
PR 合入及 daily App 的构建、隔离启动、签名与安装由最终发布记录补充。

## 跨版本影响

Contract、UI、开发验收入口和当前文档路由已同步。没有数据库迁移、内部 operation 改名、模型上下文、
Runtime Activity classifier、平台资格或 current_version 变更；既有历史数据按新 UI 规则展示，缺失公共输入时不反推。
