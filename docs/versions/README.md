---
document_type: versions-index
authority: version-lifecycle
current_version: v0.19
last_updated: 2026-07-29
---

# Rovai-ai 版本记录

`docs/versions/` 保存版本目标、版本内设计过程、实施计划、验收记录和发布范围。开始使用前先阅读 [文档导航](../README.md)；跨版本长期约束以 [有效 ADR](../adr/README.md) 为准。

## 生命周期

- `current`：唯一的当前版本，可以随范围、实施和验收事实更新。
- `historical`：已经冻结的历史快照，仅用于解释当时背景，不约束当前实现。
- 进入下一版本时，先冻结当前版本，再更新本文件 Front Matter 中唯一的 `current_version`。
- 历史文档只修复错字、失效链接或增加明确勘误，不根据新代码重写原始判断。
- 需要跨版本长期成立的决定必须提升为 ADR；版本文档只保留版本影响和 ADR 链接。

## 版本索引

| 版本 | 生命周期 | 内容 | 入口 |
|---|---|---|---|
| v0.01 | `historical` | 本地优先单 Agent 执行基线 | [v0.01/README.md](v0.01/README.md) |
| v0.02 | `historical` | 多 Agent 协作控制平面架构与验收快照 | [v0.02/README.md](v0.02/README.md) |
| v0.03 | `historical` | 多 Runtime 成员管理；五个实施检查点完成时的预发布快照 | [v0.03/README.md](v0.03/README.md) |
| v0.04 | `historical` | Camp-first 主界面导航与工作区；五个实施检查点完成时的预发布快照 | [v0.04/README.md](v0.04/README.md) |
| v0.05 | `historical` | 可重现上下文治理与 Agent 间执行型通信；五个实施检查点完成时的验收快照 | [v0.05/README.md](v0.05/README.md) |
| v0.06 | `historical` | Team Task 协作工具与动态工作上下文；五个实施检查点完成时的验收快照 | [v0.06/README.md](v0.06/README.md) |
| v0.07 | `historical` | Hearth & Camp 双主题视觉系统；五个实施检查点完成时的验收快照 | [v0.07/README.md](v0.07/README.md) |
| v0.08 | `historical` | Skill Library、设置入口与 Runtime 原生项目级发现 | [v0.08/README.md](v0.08/README.md) |
| v0.09 | `historical` | MCP Library、一次性配置导入与 Runtime 投影 | [v0.09/README.md](v0.09/README.md) |
| v0.10 | `historical` | 用户治理的应用级长期记忆；六个实施检查点完成时的预发布快照 | [v0.10/README.md](v0.10/README.md) |
| v0.11 | `historical` | Rovai-ai 受控品牌与技术标识迁移 | [v0.11/README.md](v0.11/README.md) |
| v0.12 | `historical` | 公共消息层检索、渐进摘要与上下文投递 v2 | [v0.12/README.md](v0.12/README.md) |
| v0.13 | `historical` | 伙伴经验自动沉淀与分级记忆权威 | [v0.13/README.md](v0.13/README.md) |
| v0.14 | `historical` | 营地伙伴身份视觉与受管本地头像 | [v0.14/README.md](v0.14/README.md) |
| v0.15 | `historical` | 成员生命周期、保留式永久移除与 Camp 执行准入 | [v0.15/README.md](v0.15/README.md) |
| v0.16 | `historical` | Runtime 权限归属与 Workspace 语义收敛 | [v0.16/README.md](v0.16/README.md) |
| v0.17 | `historical` | 可中断执行、持久会话证据与最小 A2A 上下文 | [v0.17/README.md](v0.17/README.md) |
| v0.18 | `historical` | 默认开启的伙伴记忆自动形成与一级长期记忆工作台 | [v0.18/README.md](v0.18/README.md) |
| v0.19 | `current` | 已验证 Runtime 目录与四种新增精确 MCP ACP 执行引擎 | [v0.19/README.md](v0.19/README.md) |
