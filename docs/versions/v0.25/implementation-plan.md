---
document_type: implementation-plan
version: v0.25
authority: implementation-status
status: complete
last_updated: 2026-07-31
---

# v0.25 实施与验收

## Core 与持久化

- [x] v40 Migration 建立 Camp Composer Draft、Prepared Attachment、稳定 Message
  Attachment 与 ContextManifest v5。
- [x] 文件准备限制普通文件、数量/大小、规范化名称、SHA-256 和安全栅格预览。
- [x] 消息事务按 Draft 顺序原子消费全部附件；正文非空规则保持。
- [x] Camp 删除与 Draft 过期清理附件目录。
- [x] Current Input、Shared Conversation 与边界检索返回稳定路径。
- [x] 删除生产代码中的 Managed Blob 附件写入与 Run Attachment Projection。

## Electron 与 Renderer

- [x] Preload 使用 `webUtils.getPathForFile`，内存文件通过有界 Main ingress。
- [x] Renderer 只开放 Draft 方法和受控预览，不开放任意本地路径读取。
- [x] 粘贴/拖拽、准备/错误状态、移除、恢复与原子发送。
- [x] 消息附件纵向冻结显示与安全图片 Lightbox。
- [x] Inspector 使用 Camp Attachment Paths / refs / digest 词汇。

## 验收

- [x] `cargo test -p rovai-core`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm package:mac`
- [x] 真实 macOS App：Paste 文件/截图、Drag 多文件、导航恢复、重启恢复、失败保留。
- [x] 真实 macOS App：消息冻结附件、图片键盘 Lightbox、普通文件降级、路径不泄漏。
- [x] 真实 Runtime：被寻址成员和后续成员都能在各自冻结边界读取同一稳定路径。

## 验收证据

- Rust：214 个 library tests、45 个 binary tests 通过；5 个既有手工 Runtime tests
  保持 ignored。
- Renderer：23 个 test files、115 个 tests 通过，TypeScript typecheck 通过。
- macOS：arm64 打包 App 在隔离 `userData` 中完成拖拽、文件 Paste、普通文字 Paste、
  导航/重启恢复、拒绝发送保留、纵向消息卡、Lightbox Escape、通用文件降级和绝对
  路径不泄漏检查。
- Runtime：`pnpm smoke:attachments` 让两个被寻址 Codex Runtime 分别读取同一
  Current Input 路径，再让第三个成员从后续 Shared Conversation 读取该历史路径；
  三个 AgentRun 都返回只存在于文件中的随机令牌。
