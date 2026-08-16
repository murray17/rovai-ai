---
document_type: implementation-plan
version: v0.91
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-16
---

# v0.91 实施与验收计划

## Checkpoint 0：版本与长期边界

- [x] 冻结 v0.90，建立唯一 current v0.91 与九范围影响记录；
- [x] 接受 ADR-0197，并更新 MCP 当前 Architecture、领域词汇与 ADR 导航；
- [ ] 通过 ADR generator、版本生命周期与 base-aware 文档门禁。

## Checkpoint 1：空配置与 clean break

- [x] 删除 Context7/Playwright 常量、固定包版本与 reviewed defaults；
- [x] 新配置原子创建精确 schema v2 空 Library；
- [x] 启动迁移只按 `source: builtin` 删除 Server/Assignment，保留 user/import 同名项并证明幂等；
- [x] 无法进入严格当前 Schema 的预发布配置删除后重新初始化为空。

## Checkpoint 2：Contract、Renderer 与验收脚本

- [x] 删除 `presetId`、built-in source contract、预设首字母与样式；
- [x] MCP 空状态只保留手动添加和本机配置导入；
- [x] 删除 preset Smoke，改写 packaged MCP 操作链为空 Library 起步；
- [ ] 完成 Renderer 定向测试、Impeccable detector 与隔离 packaged App MCP 验收。

## Checkpoint 3：回归与交付

- [ ] Rust fmt、定向/全量测试与 strict Clippy 通过；
- [ ] TypeScript、Vitest、文档治理与 Desktop build 通过；
- [ ] macOS App 打包、签名/架构检查与隔离验收通过；
- [ ] 提交并推送 `main`，将验收构建安装到 `/Applications`。

## 自动验收证据

实施完成后记录精确命令、测试计数、打包产物和安装结果；未执行的真实模型 Runtime Smoke 不得写成
通过。
