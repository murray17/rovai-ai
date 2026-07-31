---
document_type: implementation-plan
version: v0.26
authority: implementation-status
status: complete
last_updated: 2026-07-31
---

# v0.26 实施与验收

## 文档与领域

- [x] ADR-0082 冻结成员运行配置、默认值、漂移和无兼容重置边界。
- [x] `CONTEXT.md` 定义 Runtime Default/Explicit Model Selection 和 Member Runtime
  Configuration。
- [x] Arctic Dawn 成员规范增加“运行参数”折叠区。

## Core 与持久化

- [x] v41 Migration 清空全部成员 Runtime 选择、模型和权限参数。
- [x] 原子保存命令支持完整配置与未就绪 `AdapterKind` 例外。
- [x] 停止 snapshot/Installation 后台自动补齐成员配置。
- [x] Core 为九种 Adapter 提供明确的最宽松成员权限默认值。
- [x] 保存和 Readiness 使用当前模型、option、权限 schema 与原生值校验。
- [x] AgentRun 继续冻结配置，Host/Session 差异沿用 ADR-0007 惰性交接。

## Renderer

- [x] “Agent运行时”下增加默认收起的“运行参数”。
- [x] 九种 Runtime 使用专用字段组件和原生序列化。
- [x] `runtime_default` 隐藏模型与模型参数；固定模型按 snapshot 渲染。
- [x] Copilot `allow_all` 与 Antigravity `dangerously_skip_permissions` 使用开关。
- [x] 切换 Runtime 只重置本地草稿；原子保存失败保留草稿。
- [x] 普通成员页不显示 Installation、路径、fingerprint、auth scope 或探测详情。

## 自动化验收

- [x] `cargo fmt --all -- --check`
- [x] `cargo test -p rovai-core`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm package:mac`

## 真实交互检查

- [x] Runtime 未就绪时可以保存选择，但参数保持未配置。
- [x] Runtime 就绪后必须显式保存完整参数才 Ready。
- [x] 九种 Runtime 默认值、字段名和开关值与 ADR-0082 一致。
- [x] 固定模型切换会重建该模型 option 草稿；跟随默认不保存 options。
- [x] 能力漂移显示 `needs_attention`，不会静默重置。
- [x] 本地 arm64 App 能启动并打开成员页，折叠、编辑、保存和错误状态可操作。

## 验收证据

- Core：218 个 library test 与 45 个 binary test 通过；5 个依赖真实外部 Runtime 的
  手工 smoke 按定义忽略。
- Renderer：24 个 test file、125 个测试通过，TypeScript typecheck 通过。
- `smoke:member-config` 验证未就绪选择、无 Runtime fallback 和重启持久化。
- 打包 App 的 `accept:member-lifecycle-ui` 验证 v41 全量清空、默认收起、Runtime
  切换重置、放弃草稿、固定模型 option、原生权限原子保存、重启和两个目标尺寸。
- `dist/mac-arm64/Rovai-ai.app` 已完成 arm64 目录打包并通过 `codesign --verify
  --deep --strict`；本地开发包为 ad-hoc 签名，未做 notarization。
