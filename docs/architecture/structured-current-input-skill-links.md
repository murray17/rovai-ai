---
document_type: architecture
architecture: structured-current-input-skill-links
authority: structured-skill-selection-and-context-resolution-boundaries
status: historical
last_updated: 2026-09-18
---

# Structured Run Input Skill Links Architecture

> 本文件解释旧 Library、Exposure 与 SkillProjection 参与的输入。v1.70 新 Run 的来源身份和消息局部链接见 [Skills 来源、配置与模型投递](skills.md)及 [Skills Rebuild v1](../contracts/skills-rebuild-v1.md)。

本文件说明 Picker identity、claim-time 批次冻结、SkillProjection preflight、start-time resolution、Context
Formatter 和 Runtime Adapter 的 Module seam。字段级合同见
[Run Input Skill Links v2](../contracts/current-input-skill-links-v2.md)和
[ContextManifest Evidence v27](../contracts/context-manifest-evidence-v27.md)。Single Chat 继续使用 v1。

## Authority flow

```text
Composer Picker
  -> structured SkillMention in each CampMessage
  -> waiting Delivery (no execution config or Skill freeze)
  -> Scheduler claims an ordered message prefix
  -> one batch SkillSelectionSnapshot + frozen Runtime groups
  -> full current-root SkillProjection preflight
  -> RunSkillAvailabilityView + deterministic resolver
  -> relevant RUN_INPUT.messages[].skills + Manifest 27 evidence
  -> unchanged Runtime Adapter payload transport
```

| 层 | 拥有 | 不拥有 |
| --- | --- | --- |
| Structured Content | 每条消息的 `skillId/nameAtSend` 与稳定 `/nameAtSend` marker | Run path、Runtime group、eligibility |
| Delivery queue | 消息顺序和 claim 边界 | Skill eligibility、Runtime config、projection path |
| Skill Selection Snapshot | claim 时整批 first-occurrence 去重、当前资格与 digest | start-time filesystem health、模型读取证明 |
| SkillProjectionReconciler | 当前 root 投影写入、ownership/digest verification 与完整 Exposure | 用户选择、模型字段、Runtime load |
| Skill resolver | selection/availability/Exposure 的确定交集和稳定候选 | filesystem/Library mutation、Adapter transport |
| Context Formatter | 将已解析 link 只投影到实际选择它的 Run Input message | eligibility、path discovery、accepted ACK |
| Runtime Adapter | 完整 prepared payload transport | Skill 解析、Provider Skill item、权限授予 |

## Module seams

Structured Content Module 保持 closed `skill_mention` 协议。Picker 是唯一创建入口；手写或粘贴 Slash 文本只是
Text。CampMessage 保存身份和 body marker，不保存 execution root、投影路径或当时 Runtime 配置。

Scheduler claim 在同一事务确定有序 `input_message_ids`、当前 Agent execution config 和 Runtime groups，然后把
整批 structured content 交给 selection freezer。freezer 按消息顺序和 segment 顺序保留同 Skill ID 的第一次出现，
读取 claim 时的 Skill lifecycle/enablement/name/assignment，返回一个 Run-level snapshot 与 canonical digest。
等待阶段不创建 empty Run snapshot，也不因输入来源类型拆批。

SkillProjectionReconciler 仍是唯一可创建、修复、切换或删除 projection entry 的 Module。Resolver 只读取冻结
selection、当前 desired-state availability、verified Exposure 和冻结 group precedence；它不写 filesystem、扫描
Runtime-native inventory、猜 path 或回调 Reconciler。

Formatter 27 继承 Formatter 26 的 Skill 解析：接收已解析的 Run-level included entries 以及每条输入自己的 Skill names。它为每条消息独立生成可选
`skills[{name,path}]`；未选择或未解析成功时省略字段。同一 Skill 可出现在多条真正选择它的消息中，但解析/evidence
仍只做一份。Manifest 27 在同一 preparation critical section 冻结 selection、Exposure、resolution、消息映射和
exact rendered bytes。

## Claim、恢复与失败

```text
atomic Delivery claim
  -> freeze Run + ordered inputs + execution config + batch Skill selection
  -> reconcile and verify full current-root projection
  -> materialize Formatter 27 / Profile 8
  -> persist Manifest 27
  -> deliver exact payload
```

- claim-time missing/inactive/disabled/name/group mismatch：selection ineligible，正文保留，对应 link 省略；
- materialization-time desired-state mismatch 或无 compatible ready candidate：resolution omitted，Run 继续；
- full Exposure error/stale/digest/ownership failure：preflight fail closed，不交付部分 Context；
- selection/resolution/Exposure digest tamper：materialization/recovery fail closed；
- 已存在 Manifest 的同 Run 恢复：复用 frozen evidence 与 bytes，不读取后来变化的 Library/filesystem。

Skill link 只是 Agent 指令/上下文，不授予 Core operation、工具、文件系统或 Runtime 权限，也不证明模型读取。

## References

- [Skill Projection Reconciliation](skill-projection-reconciliation.md)
- [Built-in Tool Runtime](builtin-tool-runtime.md)
- [Camp Composer](camp-composer-draft.md)
- [ContextManifest and Run Facts invariants](foundational-invariants.md#context-manifest-run-facts)
