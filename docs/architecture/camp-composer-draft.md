---
document_type: architecture
architecture: camp-composer-draft
authority: desktop-local-public-camp-composer
status: accepted
last_updated: 2026-10-23
---

# Public Thread Composer

公开 Thread Composer 的内容权威是客户端本机、按 Thread 隔离的轻量状态。Active 与普通一键 Pending
都保存本机快照；Core 仅为普通 Pending 保存客户端 presence，拥有侧栏可见性与清理保护。合同见
[Camp Composer Draft v20](../contracts/camp-composer-draft-v20.md)。Single Chat 的私有 Draft/Pending 不在本架构范围。

## 组件边界

| 组件 | 职责 |
| --- | --- |
| Lexical Editor | 节点树、selection、composition、undo/redo 与当前未发送内容 |
| Composer shell | 成员/Skill picker、引用、回复锚点、附件选择、发送状态和错误反馈 |
| Composer adapters | `EditorState` 与 `ComposerDocument`/Structured Content 的确定性转换 |
| Local Draft store | 按 Thread 保存/恢复正文、结构化 atom、quotes、reply、continuation 与附件身份；无跨客户端协调 |
| Main attachment authority | 持有 Thread+attachment 的原路径绑定，重验预览/open/reveal/发送，不信 Renderer 替换路径 |
| Core pending presence | 仅保存 Thread+可信客户端的非空标记，供导航与清理判断；不拥有正文、附件路径或编辑版本 |
| Core publication | 校验一次发送快照并原子创建 ThreadMessage、附件关系和目标 Deliveries |
| Delivery queue | 已公开消息的目标等待责任；不是草稿或下一轮输入缓存 |

Core 不保存 public Thread Draft 正文、revision、编辑租约、恢复锁或未公开 Pending 队列。普通按键路径更新本地
编辑器，由现有保存队列把有界快照写入 Thread-local store。普通 Pending 的首次保存及非空状态变化还等待 presence
确认；失败保留输入并阻止离开，后续同为非空的编辑只写本机。无跨客户端内容同步或合并。

## 发送

```text
mounted Renderer edit
  → snapshot content / quotes / reply anchor / targets / Skills / source refs
  → dedupe outsider Member Atom IDs; for Active Thread, sequential threads.members.add
  → one idempotent publication command
  → ThreadMessage + waiting Deliveries
```

提交期间 Composer 防止重复发送。成功后用空 Draft 替换已发送内容，并在唯一显式非 Lead 目标时记录 continuation；
明确失败时保留原内容供用户修正或再次发送。未知提交结果通过
原 command ID 查询/回放，不能先清空再猜测。附件继续是源文件引用；发送不会移动或删除用户文件。

首发成功回执可能早于 Active 名册投影：客户端按回执保留唯一显式续发身份，旧 Pending 名册不能清掉它；
实际续发仍等待当前成员资格。该 transport 内记住已接受的激活事实，跨 Composer 重挂载停止 Pending
presence/discard 操作并继续本机保存；不推测或补造成员名册，也不新增持久草稿字段。

待邀请身份只从冻结后的 `ComposerDocument` Member Atom 派生，不进入 Core Draft，也不单独持久化。Active Thread 的
队外、资料仍在的队员可在 Composer 选中；重复提及仅加入一次，正文中的每处 Atom 均保留。发送时先完成全部
`threads.members.add`，再调用现有 `thread.messages.send`。两类命令各自拥有权威回执，不构成跨命令原子事务：
部分加入成功时停止发送、保留草稿并报告结果；加入成功而发送失败时成员关系继续存在，重试时从最新名册
重新判定，已在队者不再加入。Pending Thread 首条输入直接提交冻结正文，由
[Pending Camp Activation v5](../contracts/pending-camp-activation-v5.md) 在一个事务中加入队外身份、激活、发布和投递；
业务拒绝也撤销暂写的成员和事件，保留本机草稿。不能在激活前调用单独成员加入命令。

Active 和普通一键 Pending Thread 的已保存输入可跨切换、刷新、窗口重建和普通退出恢复。每次新建拥有独立
Thread ID；同一项目可以有多份草稿。Pending presence 的导航、清空和启动保护见
[Pending Camp Activation v5](../contracts/pending-camp-activation-v5.md)。
恢复会重新校验成员、reply source 和 Main 持有的附件 authority；无效来源以可修复状态呈现，不能静默换址。

搜索/around 临时载入的消息已经是可见的完整 reply target，Composer 直接冻结其最小本地 snapshot；发送事务再按
Thread+messageId 验证。附件缩略图、应用内预览、系统打开与 reveal 走 Main authority，不依赖 Core Draft locator。

## User 输入历史

公共 Thread 与 Single Chat 共用同步导航器；首次 ↑ 从现有消息集合提取独立的本轮内容数组，
仅保留下标和原草稿/选区。公共数据来自 `visibleThreadMessages`，单聊来自当前快照的正式消息与
活动 Pending。范围、顺序与筛选规则见 [Input History v1](../contracts/input-history-v1.md)。
输入历史不拥有数据库读取、消息加载、跨会话缓存或成功回执记录。

Lexical adapter 保留原 EditorState，预览只替换显示与有效输入；`ComposerDraftSync` 保存/重试仍引用
原稿，编辑或发送才接管。工作区订阅路由需要的 live Atom，不因普通文本逐字输入新增整页重渲染。
单聊 textarea 使用同一导航；消息刷新不改变本轮数组，显式替换草稿则结束浏览。退出后释放本轮内容。

## 长粘贴生成文件

