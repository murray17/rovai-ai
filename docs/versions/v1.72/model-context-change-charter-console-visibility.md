---
document_type: model-context-change
version: v1.72
change_id: charter-console-visibility
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User
confirmed_at: 2026-11-23
authority: confirmed-model-input-change-statement
implementation_status: implemented
last_updated: 2026-11-23
---

# 公开 Thread 的执行台可见性

## 二次确认

用户给出下方英文原句。Claude Code 与 Codex CLI 的三组对照完成后，用户明确选择 C 版实施，并确认已有 Bootstrap 会话按现状处理，新会话传新文案。

## 变更前

```text
- `rovai send` publishes one public Thread message. When your responsibility has a Thread-visible answer, result, status or summary, send it successfully before ending; Runtime output is not a Thread message.
```

## 变更后

```text
- `rovai send` publishes one public Thread message. When your responsibility has a Thread-visible answer, result or summary, send it successfully before ending; Runtime output is not a Thread message, but the User sees it live in the execution console.
```

## 明确不变

替换范围为公开 Thread 的 `SESSION_CHARTER` 中这一行。Single Chat 使用自己的 Charter。公开发送、队员派活、用户提醒与最终结果补发沿用现有语义，发送次数由任务决定。

## 版本与投递

Session Charter revision 从 26 升至 27。Bootstrap v6 / Formatter 6、Binding compatibility 16、Dynamic Context 的选择与预算、Manifest 和接收证据沿用现行合同。新会话通过已有的 Bootstrap 装配路径取得新句。已有会话继续使用正常的恢复路径，已冻结的输入按原字节恢复，无需迁移或主动重发。

## 验证

以下四项 Rust 测试均通过。它们覆盖公开发送说明的精确正文、各 Runtime 和渠道变体、新绑定会话首包、Single Chat 正文摘要和 Charter 版本轴。

```sh
cargo test --locked -p rovai-core --lib --features slow-tests -- \
  session_charter_publishes_one_cli_only_builtin_contract \
  newly_bound_session_bootstraps_on_its_current_generation \
  single_chat_contract_bytes_and_dynamic_section_order_are_exact \
  binding_contract_rotates_existing_sessions_for_new_charter
```

实施前的对照使用两个任务，每种 Runtime、任务和文案各跑五轮。三个版本均为 20/20 轮只公开最终结果，这组样本无法量化进度播报的降幅。
