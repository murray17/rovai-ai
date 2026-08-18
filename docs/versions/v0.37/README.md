---
document_type: version-overview
version: v0.37
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-05
---

# Rovai-ai v0.37 MCP Configuration, Projection and Runtime-Group Skills

> 状态：设计与生产实施已完成
>
> 前置版本：[v0.36 Collaboration-Value Diagnostic Portfolio](../v0.36/README.md)
>
> 跨版本决策：[ADR-0103](decisions.md#adr-0103)、
> [ADR-0104](decisions.md#adr-0104)、
> [ADR-0105](decisions.md#adr-0105)
>
> 实施设计：[architecture.md](architecture.md)
>
> UI 合同：[production-design.md](production-design.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

v0.37 把 MCP 设置从 Rovai 专用拆分表单收敛为标准 `mcpServers` JSON，同时在同一
`~/.rovai/mcp.json` 中以隐藏 `_rovai` 元数据保存稳定 Server Identity、启停和按队员的
Assignment。设置页以用户确认的 v4 HTML 交互稿为内容结构参考，但继续使用 Arctic Dawn
App Shell、Token、组件与产品语言。

本版本还统一八种 External MCP Adapter 的同名语义：Rovai 本次 AgentRun 投影优先于同名
Runtime 原生 MCP。无法可靠实施优先级或外部配置被 Runtime 拒绝时，记录显式降级并允许基础
AgentRun 继续；不得静默使用原生同名 Server，也不得仅因外部 MCP 不可用阻止队员运行。

同一版本把 Skill 从全局隐式投递改为应用级 Library、不可变 Revision 和九个 Runtime Delivery
Group 的显式 Assignment。Rovai 只管理项目原生目录中的受管链接，不接管 `.agents/skills`，
并把每次实际可见的 Revision、路径和冲突冻结到 AgentRun ContextManifest。

## 范围

- `~/.rovai/mcp.json` schema v2：公开 `mcpServers` + 隐藏 `_rovai`；不再选择旧品牌路径；
- Assignment 引用不可变 `serverId`，与 Server Definition、启停相互独立；
- Add/Edit 只接受恰好一个标准 `mcpServers` JSON 条目；
- 新配置原子写入 Context7、Playwright 两个禁用、未分配的 reviewed defaults；
- 导入只在用户点击后扫描，并按无损规范化、明确丢弃、阻止迁移三级预览；
- 一个设置页依次展示添加/导入与公开配置预览、按队员 Assignment、已安装 MCP；
- AgentRun 冻结 MCP Projection Input，成功建立 Runtime Session 后封存最终 Exposure；
- Codex、Claude Code、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code 统一
  Rovai 同名优先语义；
- Development-only Runtime 与真实 MCP Smoke，不在用户机器上执行连接探测；
- Skill Library 的本地/GitHub 导入、全局启停、不可变 Revision 与九个 Runtime Group Assignment；
- 九种 Product Runtime 的原生 Skill 目录投影、冲突保护、活跃 Run 稳定和真实 discovery smoke。

## Clean break

应用尚未发布旧 MCP schema，因此不增加生产兼容 reader、SQLite migration 或自动 v1
转换。开发机上的旧 `~/.rovai/mcp.json` 可以在开发流程中单独备份、转换或删除；该操作不进入
App 逻辑。历史 AgentRun 的冻结 Context/Projection 仍按原证据读取，不把新的 live config
反向写入既有 Run。

## 明确不在范围

- 统一 MCP Tool Policy、跨 Runtime tool allowlist/denylist、审批或 auto-approve 语义；
- OAuth 状态、credential cache、Runtime sandbox/trust 配置的自动迁移；
- MCP Registry、在线模板目录、默认启用或默认 Assignment；
- 设置页主动启动 Server、连接远端或宣称实时 online；
- SQLite MCP Server/Assignment 真源；
- 修改用户或项目的 Runtime 原生 MCP 配置。

## 完成定义

只有在 schema/identity/atomic write、导入分级、Renderer 双尺寸与键盘交互、八 Adapter
投影测试、同名 smoke、两个 reviewed default smoke、九 Runtime Skill discovery smoke 和完整
回归证据均通过后，本版本才可标记 `implementation_status: complete`。
