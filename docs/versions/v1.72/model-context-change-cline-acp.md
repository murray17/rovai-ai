---
document_type: model-context-change
version: v1.72
change_id: cline-official-acp
revision: 1
confirmation_status: confirmed
confirmed_by: User (Thread message eeac1efb-50bd-4361-853f-dc77d0341d32)
confirmed_revision: 1
confirmed_at: 2026-10-08
authority: model-input-change-statement
implementation_status: implemented
last_updated: 2026-10-08
---

# Cline 官方 ACP：保留 System Rule，退役 Hub

## 变更前

Hub 通过成员 Host 私有原生文件 Rule 交付 B，user 交付现有 formatter 的 P；cold 在客户端搬运完整原生历史。
历史 ACP 的逐 Session Plugin 与实际 3.0.3 原生入口不兼容，不能直接沿用其验收结论。

## 变更后

User 95 明确确认切回官方 ACP。B 是 Binding 冻结的 Bootstrap，P 是现有 Dynamic Context。
仍采用原生文件 Rule：成员 Host 私有 rules 快照中仅一份 `rovai-managed-bootstrap.md`，包含冻结 B 与现有注释边界。
同 Host 内容不可变；不同 B 不能覆盖已存在 Rule。不同成员拥有独立 Host，不使用进程全局可变 active Bootstrap。
`bind_bootstrap` 保留 Session ID/摘要绑定用于审计，user 只发送 P。可用的原生 Plugin 仅观察数值，不再承担身份交付。

恢复改为共享 ACP session/load（声明能力时可用 session/resume）；Rovai 不搬运原生历史数组。
load 重放只用于恢复，不构成本轮新输出、工具、审批、Diff 或 Usage。原生恢复失败不得冒充同 Session 连续。
旧 Hub Binding 下一次新输入按共享不兼容机制重建，generation 推进；公开历史保持，隐含原生上下文不迁移。

## 明确不变

B/P 正文、顺序、动态 formatter、权限、发送归属、MCP/Skills 隔离和未知输入不重发不变。
不恢复 first_payload，不注入 compaction、不写自有摘要，不以普通模型总结作为压缩；ACP 的已知缺口保持。
不增加版本或认证字段门槛、共享账号状态机。缺失观察保持未知，不能伪造模型或 Usage 事实。

## 二次确认

User 的 Thread 95（`eeac1efb-50bd-4361-853f-dc77d0341d32`）已明确授权唯一 ACP、原生 System Rule 和旧 Binding 替换。
本文记录该确认，无需就同一切换重复请求。当前合同为
[Runtime Launch v54](../../contracts/runtime-launch-and-verification-v54.md#cline-official-acp)。

## 验证

Rust Host 配置 owner 验证不可变 Rule、不同 Host 隔离、原生源不变及单一 MCP 投影；共享 ACP owner 验证 load 重放隔离。
本机账号 first/warm 身份 marker 与早期记忆通过；cold 返回 Method not found，实际换代，不能记成 exact cold 通过。
精确原生 System 出现次数缺少本机观察证据，不沿用旧 Plugin 证据。详细结果见
[ACP 退役验收](../../research/cline-runtime/acp-retirement-2026-10-08.md)。
[旧 Hub 输入记录](model-context-change-cline-native-hub.md)保留为退役历史。
