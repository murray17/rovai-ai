---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-09
---

# Kilo 常规 Steer 后复用与适配边界

User sequence 25 质疑正常 Steer 后无条件退役的必要性，并要求解释文件转换、MCP cwd 与其他接入的关系；
问卷关闭双入口明确保持。在原 `rovai/kilo-acp` worktree、基线 `0ffb6fe460359c13deb05ac0e18c797ca355666c` 实施。
当前语义见 [Launch v82](../../contracts/runtime-launch-and-verification-v82.md)，理由见 [D81](decisions.md#v1-72-d81)。

## 最小改动

Kilo 本来就用普通 `session/prompt` 插话；额外成本来自 Rovai 共享提交路径设置的退役标记。
此前没有实际失败证据证明正常成功后必须重启，不能把缺少复用验收当成必须退役的原生约束。
现在只在已有 `AcpPromptProgress` 汇合出正常终态时解除 Kilo 的 Steer 标记，然后走原 Fleet 复用。
失败、取消和未收口仍保持原处理，其他 Runtime 不变。没有新状态字段、计时、队列或管理器。

共同终态仍须等待原请求与所有已提交补充请求，不能只看某一个 RPC 成功；输入未知仍不自动重放。
终态可见前仍沿共享 detach/release 顺序，让后继 Run 获得已经空闲的 Host。

## 与其他接入的具体对照

| 内容 | Kilo | 其他现有路径与必要性 |
| --- | --- | --- |
| 文件结果 | 读取 `metadata.filediff` 或 `metadata.files[]` 中的 path/type/patch，映射为共同 Diff candidate | OpenCode 的标准 ACP Diff 进入共同分支；MiniMax 从 `details.patch` 取 patch；Claude 整理已成功的精确替换；Command Code 关联 proposed edit 与成功回执。均需把各自字段整理成共同 shape |
| 后续显示 | 路径、统一 patch 解析、增删计数、预算和 Renderer 共用 | 这层不再次执行写入。需要文件列表和红绿 Diff 时，不能把字段接线直接删掉；不需要再做 Kilo 专用渲染或解析器 |
| MCP cwd | ACP 的单个 stdio MCP 配置没有 cwd，只有会话 cwd；服务目录不同时使用 bundled CLI 的私有启动模式 | Command Code 共用同一 helper；Claude 的附加原生 MCP 配置直接携带 cwd，Kiro 的原生 Agent 配置也携带 cwd。配置入口不同，不能要求所有接入使用同一种启动方式 |
| 条件范围 | 服务 cwd 相同、未设置或 HTTP 均不包装 | 只为保持用户明确配置的不同目录，避免相对入口、资源和配置解析到项目目录。无需新服务或外部 Node；共享入口保留 |

当前 OpenCode 的普通 ACP MCP 构造没有调用这一 cwd helper；这是其不同目录能力需要单独核对的地方，
不能用“其他 ACP 没有处理”证明 Kilo 可以丢掉用户配置的 cwd。本轮不扩大修改其他 Runtime。

## 验证归属与实际结果

扩展已有 `active_input_receipts_preserve_the_original_prompt_and_fence_late_sources`：
成功和明确未接受后的正常汇合不退役；原请求/两条补充终态的两种顺序、失败、未知和取消仍保留。
新增 Rust 测试函数为零。

原版本该 owner 先失败于 `retire_after_steer=true`，修正后通过。
原生产 Core 加强既有 smoke 后，在首轮成功 Steer 的普通后继获得了不同 Host，按预期断言失败；
失败 fixture 为 `rovai-kilo-core-CX5RkK`，原记录保留。

现有 Core smoke 扩展为三轮连续“Steer 成功 → 普通后继”，验证跨 Run 的同 Host/Session，
后继各用自己的 CLI lease 实际公开发送且无重复 final；三轮用于覆盖已经经历过前次 Steer 的进程。
另保留待回执时取消及新 Host 后继、原权限/MCP/cwd/相对路径/用量场景。
官方 7.8.27 与新构建生产 Core/CLI 在 `rovai-kilo-steer 复用-3u472auk` 完成 **23 个 Run：21 成功、2 主动取消**。
三轮 Steer 及各自普通后继使用同一 Host `55b8f766-0c5d-4fb6-bd18-49f2a7758dcc`、同一原生 Session；
每个后继的 CLI 消息均归属自己的 Run，且没有重复 final。输入账本为 23 start accepted、
3 steer accepted、1 steer delivery_unknown。待回执 Steer 取消后，原 Host 与后继 Host 确实不同，后继 succeeded。

原 no-Node、pure=true 权限、MCP A→B→A、不同 cwd、相对 write 的持久化 Diff、Bootstrap 与部分数值采样均继续通过。
验收结束回收本轮 Core/Runtime，运行文件清理通过。使用本地受控 Provider 和假 token，没有付费模型调用。
[白名单证据](../../research/kilo-runtime/steer-reuse-7.8.27-macos-arm64.json)仅保留版本、Run/Host/Session 关联、账本与结果，
不发布模型请求正文或原生数据库。

最终门禁通过：`cargo test --workspace` **484 passed、1 项既有 ignored**；active-input extended owner 通过。
`TZ=UTC pnpm test` 为前端 **3193 passed/2 skipped**、Node **377 passed/2 skipped**；
`pnpm typecheck`、`pnpm build:desktop` 与 `pnpm dev` 构建/窗口核对通过。
开发版恢复原隔离 fixture 的文件 Diff，3 文件 +5/−3 与草稿 `on` 保持，未发送新模型请求。
`pnpm docs:test` 10 项、`pnpm docs:check`、
`DOCS_BASE_REF=958784f6e17fc32d8b2753d7f14fd6122dceea9d pnpm docs:check:ci`、
Cargo format、Node syntax 和 `git diff --check` 通过。

## 边界

本轮使用官方 7.8.27、macOS arm64、独立 data/Skills/MCP/HOME/XDG 和受控 Provider。
未重跑付费模型，未据此扩大 Windows 或其他版本资格。输入 scheduler 仍串行派发；
不把传输 owner 的多 RPC 测试描述为多条用户 Steer 同时派发。
文件与 MCP cwd 本轮保持原实现，问卷双入口按用户意见保持。
