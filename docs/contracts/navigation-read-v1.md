---
document_type: contract
contract: navigation-read
version: v1
status: accepted
last_updated: 2026-10-21
---

# Navigation Read v1

Core 在 SQLite 事务内返回侧栏权威状态；事件只声明读取范围。排序仍只由已发布的用户或
external_principal 消息推进。查看、重命名、队员消息和 Run 终态不改变用户活动排序。

## Read scopes

| 接口 | 请求 | 权威返回与范围 |
| --- | --- | --- |
| `navigation.camps` | `{ campIds: string[] }` | `{ throughGlobalSequence, groupKeys, camps }`，按 ID 读取；不在调用者导航范围内的行不返回，不读取其他 Camp；groupKeys 从仍存在的目标 Camp 取得，包含删除受理后尚未物理删除的所属组 |
| `navigation.snapshot` | `{ groupLimits?, groupKeys? }` | schema 3；省略 groupKeys 表示完整快照，提供时只返回指定组；quickChat 未被请求时为空；缺失/空项目不创建项目项 |
| `navigation.groupCamps` | `{ projectPath?, groupKey?, offset?, limit? }` | schema 3；单组 SQL COUNT + LIMIT/OFFSET，limit 限制为 1–200；保留现有 page shape |

`groupKeys` 为 `quick-chat`、`chat-bot` 或 `directory:<projectPath>`。`groupLimits` 为完整前缀大小，默认/最少 5；
未知 key 不创建组。分组响应在同一个事务里获得总数与排序后的前 N 条，不能用部分本地数据推导补位或名次。
完整快照只跨组读取目录/计数元数据，各组详细行按索引限定窗口；正常路径不访问 event_log。
置顶 Camp 用已知 ID 批量读取，不遍历其他组寻找；完整恢复同时按 ID 核对窗口外的置顶项，普通切换不带起其他置顶项读取。

完整快照增加 `chatBot: NavigationThreadGroup`，与 `quickChat` 使用相同窗口结构；局部快照未请求
该组时返回空窗口。`navigation.groupThreads`（及 `groupCamps` 别名）可显式传入 `groupKey: "chat-bot"`；
省略 `groupKey` 时沿用 `projectPath` 或快速对话的既有选择方式。
聊天 Bot 分组依据线程创建时同事务保存的 `camp.navigation_is_chat_bot` 来源标记；Migration 212 由既有 `channel_chat_conversation` 的线程绑定
回填，不按资料目录或正文推断已丢失绑定的历史。该分类不依赖成员当前聊天开关或资料目录的
客户端登记状态，更换资料目录后旧聊天线程仍保留分类。相同资料目录内普通会话仍属于目录项目，
聊天线程不会重复进入其他组。

NavigationCampItem、精确 ID 查询目标与 Thread snapshot/open header 提供 `navigationGroupKey`，供客户端一致处理分组、置顶、
刷新与打开；聊天线程的 `projectBindingKind` 和 `projectPath` 仍描述实际资料工作区，不因导航改变。

NavigationCampItem 延续 schema 3 字段，并提供 `lastSeenGlobalSequence`（读取旧 fixture 时可缺省为 0）。
`lastActivityAt`、`lastActivityGlobalSequence`、`latestCompletionGlobalSequence` 来自 camp 摘要；
`marker` 从现有活跃 Run 与 camp_view_state 推导，loading 优先于 unread_completed。
Renderer 的运行环沿用 loading，而未读独立使用最新回复与查看水位计算，允许运行和未读同时显示；
`latestCompletionGlobalSequence` 的 wire 名称保留，其事实为已发布且未撤回的 Agent 回复，不要求 Run 已结束。

## Client directory preferences

Desktop 的 `navigation.json` 与 Web 既有 origin/Owner 偏好 JSON 是各自目录清单的唯一存储；
不在 SQLite 登记目录，不跨客户端同步。schema 6 在旧 pins、removedProjects、projectOrder、
projectNames、threadReadStates 上增补 `registeredProjects: string[]` 与 `legacyProjectsSynced: boolean`。
路径沿用 Workspace 规范绝对路径；名称只读取既有别名映射。旧 schema 在内存补空数组和 false，不在读取时重写。

`registerProjects(paths, completeLegacy=false)` 由同一个偏好写入口增量追加缺失目录，过滤最新移除记录；
`completeLegacy=true` 在同一次原子保存中写清单和完成标记，已经完成则不改变清单。
正常目录操作不重置完成标记。明确移除同时去掉登记和顺序并保留移除记录；明确恢复重新加入同一路径。
合法空集合可以完成；读取失败的默认值不能完成。可选 `readError` 仅为读取结果的降级说明，不进入存储。

