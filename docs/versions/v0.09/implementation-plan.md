---
document_type: implementation-plan
version: v0.09
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-24
---

# Lumen AI v0.09 实施计划与验收清单

> 状态：实施中（检查点 1/5）
>
> 版本范围：[README.md](README.md)
>
> 架构协议：[architecture.md](architecture.md)
>
> 跨版本边界：
> [ADR-0018](../../adr/0018-file-backed-mcp-library-runtime-projection.md)

## 实施原则

- 五个检查点分别完成代码、测试和文档状态更新后 Commit。
- 先完成文件真源和脱敏 API，再做 Importer、Runtime、Renderer。
- 不预装第三方 MCP，不写入 Runtime 用户配置，不建立 SQLite MCP 表。
- 所有 Parser 与 Adapter Translator 处理当前安装版本，不使用版本 Allowlist。
- 过程中不等待人工审核；全部自动化与真实 App 验收完成后统一交付。

## 检查点 1：配置文件、Schema 与 Core API

> 实施状态：已完成（2026-07-24）。

实施：

- 新增 `mcp` Core 模块与 `McpConfigStore`。
- 实现 `~/.lumen/mcp.json` Schema v1、Strict Validation、Canonical JSON、
  Digest、Permissions、Atomic Write 与 CAS。
- 实现空文件、不存在、损坏、外部编辑和权限过宽的读取模型。
- 实现 List/Create/Update/Enable/Delete API 与脱敏合约。
- 保留名称 `lumen_team`，不增加默认 Server。
- Electron Main 增加 Reveal Config。

测试：

- 首次读取零写入。
- Schema、名称、Transport、URL、Header、Command、Env 与成员引用。
- Atomic Write 中断、临时文件清理、权限 `0600`。
- Stale Digest、重复请求、外部编辑冲突。
- 错误文件不会被空配置覆盖。
- API 与诊断不泄露敏感值。

完成门：

- `mcp.json` 是唯一 MCP 配置真源。
- SQLite Schema 没有 MCP Server/Assignment 表。
- `cargo test --workspace`、`pnpm typecheck` 通过。

实施记录：

- `McpConfigStore` 已实现严格 Schema、Canonical JSON、原始字节 Digest、CAS、
  原子替换、`0600` 权限、损坏文件只读错误和敏感值脱敏。
- Core 与 Renderer 契约已提供读取、创建、编辑、启停、删除和打开配置位置的窄 API；
  首次读取不会创建 `~/.lumen/mcp.json`。
- 不存在的删除目标、未知 AgentProfile 分配、保留名称、未知字段和陈旧 Digest
  均会确定性拒绝。
- 验证：Rust Workspace 112 个库测试与 33 个二进制测试通过（4 个手工
  Runtime Smoke 按设计忽略）；Renderer 42 个测试通过；TypeScript 类型检查通过。

## 检查点 2：六种 Importer

> 实施状态：待实施。

实施：

- Codex TOML Importer。
- Claude Code、Copilot、Antigravity 与 Cursor JSON Importer。
- OpenCode JSON/JSONC Importer。
- 支持环境覆盖路径，严格限制用户级来源。
- 实现 Scan/Normalize/Redact/Compare/Commit 两阶段协议。
- 实现明文凭据遮罩、OAuth/SSE/Tool Filter 不可移植 Issue。
- 实现同名幂等、Replace/Rename/Skip 和重复定义提示。
- Import 默认勾选全部当前活跃 AgentProfile。

测试：

- 六种来源的本机样例和缺失文件。
- 单来源损坏不影响其他来源。
- 不读取项目级配置。
- 不把明文 Env/Header 返回 Renderer。
- `${ENV_VAR}` 保留。
- OAuth、SSE 和限制性 Tool Filter 不会静默导入。
- 冲突策略与 Digest CAS。

完成门：

- Scan 只读且零进程/网络副作用。
- Import 后不依赖来源文件。
- 重复扫描不会修改现有配置。

