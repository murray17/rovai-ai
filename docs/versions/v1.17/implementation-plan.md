---
document_type: implementation-plan
version: v1.17
authority: implementation-and-acceptance-status
status: implemented
last_updated: 2026-08-20
---

# v1.17 统一附件发布与 Agent 文件发送实施计划

## 1. 治理与数据合同

- [x] 冻结 v1.16，建立唯一 current v1.17 与 [V1.17-D01](decisions.md#v1-17-d01)；
- [x] 建立 v1.17 当前 Contracts，并同步 Architecture、UI 与文档路由；
- [x] Migration 102 从完整 schema 56 升到 schema 57，保留历史公共附件并回填 `available`。

## 2. 深模块与 ingress

- [x] 建立 `CampAttachmentPublicationCoordinator` 小接口，统一 Composer/Agent 的语义提交、reservation、
  revision、operation、writer intent 与 Delivery gate；
- [x] 建立 `CampAttachmentProjectionWorker`，按 Camp semantic revision FIFO 完成无数据库锁 copy/hash/fsync；
- [x] Composer 从同步 View-before-message 改为短事务 public commit，Agent CLI 增加受限 `--file` Authority ingress；
- [x] built-in file freeze 不持有全局 invocation guard/Database mutex，提交前重验 exact lease/run/epoch。

## 3. admission、恢复与读取侧

- [x] unresolved writer intent 阻止 Scheduler Claim；一个 AgentRun 只取得一次 Camp read admission；
- [x] `projection_blocked` Delivery 占据 FIFO，成功后释放，terminal failure 稳定结算；
- [x] startup recovery、normal worker、full verification、rebuild、authorization 与 path resolver 共享
  `available` Desired-set 定义和 failed tombstone；
- [x] quota 同时统计 materialized bytes 与 unresolved reservation；terminal failure 释放 reservation；
- [x] Camp open 与 Renderer 投影 pending/recovery/failed，不暴露 Authority/Runtime path。

## 4. 验证与发布

- [x] 定向回归覆盖 Agent source boundary、真实 accepted IDs、FIFO gate、同 Camp queue、startup recovery、
  failed Runtime exclusion、quota、统一 aggregate、Migration 102 与 Renderer 状态；
- [x] 通过 Rust fmt/Clippy/PR suite、TypeScript、Vitest、Desktop build 与文档门禁；
- [x] 从治理提交 worktree 完成功能提交，快进 main 并 push；
- [x] 完成 macOS arm64 package、签名/架构校验与 `/Applications` 安装交接。

## References

- [v1.17 版本概览](README.md)
- [V1.17-D01](decisions.md#v1-17-d01)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
