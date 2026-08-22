---
document_type: version-overview
version: v1.27
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-22
---

# Rovai-ai v1.27：Kimi Code + MiniMax M3 本地 Runtime 接入

> 当前状态：Kimi Code `0.32.0` 已作为第十二种 Product Runtime identity 接入，并在 macOS arm64 上使用
> MiniMax 国内 Token Plan、`MiniMax-M3` 与 OpenAI-compatible endpoint 完成基础 ACP、真实 Approval、
> command-output、Missing-Send、cancel 与进程清理验收。但完整 Built-in CLI 资格矩阵连续三次未建立任何
> CLI operation evidence（两次为 `0/15`），因此 macOS arm64 也保持 `not_qualified`；其他平台同样未准入。
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
- 发现 `kimi`，以 `kimi acp` 启动 ACP v1；每个 Host 使用隔离 `KIMI_CODE_HOME`，完成后立即回收；
- 从 `~/.config/rovai/kimi-code.env`（或 `ROVAI_KIMI_CONFIG`）读取严格 allowlist 的六个
  `KIMI_MODEL_*` 字段；Unix 上拒绝 group/other 可访问文件；
- 支持 `default`、`plan`、`auto`、`yolo` 权限模式，Core read-only 强制 `plan`；真实 Shell 工具调用仍由
  Rovai permission request 决定，不把 provider 配置当作授权；
- 不强制关闭 Kimi/MiniMax thinking；`KIMI_MODEL_CAPABILITIES=thinking` 只作为能力声明。
  `<think>...</think>` 推理块不进入公开消息，完整闭合块被剥离，未闭合块 fail closed；
- Kimi Skill 投影到 `.kimi-code/skills`；External MCP、Usage/Cost、Compaction 与 native session resume
  保持 Disabled。每个 Run 建立新 Session，capability snapshot 不声明 `session.resume`；
- 三个平台均保持准入阻断，不进入普通 discovery、检查、成员配置或执行路径；macOS arm64 的直接诊断
  证据只用于定位剩余 Built-in transport 阻断，不构成产品资格。

## 明确边界

- ACP Client `fs/write_text_file` 没有匹配的一次性授权时由 Core 拒绝；写文件验收使用会产生结构化
  permission request 的 Shell 路径；
- `.kimi-code/skills` 的真实发现、唯一 marker 调用和 canonical `--to-principal` 教学通过；Kimi 仅因平台
  未准入而不进入 `smoke:skills all`；
- allow 与 deny 均已通过真实 Approval roundtrip；deny 的目标 Tool 为 `not_executed` 且没有文件副作用；
- stdout、stderr、mixed、empty、nonzero 与 large output 六类终态 Tool Evidence 已通过；empty 场景中模型未给
  final 时 AgentRun 正确 fail closed，Tool terminal 仍可审计；
- Built-in CLI 资格矩阵一次等待 12 分钟没有 execution evidence，随后两次虽结束但均跳过 shell、产生
  `0/15` operation evidence；Kimi 不声明 built-in transport capability，也不进入默认矩阵；
- 原始 ACP Probe 中，同 Host 多 Session 无串话；新进程复用同一 `KIMI_CODE_HOME` 的 exact resume/load 保持
  Session ID 和上下文，而新隔离 home 对旧 ID 返回 `Unknown sessionId`。Rovai 当前 terminal 前停止 Host 且
  每 Host 新建 home，所以 warm reuse、native resume 与 History Restore 仍不作为产品能力；
- 原始 ACP stdio MCP Tool 调用与相邻空 MCP Session 隔离通过，但 Rovai projection 尚缺 precedence、完整定义
  和 Host compatibility 准入；本版没有把 External MCP、Token Usage、Cost 或 Compaction 写成已支持；
- macOS x64 与 Windows x64 没有从 arm64 结论外推资格。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.26 冻结为 historical；本概览、计划、决定和版本索引建立唯一 current v1.27。 |
| Decisions | 已更新 | [V1.27-D01](decisions.md#v1-27-d01)记录私有 provider 配置、隔离 Host 与 `new_only` Session 策略。 |
| Contracts | 已更新 | [Runtime Launch and Verification v20](../../contracts/runtime-launch-and-verification-v20.md)冻结 Kimi identity、配置、推理隔离、能力收窄和准入。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)扩展为十二种 identity，并记录 Kimi 边界。 |
| UI | 已更新 | Member/Settings surface brief 与 Renderer catalog 加入 Kimi 图标、权限和逐平台状态。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)加入 Kimi ACP `run_level` baseline 与真实 Shell Evidence。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 `0.32.0`、MiniMax M3、真实 prompt/approval/output/cancel/cleanup 与 Built-in 阻断。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航路由到 v20、本版本与 Kimi Research。 |
| Root README | 已更新 | 常青能力更新为十二种 Product Runtime identity。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Launch and Verification v20](../../contracts/runtime-launch-and-verification-v20.md)
- [Kimi Code Runtime Research](../../research/kimi-code-runtime-research.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
