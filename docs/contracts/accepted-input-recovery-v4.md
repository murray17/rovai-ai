---
document_type: protocol-contract
contract: accepted-input-recovery-v4
authority: accepted-runtime-input-dispatch-and-late-observation
status: accepted
version: 4
source_version: v1.37
last_updated: 2026-09-01
---

# Accepted Input Recovery v4

继承 [v3](accepted-input-recovery-v3.md) 的正常重启分类、人工 unknown 收敛、冻结模型字节与禁止 accepted 重发。
仅取消采用 [Cancellation Settlement v1](cancellation-settlement-v1.md)，不把普通 recovery waiting 当作取消。

## 最小发送边界

`runtime_input_delivery` 仅增加 nullable `dispatch_started_at TEXT`，不新增状态、attempt 表或通用发送协议。
发送前必须提交条件更新：delivery 属于 exact Run/epoch、status prepared、时间为空；Run active 且未取消，
所属 Turn active 且未取消、未耗尽预算。只有更新一行才可以调用实际 send/prompt/append；更新为零禁止发送。

prepared + timestamp NULL 可证明本次未发送，取消关闭为 not_accepted；timestamp 非空则保留 delivery_unknown。
accepted/unknown 不降级。只有明确 not_accepted 才可重新 prepare，并清空 timestamp，重新取得发送准入。

## 迟到观察

迟到 accepted/unknown 只补充 Input 的客观证据；不得重开 Run/Turn、变更终态、解除清理隔离或重发输入。
只有 Run/epoch、active Turn 和 Conversation 的 exact Native Binding/generation 仍有效，accepted 才能推进
公共水位、Charter/collaboration digest 或 Bootstrap redelivery acknowledgement。新 Binding 不接受旧 Run 的水位。

取消分类不新增模型可见字段。Formatter、Manifest、Charter 和 input digest 的字节规则保持各自当前合同。
