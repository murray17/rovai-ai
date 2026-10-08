---
document_type: protocol-contract
contract: camp-open-projection-v26
authority: thread-user-message-navigation
status: accepted
version: 26
source_version: v1.72
last_updated: 2026-10-08
---

# Camp Open Projection v26

继承 [v25](camp-open-projection-v25.md) 的 Open schema 8、创建回执、消息模型信息、正文分页和只读边界。
新增两个 Owner 授权的封闭读取方法，Desktop/Web 使用同一 Core 实现。旧 Snapshot、Open 和 around schema
不升版；不新增数据库表、持久导航副本、业务写入或已读确认。

## 全会话用户目录

`thread.messages.anchors({ threadId })` 返回：

```ts
interface ThreadUserAnchorIndex {
  schemaVersion: 1
  threadId: string
  throughGlobalSequence: number
  totalCount: number
  items: Array<{ messageId: string; sequence: number; title: string; messageVersion: number }>
}
```

覆盖该 Thread 所有可导航 `user` / `external_principal` 消息，排除撤回、tombstone、使命启动与非用户系统初始化。
按 `(sequence, messageId)` 升序，`totalCount` 是符合条件的用户消息数，不套用正文分页限制，不截断早期目录。
读取以当前 Thread 的消息业务表为入口，只选 ID、顺序、版本和标题所需用户字段。批量解析提及名称、附件名和引用；
不复用整套消息 hydration，不装配 Agent 回复、Run、执行记录或附件文件。必要字段、名称、附件名和引用材料与水位
在同一读事务内取得；仅识别提及所需的结构解析留在读取阶段，随后释放事务与共享 Database 锁，再做规范化、纯文本
生成、回退和有界 Unicode 截断。不为短摘要构造整篇字符数组。单条预览复用同一材料／格式化边界。

标题使用现有结构化纯文本格式化规则，空正文依次回退附件名称、引用文本和统一占位。统一空白，并沿用现有摘要的
240 Unicode scalar 传输预算，超长以末尾省略号收口。该预算不定义 UI 展示长度，界面仍单行省略。

## 首条有效直接回复

`thread.messages.anchorPreview({ threadId, messageId })` 返回：

```ts
interface ThreadUserAnchorPreview {
  schemaVersion: 1
  threadId: string
  messageId: string
  throughGlobalSequence: number
  sourceAvailable: boolean
  firstReply: { messageId: string; sequence: number; summary: string; messageVersion: number } | null
}
```

`sourceAvailable` 同时检查 Thread、用户作者、特殊消息和撤回／删除；false 表示问题已不可导航。
true 且 `firstReply: null` 仅表示没有符合本规则的直接回复预览，不表示队员没有回答过。它独立于前端未请求、
加载中、失败状态；界面仅保留标题，不增加“未回答”判断。

Core 只查询 `reply_to_camp_message_id` 直接等于目标用户消息 ID 的子消息，要求同 Thread、Agent 作者、顺序严格
晚于问题且未撤回、未 tombstone、非特殊消息。按 `(sequence, id)` 取第一条；不读取问题自己的父消息，不递归追踪
回复链，不查询 Run、Run input 或 Turn，不按时间或语义推断。历史缺少直接 reply 时允许没有预览，不回填历史或修改发送规则。
先通过等值前缀和顺序索引确定回复 ID，再读取这一条的摘要字段，沿用相同传输预算。

Migration 186 从精确 `v1.72/schema 135` 原子增加
`camp_message_direct_reply_idx(camp_id, reply_to_camp_message_id, sequence, id)`，仅索引 reply 非空的消息，并发布
`v1.72/schema 136`。该索引无需读取全会话后续消息或排序全部候选；不建立摘要表，失败时索引与 receipt 一起回滚。

索引首开不计算任何回复预览。悬浮／键盘聚焦延迟 120ms 后读取，离开取消尚未启动的读取；同一目标在途合并，
只缓存访问过的结果。普通正文里碰巧出现的回复不用于认定首条回复。失败保留标题和定位能力，允许重试。

