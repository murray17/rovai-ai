---
document_type: implementation-plan
version: v1.01
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-17
---

# v1.01 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0207](../../adr/0207-explicit-maximum-authority-member-runtime-defaults.md)与
[Runtime Launch and Verification v4](../../contracts/runtime-launch-and-verification-v4.md)。修改 Rust 测试遵守
[Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)；启动 Core、Desktop、
打包 App 或真实 Runtime 前遵守[本地 Runtime 工作流](../../development/local-workflow.md)。

## Checkpoint 0：Kiro 原生能力证据与治理

- [x] 本机 Kiro CLI 2.16.1 `acp --help` 确认 `-a, --trust-all-tools`；
- [x] Context7 官方文档确认 `allowedTools` 与 trust-all 语义，排除全局 `*` 猜测；
- [x] 接受 ADR-0207、Runtime Launch and Verification v4，开启唯一 current v1.01；
- [x] 生成 ADR HISTORY 并通过通用文档门禁。

## Checkpoint 1：Core 默认值与执行映射

- [x] TRAE 新队员默认改为 `bypass_permissions`，静态 descriptor 同时接受保守与最高权限值；
- [x] Kiro 新增 `trust_all_tools` descriptor，默认 `on`，scope 为 Host；
- [x] Kiro Agent Host 将 `on` 映射为 `--trust-all-tools`，Probe 与 read-only effective launch 保持关闭；
- [x] permission schema digest 改变时不保留旧 Ready snapshot；
- [x] 增补 schema drift 与 Kiro effective launch 定向回归。

## Checkpoint 2：Renderer 与队员配置

- [x] Kiro 运行参数复用现有可访问开关，标签为“自动允许全部工具”；
- [x] TRAE/Kiro draft 直接复制 Core `memberRuntimeDefaults`；
- [x] Renderer 定向测试覆盖两个最高权限默认和 Kiro 开关；
- [x] 完成 TypeScript、403 项聚合 Vitest、Desktop build 与 Impeccable detector。

## Checkpoint 3：自动化与交付

- [x] Rust 定向与完整测试（479 lib + 12 CLI + 89 Core binary）、fmt、严格 Clippy 和 diff check 通过；
- [x] TypeScript typecheck、403 项 Vitest 与 Desktop production build 通过；
- [x] 文档测试、版本/ADR 门禁与 diff-aware CI 门禁通过；
- [x] Impeccable detector 返回零问题；未启动 App、真实 Runtime 或修改/替换日常安装版；
- [x] 聚合 `pnpm test` 已执行；唯一失败是 HEAD 已存在的 benchmark profile locator 仍要求
  `current_data_contract_accepts_current_and_exact_upgrade_sources`，而 HEAD `db.rs` 已改名为
  `current_migration_state_admission_matrix`。本版本未修改这两个文件，不把该基线失配计为本版本回归；
- [x] 最终实现与验收结论已记录，版本状态更新为 complete。

## References

- [v1.01 版本概览](README.md)
- [ADR-0207](../../adr/0207-explicit-maximum-authority-member-runtime-defaults.md)
- [Runtime Launch and Verification v4](../../contracts/runtime-launch-and-verification-v4.md)
- [本地 Runtime 工作流](../../development/local-workflow.md)
