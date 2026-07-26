---
document_type: version-overview
version: v0.11
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-26
---

# Rovai-ai v0.11 受控品牌与技术标识迁移

> 状态：实现完成（4/4）
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.10 长期记忆](../v0.10/README.md)
>
> 跨版本决策：[ADR-0048](../../adr/0048-rovai-product-identity-and-legacy-namespace.md)
>
> 实施入口：[架构与协议](architecture.md) · [实施计划](implementation-plan.md)

## 版本目标

v0.11 将旧的 Lumen AI 与未发布的 Horizonward 命名统一迁移到 Rovai-ai，使公开品牌、
GitHub、桌面包、Core、私有包、IPC/API、运行时生成标识、当前文档和纯品牌界面文字
遵循同一份命名表。

## 固定命名

| 用途 | 名称 |
|---|---|
| 正式品牌展示名 | `Rovai-ai` |
| GitHub / npm slug | `rovai-ai` |
| 普通内部前缀 | `rovai` |
| Rust Core package / binary | `rovai-core` |
| Rust 导入模块 | `rovai_core` |
| Electron appId | `ai.rovai.desktop` |
| IPC / Renderer API | `rovai:*` / `window.rovai` |
| TypeScript API 类型 | `RovaiApi` |
| Core 覆盖变量 | `ROVAI_CORE_BIN` |
| 诊断文件前缀 | `rovai-diagnostics-` |
| 日志组件 | `[rovai-core]` |
| macOS 产物前缀 | `Rovai-ai-` |

## 范围

- GitHub 仓库更名为 `murray17/rovai-ai`，本地 `origin` 同步新 URL。
- 桌面显示名、窗口标题、HTML title、设置页和其他纯品牌文案使用 Rovai-ai。
- Rust crate/Core、npm workspace、Preload API、Electron IPC 与运行时内部品牌标识使用
  `rovai` 命名。
- 新安装使用 Rovai-ai 数据/config 路径和技术标识；已有 Horizonward/Lumen 路径按
  ADR-0048 受控回退。
- 不改变 Camp、Task、AgentRun、Approval、Audit、Recovery、Memory 或 Runtime
  Adapter 的业务语义。

## 非目标

- 不更换应用图标。
- 不重新设计界面，不修改布局、组件结构、主题、颜色、间距或交互。
- 不改变权限、审批、审计、恢复、持久化或领域行为。
- 不改写 OpenAI、Antigravity、Claude、Codex、OpenCode、Copilot、MCP 等第三方名称。
- 不处理域名、商标结论、组织账号迁移或公开发布。

## 验收

- 源码与构建产物遵循固定命名表，没有活动的 Lumen/Horizonward 输出。
- 旧 `userData`、Home 配置和 `lumen.sqlite` 在新位置不存在时仍可读取。
- 新输出只使用 `ROVAI_*`、`rovai` 和 `Rovai-ai`，不合并或双写旧位置。
- 图标和 Renderer 结构/样式文件没有品牌迁移之外的视觉变更。
- Rust、TypeScript、Renderer 测试、无模型 Smoke 与 macOS 打包通过。
