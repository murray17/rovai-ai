---
document_type: implementation-plan
version: v1.07
authority: implementation-plan-and-acceptance
status: not_started
last_updated: 2026-08-18
---

# v1.07 实施与验收计划（模型上下文已确认，未实施即冻结）

## 计划状态与阻断条件

本计划只固定提案范围，未进入实现。[模型上下文变更 revision 1](model-context-change-a2a-public-only.md)
已于 `2026-08-18T15:29:27+08:00` 由 `murray17` 二次确认；这只解除模型上下文治理门槛。开发者尚未要求
开始该提案实现，相关 ADR/Contract 仍未接受；v1.08 开始时本版本以 `not_started` 冻结，Checkpoint 1
及以后保持未开始，Rust/TypeScript、数据库 Schema、共享 fixture、当前 Contract 入口与版本常量均未改变。

## Checkpoint 0：提案与二次确认

- [x] 建立唯一 current v1.07 proposal，并冻结 v1.06 complete 历史状态；
- [x] 起草 ADR-0216～0218 和五份下一版本 Contract，不切换当前 accepted 入口；
- [x] 提交完整 Session Charter、Dynamic Context、Principal projection、Manifest 与 Runtime transport 的
  before/after revision；
- [x] 开发者 `murray17` 于 `2026-08-18T15:29:27+08:00` 明确确认 revision 1，并记录
  `confirmed_revision/confirmed_by/confirmed_at`；
- [ ] 接受 ADR、提升 Contract 并更新 CURRENT/Contract/Architecture 路由。

## Checkpoint 1：Transport v15 与输入合同

- [ ] 先完整实现 v14 `LocalIpcEndpoint`、IPC v2、Unix Socket/Windows Named Pipe，再启用 v15 identity；
- [ ] Send closed input、durable command 和 digest 增加 `publicOnly`，Core seam 转换为
  `AgentAddressingMode`；
- [ ] CLI 增加 `--public-only` 与 canonical `--to-principal`，`--to-user` 只在参数归一化层隐藏兼容；
- [ ] catalog、help、error、projection identity、capability、health/diagnostics 与 compatibility digest 原子
  前进到 v15。

## Checkpoint 2：Public-only Core 硬门

- [ ] 在正文 parser 和 alias/member lookup 前处理 PublicOnly；
- [ ] `to/taskId` 冲突返回 closed `message.public_only_conflict / fix_input`；
- [ ] 以 literal Text + optional CurrentUserMention 持久化，证明零 MemberMention/Delivery/预算；
- [ ] 单独持久化 `agentAddressingMode`；clean-break event v2 删除旧误名 `publicOnly`，以 `recipientFree`
  表达派生结果；Gather variant 的 mode 为 not-applicable；
- [ ] canonical result 与 `camp-message-send-v2` Agent projection 返回 mode 与最终 recipient 结果；
- [ ] replay、idempotency conflict、commit/dispatch race 与 evidence 保持同一模式。

## Checkpoint 3：Agent/Human audience projection

- [ ] 建立封闭 Human/Agent segment renderer；Human cache/FTS/UI 保持 `@你`；
- [ ] Context Current Input、Shared Conversation 与 reference closure 全部使用 `@Principal`；
- [ ] Camp search/read/history body、snippet、offset、replay 和 Built-in output 使用 Agent renderer；
- [ ] 为 Agent 查询 `@Principal` 增加 structured mention candidate path，不改写 Human FTS；
- [ ] content digest 保持不变，Agent projected digest/offset 使用新的 audience space。

## Checkpoint 4：Formatter 19 与 Manifest 17

- [ ] 用固定 `[A2A_GUIDANCE]` JSON 文本实现 ordinary A2A forward/return 两个 variant；
- [ ] direct 与 `gather_completion` 不注入，eligible A2A 不因 payload budget 被省略；
- [ ] Manifest 保存 closed guidance evidence/digest 和 `messageProjectionAudience=agent_v1`；
- [ ] preflight、materialization、delivery retry 和 active recovery 交叉验证冻结 edge 与 exact bytes；
- [ ] Gather Barrier 使用 Agent renderer 冻结 Completion Input v3；request/captured body 增加 audience 与
  projected digest，fallback/lifecycle/limits/budget 不变；
- [ ] 更新 context v19 与 Gather v3 shared fixture，并保持 Bootstrap v3/Formatter 3/Profile v3 不变。

## Checkpoint 5：Charter、Teaching 与 Session clean break

- [ ] 使用已确认的完整 Charter 文本，只教 canonical `--public-only` / `--to-principal`；
- [ ] 所有 Runtime 继续使用既有 NativeAppend/FirstPayload wrapper，不增加 adapter-local A2A prompt；
- [ ] Formatter19/Manifest17 改变 binding compatibility digest，旧 Native Session 必须换绑；
- [ ] 执行已确认的开发期本地数据 reset；不实现 v1.06 业务历史 backfill/reader/双写，并在破坏性动作前
  提供明确用户提示与精确目标校验；
- [ ] 保持所有 Adapter `missing_send_recovery=if_no_accepted_send`，不实现 return suppression。

## Checkpoint 6：负向与治理验收

- [ ] public-only canonical ID、显示名、自指、ancestor、代码/URL/escaped lookalike 均为 literal Text；
- [ ] `publicOnly+to/taskId` 拒绝，`publicOnly+toPrincipal` 成功；Automatic-empty 与 PublicOnly audit 可区分；
- [ ] recovery candidate 的 canonical/display-name/首尾 mention 全部零 Delivery/reply/预算；
- [ ] forward/return/direct/gather completion exact guidance matrix 与 Manifest tamper/recovery tests 通过；
- [ ] Human/Agent 双投影、search candidate、snippet、Unicode offset、context digest 与 replay tests 通过；
- [ ] v13/v15 mismatch、IPC2 endpoint、安全 Named Pipe、macOS Unix 与逐平台 Runtime qualification 通过；
- [ ] 按 Rust 测试准入规则运行定向/全量测试、格式/Clippy、文档治理和真实 Runtime smoke；
- [ ] 复核仅在全部证据成立后把 implementation status 更新为 complete。

## References

- [v1.07 概览](README.md)
- [模型上下文变更 revision 1](model-context-change-a2a-public-only.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
- [本地 Runtime 工作流](../../development/local-workflow.md)

## 冻结后独立执行记录（2026-08-18）

本计划的 `not_started` 与未勾选 Checkpoint 保留 v1.08 切换时的冻结快照。后续独立交付已完成代码层的
Checkpoint 1～5 与关键负向/治理覆盖：PublicOnly parser 前硬门、Principal 双投影、A2A exact guidance
evidence、Gather v3、Transport v15/IPC2、Session Charter、Schema 48/Migration 93 及 clean-break quarantine
均已实现。最终打包、安装与完整验证结果由本次独立交付提交记录承载，不追溯改写本历史计划状态。