启动在恢复当前选中项前保留旧选中空目录，只在内存标记未完成时，对启动成功取得的完整 Navigation
项目元数据尝试一次补齐。别名残留不作为候选，不遍历消息或磁盘。失败保留未完成标记，等下次启动再尝试，
导航刷新、新消息、切换与计时器不触发补齐。成功后退出兼容逻辑；普通会话读取保持原样。

完成后项目入口来自登记清单，挂接普通 Navigation 会话窗口；无会话的已登记目录仍显示。
未完成或读取降级时使用登记和普通会话项目的并集，过滤可靠的移除记录。
显式选择目录、新建对话／使命的目录选择入口直接保存，成功后才展示和选择新目录；失败保留原选择，
沿用现有提示告知未保存，用户再次添加即可重新尝试。不保留项目专属错误横幅、重试回调或临时目录恢复状态。
旧项目未补齐时创建／删除会话可按内存集合补缺，完成后不再执行该检查，更不为判断标记而读取 JSON。
可选补缺失败只提示一次；原有路径、权限和业务检查通过时会话继续。明确访问恢复仍须通过原有检查。

所有写入基于最新可读偏好增量修改并保持其他字段，失败保留旧持久数据与已确认快照。
Desktop 复用 Main 队列及私有原子文件写入；Web 在现有浏览器数据库上用短 readwrite 事务串行执行
偏好读取／修改／localStorage 写入，事务不存目录、副本或后台队列。跨标签页与迟到启动补齐都不能撤销移除。
损坏原文不被空默认值覆盖；后续明确添加仍经同一安全写入口读取最新偏好。`onChanged` 仅发布成功写入的完整偏好。

## Observed read acknowledgement

`navigation.campViewed { campId, throughGlobalSequence }` 只确认已正式展示、可见且拥有焦点的 Camp；
不能使用缓存预览、水位之后到达的完成事件或候选恢复位置确认已读。负值、未来水位、缺失 Camp 拒绝。

回复 `{ campId, lastSeenGlobalSequence, changed, navigation }`，其中 navigation 为同一事务取得的
`navigation.camps` 结果。已读复用 camp_view_state，单调增加；重复/旧水位不写入、changed=false，
不发侧栏失效通知。客户端已知没有新增可见完成内容时不重复请求；确需确认时应用 Core 返回的行，不能猜 marker。
普通进入只请求目标投影和目标行，不触发全侧栏、其他分组、使命列表或技能目录扫描。

## Explicit local read intent

`navigationPreferences` schema 6 另存本机 `threadReadStates`，每个稳定 Thread ID 的值为
`{ manualUnread: boolean, readThroughGlobalSequence: number }`；水位必须是非负安全整数。
`setThreadReadState(threadId, state | null)` 原子保存并返回完整偏好快照；`null` 移除本机意图，非空值的 read-through
与旧值取最大。`onChanged` 发布成功保存后的快照。schema 2/3/4 默认补空映射，不修改 Core schema 或已读存储。

显式标记未读只设置 reminder；标记已读清除 reminder 并覆盖操作时已知回复，后续新增回复仍可未读。
展示未读为 manualUnread 或 `latestCompletionGlobalSequence > max(lastSeenGlobalSequence, readThroughGlobalSequence)`。
显式成功打开完整会话可清除 reminder，失败、缓存预览或自动刷新不清除。
这些动作不调用 `navigation.campViewed` 冒充实际查看，也不能倒退 Core 水位。

## Notifications and recovery

`navigation.invalidated { reason, scope: 'camp' | 'group' | 'all', campId?, groupKeys? }` 在提交后发出。

- camp：已读、改名、Lead/成员或运行状态变化，只刷新目标行，保留成员位置与总数。
- group：发布用户消息、增删/激活或分组成员变化，重读相关组当前完整前缀与总数。删除在物理移除前取得所属组并随通知发送，不保存删除补齐记录。移动时包含新旧组。
- all/未知范围：首次建立基础、断连漏通知/无法确认完整性、Core 重启、用户主动刷新时重读摘要完整快照。

一个刷新协调器合并范围；完整范围覆盖局部，组与 Camp ID 去重，最多一个刷新批次在途，保留 trailing 与退避。
窗口变更、已读回执和 dispose 的迟到响应不得覆盖较新状态。客户端不回放事件重建状态。
单行响应按该 Camp 已应用的读取水位判断新旧；其他 Camp 抬高的快照全局水位不能使该行被丢弃。
同水位的旧已读状态不得覆盖新回执；接受局部响应也不能让快照全局水位回退。
不提供持久化分组版本、变化日志、保留期或通用增量同步。现有聚焦/前台 20 秒完整性兜底继续读取摘要；
正常在线变化不依赖兜底。使命有独立失效提示；Skill 候选仅在用户使用选择器时读取。
