---
document_type: implementation-plan
version: v0.50
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-09
---

# v0.50 实施与验收计划

> 本文 Checkpoint 0–5 和验证结果只记录已经合入的 Self/Peer Collaboration baseline，不证明随后
> 接受的 Model Context Projection、Task Notice/Charter 或 Bootstrap Redelivery v2 已实现。逐项结论见
> [设计审查](model-context-projection-review.md)；该审查不是实施规格，当前也未授权据此写代码。

## Checkpoint 0：版本、决策与合同

- [x] v0.49 按原实施事实冻结为 historical，v0.50 成为唯一 current；
- [x] ADR-0146 冻结唯一 Self Identity、peer routing projection 与 ACK 边界；
- [x] Collaboration State v2 冻结模型字段、选择规则、隐私、digest 和 inclusion；
- [x] Bootstrap v3 / Bootstrap Formatter v3 / Context Formatter v11 / ContextManifest v8；
- [x] 长期 Architecture、领域词汇和文档路由同步。

## Checkpoint 1：Projection 与 formatter

- [x] `MEMBER_IDENTITY` 保持六字段 schema v1、固定顺序和 eligible-Bootstrap eventual consistency；
- [x] `peers = current CampMembers - self`，away/leave-requested 保留至正式 left；
- [x] peer 只投影 Agent ID、Name、Team Role、Professional Responsibilities；
- [x] Lead 改为 `defaultLeadAgentId + selfIsDefaultLead`，不复制 self 文本；
- [x] Session Charter 声明 sole self identity 与 peer-only routing identity。

## Checkpoint 2：Digest、Evidence 与 ACK

- [x] 对完整最终 Collaboration State v2 canonical projection 计算 digest；
- [x] `collaborationStateIncluded` 独立记录本轮是否渲染；
- [x] Prepared/Frozen Context、Runtime Input Delivery、ContextManifest、事件和 Read Model 全链路改名；
- [x] accepted ACK 只推进冻结的完整 projection digest；failure/unknown/not accepted 不推进；
- [x] self 编辑、Presence 和 leave request 等非模型可见变化不触发重复投递。

## Checkpoint 3：Migration 68 clean break

- [x] 唯一升级源为 v0.48/schema 26，且 migrations 66、67 已应用、68 未应用；
- [x] 清理旧 Binding、Session、watermark、redelivery、resume、observer 和上下文技术投影；
- [x] 旧非终态 Run/Turn 与未完成 Message Delivery/attempt fail closed，旧 frozen delivery context link 清除；
- [x] 保留 Camp、消息、Task、Conversation 和终态 Run/Turn 业务历史；
- [x] 新表只接受 v3/3/11 与非空 inclusion，无旧 formatter/read compatibility 分支。

## Checkpoint 4：自动验收

- [x] Self/peer/Lead/privacy/presence/leave-requested/digest/inclusion/ACK 端到端测试；
- [x] v68 精确 source、业务历史保留、技术投影表行/可达引用清理、FK 与重复启动幂等测试；
- [x] 完整 `context::tests`；
- [x] 完整 `db::tests`；
- [x] Rust workspace format/check/clippy/test；
- [x] TypeScript typecheck 与 Vitest；
- [x] `pnpm docs:check` 与 `git diff --check`。

## Checkpoint 5：Self/Peer baseline 完成条件

- [x] 所有工作区级命令通过；
- [x] 当前合同搜索不存在 live `member_state_digest`、旧 formatter 或 nullable inclusion 分支；
- [x] Self/Peer baseline 记录实际验证结果；该完成事实不再代表扩展后的整个 v0.50。

## Self/Peer baseline 实际验证结果（2026-08-09）

- `cargo fmt --all -- --check`：通过；
- `cargo check --workspace --all-targets`：通过；
- `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `cargo test --workspace`：库测试 296 项、CLI 测试 9 项、主程序测试 52 项全部通过；3 项手工
  Runtime smoke 按合同标记为 ignored；
- `cargo test -p rovai-core context::tests`：30 项通过；
- `cargo test -p rovai-core db::tests`：34 项通过；
- `pnpm typecheck`：通过；
- `pnpm test`：38 个 Vitest 文件共 235 项、78 项 Node qualification tests 全部通过，且前置
  documentation version check 通过；
- `pnpm docs:check`：通过；
- `git diff --check`：通过；
- 当前合同搜索只在历史 migration 输入、v0.48 source fixture 与历史版本文档中命中旧名称；
  current DTO、运行时 SQL、formatter 与 read path 均为 v3/3/11/v8 current-only 合同。

## 扩展范围状态门槛

- [x] 第 4–13 项逐项挑战完成，确认与否决项已归档；
- [x] ADR-0147 冻结四层权威、无损投影和 Redelivery v2 的长期边界；
- [ ] 最终 DTO、Formatter/Manifest Evidence、clean-break 影响和验收矩阵形成独立实施规格并获批；
- [ ] 获得明确代码实施授权；
- [ ] 最终 v0.50 实现与全量验证完成。

上述门槛全部完成前，本计划和 v0.50 概览不得恢复 `complete`。既有 `[x]` 是仍然有效的历史验收
事实，不是对未实施范围的隐式授权。
