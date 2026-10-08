---
document_type: architecture
architecture: camp-composer-draft
authority: desktop-local-public-camp-composer
status: accepted
last_updated: 2026-10-08
---

# Public Camp Composer

公开 Camp Composer 的内容权威是客户端本机、按 Camp 隔离的轻量状态。Active 与普通一键 Pending
都保存本机快照；Core 仅为普通 Pending 保存客户端 presence，拥有侧栏可见性与清理保护。合同见
[Camp Composer Draft v16](../contracts/camp-composer-draft-v16.md)。Single Chat 的私有 Draft/Pending 不在本架构范围。

## 组件边界

| 组件 | 职责 |
| --- | --- |
| Lexical Editor | 节点树、selection、composition、undo/redo 与当前未发送内容 |
| Composer shell | 成员/Skill picker、引用、回复锚点、附件选择、发送状态和错误反馈 |
| Composer adapters | `EditorState` 与 `ComposerDocument`/Structured Content 的确定性转换 |
| Local Draft store | 按 Camp 保存/恢复正文、结构化 atom、quotes、reply、continuation 与附件身份；无跨客户端协调 |
| Main attachment authority | 持有 Camp+attachment 的原路径绑定，重验预览/open/reveal/发送，不信 Renderer 替换路径 |
| Core pending presence | 仅保存 Thread+可信客户端的非空标记，供导航与清理判断；不拥有正文、附件路径或编辑版本 |
| Core publication | 校验一次发送快照并原子创建 CampMessage、附件关系和目标 Deliveries |
| Delivery queue | 已公开消息的目标等待责任；不是草稿或下一轮输入缓存 |

Core 不保存 public Camp Draft 正文、revision、编辑租约、恢复锁或未公开 Pending 队列。普通按键路径更新本地
编辑器，由现有保存队列把有界快照写入 Camp-local store。普通 Pending 的首次保存及非空状态变化还等待 presence
确认；失败保留输入并阻止离开，后续同为非空的编辑只写本机。无跨客户端内容同步或合并。

## 发送

```text
mounted Renderer edit
  → snapshot content / quotes / reply anchor / targets / Skills / source refs
  → dedupe outsider Member Atom IDs; for Active Camp, sequential camps.members.add
  → one idempotent publication command
  → CampMessage + waiting Deliveries
```

提交期间 Composer 防止重复发送。成功后用空 Draft 替换已发送内容，并在唯一显式非 Lead 目标时记录 continuation；
明确失败时保留原内容供用户修正或再次发送。未知提交结果通过
原 command ID 查询/回放，不能先清空再猜测。附件继续是源文件引用；发送不会移动或删除用户文件。

首发成功回执可能早于 Active 名册投影：客户端按回执保留唯一显式续发身份，旧 Pending 名册不能清掉它；
实际续发仍等待当前成员资格。该 transport 内记住已接受的激活事实，跨 Composer 重挂载停止 Pending
presence/discard 操作并继续本机保存；不推测或补造成员名册，也不新增持久草稿字段。

待邀请身份只从冻结后的 `ComposerDocument` Member Atom 派生，不进入 Core Draft，也不单独持久化。Active Camp 的
队外、资料仍在的队员可在 Composer 选中；重复提及仅加入一次，正文中的每处 Atom 均保留。发送时先完成全部
`camps.members.add`，再调用现有 `camp.messages.send`。两类命令各自拥有权威回执，不构成跨命令原子事务：
部分加入成功时停止发送、保留草稿并报告结果；加入成功而发送失败时成员关系继续存在，重试时从最新名册
重新判定，已在队者不再加入。Pending Camp 首条输入直接提交冻结正文，由
[Pending Camp Activation v5](../contracts/pending-camp-activation-v5.md) 在一个事务中加入队外身份、激活、发布和投递；
业务拒绝也撤销暂写的成员和事件，保留本机草稿。不能在激活前调用单独成员加入命令。

Active 和普通一键 Pending Camp 的已保存输入可跨切换、刷新、窗口重建和普通退出恢复。每次新建拥有独立
Thread ID；同一项目可以有多份草稿。Pending presence 的导航、清空和启动保护见
[Pending Camp Activation v5](../contracts/pending-camp-activation-v5.md)。
恢复会重新校验成员、reply source 和 Main 持有的附件 authority；无效来源以可修复状态呈现，不能静默换址。

搜索/around 临时载入的消息已经是可见的完整 reply target，Composer 直接冻结其最小本地 snapshot；发送事务再按
Camp+messageId 验证。附件缩略图、应用内预览、系统打开与 reveal 走 Main authority，不依赖 Core Draft locator。

## 撤回不是草稿恢复

发送后的本地 Principal 消息在首次目标 claim 前可以撤回。撤回操作针对已发布 CampMessage，原子取消 waiting Delivery
并擦除受控原文；它不会把内容放回 Composer，也不是 Undo Send/草稿恢复。首次 claim 后撤回资格永久关闭。

## 升级

Migration 163 一次性删除旧 **Core** public Composer Draft、未公开 Pending 及编辑/恢复状态，且不提供 legacy recovery UI。
新的本机 store 不读取这些旧行。删除本地引用不删除用户源文件；已发布消息和其附件不受影响。
