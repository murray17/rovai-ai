---
document_type: implementation-plan
version: v1.43
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-04
---

# v1.43 实施与验收

## 实施范围

- [x] 删除 Pi `resources_discover` skill path、`get_commands` activation/catalog 与全部 Slash Command 展开。
- [x] 把 Formatter 22 payload 原样发送为 Pi `prompt.message`，从 ContextManifest 结构化附件生成图片。
- [x] 删除 Prompt Transform 运行时类型、Blob/数据库写入和正则依赖；Migration 138 保留图片行并移除旧表。
- [x] 删除 `--no-extensions` 自动 fallback，升级薄 extension/binding/receipt 至 v6/schema 3。
- [x] 为 activation 错误建立 `ResumeContinuityLost | ActivationFailed | HostFailed | ConfigurationFailed` 分类。
- [x] 把 Fleet acquire 改为 Reserve/锁外 Spawn/Commit，并覆盖同 Run singleflight、容量、失败与 shutdown fencing。
- [ ] 完成 Rust、文档、TypeScript、桌面构建和 staged PR 门禁。

## 验收重点

- 正式 Pi argv 只有 `--mode rpc --no-themes --extension`，不会静默禁用用户 Extension；
- managed extension 不出现 `resources_discover`、`skillPaths`、Skill root/exposure 或完整 catalog 证明；
- 任意以 `/` 开头的 Rovai 输入仍逐字节作为普通 Prompt，图片不从 Dynamic Context 文本反向解析；
- 非 continuity activation error 不新建 replacement Session；explicit missing/unreadable locator 才允许一次 replacement；
- 两个不同 Run 的慢 spawn 能并发，相同 Run 只启动一次；Starting 占用容量且被 shutdown/删除 fencing 退役；
- Migration 138 后 Prompt Transform 表不存在，图片和 Receipt 的父 Delivery cascade 成功，foreign key check 为空；
- Machine Ready 仍不发送 Prompt、不调用模型或 Tool/MCP，且 Probe session/config 能清理。

## 必跑命令

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p rovai-core pi::
cargo test -p rovai-core runtime_fleet::tests
cargo test -p rovai-core v135_through_v138_preserves_receipt_and_direct_image_cascades
cargo test -p rovai-core pi_prompt_images_bind_directly_to_delivery_before_dispatch --features slow-tests
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
pnpm test:rust:staged
git diff --check
```

## 验证记录

验证完成后在本节记录命令、用例数量和任何平台限定；真实 Provider/Prompt 不属于普通门禁，不得把 deterministic
fixture 或本机 Preview 运行误记为 qualification evidence。
