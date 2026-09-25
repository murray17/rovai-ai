---
document_type: protocol-contract
contract: context-manifest-evidence-v30
authority: public-multi-input-agent-run-context-evidence
status: accepted
version: 30
last_updated: 2026-09-24
---

# ContextManifest Evidence v30

新公开 Camp Run 使用 Formatter/Manifest 30、[Profile 10](context-delivery-profile-v10.md)、Run Facts 7 与 Session Charter revision 13。新非 batch Camp/A2A/Single Chat 使用 Formatter/Manifest 27、Profile 7、Run Facts 5。Bootstrap v5/Formatter 5 为新 Binding 插入独立平台技能 section；旧 Binding 保留冻结 v4 Bootstrap。完整文本、Selection/Resolution 形状见 [Skills Rebuild v1](skills-rebuild-v1.md)。

新公开批次顺序固定为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[RUN_INPUT]
```

非 batch 在可选 `SHARED_CONVERSATION` 后继续输出 `RUN_FACTS`、可选 `WORKSPACE`、必有 `ROVAI_ADDITIONAL_SKILLS`、可选 Guidance，最后 `CURRENT_INPUT`。公开批次不自动输出公屏历史；`RUN_FACTS.historyHint` 必有，`RUN_INPUT.messages` 保留完整 FIFO 工作项，`quotes`、`attachments`、可选 `skills[{name,path}]` 与既有字段省略规则不变。Skill 不改变路由、权限或接受水位。

Manifest 冻结 Profile JSON/digest、完整消息选择、执行前公屏边界、Run Facts 原始 JSON/digest、Selection/Resolution v2、每消息链接、Skill 索引完整 section 文本/digest、未索引原因、Bootstrap/Collaboration/Workspace、附件以及最终 rendered payload bytes/digest。与 [v29](context-manifest-evidence-v29.md) 相同，公开历史专属 refs/evidence 为 `[]`，遗漏计数与 sequence bounds 为 `null`。Runtime Input Delivery Evidence 独立记录实际接受；同 Run 重试与恢复复用 Manifest，不重算索引或历史提示。

Schema 123 从 v1.68/schema 122 原位迁移并保留旧字节。旧公开 v29/Profile 9/Run Facts 7、非 batch v26/Profile 6/Run Facts 5 仅在精确版本组合和完整历史证据下可继续派发或物化；旧格式缺少新增 section 合法，恢复不得补写。公开 v28 及更早保持退役。新创建的 Run 输入只写 v30/v27；老的 v29 `agent_run_input` 和 v26 冻结 Delivery 可受限物化旧 Manifest。Bootstrap compaction redelivery 复用其 Binding 的原始 v4 或 v5 完整字节，不另发一次任务。
