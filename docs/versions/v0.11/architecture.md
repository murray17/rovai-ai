---
document_type: version-architecture
version: v0.11
lifecycle: historical
authority: version-architecture-and-protocol
last_updated: 2026-07-26
---

# Rovai-ai v0.11 命名迁移架构

> 状态：已实现
>
> 版本范围：[README.md](README.md)
>
> 跨版本决策：[ADR-0048](../../adr/0048-rovai-product-identity-and-legacy-namespace.md)

## 1. 身份分层

| 层 | v0.11 身份 |
|---|---|
| 产品 / Electron productName | `Rovai-ai` |
| GitHub / 根 npm package | `murray17/rovai-ai` / `rovai-ai` |
| 私有 npm scope | `@rovai/*` |
| Rust package / crate / binary | `rovai-core` / `rovai_core` / `rovai-core` |
| Electron appId | `ai.rovai.desktop` |
| Preload / IPC | `window.rovai` / `rovai:*` |
| TypeScript API | `RovaiApi` |
| 新环境变量 | `ROVAI_*` |

大小写和连字符不做自由变体：品牌文字使用 `Rovai-ai`，slug 使用 `rovai-ai`，普通内部
命名使用 `rovai`。

## 2. 路径与数据库选择

Electron Main 在 `ready` 前执行：

```text
explicit --user-data-dir?
  yes → preserve it
  no  → Rovai-ai exists?
          yes → use Rovai-ai
          no  → Horizonward / Horizonward AI / Lumen AI 中第一个存在的目录
```

Skill 与 MCP 使用：

```text
~/.rovai/<resource>
~/.horizonward/<resource>  # compatibility input
~/.lumen/<resource>        # compatibility input
```

Core 在选定数据目录中优先打开 `rovai.sqlite`；仅当它不存在且 `lumen.sqlite` 存在时
复用旧数据库。选择发生后只写一个位置，不复制、不合并、不双写。

## 3. Runtime 命名

新生成的 Runtime 配置只发出 `ROVAI_*`。读取优先级是 `ROVAI_*`、`HORIZONWARD_*`、
`LUMEN_*`。新 Team MCP 和结构化回执使用：

```text
rovai_team
rovaiTeamTool
rovaiTeamReceipt
rovai.team-tool-*.v1
```

新 Camp Git ref、导出格式、Bundled Skill URI 与 Git exclude block 使用：

```text
refs/rovai/camps/*
rovai-diagnostics-v4
rovai-memory-export-v1
rovai://bundled
# BEGIN/END ROVAI MANAGED SKILL PROJECTIONS
```

已有数据库行中的旧 ref 或 source URI 仍按其存储值工作；旧 Git exclude block 会在下一次
reconcile 时被 Rovai block 原位替换。

## 4. 桌面与构建

- Core 查找顺序以 `ROVAI_CORE_BIN` 开始，并兼容旧变量作为只读回退。
- Main 日志组件固定为 `[rovai-core]`。
- 诊断文件固定使用 `rovai-diagnostics-YYYY-MM-DD.json`。
- macOS App 是 `Rovai-ai.app`，DMG/artifact 前缀是 `Rovai-ai-`。
- `build/icon.*`、Renderer 布局、组件树和样式不属于本版本改动。

## 5. 语义边界

Camp、Task、AgentRun、Approval、Audit、Recovery、Memory 和五种 Runtime Adapter 的
领域与协议语义不变。Team MCP 的品牌 namespace 与 Core 同步切换，但工具名称、
参数意义、授权、幂等、审计和恢复规则不变。第三方产品与协议名称保持原样。