## 独立定位与正文连续区间

目标已加载且身份、版本、可导航状态仍有效时直接定位，否则使用 `thread.messages.around`。
around 的原有 `sourceAvailable` 语义不变，前端仍单独验证目标类型、撤回、删除、Thread 和精确 ID。
其新增 `nextMessageSequence: number | null` 是窗口末尾之后的下一条实际未 tombstone 消息顺序，用于判断两个读取
范围之间是否存在未加载正文；不能根据数值跳号推断缺口。

锚点只持有一份当前目标窗口，定位另一个未加载目标时替换；缓存命中保留窗口，不能因目标“过去见过”而清窗。正常分页的 coverage、loadedCount、complete、hasEarlier、边界和游标
只由正常连续区间维护。展示合并按消息 ID 去重，保留较新版本与已知撤回／删除状态；不改变已有引用、通知、查找窗口
的生命周期。分页按钮及用户输入驱动的自动加载都跟随正常区间入口，程序定位不启动连续翻页。有缺口时明确显示
中间消息未加载，不提供通用缺口补齐或双向无限分页。

请求绑定 Thread 和代次；只允许最后一次点击定位，切换会话、关闭或选择其他导航目标后忽略旧响应。目标不可用时
明确反馈，不定位其他消息。私有待发送输入不进入目录；公开发送回执确定 ID 和顺序后可以即时追加，再由 Core 目录替换。

即时回执补充层随原有会话缓存保留，切换 Thread 不额外清空它。观察到撤回／删除时，只移除对应临时条目及其顺序
映射，不以该消息已进入完整目录为前提。成功且通过身份、代次和水位检查的目录接管本次请求发出前已确认公开的
条目：已包含的交给目录，缺席的标记不可用并移除；请求发出后才确认的条目不能因缺席该结果而被误删。失败或旧
响应不执行接管，已知不可用的消息不能被旧发送回执重新加入。清理沿用现有读取与观察入口，不增加目录请求或预览
缓存清空，不改变正文分页。

## 刷新与资源边界

正文首屏优先：取得可用正文投影后立即提交页面，页面 effect 再独立读取完整目录，不等待目录才显示正文。
进入／启动恢复不提前 prefetch，局部模块合并同一有效目录请求。缓存可先显示，但局部正文不能冒充完整目录。
缓存仅属于当前 Business surface/Host，最多保留最近 8 个 Thread 的目录；退出 Thread 释放定位窗口与预览在途状态。

旧目录可见与旧目录可信分开。进入、resync、丢帧／重连或相关目录失效立即撤销可信状态并使旧请求代次失效，
不等合并延迟结束。点击优先等待当前有效目录请求，仍不可信时通过 around 验证目标；仅最新有效目录恢复缓存快速定位。
刷新失败或失效前启动的响应均不能恢复信任。已知撤回／删除立即阻止定位，有效未失效缓存不额外请求服务器。

实际公开消息发布、撤回和删除路径收集 `{ threadId, indexChanged, unavailableMessageIds }`，由同步事务作用域持有。
Gateway 与 Channel Host 既有事务提交上下文只在确有消息变更时读取必要水位；commit 成功后沿原 Host 输出发送
`thread.messages.changed`。无关命令不为锚点额外查询事件序号或事件范围，不按命令名白名单推断是否产生消息。
回滚丢弃，幂等回放不重发；不复制正文，不提交后反查业务对象，不新增全局失效总线、轮询或持久队列。
Web SSE 继续只投影封闭字段，重连或丢帧沿用已有 resync。

相关用户消息变化合并刷新目录，已知撤回／删除立即使相关导航失效；可见名称变化也刷新标题。普通回复只使当前
Thread 已访问的预览失效，包括已确认没有回复的结果，下次访问再读。不因执行状态或整个 Snapshot 更替重读目录，
`throughGlobalSequence` 只负责拒绝旧响应，不作为目录内容版本。未加载历史锚点不挂载消息 DOM。