## 检查点 3：AgentRun Exposure 与 Runtime Projection

> 实施状态：待实施。

实施：

- Adapter Registry 增加 MCP Projection Capability。
- Context Manifest 增加脱敏 MCP Exposure 与 Digest。
- AgentRun 前解析 Enabled、Assignment、Adapter、Environment 与 CWD。
- 生成 `<data_dir>/runtime/mcp/<run>/<epoch>` 私有不可变投影。
- 恢复复用原投影；终态与启动扫描安全清理。
- 配置损坏、缺 Env、不支持 Adapter 时 Fail Closed 外部 MCP，Team MCP 保持。
- Context Inspector 展示 Exposure，不显示秘密。

测试：

- 每成员过滤、默认全员与后续新增成员不自动授权。
- Run 中修改/禁用/删除不改变当前 Projection。
- Core 重启后同一 Run 复用原 Projection。
- Projection 丢失/篡改明确失败。
- 终态清理与孤儿目录 GC。
- Manifest 无凭据。

完成门：

- 每个 AgentRun 的外部 MCP 清单可解释、可恢复、不热切换。
- Native Session ID 不因 MCP 改变。

## 检查点 4：多 Adapter 原生注入

> 实施状态：待实施。

实施：

- Codex App Server/Exec Fallback 注入完整 `mcp_servers`。
- Claude Code 合并外部与 Team MCP，使用 Strict Config。
- OpenCode ACP Session 注入并隔离个人配置。
- Copilot Additional Config 注入并隔离 Built-in、Personal 与 Plugin MCP。
- Antigravity 明确报告 Unsupported。
- Runtime Event 和 Action/Approval 按实际 Adapter 能力标注。

测试：

- 每个 Adapter Translator 的 Stdio/HTTP Golden Config。
- `lumen_team` 无法被外部定义覆盖。
- 未分配的用户个人 MCP 不出现在 Runtime Tool List。
- Resume 同一 Native Session 时可以使用新 AgentRun 配置。
- Adapter 无法安全隔离时拒绝暴露，而不是降级泄露。
- 本机当前版本真实 Runtime Smoke；不固定版本号。

完成门：

- Codex、Claude Code、OpenCode、Copilot 至少各完成一次真实逐轮注入验证。
- Antigravity UI/Manifest 明确 Unsupported。
- Team MCP 原有 A2A/Task Smoke 全部保持通过。

## 检查点 5：设置页、集成验收与收口

> 实施状态：待实施。

实施：

- 设置导航增加“MCP”。
- 实现 Empty/List/Loading/File Error/Conflict 状态。
- 实现 Add/Edit/Enable/Delete Dialog 与成员多选。
- 实现按来源分组的 Import Dialog。
- 实现“打开配置文件”和重新读取。
- Day/Night、键盘、Focus 与最小窗口验收。
- 更新 README、本地开发、版本状态与 Smoke 命令。

自动化：

- Renderer 纯函数与交互测试。
- Core Contract 测试。
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- 现有 Core、Runtime、Team、Task、Skill、Recovery Smoke。
- 新增 MCP Config、Import、Projection 与真实 Runtime Smoke。

真实 App 验收：

- 初次打开 MCP 页面为空，无 Context7。
- 导入本机候选时不显示明文秘密。
- 添加 Stdio/HTTP、分配成员、启停、编辑、删除可用。
- 外部修改合法 JSON 后页面重载；损坏 JSON 不被覆盖。
- 四个支持 Adapter 的 AgentRun 只看见其已分配 MCP 与 Team MCP。
- 改 MCP 后同一 Native Session Resume，新 Run 使用新配置。
- 删除 MCP 不影响正在运行的 Run，后续 Run 不再暴露。
- Antigravity 显示不支持而不修改其配置。
- `1440×920` 与 `1040×700`、Day/Night 均可用。

完成门：

- 五个检查点全部完成并分别 Commit。
- 自动化、真实 Runtime 与 App 验收有可复现记录。
- v0.09 文档状态与实际实现一致。
