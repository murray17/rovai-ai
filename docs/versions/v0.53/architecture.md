---
document_type: version-architecture
version: v0.53
authority: version-local-production-design
last_updated: 2026-08-10
---

# v0.53 Production Architecture

长期组件和权威边界见 [Benchmark Protocol architecture](../../architecture/benchmark-protocol.md)，字段合同见
[Benchmark Protocol v3](../../contracts/benchmark-protocol-v3.md)。本文件只记录 v0.53 的具体接线。

## 目录与兼容入口

`scripts/benchmark/` 分为 `protocol`、`adapters`、`profiles`、`execution`、`evaluation`、`reporting`。
`scripts/qualification-suite.mjs` 与 `scripts/project-qualification-benchmark.mjs` 是薄 wrapper；旧 package command
保持。v0.34 的 3 rounds/4 cases/version 校验只在 `qualification-suite-v034` adapter 和 legacy profile 中。

Registry 的四个 ID 为：

- `qualification-suite-v032`；
- `qualification-suite-v034`；
- `diagnostic-portfolio-v036`；
- `benchmark-protocol-v3`。

Trial schema 1/2 在 legacy adapter 中 normalization；v3 Writer 不写 legacy schema。历史读取与派生 v3 是
两步操作，不允许覆盖 source。

## Current Contract Profile

`current-contract-conformance@1.0.0` 只有一个 deterministic round 和 15 个 criteria。Runner 先确认所引用的
Rust `#[test]` 仍存在，再运行 `cargo test -p rovai-core --lib -- --test-threads=1`。它不复制 Context/Migration
算法，也不启动真实 Agent Runtime。Task v2、Built-in Transport v4 和 accepted-input ACK 作为 prerequisite
evidence 进入 fingerprint/profile evidence。

## 输出

- `benchmark-run.json`：v3 machine authority；
- `evidence.json`：确定性 source/test process evidence；
- `README.md`：Review 投影；
- `comparison.json` 与 `.md`：逐轴 eligibility/diff；
- Project `reports/<run-id>/`：源 Run 的字节副本和派生 Review。

公开 Run 的路径/secret scanner 和 schema validator 都在写入前执行。Project import 只使用用户消息 draft/send
合同并传 `execution:null`，随后读取 CampSnapshot 验证没有 Turn/Run。

## Unattended Qualification failure boundary

Legacy/public Demo Runner 不会把人工重试当作自动执行：当当前 required AgentRun 都已进入终态 `failed`、
CampTurn 仅因可人工重试而保持 `waiting`，且没有待结算 Delivery、Action 或外部效果时，Runner 等待一个短暂
稳定窗口后以 `unattended_manual_retry` 收口。它不发送取消、不改写 Hard Outcome；因此功能交付仍按 Verifier
结果判定，Turn 未终态仍会使 Orchestration Convergence 保持失败。该边界避免 Runtime 已失败后空等完整预算。

Core 的筛选诊断只写入 trial evidence 目录中的 `runtime-private-log.ndjson`，不进入 Evidence Bundle Manifest、
public report 或任何公开路径投影；其中的 Runtime stderr、模型错误和绝对路径仍属于私有证据。

## Schema

- [Benchmark Run v3](schemas/benchmark-run-v3.schema.json)
- [Benchmark Comparison v1](schemas/benchmark-comparison-v1.schema.json)
