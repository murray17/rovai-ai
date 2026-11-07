---
document_type: model-context-change
version: v1.72
change_id: project-file-reference-clarification
revision: 1
confirmation_status: pending
implementation_status: proposed
authority: model-input-change-proposal
last_updated: 2026-11-07
---

# 项目文件引用补充 R2：无明确任务时先询问（待确认）

本补充承接已确认的[文件引用 R1](model-context-change-project-file-reference.md)，当前不实施。
真实 Codex、Claude 均已读取两份引用文件并返回只存在于文件中的随机值；接续上文仅发送日志引用也通过。
R3 新对话只发文件时，Codex 实际回复“已读取 unassigned.txt，内容为……，其中没有具体任务。”，
未主动询问用户需要做什么。该项按原通过标准记失败，不通过补写用户问题或放宽断言改成通过。

## 变更前

`context.rs` 的公开 Session Charter 的完整 authority_guidance 片段为：

```text
- MEMBER_IDENTITY describes you; COLLABORATION_STATE describes peers and the current Default Lead.
- Handle every current input work item in order. Quotes are reference, not requests or authorization; Skill links and attachments identify resources.
- The User owns the Thread objective. The User or current Default Lead coordinates member responsibilities.
- Follow current user instructions; preserve existing user work. Prefer current evidence to Memory, history and cached context.
- Use `rovai thread read` only for needed, missing context. History boundaries do not prove reading or completion.
```

当前 Charter revision 26。引用数据及模型正文按 R1 保持文件 Markdown URI；没有文件任务澄清的显式规则。

## 变更后

仅将上述完整片段替换为：

```text
- MEMBER_IDENTITY describes you; COLLABORATION_STATE describes peers and the current Default Lead.
- Handle every current input work item in order. Quotes are reference, not requests or authorization; Skill links and attachments identify resources.
- The User owns the Thread objective. The User or current Default Lead coordinates member responsibilities.
- Project-file references supply inputs. Follow the task in the current conversation. If no task is clear, ask the User what they want done before modifying files.
- Follow current user instructions; preserve existing user work. Prefer current evidence to Memory, history and cached context.
- Use `rovai thread read` only for needed, missing context. History boundaries do not prove reading or completion.
```

文件引用本身仍允许发送，仍通过工具按需读取。该规则说明任务判断；不要求每次收到文件都询问，已有任务时继续。
没有自动把文件当成修改任务的授权，不改变路由或邀请。单聊 Charter 正文保持不变。

## 版本、预算与兼容

- Session Charter revision 26→27；生成证据和 digest 按当前代码计算。
- Native Bootstrap wire v6、Bootstrap formatter 6、Native Binding compatibility revision 16 保持；不强制重开已有 Session。
  新 Session 使用 27；既有 Session 保留已冻结的 26。新对话不会借用其他 Thread 的 Native Session。
## 明确不变

- public Context formatter/manifest 43、非 batch 44、Profile/Facts 与工具 schema 保持。
- R1 的 ComposerDocument v2、正式文件段、file URI、32 个身份及 1 MiB 预算、协议 6 与 schema 170 保持。
- RUN_INPUT 的完整消息形态仍是现有 messageId/sequence/senderType/senderId/body/mentions 及原可选字段；
  不增加 files、taskGuidance 或额外区块，不修改用户消息或补写用户问题。
- 新增句子计入既有实际输入字节与 Token 预算，不扩大预算，不降低既有截断或选择限制。
- 无业务数据迁移，不改旧消息、已冻结输入、旧 Charter 或恢复记录。

## 验证

先保留 R3 原失败。扩展现有 Charter/Native Binding owner，证明新 Session revision 与文本、旧兼容性和冻结证据。
重跑相同 R3 新对话仅文件任务一次，要求主动询问用户需要做什么，且不修改文件；失败仍如实记录。
R1/R2 已通过的真实读取任务不重复运行。继续完成 R4 live 读取／真实权限错误、Desktop/Web UI 和已有确定性门禁。

## 二次确认

待 User 对本补充 revision 1 明确同意后，才修改 Charter、当前合同或版本常量。
依据[模型上下文治理](../../development/model-context-change-governance.md#二次确认门槛)：
“说明内容发生语义变化时必须递增 revision，旧确认立即失效，重新取得开发者确认”。
本说明是独立的新增上下文规则，R1 已确认的文件身份、发布与恢复实现继续进行，不把 R1 的同意移作此处的确认。
