---
document_type: implementation-plan
version: v1.19
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-20
---

# v1.19 Agent 文件入口隔离与纯附件发送实施计划

## 1. 治理与合同

- [x] 冻结 v1.18，建立唯一 current v1.19 与两项版本决定；
- [x] 建立 Send v12、Attachment v4、Built-in v19、Runtime Launch v13，并同步 Architecture 与文档路由；
- [x] 明确不修改 Data Contract、View v3、Context/Manifest 或 Agent accepted output。

## 2. Run tmp lease 隔离与 Runtime 准入

- [x] 每次 bind 在激活 lease 前 fail-closed 重置稳定 `ROVAI_RUN_TMP`，unbind/fence 尽力清理；
- [x] authentication 只返回 active lease 对应的已重置 exact root，lease rotation 回归证明旧文件不可见；
- [x] Codex、Claude Code、ACP/Copilot 与 Antigravity 原生目录参数包含 exact Run tmp，并更新参数/root 测试。

## 3. Authority ingress 与纯附件 Send

- [x] 跨 `CampAttachmentStore` 实例共享 per-Camp ingress gate，覆盖 Camp root mode transition、Agent freeze、
  Composer prepare/remove/discard、failure cleanup 与 Camp removal；
- [x] 定向并发测试证明同 Camp 独占、不同 Camp 不共享该 admission；
- [x] `body` serde/schema/help 改为可选默认空串，领域门禁接受 attachment-only 并拒绝 body/files 同时为空；
- [x] attachment publication 回归使用真实空 body，CLI direct flags 支持只传 `--file`。

## 4. 验证与发布

- [x] 通过定向 Rust 测试、fmt、Clippy、Rust PR suite、TypeScript/Vitest、Desktop build 与文档门禁；
- [x] 从治理提交创建独立 worktree，功能提交 fast-forward `main` 并 push；
- [x] 完成 macOS arm64 package、签名/架构校验、隔离 App 验收与 `/Applications` 非终止安装交接。

## References

- [v1.19 版本概览](README.md)
- [v1.19 决策记录](decisions.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
