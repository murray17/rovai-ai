---
document_type: contract
contract: navigation-read
version: v1
status: accepted
last_updated: 2026-09-27
---

# Navigation Read v1

Core 在 SQLite 事务内返回侧栏权威状态；事件只声明读取范围。排序仍只由已发布的用户或
external_principal 消息推进。查看、重命名、队员消息和 Run 终态不改变用户活动排序。

## Read scopes

| 接口 | 请求 | 权威返回与范围 |
| --- | --- | --- |
| `navigation.camps` | `{ campIds: string[] }` | `{ throughGlobalSequence, groupKeys, camps }`，按 ID 读取；不在调用者导航范围内的行不返回，不读取其他 Camp；groupKeys 从仍存在的目标 Camp 取得，包含删除受理后尚未物理删除的所属组 |
| `navigation.snapshot` | `{ groupLimits?, groupKeys? }` | schema 3；省略 groupKeys 表示完整快照，提供时只返回指定组；quickChat 未被请求时为空；缺失/空项目不创建项目项 |
| `navigation.groupCamps` | `{ projectPath?, offset?, limit? }` | schema 3；单组 SQL COUNT + LIMIT/OFFSET，limit 限制为 1–200；保留现有 page shape |

`groupKeys` 为 `quick-chat` 或 `directory:<projectPath>`。`groupLimits` 为完整前缀大小，默认/最少 5；
未知 key 不创建组。分组响应在同一个事务里获得总数与排序后的前 N 条，不能用部分本地数据推导补位或名次。
完整快照只跨组读取目录/计数元数据，各组详细行按索引限定窗口；正常路径不访问 event_log。
置顶 Camp 用已知 ID 批量读取，不遍历其他组寻找；完整恢复同时按 ID 核对窗口外的置顶项，普通切换不带起其他置顶项读取。

NavigationCampItem 延续 schema 3 字段，并提供 `lastSeenGlobalSequence`（读取旧 fixture 时可缺省为 0）。
`lastActivityAt`、`lastActivityGlobalSequence`、`latestCompletionGlobalSequence` 来自 camp 摘要；
`marker` 从现有活跃 Run 与 camp_view_state 推导，loading 优先于 unread_completed。

## Observed read acknowledgement

`navigation.campViewed { campId, throughGlobalSequence }` 只确认已正式展示、可见且拥有焦点的 Camp；
不能使用缓存预览、水位之后到达的完成事件或候选恢复位置确认已读。负值、未来水位、缺失 Camp 拒绝。

回复 `{ campId, lastSeenGlobalSequence, changed, navigation }`，其中 navigation 为同一事务取得的
`navigation.camps` 结果。已读复用 camp_view_state，单调增加；重复/旧水位不写入、changed=false，
不发侧栏失效通知。客户端已知没有新增可见完成内容时不重复请求；确需确认时应用 Core 返回的行，不能猜 marker。
普通进入只请求目标投影和目标行，不触发全侧栏、其他分组、使命列表或技能目录扫描。

## Notifications and recovery

`navigation.invalidated { reason, scope: 'camp' | 'group' | 'all', campId?, groupKeys? }` 在提交后发出。

- camp：已读、改名、Lead/成员或运行状态变化，只刷新目标行，保留成员位置与总数。
- group：发布用户消息、增删/激活或分组成员变化，重读相关组当前完整前缀与总数。删除在物理移除前取得所属组并随通知发送，不保存删除补齐记录。移动时包含新旧组。
- all/未知范围：首次建立基础、断连漏通知/无法确认完整性、Core 重启、用户主动刷新时重读摘要完整快照。

一个刷新协调器合并范围；完整范围覆盖局部，组与 Camp ID 去重，最多一个刷新批次在途，保留 trailing 与退避。
窗口变更、已读回执和 dispose 的迟到响应不得覆盖较新状态。客户端不回放事件重建状态。
不提供持久化分组版本、变化日志、保留期或通用增量同步。现有聚焦/前台 20 秒完整性兜底继续读取摘要；
正常在线变化不依赖兜底。使命有独立失效提示；Skill 候选仅在用户使用选择器时读取。
