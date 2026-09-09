---
document_type: implementation-plan
version: v1.56
lifecycle: current
status: in-progress
last_updated: 2026-09-10
---

# 官方 ZCode 实施与验收

官方 BYOK Adapter 已实现并经过真实 Core 验证；当前为 macOS arm64 Preview，完整 First-Class 资格仍未完成。
[接入矩阵](../../research/zcode-runtime.md)逐项描述用户可观察差异；[D02](decisions.md#v1-56-d02)明确 Preview 的可见性边界。

## Worktree 交接

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-zcode-runtime`
- Branch：`codex/zcode-runtime`
- Base：`23c002585f9a6840e82294b6d9e93667f7386118`
- Governance：无先行主线治理提交；版本、合同和实现同一 PR 评审。
- Status：ready（Preview 实现可评审，未合入；First-Class 资格尚未闭合）
- 主 checkout 的并行文档改动不属于本任务；worktree 在 review/CI 期间保留。

## 已实现

- 官方 bundle 发现与 App/cjs/独立 Node composite fingerprint；统一无 GUI 启动；私有短 socket root。
- 复用 AcpHost/Fleet，Camp 内多成员 exact Session 切换、并发独立 Host；原生配置、mode、MCP 变化 fence。
- 原生 NDJSON 的 Session/Input/Turn/Tool correlation、accepted-input、终态与后台收口；未知回调拒绝。
- user FirstPayload、completed Compaction observer、标准审批、原生 Skills 与 additive MCP。
- narration/reasoning 隔离、Missing-Send、bundled CLI lease、稀疏 Usage、Read/Write/Edit 与 path-bound patch。
- 原生 detached Bash 的 pipe-owned cleanup companion；官方内核原样加载，Core/原生强杀后回收已记录的进程组。
- Migration 148 与 schema 98 的 Runtime/Skill/Compaction 闭集；目录、成员参数、安装导航、监控和活动统一呈现。

## 能力轴与验证状态

以下 `Verified + Implemented` 只适用于列出的行为及官方 App 3.11.2 / kernel 0.16.5 / Node 26.8.1 / macOS arm64。
未覆盖的组合场景仍单独记录，不能据此推导整轴 First-Class 或其他版本、平台通过。

| 能力轴 | Runtime / Rovai | 已通过行为与证据 |
| --- | --- | --- |
| Auth / Provider / Model | Verified / Implemented | 官方 MiniMax BYOK，native default 与显式模型；秘密只读自官方配置 |
| Host / Fleet / LRU | Verified / Implemented | Camp 内 A→B→A、并发独立 Host、配置变更、普通 shutdown；实际 Core 与原生 Host SIGKILL 后无残留/延迟写入 |
| Session / Continuation | Verified / Implemented | warm exact switch、Core cold resume、零历史动作/审批重放；无效 ID 一次 continuity loss 后唯一替代 Session |
| Bootstrap / Context | Verified / Implemented | FirstPayload、Session 标签不串线、warm/cold 恢复；用户已接受 user 注入与重投策略 |
| Compaction | Verified / Implemented，组合资格未全闭合 | 真实 Core manual/threshold auto/overflow reactive 完成与补发；auto compact 后 Core 重启恢复同一 Session 和补发；fail/cancel 另有原始协议与 parser 证据 |
| Skills | Verified / Implemented | 真实调用、更新、禁用/重新启用、取消分配/删除、项目冲突、重启恢复 |
| External MCP | Verified / Implemented | stdio/HTTP、native + assigned 同名优先、更新/取消分配/重分配/删除、相邻成员隔离 |
| Tool / Action / Output | Verified / Implemented | 六种命令输出、131100 字节 blob；Read/Write/空文件/Edit Diff 的实时与历史事实 |
| Narration / Final / Missing-Send | Verified / Implemented | 私有 reasoning、成功 terminal；zero-send、accepted-send suppression、tool→final |
| Permission / Cancel | Verified / Implemented | build allow/deny、plan 无写入、cancelled；等待 35 秒无延迟文件 |
| Built-in rovai CLI | Verified / Implemented | 当前完整 operation 集、Gather 返回、后续 Run、旧 lease 失效 |
| Usage / Cache / Cost | Verified / Implemented，组合资格未全闭合 | provider Turn input/output/cacheRead；其他字段 NULL；稀疏字段 parser 与实际持久化 |
| Retry / Queue / Cleanup | Verified / Implemented，组合资格未全闭合 | V4 accepted 输入、单终态、正常后台等待、取消、Core/原生强杀；共享队列/epoch 回归 |
| Ready / Version / Platform | Verified / Implemented，平台资格未全闭合 | 官方 identity、独立 Node、无模型调用 Probe；arm64 Preview，其他平台 NotQualified |

## 真实 Golden Flows

全部通过独立 Home、Core data、Skill Library 和测试项目执行。测试密钥来自用户授权的临时复制，生产实现不借用其他 Runtime 配置。
[脱敏证据清单](evidence/zcode-macos-arm64-2026-09-10.json)保存版本、内核 SHA、日志摘要 SHA 和有限 identity；不提交密钥、原始协议、Prompt 或个人路径。

| Owner | 结果 |
| --- | --- |
| `smoke-acp-runtime.mjs`（ZCode） | 文件/空文件/Edit Diff、六种命令输出、manual compact、审批/取消通过 |
| `smoke-trae-cold-resume.mjs`（ZCode selector） | exact resume、无历史重放、写入、取消、无效 Session 唯一 fallback 通过；最新 Node companion 复验通过 |
| `smoke-builtin-cli.mjs`（ZCode selector） | 完整共享业务操作、Gather、后续 lease 与失效旧 lease 通过 |
| `smoke-missing-send-recovery.mjs`（ZCode selector） | 三种发布边界通过 |
| `smoke-skills.mjs`（ZCode selector） | 全部 capability 生命周期与项目保护通过 |
| `smoke-mcp-projection.mjs`（ZCode selector） | stdio/HTTP、native 同名与 assignment 生命周期/相邻隔离通过 |
| `smoke-zcode-runtime.mjs` | A→B→A、并发、配置 fence、plan、shutdown 通过；Core/原生 Host 分别强杀、15 秒内回收及 35 秒后无文件通过 |
| `smoke-zcode-context.py auto` | 真实模型 36k threshold compact，Core observation 与下一请求补发通过 |
| `smoke-zcode-context.py reactive` | 本机代理注入一次 provider overflow，官方内核真实 compact/retry 与下一请求补发通过 |
| `smoke-zcode-context.py auto` + `ROVAI_ZCODE_CONTEXT_COLD_RESUME=1` | compact 后重启 Core，exact Session、原标签、revision 1 requested/acknowledged/accepted 通过 |
| `smoke-zcode-launch.swift` | 权限、Fleet、冷恢复、压缩后重启、两种强杀的所有被观察产品流程中新 ZCode App 注册数为 0 |

功能流早于最终进程回收 prelude 的证据与 v3 复验分开标记；不能声称每条历史功能流都运行在最终启动器上。
原始协议研究只用于说明上游字段和行为，不能替代上述 Core 产品路径。

## 本地回归

- Rust library：548 passed。
- Rust Core binary：234 passed，5 个既有 ignored；CLI binary：33 passed。
- Rust slow：全量 308 passed、1 个 Runtime 闭集期望遗漏；修正期望后该唯一失败项定向通过。没有禁用或删除测试。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `pnpm typecheck`、`pnpm build:desktop`：通过；构建未启动日常 App。
- `pnpm test`：通过；Vitest 168 files / 1717 tests，末段 Node tests 222 passed / 1 个既有平台 skip，文档与 Skills 检查通过。
- 通用文档 CI 门禁与最终 compatibility source SHA 绑定在提交前重新校验。

新增 Rust 测试按最窄已有 owner 分配：原生事件关联/拒绝终态、结构化 hunk、原生配置/MCP precedence、
有界且绑定 Session/Tool 的输出 artifact；Migration 使用独立升级 owner。Shared Fleet、Usage、closed catalog 等扩展已有测试。
原生强杀遗漏 detached 组先实际复现（延迟文件出现），再由真实 Core/原生强杀复验修复；没有用 parser 成功替代进程回收。

## First-Class 前仍需冻结的资格

- 在完整 Core 流程中联合验证 compact fail/cancel 与 Skills/MCP/权限保留；当前失败/取消证据来自原始协议与 parser，成功及 cold-after-compact 已有 Core 证据。
- provider Usage 在多次 retry、compaction、resume 组合中的无重复归属，以及 MCP mutation 的审批/取消网络副作用，补充逐流真实证据。
- Adapter 专属协议损坏、Probe timeout、idle eviction 和版本/Node 升级 drift 组合；现有共享安全回归不能替代该官方版本的全部真实流程。
- macOS x64、Windows x64 没有目标平台证据；不得因 arm64 功能通过而开放。

结构化 Prompt 图片与 GUI/Computer Use 回调为 NotImplemented，账户订阅登录在用户指定 BYOK 范围之外。
不把这些限制声明为上游 Unsupported，不把 Preview 或代码可评审等同于正式第一版接入完成。
