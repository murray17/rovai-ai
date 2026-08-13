---
document_type: version-overview
version: v0.70
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-13
---

# Rovai-ai v0.70：消息局部 User Attention 教学收窄

> 当前状态：实现、确定性门禁与 Codex 单 Runtime 行为 smoke 已通过；九 Runtime v8 正式矩阵尚未执行，
> 因此版本保持 `in_progress`。Core-owned Current User Attention 的持久化、Notification、Delivery 与
> 权限语义保持不变。同一 current snapshot 已把三项固定 `mattpocock/skills` 工程工作流纳入十项
> official Skill inventory。
>
> 前置版本：[v0.69 Planned Shutdown 线性化与硬期限修正](../v0.69/README.md)

## 版本目标

修正 `rovai send --to-user` 被 Agent 误解为“发送给用户”或与 `--to` 配套使用的常规模式。普通
CampMessage 已经对用户可见；`--to-user` 只把当前这条公开消息升级为需要用户特别处理的 attention，
其统一判据是：消息新产生了一个尚未解决的用户决定、回答或行动，或者履行用户明确要求的重要异步
结果通知。

本版本不修改 `mentionUser=true` 的 Core 效果，不分析正文、不按 Agent 角色拒绝、不自动抑制连续
Mention，也不从 reply、Task、父子 AgentRun、A2A 或历史消息继承 attention。

Skill inventory 增量以 [ADR-0174](../../adr/0174-ten-skill-official-inventory-and-pinned-matt-pocock-imports.md)
替代七项集合，离线引入 `diagnosing-bugs`、`tdd` 与 `writing-for-agents`；不改变 Skill Library、
Runtime Group Assignment 或权限模型。

## 交付范围

### 单一 Agent-facing 判据

- 新增集中式 Send teaching module，统一 catalog summary、`mentionUser` schema description、精确 help
  文案和三条基础示例；
- `rovai send --help` 明确普通消息已对用户可见，列出正向判据、常规负向场景、消息局部不继承、
  无 Agent Delivery 与不代表用户批准；
- 基础示例分别展示 public-only、Agent-only、User-attention-only，不演示 `--to + --to-user`；
- Session Charter 增加一条短且高信号的相同边界，避免每个新 Session 都重新从宽泛语义猜测。

### 协作责任与非例行组合

- `cli-operations` Send reference 删除“需要用户查看”这一过宽条件；
- 内部评审、子任务、验证和临时协助 Agent 默认把结果返回调用方，由承担用户侧闭环责任的 Agent
  重新判断；该规则只是 Agent 使用指导，不成为 Core authorization；
- 只有用户和 Agent 各自拥有相互独立的行动时才组合 `--to` 与 `--to-user`；依赖用户决定的 Agent
  工作必须等待用户回复后再唤醒。

### 合同与 Runtime rollout

- Camp Message Send v5 保留 v4 closed input、wire、原子效果、幂等、错误和 compact output，只收窄
  `mentionUser` / `--to-user` 的 Agent-facing 使用合同；
- Built-in Tool Transport v8 保留十三项命令、IPC、Envelope、receipt 与 Agent Output，升级 CLI context、
  capability 和 catalog identity；
- catalog digest 必须因 summary/schema 教学变化而改变；Antigravity 既有 binding digest 包含该 identity，
  因此建立 replacement Native Session；其他 Runtime 不因 Charter copy 全局丢弃会话，续接进程使用当前
  v8 CLI/help 与 official Skill Revision，新 Session 使用当前 Charter。

### 十项 official Skill inventory

- 从 `mattpocock/skills@84fdeffd12f2ee307994d1eb6feb48173b6e0502` 完整 vendor
  `diagnosing-bugs`、`tdd` 与 `writing-for-agents` 的选定目录，并附 MIT LICENSE/NOTICE；
- Core 构建脚本递归打包四项固定 GitHub 来源 Skill，拒绝 symlink 与非普通文件，构建和运行时均不访问网络；
- 三项 Skill 仅收窄调用 description 并本地化 `agents/openai.yaml`，其余上游工作流正文与资源保持不变；
- 新 Skill 作为普通 official row 默认启用并投递九个 Runtime Groups，设置页显示固定 GitHub 来源与
  8 字符 Revision，不增加专属分组、required/locked 状态或新权限；
- `code-review` 暂不原样导入，先围绕 Camp public A2A、独立双轴审查、solo fallback 与 authority
  boundary 设计 Rovai-native 版本。

