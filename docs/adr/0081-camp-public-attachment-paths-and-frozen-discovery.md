---
document_type: adr
id: ADR-0081
title: "Camp-Public Attachment Paths and Frozen Discovery"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.25
supersedes: []
superseded_by: null
---

# ADR-0081: Camp-Public Attachment Paths and Frozen Discovery

## Context

旧附件设计把受管 Blob 再复制为每个 Run 的只读投影。用户确认公共会话附件应对
Camp 当前成员统一可用：Runtime 只需要收到路径并用自身文件工具读取，不应为每个
Run 生成副本。同时，AgentRun 仍必须遵守消息冻结边界，不能通过列目录发现未来消息
附件。

## Decision

1. `Message Attachment` 是 Camp 公共资源。发送后，所有当前有资格参与该 Camp 的
   成员都拥有相同的资源可见性；消息的显式寻址不缩小附件授权范围。
2. 每个附件只有一个应用受管的稳定权威路径：
   `<userData>/camp-attachments/<camp-id>/<attachment-id>/<safe-name>`。该路径不在
   Project、Workspace 或 Worktree 中，也不是原始用户路径。
3. Prepared Attachment 从复制完成起就在该最终路径；发送事务只把所有权从私有
   Draft 转移给 Message Attachment，不创建 Run 副本或投影。
4. Camp 目录使用不可枚举权限，附件 ID 使用不可预测身份。Runtime 获得 Camp
   Attachment 访问根，但具体路径只通过冻结上下文公开。
5. AgentRun 发现边界与公共消息冻结边界一致：
   - Current Input 包含触发消息的稳定附件路径；
   - Shared Conversation 包含冻结边界内公共消息的附件路径；
   - `context.get_message*` 只能在该 Run 的冻结消息边界内返回路径；
   - 运行期间新增的消息附件不会进入已物化的 ContextManifest。
6. ContextManifest v5 保存 `attachmentRefs` 与摘要；引用由 Attachment ID、稳定
   path 和内容摘要组成。删除 Run 不删除附件，删除 Camp 才删除整个 Camp Attachment
   Directory。
7. Renderer 永不展示绝对路径。图片预览只允许通过 Electron Main 授权读取
   PNG/JPEG/WebP/GIF；SVG、HTML、脚本、可执行文件和未知类型只显示通用文件卡。
8. 预览采用有界、异步、非阻塞读取；预览失败或超时不影响消息发送和 Runtime 读取。

本 ADR 局部替代 ADR-0013 中“消息附件内容必须以 Managed Blob 为权威”的条款，以及
ADR-0067 中 Run Attachment Projection 的条款；两份 ADR 的其余约束保持有效。

## Consequences

- 一个公共附件只存一份，路径在消息生命周期内稳定。
- Agent 使用原生文件工具读取路径，不需要 Rovai 专用附件读取工具。
- 稳定路径不是实时订阅；路径发现仍由 ContextManifest 和检索边界控制。
- Camp 目录权限、不可预测 ID 和 Core 边界校验共同承担“已知路径可读、未知路径不可
  枚举”的安全约束。
- Renderer 预览与 Agent 文件访问分离，预览失败不会降低附件的公共资源语义。

## Rejected Alternatives

- 每 Run 复制或 hard-link 投影：重复状态、额外清理与恢复复杂度没有授权收益。
- 把附件复制进 Project/Worktree：污染用户仓库，并把资源生命周期错误绑定到 Git。
- 把原始本机路径发给 Agent：泄漏用户目录结构且无法保证重启后的稳定性。
- 仅向被寻址 Agent 暴露附件：与公共会话资源语义冲突。
- 让 Runtime 枚举整个 Camp 目录：会绕过冻结消息边界发现未来附件。
- 在 Renderer 中直接加载 `file://`：违反 Electron 隔离边界并受浏览器策略限制。

## References

- [ADR-0013: Evidence & Read Side](0013-evidence-read-side.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [v0.25 Attachment Composer](../versions/v0.25/README.md)
