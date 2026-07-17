# Lumen AI

Lumen AI 是一个本地优先的 AI 研发工作空间。v0.01 聚焦一条可验证的自举路径：在 macOS App 中驱动本机 Codex，在独立 Git Worktree 中继续开发 Lumen 自身。

产品与验收范围见 [v0.01 MVP 规格](docs/mvp-v0.01.md)。

## 本地开发

要求：

- macOS 14+（Apple Silicon）
- Node.js 24+
- pnpm 11+
- Rust stable
- Git
- 已安装并登录的 Codex CLI

```bash
pnpm install
pnpm dev
```

## 构建 macOS App

```bash
pnpm package:mac
```

未签名的本地构建位于 `dist/mac-arm64/Lumen AI.app`。

