---
document_type: protocol-contract
contract: context-manifest-evidence-v31
authority: public-multi-input-agent-run-context-evidence
status: accepted
version: 31
last_updated: 2026-09-25
---

# ContextManifest Evidence v31

新公开 Camp batch Run 使用 Formatter／Manifest **31**、[Profile 10](context-delivery-profile-v10.md)、[Run Facts 8](run-facts-v8.md)；新非 batch 仍为 Formatter／Manifest 27、Profile 7、Run Facts 5。新 Binding 的 Bootstrap v5／Formatter 5、普通 Camp Charter revision 16；Native Binding 的兼容摘要投影 v4／Formatter 4／Charter 16／非 batch 26，使已有 Session 在下一次正常执行时切换到新 Charter。旧 Binding 的冻结 Bootstrap 与系统提示词不回写。此前 [v1.70 revision 5](../versions/v1.70/model-context-change-history-hint-additional.md) 的 historyHint 文案变更采用新建 Charter 14、兼容摘要 Charter 13；本次按已确认的 [Charter 精简稿](../versions/v1.70/model-context-change-charter-simplification.md) 压缩公开 Camp 正文，等待队友规则仅留在正文末尾，并轮换兼容摘要。此静态 Charter revision 不改变本合同的动态 payload／Manifest shape。Skills section 与 Selection／Resolution 形状沿用 [Skills Rebuild v1](skills-rebuild-v1.md)。

公开 batch 动态 section 的顺序为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[RUN_INPUT]
```

`ROVAI_ADDITIONAL_SKILLS` 必有，即使为空集合；`RUN_INPUT.messages` 是完整有序的领取集合，每消息的 `quotes`、`attachments` 与可选 `skills[{name,path}]` 按原规则冻结。不自动生成公屏历史、摘要或遗漏 locator；公开历史专属 refs/evidence 为 `[]`，遗漏计数及 sequence bounds 为 `null`。`RUN_FACTS` 的顶层 shape 不变：`attachmentOutputRoot`、`historyHint` 必有，其他字段按既有条件省略。新的 `historyHint` 仅能从 [Run Facts v8](run-facts-v8.md) 的四句完整文本中按 claim 冻结的 `P` 与额外可见消息布尔值选择，不向模型输出额外字段、列表或第二份边界。

Manifest 冻结 Profile 10 JSON/digest、完整 input refs/digest、前次 accepted 公屏边界及本轮 claim 公屏尾、Run Facts 原始 JSON/digest、Skill Selection／Resolution v2、动态 Skills 完整 section 文本/digest 与未索引原因、Bootstrap／Collaboration／Workspace、附件和 exact rendered payload bytes/digest。两个新的 `agent_run` 列只记录该 Run 的 `P` 和布尔值，不回填旧 Run；同 Run 恢复直接复用已冻结 Manifest／payload，不随新消息、撤回或 accepted 水位重新计算。完整 hint 计入 Profile 10 的现有容量与 payload 字节门禁，`RUN_INPUT` 不截断；容量临界估算低估是未扩修的已知限制。

Migration 174 从已验证的主线 Skills `v1.69`／schema 123 前进至 `v1.70`／schema 124，只新增 claim 冻结列和新公开 31／10／8 的 Manifest／Input 约束与写入守卫，保留历史数据、Bootstrap、Skills 证据和附件授权。旧 [v30](context-manifest-evidence-v30.md) 是**主线** 30／Profile 10／Facts 7，旧 [v29](context-manifest-evidence-v29.md) 是 29／Profile 9／Facts 7；两者及旧非 batch 26／Profile 6／Facts 5 只按精确冻结输入／完整证据有界恢复，原 payload 和原 Bootstrap 字节不改。旧公开 28 及更早不派发。旧 30 若仅有冻结 Input、尚未物化 Manifest，缺少完整动态 Skills section 的冻结证据，本次拒绝物化；不能从当前状态生成原版或以新 31／Facts 8 代替。新公开输入只写 31，新非 batch 输入仍写 27。早期分支也曾以 migration 173／同标记建立另一种 30／Profile 9／Facts 8，它不是合格升级来源，必须保全并拒绝自动升级。合同 accepted 不表示本次实施或验收已经完成。
