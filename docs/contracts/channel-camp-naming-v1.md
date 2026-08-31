---
document_type: contract
name: Channel Camp Naming
version: v1
status: accepted
source_version: v1.36
last_updated: 2026-08-31
---

# Channel Camp Naming v1

## 名称权威与生成

飞书私聊、普通群、话题和钉钉私聊、普通群共用普通 Camp 命名流程。创建时使用
`title=未命名对话 / name_origin=default`，不把昵称、群名、项目名或“快速对话”设为生成标题。
首条通过统一原子 admission 的有效 Owner 消息，复用普通 Camp 的 Structured Content 命名函数：
移除行首连续真实寻址 Mention、规范化空白、限制为 80 个 Unicode scalar，并在同一消息/Turn/Run
事务中把 `default` 改为 `generated`。collecting、待选项目、被拒绝或回滚的消息不产生生成名。
已为 `generated` 或 `user` 的标题不被后续消息覆盖；手动重命名仍只更新普通标题及 `name_origin=user`。

`/new` 只创建新的默认命名 Camp；新 Camp 的首条有效消息独立命名。旧 Camp 与旧绑定仍保留。
本次不迁移、批量重命名旧 Camp，也不根据旧标题猜测是否为用户手动名称。

## 渠道来源投影

NavigationCampItem、CampSnapshot/Open 的 `camp` 和 NotificationEpisodeView 的 `camp` 增加
可选 `channelSource`：

```ts
type CampChannelSource =
  | { provider: 'feishu'; conversationKind: 'p2p' | 'group' | 'topic' }
  | { provider: 'dingtalk'; conversationKind: 'p2p' | 'group' }
```

Core 在现有读取事务中沿 `camp.id → channel_conversation_binding.camp_id → channel_conversation`
投影两个字段。不限定 binding 为 active，保证 `/new` 关闭绑定后历史 Camp 仍有来源；唯一 camp_id
保持列表基数和分页不变。不新增查询网络请求或逐 Camp 额外读取，不公开外部会话/租户/用户/App ID、凭据或路径。
普通 Camp、无绑定或未知组合省略字段。旧 reader 可忽略，新 reader 容许缺失/null；不得由名称或项目类型推断渠道。

## Renderer 展示

所有 Camp 名称显示统一使用下表前缀加原始 `camp.title`，中间不增加空格：

| provider | conversationKind | 前缀 |
| --- | --- | --- |
| feishu | p2p | `【飞书私聊】` |
| feishu | group | `【飞书群聊】` |
| feishu | topic | `【飞书话题】` |
| dingtalk | p2p | `【钉钉私聊】` |
| dingtalk | group | `【钉钉群聊】` |

侧栏/置顶、跳转搜索、Quick Chat 最近会话、顶部标题、会话可访问名称、删除确认和临时通知使用同一 formatter。
搜索可匹配前缀。重命名输入框及提交值只使用原始标题；例如保存 `OAuth 登录问题` 后仍展示
`【飞书私聊】OAuth 登录问题`。前缀不写 SQLite、消息、模型上下文或任何重命名命令。
原有截断布局、完整可访问名称与菜单行为保持不变。

## 不变边界与验证

不新增 Migration，不修改消息路由、Quick Chat、项目/Topic 绑定、`/new` 执行语义、成员/Bot 路由或身份权限。
通知来源只在 read hydration 追加，不写 Journal、增加 attention revision 或触发提醒。
Navigation schema 3、Snapshot schema 34、Open schema 5 与 Notification schema 6 保持不变。

回归覆盖五种来源、首条有效消息、未完成聚合不命名、FIFO 不覆盖手动名、普通 Camp 无前缀、
闭合绑定仍投影、UI formatter 不修改输入、重命名后保留来源与长标题截断。

## References

- [Camp 命名不变量](../architecture/foundational-invariants.md#camp-lifecycle)
- [Camp Open Projection v10](camp-open-projection-channel-v10.md)
- [Notification Episode v5](notification-episode-v5.md)
- [App Shell 与统一侧栏](../ui/components/app-shell-navigation.md)