Desktop 与 Web 公屏单次普通文本粘贴超过 10,000 码点时，将全文交给原附件准备队列；本机保存完成是明确接纳点。
内部复制恢复后只有文字的内容也使用同一阈值；仅仍含 Member、All Members 或 Skill Atom 时保留结构化粘贴优先级。
准备期间原编辑器持有原文；未接纳时先追加到原编辑器最新正文，再清理生成物。Pending presence 失败发生在
本机接纳之后，不重复回填，也不以旧快照覆盖等待期间的新输入。

Main 使用 Host/Core 解析的 Thread 输出目录写入 UUID `.txt`，沿用 source ref 的预览、恢复和发送；
草稿正文与附件清单仍在原 localStorage。Main 登记仅增加生成来源和不可撤销的发送保护；保护持久保存
先于请求发出，只覆盖本次最终发送快照中的生成附件，并与物理删除使用同一现有串行队列。
已移除的附件不被后续发送连带标记；本次空附件快照也不解除更早的保护。
空附件发送直接绕过登记队列；另一 Thread 显式发送同一 `sourcePath` 时，原生成登记同样保留文件，
ID 匹配仍限定发送 Thread。此复用不延长所属 Thread 的寿命；删除该 Thread（含既有空 Pending 清理）
仍按原规则清理目录。
用户移除先保存草稿，再等待异步文件删除，最后释放登记。
已进入发送流程或资格不明时只移除引用，保留文件。清理失败不成为草稿保存失败，允许残留到 Thread 删除。
发送成功同样先保存新草稿，再释放恢复登记。仍有恢复或清理职责的生成登记不参与普通缓存裁剪。

Web 复用上传回执，不调用 Electron Main。Host 接收时直写同一 Thread 输出目录；Core 原 SQLite
仅记录生成文件的归属与单向保护。附件操作锁协调发布与异步删除，空附件发送绕过；
删除复用现有独立请求路径，数据库锁不跨文件系统等待。上传回执不等于本机草稿接纳，
未知结果沿用现有上传恢复与显式重试；普通外部上传仍为原临时文件语义。

普通弹窗的零消息 Active 不因清空而丢弃；一键 Pending 继续使用既有 presence、离开与启动清理，并补齐
输出目录删除。首次发布后身份与路径不变。不建立新的草稿事务、发送对账或垃圾回收框架；
精确接口与负例由 [v20](../contracts/camp-composer-draft-v20.md) 拥有。

## 撤回与短期重新编辑

发送后的本地 User 消息在首次目标 claim 前可以撤回。撤回操作针对已发布 ThreadMessage，原子取消 waiting Delivery
并擦除受控原文；撤回本身不会把内容放回 Composer。首次 claim 后撤回资格永久关闭。
输入历史不另行监听撤回；本轮已提取内容仍可由 User 回填，下一轮依据最新消息数据，重新发送算新提交。

[Message Reedit v1](../contracts/message-reedit-v1.md) 另行拥有两分钟内的客户端文字回填。
`MessageReeditStore` 在独立 localStorage 命名空间保存有界 pending / ready 副本，统一读取校验和应用级清理；
`MessageWithdrawal` 只适配原撤回命令与回放，将命令结果、副本写入、列表刷新分开处理。
`ThreadWorkspace` 负责蓝色无下划线入口及已有草稿的替换确认，最终回填前再次读取有效副本。

Web 的原请求 Promise 可以由回执补查完成。`ConsoleClient.requestWithSource` 将直接响应与恢复来源
作为客户端结果元数据交给撤回适配器；补查、Core 错误后的回执核对及显式重放均使用 pending 剩余窗口。
该元数据不进入 Core 请求、回执或持久化格式，普通 `request` 仍返回原结果值。
撤回适配器同时在实例内保留未知请求的原命令参数，供无正文或副本保存失败后的显式重试使用；
明确成功／拒绝才移除，不保留正文、不跨重启承诺恢复、不单独启动后台重试。
存储通知按消息 key 分发，无变化清理不广播；入口资格仍实时读取校验，不能用通知替代有效期判定。

只恢复正文与原文明示的成员 @，不携带默认队长显示前缀或撤回消息的附件／引用／回复关系。
回填后由原有本机草稿协调器拥有，副本到期不影响草稿。Core 不保存恢复字段，不新增表、命令或上下文通路。
每个前端实例最多一个清理定时器；其他窗口通过 storage 更新，容量与并发保证限于合同中的最佳努力边界。

## 升级

Migration 163 一次性删除旧 **Core** public Composer Draft、未公开 Pending 及编辑/恢复状态，且不提供 legacy recovery UI。
新的本机 store 不读取这些旧行。删除本地引用不删除用户源文件；已发布消息和其附件不受影响。

## 对话与使命参考

[Thread Reference v1](../contracts/thread-reference-v1.md) 将本机引用选择、用户目录读取和正式发布分开。
`thread_reference` 模块拥有 live 目录、目标校验及首次标题捕获；发布网关先完成命令回放判定，再在原事务
中捕获标题并沿既有成员语义创建消息和 Delivery。不存在另一个引用清单或背景摘要 owner。

公开 `@` picker 复用成员交互，完整目录搜索与游标分页不读取来源历史。选中 Atom 的可用性批量查询，
不会改写其身份或产生草稿 dirty。消息段是发布权威，Context/Steer/History 使用同一个现有正文 projector
输出定位链接；源删除与 owner 删除各走自身生命周期。取舍见 [V1.72-D58](../versions/v1.72/decisions.md#v1-72-d58)。
