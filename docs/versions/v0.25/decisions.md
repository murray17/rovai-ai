---
document_type: version-decisions
version: v0.25
lifecycle: historical
last_updated: 2026-08-18
---

# v0.25 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0080](#adr-0080) | Durable Camp Composer Draft and Atomic Attachment Consumption | `accepted` |
| [ADR-0081](#adr-0081) | Camp-Public Attachment Paths and Frozen Discovery | `accepted` |

<!-- legacy-adr:begin id=ADR-0080 source-file-sha256=dcb348177818f5232d4bc8b3f8e55bdf1df7d6558adaf9460d138449616d00eb -->
<a id="adr-0080"></a>

## ADR-0080: Durable Camp Composer Draft and Atomic Attachment Consumption

迁移时原路径：`docs/adr/0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0080
title: "Durable Camp Composer Draft and Atomic Attachment Consumption"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.25
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0080 -->
<a id="adr-0080-context"></a>
### Context

Camp Composer 原先只有 Renderer 内存中的正文。导航、重启或发送失败会丢失输入，
而附件准备又包含文件复制、摘要计算和安全检查，不能放进消息提交的短事务。附件也
不能脱离正文成为一种隐式消息，否则会破坏现有的公共消息语义、寻址和执行目的。

<a id="adr-0080-decision"></a>
### Decision

1. 每个 Camp 至多有一个 Core 持久化的 `Camp Composer Draft`，保存完整正文和有序
   `Prepared Attachment` 集合。它是用户私有编辑状态，不是 Camp 消息、Agent
   上下文、事件或审计事实。
2. Draft 在 Camp 导航和应用重启后恢复；每次正文或附件变化刷新七天闲置过期时间。
   启动清理只删除已过期 Draft 及其尚未发送的附件文件。
3. 文件准备发生在消息事务之前。Core 复制普通文件、计算 SHA-256、限制数量和大小，
   并写入最终权威位置。目录、symlink 和其他非普通文件失败关闭。
4. 一条消息最多十个附件；单文件最多 25 MiB；Draft 附件总量最多 64 MiB。
5. 用户消息正文去除首尾空白后必须非空。纯附件消息不允许，也不生成占位正文。
6. 发送请求携带 Draft 中按顺序排列的全部 Prepared Attachment ID。Core 必须验证
   请求集合与当前 Draft 完全一致；不支持部分发送。
7. 消息提交事务原子创建 `CampMessage` 和 `Message Attachment`，同时消费 Draft。
   文件不在该事务中复制或重算。提交成功后正文与附件一起清空；提交失败时 Draft
   原样保留。
8. 运行中的 Camp 仍允许编辑正文和准备附件；现有执行准入继续阻止新消息提交。

<a id="adr-0080-consequences"></a>
### Consequences

- 用户可以在导航、重启和发送失败后继续编辑同一条消息。
- 消息事务保持短小，不承担大文件 I/O。
- Prepared Attachment 在发送前不是公共事实，Agent 无法从 Draft 读取它。
- Draft 过期会永久删除尚未发送的附件；UI 必须显示这是临时编辑状态。
- 发送成功后的重复命令通过命令幂等记录重放，不要求已被消费的 Draft 仍存在。

<a id="adr-0080-rejected-alternatives"></a>
### Rejected Alternatives

- 只在 Renderer 保存 Draft：无法跨重启恢复，也不能成为附件所有权真源。
- 在发送事务中读取、复制和扫描文件：大文件 I/O 会延长 SQLite 写锁。
- 允许纯附件消息：会产生没有明确用户意图的公共消息和执行目的。
- 自动生成“请查看附件”等正文：这会伪造用户表达。
- 成功发送部分附件、保留失败项：消息边界将不再与用户确认的 Draft 一致。

<a id="adr-0080-references"></a>
### References

- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0076: Message-First AgentRun Dispatch Boundary](../v0.24/decisions.md#adr-0076)
- [v0.25 Attachment Composer](README.md)
<!-- legacy-adr-body:end id=ADR-0080 -->
<!-- legacy-adr:end id=ADR-0080 -->

<!-- legacy-adr:begin id=ADR-0081 source-file-sha256=6e456a30add0659544a602ad6f1a09aced8300e535f7c77a7ecdf56682f42f4c -->
<a id="adr-0081"></a>

## ADR-0081: Camp-Public Attachment Paths and Frozen Discovery

迁移时原路径：`docs/adr/0081-camp-public-attachment-paths-and-frozen-discovery.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0081
title: "Camp-Public Attachment Paths and Frozen Discovery"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.25
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0081 -->
<a id="adr-0081-context"></a>
### Context

旧附件设计把受管 Blob 再复制为每个 Run 的只读投影。用户确认公共会话附件应对
Camp 当前成员统一可用：Runtime 只需要收到路径并用自身文件工具读取，不应为每个
Run 生成副本。同时，AgentRun 仍必须遵守消息冻结边界，不能通过列目录发现未来消息
附件。

<a id="adr-0081-decision"></a>
### Decision

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

<a id="adr-0081-consequences"></a>
### Consequences

- 一个公共附件只存一份，路径在消息生命周期内稳定。
- Agent 使用原生文件工具读取路径，不需要 Rovai 专用附件读取工具。
- 稳定路径不是实时订阅；路径发现仍由 ContextManifest 和检索边界控制。
- Camp 目录权限、不可预测 ID 和 Core 边界校验共同承担“已知路径可读、未知路径不可
  枚举”的安全约束。
- Renderer 预览与 Agent 文件访问分离，预览失败不会降低附件的公共资源语义。

<a id="adr-0081-rejected-alternatives"></a>
### Rejected Alternatives

- 每 Run 复制或 hard-link 投影：重复状态、额外清理与恢复复杂度没有授权收益。
- 把附件复制进 Project/Worktree：污染用户仓库，并把资源生命周期错误绑定到 Git。
- 把原始本机路径发给 Agent：泄漏用户目录结构且无法保证重启后的稳定性。
- 仅向被寻址 Agent 暴露附件：与公共会话资源语义冲突。
- 让 Runtime 枚举整个 Camp 目录：会绕过冻结消息边界发现未来附件。
- 在 Renderer 中直接加载 `file://`：违反 Electron 隔离边界并受浏览器策略限制。

<a id="adr-0081-references"></a>
### References

- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0051: Boundary-Capped Context Retrieval](../v0.12/decisions.md#adr-0051)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](../v0.21/decisions.md#adr-0067)
- [v0.25 Attachment Composer](README.md)
<!-- legacy-adr-body:end id=ADR-0081 -->
<!-- legacy-adr:end id=ADR-0081 -->
