---
document_type: implementation-plan
version: v0.83
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-15
---

# v0.83 实施与验收计划

## Checkpoint 0：版本、Research 与真实 Probe

- [x] 拉取最新 `origin/main`，冻结完成的 v0.82 并开启唯一 current v0.83；
- [x] 将 Downloads 中的研究简报原样放入 `docs/research/trae-cli-runtime/`，校验 SHA-256 一致；
- [x] 对 `traecli 0.120.52` 执行真实 `initialize`、`session/new`、prompt、cancel、permission、MCP 与跨 Host load Probe；
- [x] 保存脱敏 Capability Snapshot，明确 Ready / Authentication Required / Incompatible / transient 分类边界。

## Checkpoint 1：Product Runtime 与数据合同

- [x] 增加 `trae-cn-cli` AdapterKind、`traecli` discovery、`acp serve` launch 和 ACP v1 probe；
- [x] 模型与 permission mode 从 Session 返回动态建立，不静态写死模型或默认 yolo；
- [x] Migration 86 保留旧 Installation/Profile binding，只扩展 TRAE closed kind；
- [x] DeepSeek Harness 保持 Renderer-only preview，不进入 Core、合同或数据迁移。

## Checkpoint 2：AgentRun、安全与能力收窄

- [x] 正式 AgentRun 复用 ACP Host、Action/Approval、cancel、Native Session 与 Runtime Activity；
- [x] MCP 沿用 `AdditivePerRun` 并通过 Session 参数追加，不写用户/Workspace 全局配置；
- [x] 第一版完成后停止 Host；Skill discovery 与 compaction 保持未启用；Missing-Send 经专项三场景验证后启用；
- [x] 增加确定性 Registry、Probe classification、launch、mapping 与 Migration 回归。

## Checkpoint 3：Renderer 与文档

- [x] Runtime 页面、成员参数、侧栏/工作区 label 接入 TRAE 与图标；
- [x] Runtime 页面加入 DeepSeek Harness disabled “待支持”行，不提供检查或配置动作；
- [x] 更新 Runtime Catalog、兼容性、Activity、开发测试与版本文档；
- [x] 完成 Impeccable detector、目标 Renderer 测试与构建验收。

## Checkpoint 4：最终验证

- [x] 运行 Rust workspace 定向/完整测试、format、strict Clippy 与 TypeScript typecheck；
- [x] 运行 TRAE 真实 deep probe 及正式 AgentRun completion/Approval smoke；
- [x] 运行 TRAE Missing-Send zero-send / suppression / tool→final 专项 Smoke；
- [x] 运行 TRAE per-Run additive MCP smoke，并结合原生 sibling Session Probe 证明未配置 Session 不继承追加项；
- [x] 运行文档治理、Migration、Desktop build 与最终 diff 检查；
- [x] 回填真实结果和未证明能力后标记 complete。

## 完成证据

- Rust：workspace 455 个 library、12 个 CLI、74 个 Core binary 测试通过，4 个手动 Runtime smoke 按既有策略忽略；`cargo fmt --check` 与 strict Clippy 通过；
- Renderer/协议：51 个 Vitest 文件、347 项测试、179 项 Node 测试、TypeScript typecheck、member config smoke 与 Impeccable detector 通过；
- TRAE 实机：deep probe、completion、allow/reject Approval、cancel、Missing-Send 三场景与 additive per-Run MCP smoke 通过；未配置 sibling Session 未继承追加 MCP；
- 打包态：Runtime 设置目标段验证 TRAE、DeepSeek preview、原子绑定 set/clear 与 1040×700 无横向溢出；Runtime Activity 完整验收覆盖 10 个正式 Runtime、9 行结构化工具活动与诚实 run-level fallback；
- 交付：Desktop arm64 package、bundle/Core/CLI/native addon strict codesign、Migration/Benchmark 合同与文档 diff gate 通过。
