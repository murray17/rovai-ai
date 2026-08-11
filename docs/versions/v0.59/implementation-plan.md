---
document_type: implementation-plan
version: v0.59
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-12
---

# v0.59 实施与验收计划

> 完成门槛不是“代码看起来兼容”，而是九个 Runtime 分别通过真实执行。任一 Runtime 因登录、版本、
> 协议或环境原因未完成要求场景时，本版本继续保持 `in_progress`。

## Checkpoint 0：领域、ADR 与合同

- [x] 区分 Runtime Public Output Mode、Adapter Final Boundary、Camp Message Send 与
  Missing-Send Recovery Publication；
- [x] 确认任意 accepted send 全抑制，且不提供 final-answer completeness guarantee；
- [x] 确认 user-triggered 与 A2A target Run 使用相同规则；
- [x] 冻结四类 Adapter candidate provenance、32 KiB fail-closed 与 recipient-free shape；
- [x] v0.58 按真实 `in_progress` 状态冻结，建立 v0.59 唯一 current 入口。

## Checkpoint 1：Core 终态事务

- [x] Adapter catalog 增加独立 recovery policy，九个 Runtime 全部启用且 ordinary mode 仍为
  `explicit_send_only`；
- [x] `SucceedAgentRunCommand` 分离 required `finalOutput` 与 optional typed recovery candidate；
- [x] Core 校验 Adapter/provenance、非空与 UTF-8 byte 级 32 KiB 上限，不合格候选不影响 Run success；
- [x] 同一事务查询该 Run 的 accepted `camp.message.send`，eligible 时持久化一条无 recipients/Delivery
  的 CampMessage，并设置 `finalCampMessageId`；
- [x] 复用 recipient-free public message persistence，避免 ordinary final 与 recovery 各自维护 SQL；
- [x] event/result 只记录 decision metadata 和 digest，不复制正文。

## Checkpoint 2：四类 Adapter collector

- [x] Codex success final 可继续使用 completed item/streamed fallback，但 recovery candidate 只能来自
  authoritative `turn/completed.turn.items`；
- [x] Claude Code 从匹配 Session 的 success result 形成 `claude_success_result` candidate；
- [x] Antigravity 从成功、未截断、合法 UTF-8 的 print stdout 形成
  `antigravity_print_stdout` candidate；
- [x] ACP 保留聚合文本作为 Run success final，并独立维护 last-tool 后 assistant suffix collector；
- [x] ACP 覆盖同 messageId 续块、新 messageId 切换、匿名连续 suffix、tool reset、mixed identity
  fail-closed 与非 `end_turn` 不发布。

## Checkpoint 3：自动化事务与 collector

- [x] zero send + valid candidate 产生恰好一条 recovery message，且无 Delivery；
- [x] public-only send 与 addressed send 都抑制；rejected/fenced send 不抑制；tombstone 不恢复资格；
- [x] absent/blank/oversize/wrong provenance candidate 保持 Run success 且不发布；
- [x] terminal replay 恰好一次；send-before-succeed 抑制；succeed-before-late-send 只保留 recovery，
  late send 被 terminal fence 拒绝；
- [x] user-triggered 与 A2A target Run、多个独立静默 Run、字面量 mention Text shape 均有回归；
- [x] Codex、Claude、Antigravity 与 ACP collector fixtures 覆盖正负 boundary。

## Checkpoint 4：九 Runtime 真实验收

每个 Runtime 都在独立临时 `data-dir` 与临时 Git workspace 中至少执行：

1. `zero-send`：只返回唯一 marker，不调用 `rovai send`；断言一条 recovery CampMessage、无 Delivery；
2. `accepted-send-suppression`：调用一次 `rovai send` 发布 progress marker，再返回不同 final marker；
   断言只有显式消息，没有 recovery；
3. ACP Runtime 额外执行 `tool-then-final`：真实读取 fixture 文件后返回唯一 final marker，不 send；
   同时保存实际 `session/update` / prompt response shape，转换为独立协议 fixture 并跑 collector。

| Runtime | zero-send | suppression | tool→final | protocol fixture |
| --- | --- | --- | --- | --- |
| Codex CLI | [x] | [x] | 不适用 | [x] completed-turn fixture |
| Claude Code | [x] | [x] | 不适用 | [x] success-result fixture |
| Antigravity | [x] | [x] | 不适用 | [x] print-output fixture |
| OpenCode ACP | [x] | [x] | [x] | [x] |
| GitHub Copilot ACP | [x] | [x] | [x] | [x] |
| Kiro ACP | [x] | [x] | [x] | [x] |
| Qoder ACP | [x] | [x] | [x] | [x] |
| CodeBuddy ACP | [x] | [x] | [x] | [x] |
| Qwen Code ACP | [x] | [x] | [x] | [x] |

真实验收脚本必须逐 Runtime 可选、失败即非零退出，并检查数据库中的 source Run、author、structured
Text、`sourceOperationId = null`、recipient arrays、Delivery count 与 `finalCampMessageId`，不能只匹配
Renderer 文本或进程 stdout。

## Checkpoint 5：完整门禁与收口

- [x] Rust workspace tests、Clippy、fmt、Vitest/Node tests、typecheck、docs gates 与 diff check 通过；
- [x] 九 Runtime 全部真实场景通过，兼容性清单记录实际版本、日期与证据，不以官网文档代替；
- [x] 实施计划和版本概览只在全部门槛满足后改为 `complete`。
