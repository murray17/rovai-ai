---
document_type: model-context-change
version: v1.72
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: local_user
confirmed_at: 2026-10-09
confirmation_message_id: ed6a378b-d44d-4fc6-90ff-fdb3294ecacf
last_updated: 2026-10-09
---

# 消息 Mention 元数据统一 r1

User 提供完整字段方案（消息 a8c3d086-5dda-4bda-a49b-1bbe78c1bd0e），并在审阅三项补充后以
`ed6a378b-d44d-4fc6-90ff-fdb3294ecacf` 明确确认定稿和实施。本文记录两条消息合并后的已确认范围；
实现与验收状态单独追加，不把授权当作完成证据。

## 基线与范围

- Base：`c22816367aa124cc5783ca5a95d6ca046e2fc480`（origin/main）。
- Branch：`rovai/message-mentions`；worktree：仓库同级 `rovai-ai-message-mentions`。
- Governance：本次用户确认；无治理文档先合入 main 的要求。
- 纳入：公开 Thread 的 `RUN_INPUT.messages[]` 和 `thread.read` item/timeline/reply_chain 正常条目。
- 不纳入：非 batch CURRENT_INPUT、非 batch 历史、single_chat.history、搜索、send 参数/回执、UI、
  作者身份、渠道授权/寻址/出站、引用、附件、技能、时间及分页规则。

## 变更前

公开 batch 正常条目：

```ts
{
  messageId: string; sequence: number;
  senderType: string; senderId: string; body: string;
  anchorMessageId?: string;
  quotes?: MessageQuote[];
  attachments?: { name: string; mediaType: string; path: string }[];
  skills?: { name: string; path: string }[];
  mentionsCurrentUser?: true;
}
```

read 正常条目：

```ts
{
  messageId: string; sequence: number;
  authorType: string; authorId: string;
  anchorMessageId: string | null; createdAt: string; body: string;
  attachmentCount: number; quotes?: MessageQuote[];
  addressing: { effectiveAgentRecipients: string[]; mentionsCurrentUser: boolean };
  // 精确读取另有既有 attachments、attachmentsTruncated、attachmentOmittedCount。
}
```

## 变更后

以上两种正常条目只替换 Mention 字段，其余字段、条件省略及正文生成结果保持原状：

```ts
type MessageMention =
  | { id: AgentId; name: string }
  | { id: "user"; name?: never };

// RUN_INPUT.messages[]：移除 mentionsCurrentUser，必有 mentions。
// read 正常条目：移除 addressing，必有 mentions。
mentions: MessageMention[];
```

Agent ID 使用 Core 现有校验。Agent 条目来自消息已保存的完整有效目标，名称为该次投影的成员名，不加 @；
当前用户条目只由结构化 CurrentUserMention 产生，固定为 `{"id":"user"}`，无昵称、null 或空 name。
没有目标时为 []；按保存顺序按 ID 去重，user 最后追加一次。条目不表示已读、执行或完成。

正文示例：

```json
{"messageId":"msg_008","sequence":8,"senderType":"user","senderId":"local_user","body":"@爱丽丝 请检查实现。","mentions":[{"id":"agent_6","name":"爱丽丝"}]}
```

```json
{"messageId":"msg_008","sequence":8,"authorType":"user","authorId":"local_user","anchorMessageId":null,"createdAt":"2026-10-08T09:47:00Z","body":"请检查实现。","attachmentCount":0,"mentions":[{"id":"agent_6","name":"爱丽丝"}]}
```

正文没有字面 @ 的显式目标仍进入 mentions；@所有队员 使用保存的目标快照。引用、代码、普通文字
不产生目标。外部主体作者保持 external_principal 和既有 Core ID。撤回占位符仍严格只有
messageId、sequence、withdrawn:true、displayText:"Message withdrawn"。

## 明确不变

### 名称来源

复用正文已解析的名称并补查正文之外的目标；冻结默认接收者名称优先，不重新查询当前 Lead 或展开当前
成员，不用在队名单过滤历史目标。只在现有查询/投影代码中共享小函数，不新增服务、持久缓存或昵称历史。
自动 input 保留默认 Lead 前缀，read 不补前缀；非 batch 正文和 mentionsCurrentUser 保持原状。
公开条目保留完整目标，不按当前接收者裁剪。内部提及事实、Delivery、通知和权限保持。

## 版本、迁移与恢复

公开新 batch Formatter/Manifest 32 → 33；Profile 10、Run Facts 9、非 batch 28/7/6、
Bootstrap、Charter 与 Native Binding 兼容摘要保持。read 合同 11 → 12，工具输出合同同步。
采用现有数据库增量迁移扩展新 Run 版本闭合约束，不回写历史业务行、Manifest、payload 或成功工具回执；
不新增格式协商或迁移框架。

此后正常领取的新 Run 使用 33；既有 Session 中的新 Run 同样生效。已领取并冻结旧版本的 Run，
包含未物化输入的中间态，继续使用其冻结版本和原恢复准入。已有完整输入直接复用。
新 read 使用 mentions；旧成功回执验原摘要后按旧 shape 回放，不补查新名字，不改写历史结果。
不新增 Session 升级、重建、强制压缩或 Binding 轮换前置条件。

## 预算与证据

claim 估算与最终 RUN_INPUT 共用对应版本序列化，新增 mentions 计入实际 UTF-8 字节。
完整 RUN_INPUT 摘要与 exact rendered payload 摘要覆盖新增字段，沿用既有 evidence；
不新增第二套预算、摘要或证据系统。旧版本的摘要与 JSON 不重算。

## 验证与负向测试