完整字段与长期边界由 [Camp Message Send v5](../../contracts/camp-message-send-v5.md)、
[Built-in Tool Transport v8](../../contracts/builtin-tool-transport-v8.md)、
[Current User Attention v2](../../contracts/current-user-attention-v2.md)、[ADR-0165](../../adr/0165-core-owned-current-user-message-attention.md)
与 [ADR-0166](../../adr/0166-progressive-built-in-cli-teaching.md) 拥有；实施证据见
[实施计划](implementation-plan.md)。

## 冻结边界

- 不修改 Current User identity、Structured Content、Notification、read lifecycle、Renderer 或数据库；
- 不新增字段、Migration、Agent recipient、Delivery、Task cardinality、A2A budget 或用户批准语义；
- 不让 Core 分析正文价值、推断 Agent 角色、限制提醒频率或修正 Agent 提交的布尔值；
- 不把完整 Send 决策树塞入 Charter，也不扩大 `cli-operations` 的普通单操作触发范围；
- 不把文案变化冒充模型行为已经改善；真实 Runtime 行为必须由单独 smoke 证据确认。
- 不动态扫描或导入上游仓库其他 Skill，不跟随浮动分支，不在构建/运行时联网更新固定副本；
- 不让 Skill trigger、默认启用或 GitHub 来源成为诊断、修复、实现、测试 seam、文档写入或 Tool 权限。

## 发布门槛

1. Rust tests 覆盖精确 help 三类分离示例、schema 判据、catalog digest 变化和 Antigravity binding replacement；
2. Charter 与 bundled `cli-operations` tests 覆盖 message-local、负向场景、闭环责任和独立行动组合；
3. CLI smoke 验证 Transport v8 capability/version、精确 help 正反断言和原有 `mentionUser` Core effects；
4. 文档链接、版本生命周期、合同/Architecture 路由、ADR history 与 diff-aware governance 全部通过；
5. 至少一个目标 Runtime 完成针对“普通最终回复/内部协作不再连续提醒用户”的真实行为 smoke；九 Runtime
   正式兼容矩阵在发布前补齐，未执行时不得声称 v8 real-model compatibility 已证明；
6. Skill validator、Core manifest/provenance/risk tests、Renderer source presentation、十项 fresh-Core
   inventory fixture 与文档治理全部通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.69 按已完成事实冻结为 historical；v0.70 成为唯一 current，并记录 User Attention 教学收窄范围与证据缺口 |
| ADR | 已更新 | ADR-0165/0166 只增加当前 v5/v8 Contract References；新增 [ADR-0174](../../adr/0174-ten-skill-official-inventory-and-pinned-matt-pocock-imports.md)替代七项 official inventory |
| Contracts | 已更新 | 新增 Camp Message Send v5 与 Built-in Tool Transport v8；v4/v7 转为 historical current-entry，不改 Current User Attention v2 |
| Architecture | 已更新 | Built-in Tool Runtime 与 Public A2A 路由到 v5/v8，并记录十项 inventory 与固定 GitHub 来源的离线边界 |
| UI | 已更新 | Current User Attention 的 Renderer 合同不变；Settings surface 与 UI 验收同步十项普通列表和四项 GitHub 来源 |
| Runtime Activity | 确认无需更新 | 不新增 operation、Activity identity、provider event 或 classifier；现有 send Evidence 形状不变 |
| Runtime compatibility | 已更新 | 当前合同入口切换到 v8；Codex 聚焦行为 smoke 已通过，v7 九 Runtime 证据仍不能冒充 v8 全矩阵 |
| Documentation routing | 已更新 | docs map、CURRENT、Contract/Architecture 索引和 current version pointer 路由到 v0.70 权威，Skills 主题入口切换到 ADR-0174 |
| Root README | 确认无需更新 | 项目定位、常青能力与支持 Runtime 集合不变；根 README 不记录版本局部教学修正 |

## References

- [v0.70 实施与验收计划](implementation-plan.md)
- [ADR-0165](../../adr/0165-core-owned-current-user-message-attention.md)
- [ADR-0166](../../adr/0166-progressive-built-in-cli-teaching.md)
- [ADR-0174](../../adr/0174-ten-skill-official-inventory-and-pinned-matt-pocock-imports.md)
- [Camp Message Send v5](../../contracts/camp-message-send-v5.md)
- [Built-in Tool Transport v8](../../contracts/builtin-tool-transport-v8.md)
- [Built-in Tool Runtime 架构](../../architecture/builtin-tool-runtime.md)
