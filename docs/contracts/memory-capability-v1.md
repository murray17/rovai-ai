---
document_type: protocol-contract
contract: memory-capability-v1
authority: memory-instance-capability
status: accepted
version: 1
source_version: v1.72
last_updated: 2026-11-12
---

# Rovai 长期记忆开关 v1

一个 Core 实例共用一个默认开启的 Rovai Memory 开关，覆盖连接它的 Desktop、Web、Mobile、全部队员
与 Hearth/Companion/Relationship。Task 独立；不提供 Thread、成员或 Scope 覆盖。本合同补充
[Memory Capture v3](memory-capture-v3.md) 的可用性前置条件，不改变其授权与生命周期规则。

## 权威与控制接口

`memory_preference` 是持久化单例，`singleton=1`、`enabled` 仅允许 0/1，
`heads_up_after_global_sequence` 为非负 Memory 提示边界。Migration 224 / projection schema 174
对新库和升级库显式初始化 `enabled=1`；后续启动/升级保留用户选择。缺行、非法值和读取失败属于
状态不可用，不等同于确认关闭，不自动覆盖记录。

User Host 接口：

| 方法 | 输入/语义 |
| --- | --- |
| `preferences.memory.get` | `{}`；读取快照 |
| `preferences.memory.set` | `{"enabled":boolean}`；用户保存设置，返回提交事务内快照 |
| `preferences.memory_changed` | 提交后发出的失效提示，客户端重读权威状态 |

快照完整 shape：

```json
{
  "enabled": true,
  "headsUpAfterGlobalSequence": 0,
  "observedThroughChangeSequence": 0
}
```

`observedThroughChangeSequence` 来自既有 Core notification change clock，仅用于同 Host 的快照排序；
开关真正变化时在事务内推进。`headsUpAfterGlobalSequence` 来自既有 event_log，表示最近关闭→开启的
提示边界，不与 Core change sequence 比较。快照不携带事件观察水位，事件恢复使用 EventBatch 自身游标。
同值保存与读取不推进持久化提示边界；关闭→开启在设置事务固定事件水位。
`events.subscribe` 的 User Host 响应附带可选 `memoryCapability` 同锁快照；局部设置不可读时为 `null`，
普通事件与游标继续返回，Provider 进入读取失败态。字段缺省保留旧可选语义，不改变事件 schema 9。

设置提交后才发布事件和刷新发现文件。刷新失败不回滚设置；沿用有界重试，同值保存也修复投影。
Agent 没有设置写接口。客户端隔离 Host 访问代次。get、设置回包和事件快照共用本地观察代次：
较高 Core 设置序号优先；同序号按请求观察顺序接收。null/读取失败不能覆盖已被后续观察或更高 Core 序号
替代的状态；被接收的读取失败明确 ready=false，不依赖此前保存错误的提示类别。状态未知显示不可用和重试。
Memory 设置读取异常只阻断 Memory 本身：控制接口保留读取错误，实际业务不读取/提交，
新输入省略 Memory，统一发现仍投影有效的 Task 状态与隐藏的 Memory，不写回替代设置。

## 执行、关闭错误与回放

`memory.view/search/read` 在既有 Core 锁/事务内检查设置再读取内容；运输层读回放重新进入实时读取服务，
重新判断权限、Presence、生命周期和 Revision，不直接交付旧缓存正文或片段。
最终读取结果在构造活动记录之前选定，与设置提交共用 Core 数据库串行边界；该锁复用于记录证据，
无网络 I/O 跨越该判定。活动记录、coreEnvelope 与实际回包使用同一选定结果，运输层不在记录后再次改判。
边界之前已确认交付的结果可能晚到；客户端点击和网络到达时间不改变 Core 的提交顺序。

`memory.write` 以及所有人工管理变更在现有幂等回放后、实际业务 handler 事务内检查。
关闭时新业务不查询正文、不形成正式记录、不创建候选，也不执行 retire/forget/审核等新效果。
已提交结果仍按现有身份、commandId、requestId/digest 规则回放，不重新执行或改判保存事实；
回执不含记忆正文。关闭产生的 durable 拒绝保留原 commandId 语义，重新开启后的新意图使用新命令身份。

Agent 关闭错误沿用现有 Envelope 的 error 位置：

```json
{"code":"memory.feature_disabled","message":"Rovai long-term memory is disabled.","recovery":"stop"}
```

