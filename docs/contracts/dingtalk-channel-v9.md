---
document_type: protocol-contract
contract: dingtalk-channel-v9
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 9
source_version: v1.37
last_updated: 2026-09-02
---

# DingTalk Channel v9 Contract

继承 [DingTalk Channel v8](dingtalk-channel-v8.md) 的 Web Session、独立 Bot 发布、私聊 Quick Chat、项目卡、
三入口执行卡、紧凑 command、Owner callback、首次发布欢迎卡与恢复边界。本版纠正普通群 receiving Bot 的证明和
Robot Stream 路由字段判定：不再比较 provider 的两个 opaque 用户 ID，也不把 `openConvThreadId / openThreadId`
当成 Topic 证明；
不新增 Migration，不接入 Topic。

## 1. 普通群 Bot 目标证明

每个已发布 Bot 使用自己的 `appKey/appSecret` 建立独立 Stream client。Robot callback 只从该 credential-bound client
进入对应 App 的 handler；若 callback 携带 `robotCode`，它还必须与该 App 的冻结 `robotCode` 或 `appKey` 匹配。
普通群在此 exact receiving App 事实之外必须满足 `isInAtList=true`，才进入 3 秒观察窗。

`chatbotUserId` 是 provider 声明可忽略的 opaque 机器人 ID，`atUsers` 是本条消息的 mention 元数据；真实 Stream callback
可能对二者使用不同编码。因此它们继续做有界 shape 归一化，但不得要求
`chatbotUserId === atUsers[].dingtalkId`，也不得从 `atUsers[].staffId/dingtalkId` 推导 Agent target。

同一 external message 若被多个已发布 Rovai App 的独立 Stream 实际接收，仍按 3 秒窗口得到多 App 事实并整条
fail closed。普通私聊不依赖 `isInAtList`、`chatbotUserId` 或 `atUsers`，继续按 receiving App 直接创建或复用
Quick Chat；精确 `/new` 语义不变。

## 2. 群类型与路由字段

当前群能力只承诺同一组织内部群中通过“添加机器人”安装的企业内部应用 Bot。钉钉 UI 的普通群或外部群若只是把同名
身份作为普通成员邀请进群，显式 `@` 也不会产生 Robot Stream callback；Main 不轮询群消息、不冒用成员账号，也不把
“消息已在客户端发送”伪造成渠道入站成功。

Robot Stream callback 的 `openConvThreadId / openThreadId` 是不透明路由元数据：真实私聊和普通内部群消息均可能携带，
字段存在本身不证明 Topic。归一化必须先按 provider `conversationType` 判定 p2p/group；group 可保留但不使用
这两个路由字段，只有明确的 `threadId / topicId / topicKey` 才触发
`dingtalk_topic_not_supported`。Topic 不得降级为普通群，路由字段也不得进入 Core payload 或模型上下文。

## 3. 通用 AI 卡片 callback

Rovai 固定使用钉钉内置通用 AI 卡片，用户不需要选择、创建或发布卡片模板。项目选择沿用最多六个项目按钮以及
“开始快速对话 / 刷新项目”；平台没有提供可直接替代飞书项目下拉框、同时保持零模板配置的通用交互时，不引入
用户自定义模板前置条件。

真实 Card Stream callback 中，`content.cardPrivateData.actionIds` 是模板内部节点 ID，不保证回传动态
`msgButtons[].id`；本合同只读取有界的 `content.cardPrivateData.params.text` 作为动作查找提示。Main 必须同时提交 exact
receiving `appId` 与 `outTrackId`，Core 只能从当前权威、已发送且版本一致的项目卡 delivery 或 execution console 恢复
唯一 action。项目名重名、卡片过期、App 不匹配、按钮未知或权威实例不存在都返回无动作。

恢复出的项目 action 仍必须经过既有 Owner、pending binding、external card、nonce 与 expectedVersion 校验；执行 action
仍必须经过 Owner、exact card、AgentRun 与可取消状态校验。按钮文本本身不是授权，Main 内存映射也不是事实源。旧的
versioned action ID 可继续作为兼容输入，但不作为通用 AI 卡片可用性的前提。

## 4. 其余行为

首次发布欢迎卡、群 roster reconcile、Owner-only admission、项目或 Quick Chat 首次绑定、FIFO/Outbox、执行状态卡、
LAN 只读执行台、最近输出与 exact-run 停止全部继承 v8，不因本次目标证明修正而扩大。

群聊 `agent_output` 必须调用官方 `POST /v1.0/robot/groupMessages/send`，不得使用不存在的
`/v1.0/robot/orgGroupSend`。请求仅包含该接口公开的 `robotCode`、`openConversationId`、`msgKey` 与 `msgParam`；当前接口
不提供原生 `atUserIds`，因此 `mentionPrincipal` 可继续表现为正文中的 `@你`，但不得宣称产生平台原生 @ 通知。
HTTP 成功仍须取得 `processQueryKey` 或其他平台消息身份，不能仅凭 2xx fabricated success。

## 5. 验证边界

测试必须覆盖 `isInAtList=true` 且 `chatbotUserId` 与 `atUsers[].dingtalkId` 不同的真实 callback 形状，并证明它由
exact Stream App 接受；`isInAtList=false` 的群消息、callback `robotCode` 不匹配、同消息多个 receiving App 继续
fail closed。还必须覆盖同时带 `openConvThreadId / openThreadId` 的普通内部群 callback 可继续归一化，以及明确
`topicId` 仍被拒绝。
卡片测试还必须覆盖真实通用模板 callback 形状、exact App/card 实例恢复、未知或歧义文本 fail closed，以及最终业务命令
继续执行原有权限校验。群永久正文测试必须锁定 `groupMessages/send` 的 exact 路径和公开 request schema；真实内部群
验收还须证明 `agent_output=sent` 且 ChannelTurn 完成。私聊回归、群 roster 与首次项目卡不得退化。普通成员形态的
普通群/外部群没有 callback，不由合成 fixture 宣称支持。

## References

- [DingTalk Channel v8](dingtalk-channel-v8.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [V1.37-D12](../versions/v1.37/decisions.md#v1-37-d12)
- [V1.37-D13](../versions/v1.37/decisions.md#v1-37-d13)
- [V1.37-D14](../versions/v1.37/decisions.md#v1-37-d14)