优先扩展 camp_content、context、camp_history、team_tool_catalog、builtin_tool_cli_output、
delivery_queue 与既有 migration owner。新增独立测试仅用于此前无 owner 的 Mention 身份合同、
旧/新格式并存与迁移原子性；不复制完整运行夹具。

- 显式目标无正文 Mention、默认目标、@所有队员快照、多目标完整列表、重复与空数组；
- 结构化 user 与普通 @User、引用/代码的区别，用户条目禁止 name；
- 改名、冻结默认名、离队 profile、错误 ID/缺失名字，以及 body 前后逐字相等；
- read 三种模式、撤回占位符、旧回执原样、封闭 Schema 拒绝混合新旧字段；
- 旧 Run 已领取未物化、已生成重试、新 Run 版本、既有 Binding 兼容摘要不变；
- claim 实际大小和最终输入/摘要一致；非 batch 字段不变；保留本地/外部/Agent 作者。

确定性验证使用 Cargo owner 过滤、默认 workspace 回归、typecheck、pnpm test、
docs:test/docs:check/docs:check:ci。真实上下文 Gate 沿用 12 项通用集、相同标准和资源比较，
单 campaign 最多两次、预算 14400 秒；实际 Runtime/Judge 配置须有可用冻结证据，不编造配置或通过结果。
未执行或受阻的 Gate 单独报告，不以单元测试替代。

## 二次确认

User 在前后完整方案与三项评审补充之后，于 2026-10-09 的消息
ed6a378b-d44d-4fc6-90ff-fdb3294ecacf 明确“接受，按下面的边界定稿和实现”。
本文件 revision 1 记录该次完整边界；不再增加新的产品语义或另一次确认要求。

## 实施与验证记录

实现已完成并通过定向验证；交付到独立分支 `rovai/message-mentions`，不合并、不部署。新增公共 Mention 构造函数；旧/新 batch 由已冻结版本选择，
新 read 用封闭 Schema，旧成功回执在兼容边界验原摘要后原样通过。Migration 187/schema 137 仅扩展原有约束。
Agent Output v9/v10 golden 差异逐操作核对：仅 thread.read metadata 改变，其他字段及全部其他操作完全相同。
已核对 Native Binding 兼容摘要及非 batch Formatter 未改变；两种正文 renderer 仍分别拥有其入口。

截至本轮确定性验证：

| 检查 | 结果 |
| --- | --- |
| `cargo check --workspace --all-targets`、`cargo fmt --all -- --check` | 通过 |
| `pnpm typecheck`、`pnpm test` | 通过；版本指纹断言与实际 schema 137、Formatter/Manifest 33 同步 |
| `pnpm docs:test`、`pnpm docs:check`、带上述 Base SHA 的 `pnpm docs:check:ci` | 通过 |
| `RUST_TEST_THREADS=2 pnpm test:rust:pr` | 最终完整 workspace：459 通过、1 项原有 ignore；未跳过任何默认用例 |
| `cargo test --workspace --bins` | 29 通过 |
| `cargo test -p rovai-core --features slow-tests --lib context::slow_tests::` | 44 通过、1 个旧夹具遗漏有效目标；补齐夹具保存事实后该用例定向通过，45 项均有通过记录 |
| 相同 feature 的 `camp_history::slow_tests::`、`delivery_queue::tests::` | 7、24 项全部通过；完整目标顺序/去重、user、作者、三种读取、撤回、大小计算均覆盖 |
| `db::message_mentions::`、`db::tests::current_schema_contains_required_contract_objects` | 迁移回滚/证据保留及新触发器准入通过 |
| `db::tests::v163_requeues_unfrozen_public_work_and_retires_the_legacy_run_placeholder`、`db::tests::v9` | 补齐恢复到当前版本的迁移链及版本范围断言后，1、8 项定向通过 |
| `context::slow_tests::run_input_is_complete_even_when_it_exceeds_the_history_body_limit` | 实际新 JSON、完整输入摘要、最终 payload 摘要一致 |

默认 workspace 回归曾分别在 Antigravity interruption 与 detached child reap 的进程时序用例失败；
两个失败均已独立重跑通过；待其他重型测试结束后，最后一次完整默认 workspace 运行通过。
保留前两次失败记录，不把原始失败运行改记为通过。
扩展回归原始运行结果：972 passed / 6 failed / 6 ignored；其中四项本次版本/夹具断言已修复并定向通过，
剩余两项为下述基线同样可复现的问题。
扩展发现的 `authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data`
与 `claude::tests::public_text_streams_and_success_fallback_create_narration_without_thinking` 已在未改动
Base checkout 各自定向复现相同错误（authority_contract_changed / thinking block assertion）。不在本次局部改动中修复。
旧触发器名称、v95/v98 当前版本范围断言及 v163 重新领取前的升级链已同步并定向通过；
没有停用测试或增加 checker 例外。

真实模型 Gate：**not_run**。本次没有冻结新旧产品执行计划；发现的既有 Judge 配置使用
`catalog_bound_alias`，不具备固定模型快照的完整 Gate 证据。不借用旧 campaign 结果，不声称真实模型回归通过。

合流说明（2026-10-09，PR #662）：以上 187/schema 137 是本方案主干交付时的编号。
Preview 分支已使用同一收据号保存 Mission 描述，合流现通过 189/schema 139 保留或补齐 v33；
已有 v33 来源不重建格式表、旧 187 收据不改写。具体来源与验证 owner 见
[当前版本的数据合流说明](README.md#主干与-preview-数据合流2026-10-08)。本说明不改变模型投影方案或确认范围。