`stop` 只终止该 Memory 操作。普通对话、Run 与其他工具继续；不增加会话提示。
User 管理读取覆盖 `memory.list/get/export`、`memory.hearthReviewItems.list`；所有管理变更也暂停。
设置读写和已有结果确认属于控制路径，保持可用。

## 输入与发现

新生成 Bootstrap 关闭时不查询 Memory 索引，不输出整个 Memory Entrypoint，也不输出空库搜索教学。
观察 Revision 集合为空，授权摘要准确表示 `memoryAccess=none`，预算和证据按实际字节生成。
平台技能索引省略 `memory-stewardship`，保留文件和受管身份。开启恢复正常发现。
`cli-operations` 始终使用固定精简的通用 description/正文，不提供 Memory 专用选择行和引用；
对应界面元数据同步精简。旧 Memory reference 保留通用导航短页，文件发布沿用原同步流程。
开关不动态改写这份共享 Skill；记忆工作流由条件投递的 `memory-stewardship` 拥有。

普通 Runtime 的 CLI context 新增 `memoryEnabled`；统一刷新入口在同一 Core 读取中获取当前 Task、Memory
状态，再生成完整文件。CLI 列表、说明和 help 按投影过滤；实际调用继续进入 Core，不按本地投影拒绝整组 Memory。
Hermes 使用既有逻辑 Session 身份及 Core IPC 连接，以 `{"kind":"capabilities"}` 只读请求返回
`{"kind":"capabilities","capabilities":{"tasksEnabled":boolean,"memoryEnabled":boolean}}`。
仅 help 等发现路径发起这次远程查询；普通实际命令直接进入 Core，发现失败不当作已确认关闭。
普通 Runtime 的现有本地 Task 投影检查保留。Memory 局部设置异常不阻断 Task 能力返回。
该请求不创建操作、回放记录、Session 映射或新通知通道，不能授予业务访问权限。

不处理旧 Session、Binding 或 Bootstrap 生命周期；不增加 Memory epoch，不使旧输入过期，不触发补发或
Session 轮换，也不改写冻结/已投递内容。所有上下文版本轴保持。Runtime 原生记忆策略不变。

## 客户端停用与通知

Memory 导航保留。通用设置与记忆页提供同一个 Core 总开关，共用 Provider 的保存、失效刷新与重试状态。
关闭页提供停用说明和直接重新开启的开关，不加载列表/详情/审核、计数或复核业务。
页面外启动预加载同样受控；迟到响应不能恢复内容、派生查询或旧行为提示。开启恢复正常读取和管理，
不自动提交旧草稿。开启时既有沿用/复核文案保持。

关闭/状态未知时抑制 Memory 行为提示并继续维护既有公共事件游标。重新开启过滤持久化提示边界以前的
事件；离线重连/重订阅用既有事件水位确定提示起点，不集中补弹。数据与待审核项保留，不批量修改生命周期。
边界推进还作用于已经显示的变化和审核提示，保留 `sequence > headsUpAfterGlobalSequence` 的提示，
即使客户端未观察到中间关闭态也不合并旧提示。
内容刷新独立于提示过滤：恢复连接/事件缺口也刷新列表和审核数，同时继续抑制旧提示。
Desktop 全局 memory.changed 负责实例范围的实时内容刷新，不受选中 Thread 限制。
按 Thread 过滤的 Memory 领域事件只驱动本会话行为提示；该轮询仅在断线恢复或事件缺口时补一次内容刷新，
不因普通 memory.* 事件重复读取列表。不扩大 Thread 事件查询范围，不增加全局轮询、游标或队列。
Memory 页面打开时由其既有审核列表读取与计数回调提供导航计数，页面外由父组件读取审核列表；
初次/重新启用/内容信号在各自现有 effect 合并，不把全局设置排序序号当作内容变化信号。
已保存的新 Agent/人工业务变更提交后发出无正文的 memory.changed；拒绝、读取和幂等回放不重复发出。
Web 既有 SSE 失效元数据以 memoryContentChanged 表达该内容变化，解码/合并保留标记；
memoryChanged 继续只表示设置变化。Memory 内容只响应自身变更和 resync，普通 Runtime/消息失效不全量读取。
已有列表刷新失败时保留内容与选择，原错误行提供重试，不新增提示区块。
管理 list 在入口检查一次后使用私有记录加载；get 保留入口检查，export 复用已检查的 list，
不逐条重复查询开关，不增加开关缓存。

精确已确认文案、前后输入及验证归属见[变更说明 R4](../versions/v1.72/model-context-change-memory-capability.md)。
