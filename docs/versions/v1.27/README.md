---
document_type: version-overview
version: v1.27
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-08-22
---

# Rovai-ai v1.27：Kimi Code + MiniMax M3 本地 Runtime 接入

> 当前状态：Kimi Code `0.32.0` 已作为第十二种 Product Runtime identity 接入，并在 macOS arm64 上使用
> MiniMax 国内 Token Plan、`MiniMax-M3` 与 OpenAI-compatible endpoint 完成基础 ACP、真实 Approval、
> command-output、Missing-Send、cancel 与进程清理验收。修正 Built-in CLI fixture 的过期退出码断言后，
> 完整资格矩阵通过十五项 operation 并产生 56 条 full-run evidence；macOS arm64 已晋升为 `qualified`，
> macOS x64 与 Windows x64 仍未准入。
>
> 前置版本：[v1.26 Cursor Agent Catalog 接入](../v1.26/README.md)已按冻结时事实转为 historical。

## 版本目标

依据 [Kimi Code Runtime Research](../../research/kimi-code-runtime-research.md)与
[Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)，让 Kimi Code 使用
Rovai 私有、最小权限的 provider 配置运行 MiniMax M3，而不改写用户原有 `~/.kimi` 配置，也不把密钥写入
数据库、仓库、日志或公开 Runtime Evidence。

## 交付范围

- 新增 `AdapterKind = kimi-code-cli`、`SkillDeliveryGroupKey = kimi`、Migration 105 与 Data Contract
  `v1.19 / projection schema 60`；
- 发现 `kimi`，以 `kimi acp` 启动 ACP v1；每个 AgentRun 完成后回收 Host，但同一 Camp/成员的兼容逻辑
  会话复用稳定、隔离的 Rovai `KIMI_CODE_HOME`；
- 从 `~/.config/rovai/kimi-code.env`（或 `ROVAI_KIMI_CONFIG`）读取严格 allowlist 的六个
  `KIMI_MODEL_*` 字段；Unix 上拒绝 group/other 可访问文件；
- 支持 `default`、`plan`、`auto`、`yolo` 权限模式，Core read-only 强制 `plan`；真实 Shell 工具调用仍由
  Rovai permission request 决定，不把 provider 配置当作授权；
- 不强制关闭 Kimi/MiniMax thinking；`KIMI_MODEL_CAPABILITIES=thinking` 只作为能力声明。
  `<think>...</think>` 推理块不进入公开消息，完整闭合块被剥离，未闭合块 fail closed；
- Kimi Skill 投影到 `.kimi-code/skills`；External MCP、Usage/Cost、Compaction 与 warm Host reuse 保持
  Disabled。capability snapshot 保留真实 `session.resume/load`，新 Host 优先精确 resume，load 只作
  replay-quarantined fallback；
- macOS arm64 声明 Built-in transport 并进入普通 discovery、检查、成员配置和执行路径；macOS x64 与
  Windows x64 仍保持准入阻断，不从 arm64 证据外推。

## 明确边界

- ACP Client `fs/write_text_file` 没有匹配的一次性授权时由 Core 拒绝；写文件验收使用会产生结构化
  permission request 的 Shell 路径；
- `.kimi-code/skills` 的真实发现、唯一 marker 调用和 canonical `--to-principal` 教学通过；Kimi 已进入
  `smoke:skills all`；`--to-user` 仅是隐藏兼容 alias，不是当前 canonical 教学；
- allow 与 deny 均已通过真实 Approval roundtrip；deny 的目标 Tool 为 `not_executed` 且没有文件副作用；
- stdout、stderr、mixed、empty、nonzero 与 large output 六类终态 Tool Evidence 已通过；empty 场景中模型未给
  final 时 AgentRun 正确 fail closed，Tool terminal 仍可审计；
- 早期 Built-in CLI `0/15` 来自 fixture 把 legacy stdin 非法输入退出码错误地期待为 `1`；Kimi 实际执行了
  Shell，并在第一项 canonical operation 前被断言终止。修正为当前 CLI 合同的退出码 `2` 后，十五项
  operation、三种输入、Gather、conflict、lease fence、exact successor read 与 logical/native continuation
  全部通过，Kimi 声明 built-in transport capability 并进入默认矩阵；
- 原始 ACP Probe 中，同 Host 多 Session 无串话；新进程复用同一 `KIMI_CODE_HOME` 的 exact resume/load 保持
  Session ID 和上下文，而新隔离 home 对旧 ID 返回 `Unknown sessionId`。产品现按稳定逻辑 scope 保留私有
  home：terminal 前仍停止 Host，后继新 Host 精确 resume；load 仅作为带 quarantine 的 fallback；
- 原始 ACP stdio MCP Tool 调用与相邻空 MCP Session 隔离通过，但 Rovai projection 尚缺 precedence、完整定义
  和 Host compatibility 准入；本版没有把 External MCP、Token Usage、Cost 或 Compaction 写成已支持；
- macOS x64 与 Windows x64 没有从 arm64 结论外推资格。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.26 冻结为 historical；本概览、计划、决定和版本索引建立唯一 current v1.27。 |
| Decisions | 已更新 | [V1.27-D01](decisions.md#v1-27-d01)记录私有 provider 配置；[V1.27-D02](decisions.md#v1-27-d02)替代其每 Host home/new-only 选择；[V1.27-D03](decisions.md#v1-27-d03)记录 Built-in fixture 根因和 macOS arm64 准入。 |
| Contracts | 已更新 | [Runtime Launch and Verification v21](../../contracts/runtime-launch-and-verification-v21.md)冻结稳定 Session home、跨新 Host exact continuation 与 macOS arm64 资格。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)扩展为十二种 identity，并记录 Kimi 边界。 |
| UI | 已更新 | Member/Settings surface brief 与 Renderer catalog 加入 Kimi 图标、权限和逐平台状态。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)加入 Kimi ACP `run_level` baseline 与真实 Shell Evidence。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 `0.32.0`、MiniMax M3、真实 prompt/approval/output/cancel/cleanup、Built-in 15/15 与平台边界。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航路由到 v21、本版本与 Kimi Research。 |
| Root README | 已更新 | 常青能力更新为十二种 Product Runtime identity。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Launch and Verification v21](../../contracts/runtime-launch-and-verification-v21.md)
- [Kimi Code Runtime Research](../../research/kimi-code-runtime-research.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
