---
document_type: implementation-plan
version: v0.09
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-25
---

# Lumen AI v0.09 实施计划与验收清单

> 状态：已完成（检查点 5/5）
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
- 重复创建相同配置、重复启停和删除不存在项保持语义幂等；未知 AgentProfile
  分配、保留名称、未知字段和陈旧 Digest 会确定性拒绝。
- 验证：Rust Workspace 112 个库测试与 33 个二进制测试通过（4 个手工
  Runtime Smoke 按设计忽略）；Renderer 42 个测试通过；TypeScript 类型检查通过。

## 检查点 2：六种 Importer

> 实施状态：已完成（2026-07-24）。

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

实施记录：

- 已实现 Codex TOML、OpenCode JSON/JSONC，以及 Claude Code、Copilot、
  Antigravity、Cursor JSON/JSONC 的用户级只读扫描；空文件、缺失文件和单来源
  损坏均独立处理。
- Scan 返回稳定 Candidate、来源状态、兼容性与冲突，但所有来源明文 Env/Header
  均只保留字段名；`${ENV_VAR}` 原样保留。被遮罩字段可作为禁用 Server 的
  `missingValues` 保存，补齐前无法启用。
- Commit 支持批量 Create/Replace 与 Digest CAS；Replace 保留现有启用状态和
  成员分配；SSE、OAuth 不可提交，限制性 Tool Filter 必须显式确认按全部工具导入。
- 本机只读 Smoke 成功识别 Codex 4 个、Cursor 4 个候选；Claude Code、OpenCode
  与 Antigravity 空集合被正常识别，Copilot 配置缺失不报错。Smoke 输出仅包含
  来源状态和候选计数。
- 验证：15 个 MCP 配置/Importer 定向测试通过；全 Workspace 118 个库测试与
  33 个二进制测试通过（4 个手工 Runtime Smoke 按设计忽略）；Renderer 42 个
  测试和 TypeScript 类型检查通过。

## 检查点 3：AgentRun Exposure 与 Runtime Projection

> 实施状态：已完成（2026-07-24）。

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

实施记录：

- AgentRun 调度前按 Server 启用状态、AgentProfile 分配、Adapter 能力、环境变量
  和工作目录生成私有不可变投影；目录权限为 `0700`，配置文件权限为 `0600`。
- 同一 AgentRun 的后继 Execution Epoch 复用首次投影及其 Digest；修改、停用或
  删除 Library 配置只影响后续 AgentRun，不更换 Conversation 的 Native Session。
- 缺失环境变量、无效工作目录、Antigravity 不支持及损坏配置均按 Server 或整份
  配置 Fail Closed，并在脱敏 Exposure 中留下可解释原因；Team MCP 不受影响。
- Context Manifest 已持久化 MCP Exposure、配置摘要和投影摘要；SQLite、事件和
  Renderer 不保存实际 Command Environment、HTTP Header 或投影路径。
- Context Inspector 展示本轮 MCP 暴露状态、Transport、失败原因与完整性摘要；
  Read Model Schema 已升级为 v6。
- 启动与周期清理只删除终态 Run 或无权威 AgentRun 的私有投影；丢失、权限变宽
  或内容篡改会阻止恢复，不能静默重建成最新配置。
- 验证：MCP Projection 5 个定向测试、Context 11 个测试与数据库迁移 5 个测试
  通过；全 Workspace 127 个库测试与 33 个二进制测试通过（4 个手工 Runtime
  Smoke 按设计忽略）；Renderer 42 个测试和 TypeScript 类型检查通过。

## 检查点 4：多 Adapter 原生注入

> 实施状态：已完成（2026-07-24）。

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

实施记录：

- Codex App Server 的请求级覆盖现在写入完整 `mcp_servers` 表，外部 MCP 与
  `lumen_team` 一次性确定，用户个人配置不能以 TOML 表合并语义绕过投影。
- Claude Code 使用单个私有配置合并外部 MCP 与 Team MCP，并同时传入
  `--mcp-config --strict-mcp-config`；恢复 Native Session 时仍应用当前 AgentRun
  的冻结投影。
- OpenCode Agent Host 隔离用户与项目配置，并通过 ACP `session/new` /
  `session/load` 传入精确 Stdio/HTTP Server 清单。
- Copilot 保留用户现有 `COPILOT_HOME`，避免切断登录与 Provider 状态；启动前
  读取当前来源 Server 名称，显式禁用 Built-in、Personal、Workspace 与 Plugin
  MCP，再通过私有 `--additional-mcp-config` 注入外部 MCP 与 Team MCP。与投影
  同名的来源 Server 会 Fail Closed，避免禁用规则同时误伤 Lumen 投影。
- Adapter Registry 已公开 Transport、逐 Run 隔离与审批控制能力；Antigravity
  明确标记不支持，不写入其用户配置。
- Runtime 原生配置只在 Host/CLI 初始化期间存在，文件使用 `0600` 并在读取后
  删除；日志、事件与 Context Manifest 只保留脱敏 Exposure。
- 当前本机未固定版本的真实 Smoke 已通过：Codex `0.145.0`、Claude Code
  `2.1.206`、OpenCode `1.18.0` 与 Copilot CLI `1.0.74` 均实际发现并调用
  `lumen_smoke.echo`，分别返回对应的确定性结果。
- 验证：四类 Adapter 的 Stdio/HTTP Translator、权限与隔离定向测试通过；
  全 Workspace 128 个库测试与 33 个二进制测试通过（4 个手工 Runtime Smoke
  按设计忽略）；Renderer 42 个测试和 TypeScript 类型检查通过。

## 检查点 5：设置页、集成验收与收口

> 实施状态：已完成（2026-07-24）。

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

实施记录：

- 设置页的局部导航现为“技能 / MCP / 外观 / 诊断”；“成员”继续保留为全局
  一级入口，不与设置子导航重复。
- MCP 页面实现 Loading、Empty、File Error、Permissions Warning 和 Conflict
  等状态，以及 Stdio/HTTP 结构化表单、敏感值保留语义、成员多选、启停与删除。
- 首次进入只读扫描六种用户级来源；导入候选按来源展示，明文秘密永不返回
  Renderer，名称冲突必须显式替换或改名，限制性 Tool Filter 必须二次确认。
- 配置文件权限修复只执行目录 `0700` 与文件 `0600`，不会重写配置内容；窗口
  重新获得焦点时会重读外部编辑，损坏内容保持只读报错。
- Rust 内部 Tagged Enum 的字段已统一按 camelCase 输出，`agentProfileIds`、
  `configDigest` 等 Renderer 契约具有回归测试，避免 Import 读取 snake_case
  字段导致崩溃。
- 新增 `pnpm smoke:mcp`，使用本地 MCP fixture 对 Codex、Claude Code、
  OpenCode 与 Copilot CLI 执行真实 Tool Call，不固定上游版本号。
- 自动化验证通过：Rust Library 129 项、Core Binary 33 项、Renderer 45 项；
  `cargo fmt --check`、Clippy、TypeScript、Release Build 与 macOS 打包均通过。
- 隔离打包 App 验收通过：初始无默认 Context7；导入时秘密遮罩；添加 HTTP、
  编辑成员、启停、权限修复和删除均持久化；白昼 `1440×920` 与夜间
  `1040×700` 无整页横向溢出。Skill 设置页回归验收同时通过。
