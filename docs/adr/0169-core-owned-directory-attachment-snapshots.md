---
document_type: adr
id: ADR-0169
title: "Core-Owned Directory Attachment Snapshots"
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes: []
superseded_by: null
---

# ADR-0169: Core-Owned Directory Attachment Snapshots

## Context

Camp 附件原先只接受普通文件。用户从 Finder 交付一组有层级的资料时，只能逐文件选择，
而 Renderer 自行展开目录又会把路径遍历、安全检查、冻结时点和 Draft 原子性分散到不可信的
UI 边界。目录也不能继续引用原位置，否则发送后的内容会随用户后续编辑改变，并暴露本机目录结构。

本决定局部替代 ADR-0080 中“目录失败关闭”的条款，并扩展 ADR-0081 的单一稳定附件路径；
两者关于 Core-owned Draft、发送原子性、公共附件授权和冻结发现边界的其余决定继续有效。

## Decision

1. Camp Attachment 是 `file | directory` 的封闭联合。一个被拖入的目录是一个有层级的
   Prepared Attachment，计为一个顶层附件；不得在 Renderer 中展开成多个附件。
2. Core 是目录分类、遍历、限制、复制、摘要和只读化的唯一权威。目录快照包含用户明确拖入
   根目录下的全部普通文件、普通目录、隐藏项和空目录；任意 symlink 或其他特殊节点使整个项目
   失败，不允许静默跳过或部分成功。
3. Core 使用不跟随 symlink 的目录句柄遍历并检测复制期间的结构或内容变化。快照使用确定性
   路径顺序和文件内容摘要形成单一 SHA-256 树摘要；原始绝对路径既不持久化，也不进入
   Renderer、Camp Message 或 Runtime Context。
4. 目录快照沿用 ADR-0081 的稳定位置：
   `<userData>/camp-attachments/<camp-id>/<attachment-id>/<safe-name>`。对于目录，
   `<safe-name>` 是只读快照根；Runtime 只能从冻结消息上下文获得该根路径，并可枚举根内层级，
   不能因此枚举 Camp Attachment 根或未来消息附件。
5. 文件与目录共享同一 Draft revision、十个顶层附件和 64 MiB Draft 总量边界。目录内每个普通
   文件继续受 25 MiB 限制，并额外受有界文件数、节点数和深度限制。任一准备项失败时消息不可
   部分发送。
6. Prepared/Message Attachment 读侧显式投影 `kind`、`fileCount` 与聚合 `byteSize`；目录不能只靠
   文件名或 MIME 猜测。ContextManifest 的 Attachment Ref 仍只冻结 ID、稳定路径和内容摘要，
   不创建第二套目录投递协议。

## Consequences

- 用户可把完整资料树作为一个消息附件交付，原目录后续变化不会影响已准备或已发送内容。
- Core 必须承担有界但可能明显长于单文件的 I/O；Renderer 需要显示 preparing/error 并在完成前
  阻止发送。
- Runtime 得到的是应用受管目录根而非归档文件，可直接使用原生文件工具读取层级；这也要求快照
  内目录结构和空目录保持稳定。
- 持久附件目录需要一个 Core-private 元数据记录来恢复类型、文件数、总量和摘要；删除 Draft 或
  Camp 时必须递归解锁并清理整个受管树。

## Rejected Alternatives

- Renderer 递归读取并逐文件上传：会把安全与冻结权威移出 Core，并丢失“一个目录”的用户意图。
- 自动打包 ZIP：Runtime 必须先解包，空目录与文件工具路径语义改变，也增加新的归档攻击面。
- 保留原始目录路径：内容不再冻结，并泄漏本机结构和生命周期。
- 跳过 symlink、隐藏文件或超限节点后继续：用户无法知道实际交付了哪一部分，摘要和消息边界不可信。
- 把目录复制进 Project/Worktree：污染用户仓库，并把公共附件生命周期错误绑定到工作区。

## References

- [v0.65 当前版本](../versions/v0.65/README.md)
- [ADR-0080: Durable Camp Composer Draft](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md)
- [ADR-0081: Camp-Public Attachment Paths](0081-camp-public-attachment-paths-and-frozen-discovery.md)
- [Camp Attachment v1](../contracts/camp-attachment-v1.md)
- [Camp 会话区拖放 UI](../ui/conversation-drop-zone.md)
