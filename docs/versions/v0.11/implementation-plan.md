---
document_type: implementation-plan
version: v0.11
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-26
---

# Rovai-ai v0.11 实施计划与验收清单

> 状态：实现完成（4/4）
>
> 版本范围：[README.md](README.md)
>
> 架构协议：[architecture.md](architecture.md)

## 检查点

### 1. 仓库与构建身份

- [x] GitHub 仓库更名为 `murray17/rovai-ai`，本地 `origin` 更新。
- [x] 根 package、私有 npm scope、Rust crate/module 和 Core binary 使用指定名称。
- [x] Electron `productName`、`appId` 与 macOS artifact 使用指定名称。

### 2. 桌面与 Runtime namespace

- [x] `window.rovai`、`RovaiApi` 和 `rovai:*` 完成一致迁移。
- [x] `ROVAI_CORE_BIN`、`[rovai-core]` 和诊断文件前缀完成迁移。
- [x] Team MCP、Git refs、导出格式、Skill URI 与 Git exclude 使用 `rovai`。
- [x] 旧路径、数据库和环境变量只作为有序兼容输入。

### 3. 文档与 UI 边界

- [x] 当前 README、v0.11、ADR、UI 规范、本地开发和术语表使用 Rovai-ai。
- [x] 仅修改用户可见品牌文字；不修改图标、布局、组件结构或视觉系统。
- [x] 第三方名称扫描确认 OpenAI、Antigravity、Claude、Codex、OpenCode、Copilot 和
  MCP 未被品牌替换污染。

### 4. 最终验证

- [x] 旧品牌扫描只剩历史文档、兼容输入和迁移测试。
- [x] Typecheck、Renderer 测试、Rust fmt/test/Clippy 和无模型 Smoke 通过。
- [x] `Rovai-ai.app` 打包、签名、Core Ready 与关键 UI 验收通过。

## 验证命令

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm smoke:core
pnpm smoke:memory
pnpm package:mac
pnpm accept:memory-ui
```

真实模型 Runtime Smoke 不因纯品牌更名重复消耗；Core、路径、IPC、Memory、打包和
Renderer 品牌文字必须由不调用模型的测试与 App 验收覆盖。
