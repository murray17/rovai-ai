---
document_type: implementation-plan
version: v1.11
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-19
---

# v1.11 实施与验收计划

## 1. 设计与版本切换

- [x] 审核 60 秒 revalidate、24 小时最大服务、失败保留 LKG 与明确失效条件；
- [x] 确认 Provider/account 自动失效仅使用稳定非敏感 Adapter evidence；
- [x] 接受迁移前 ADR-0220 与 Runtime Launch and Verification v9；
- [x] 冻结 v1.10，建立唯一 current v1.11；
- [x] 确认不新增 Migration，Data Contract 保持 v1.10/schema 50/migration 95。

## 2. Core 与 Adapter

- [x] 增加 Core-owned model catalog cache view、60 秒/24 小时分类和 serviceable 判断；
- [x] 增加 `runtime.modelCatalog.open` 与 Runtime Check Manager 单飞/等待策略；
- [x] 使主动 `runtime.product.check` 等待 terminal，并持久化 supervisor transient failure attempt；
- [x] 允许 runtime default 脱离目录保存/冻结，保持 Claude/Agy/TRAE 既有 sentinel；
- [x] Codex 与 ACP 在真实 Host/Session 目录中最终验证 explicit model，禁止 silent fallback；
- [x] runtime default 对 Codex/ACP 不调用 set-model、不发送 model；
- [x] 将 typed live model failure 映射到 AgentRun public error code。

## 3. Renderer 与 contracts

- [x] TypeScript contract、Desktop allowlist 与 runtime-check helper 接入新方法和终态结果；
- [x] 队员页与 onboarding 共用受控 Radix model Picker；
- [x] 实现即时缓存、后台刷新、blocking discovery、LKG failure、expired/invalidated/empty/loading 状态；
- [x] 既有已保存模型按当前证据显示“当前目录未提供 / 缓存中未找到 / 尚未核对”；
- [x] 明确排除人工修改或技术恢复损坏数据的迁移与修复兼容；
- [x] 用 request generation 隔离 Runtime 切换后的旧异步结果；
- [x] 在既有 Porcelain Day / Steel Night token、密度和焦点规则内补齐 Picker 样式。

## 4. 自动验证

- [x] Rust Core all-targets check；
- [x] TypeScript typecheck；
- [x] 受影响 Renderer/contract 定向测试；
- [x] cache 边界、runtime default sentinel 与过期 explicit 保存定向 Rust 测试；
- [x] ACP/Codex fake real Host/Session explicit-model fail-closed 测试；
- [x] Rust fmt 与 default/all-features strict Clippy；
- [x] Rust fast lib、CLI、Core binary、slow 与 workspace all-features；
- [x] 全量 `pnpm test` 与 desktop build；
- [x] docs test/check/diff-aware CI/ADR generation；
- [x] Impeccable detector 单次最终检查与 `git diff --check`。

## 5. 真实验收与发布

- [x] 使用隔离 userData 完成 packaged App 队员工作区 UI/键盘验收，不启动日常 App；
- [x] 确认本版不需要调用真实 TRAE；fake ACP Session 已覆盖统一目录与执行期校验，未并发接触 TRAE 密钥/状态文件；
- [x] 确认工作树、提交与 main 集成顺序；
- [x] 推送实现提交 `a9cf6e06` 到 main；
- [x] 构建签名 App，隔离启动验证后替换 `/Applications/Rovai AI.app`，并从安装路径重新启动确认。

## 6. 2026-08-19 发布后修正

- [x] 删除 TRAE-only launch policy、execution-deferred dispatch 与首次 AgentRun 补偿路径；
- [x] 统一 Installation Refresh、Health Probe 和 Dispatch Preflight；
- [x] 将未采用备用 executable candidate 的失败收口为 candidate-local transient attempt，并保护当前 LKG；
- [x] 阻止旧 `installed_unverified` 继续 onboarding、配置或执行；
- [x] 修复数字 ADR clean break 后 bundled `grill-duo-with-docs` 的 reference 路径；
- [ ] 通过 Rust、TypeScript、Renderer、文档与 Desktop 全量门禁；
- [ ] 推送 main，完成签名打包、隔离 App 验收并替换 `/Applications/Rovai AI.app`。

## References

- [v1.11 版本概览](README.md)
- [ADR-0220 的迁移后决定正文](decisions.md#adr-0220)
- [V1.11-D03：统一 Runtime 深检生命周期与候选局部失败](decisions.md#v1-11-d03)
- [Runtime Launch and Verification v9](../../contracts/runtime-launch-and-verification-v9.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
- [本地 Runtime 工作流](../../development/local-workflow.md)
