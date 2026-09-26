---
document_type: architecture
architecture: desktop-navigation-refresh
authority: desktop-navigation-invalidation-and-refresh-boundaries
status: accepted
last_updated: 2026-09-27
---

# Desktop Navigation Refresh 架构

本架构规定侧栏的单会话、单分组、完整快照读取与刷新边界。Core 拥有状态、排序、计数；Main-owned
Navigation Preferences 拥有本机项目顺序和显示名称。字段见 [Navigation Read v1](../contracts/navigation-read-v1.md)。

## Component authority

| Component | Responsibility |
| --- | --- |
| Core Navigation Read Model | 从 camp 摘要与现有业务表读取；目标行按 ID、分组按索引前缀；同一事务取得窗口与总数 |
| Core mutation boundary | 事件序号确定后，同事务维护所属 Camp 的活动/完成摘要；提交后发带 scope 的失效提示 |
| Electron Main | 原样转发，不组装业务状态；schema 4 私有原子 JSON 保存 projectOrder/projectNames |
| Renderer window reader + refresh coordinator | 一处合并行/组/完整范围，串行执行、trailing、退避与窗口旧响应保护 |
| Foreground safety refresh | 保留前台约 20 秒与聚焦完整性兜底，从摘要取完整快照；隐藏时停止 |
| Overview loader | 首次建立完整导航与其他页面基础；普通 Camp 切换不调用 Overview |

## Post-commit invalidation flow

```text
业务事务提交（业务事实 + camp 摘要）
  -> navigation.invalidated { scope, campId?, groupKeys? }
  -> 唯一协调器合并范围
  -> Core 返回目标行 / 相关组完整窗口 / 摘要完整快照
  -> Renderer 应用权威读取结果
```

通知不携带可直接拼装的标题、marker 或排序。状态变化读行；人类消息发布、创建、删除、激活等成员/排序
变化读组。删除在物理移除前取得原组，通知带回该组；不新增删除补齐表。普通 `camps.enter` 只读时不失效，
确需 Lead reconciliation 时才更新对应行。已读确认返回同事务权威行；无变化不写、不通知。

事件与摘要依赖同一个 SQLite 事务。先提交后通知，不因提交后的文件清理失败丢掉失效提示。
未知范围、漏通知或失去可信基础时允许恢复完整快照，但所有正常读取都禁止聚合历史事件。
使命自己的变化使用 `missions.invalidated`，已知使命 Camp 的 Run 变化更新使命列表；普通 Camp 事件不带起
使命读取。技能目录在用户首次使用选择器时加载，不随 Camp 切换预扫描。

## Coordinator semantics

复用现有 80ms debounce、单在途、requested/completed generation、共享 drain Promise、trailing 与
1/2/5/10 秒退避。window reader 仅额外保留待更新 ID/组的集合和完整刷新标志；不保存变化日志或回放历史。
完整范围覆盖局部；同组多事件去重。读取失败保留范围，恢复后重试；隐藏时保留意图，不启动后台重试。
已读回执、窗口范围变化和 dispose 保护迟到响应；查询返回不承诺浏览器已经 paint。

普通 A → B：正式提交 B 内容，绘制后验证 B 行；有新完成内容且不越过已展示水位时确认已读并应用权威行。
不重新读取 A/其他分组、不重排侧栏、不读使命或技能目录。后台 C 完成仍独立更新 C。

## Visible Camp windows

### Camp ordering

仅 `camp_message.sent` / `camp_message.public_a2a_sent` 中 author_type 为 user/external_principal 的已发布消息
推进活动时间/序号。队员/A2A、系统、Run/Turn 状态、查看和改名不推进。无发布活动时使用 camp.created_at、
序号 0；按时间降序、序号降序、ID 升序。完成序号独立维护，loading 仍从现有活跃 Run 读取，已读复用
camp_view_state。Sidecar 已保存项目顺序不受消息排序影响。

### Snapshot prefixes

默认每组 5 条，查看更多增加 10；Core 在 SQL 中限定目标组和 LIMIT，返回该组完整前 N 条与准确总数。
不先加载所有 NavigationCampItem 再在内存分组截断。完整快照跨组的查询只取得目录/计数元数据。
置顶会话按 ID 批量取得，不遍历分页。完整恢复同时核对窗口外的置顶项；普通切换只读目标 ID。

行变化只替换该行，不能从缺失行猜测组成员或总数；组变化整体替换对应窗口，包含第六条补位、窗口外新活动
进入前五条。多组窗口各自记住请求数量，不能把新前五条与旧尾部拼接。收起立即生效；展开必须重新取得完整
窗口。旧范围返回/失败不覆盖较新范围，失败保留上次成功数量。

## Storage migration

Migration 175 接受经核验的 v1.70/schema 124，升级到 schema 125，新增持久化表为 0。

| 对象 | 迁移 |
| --- | --- |
| camp.navigation_activity_sequence | INTEGER NOT NULL DEFAULT 0，非负 |
| camp.navigation_activity_at | TEXT NULL，无活动回退 camp.created_at |
| camp.navigation_completion_sequence | INTEGER NOT NULL DEFAULT 0，非负 |
| camp_view_state | 复用，不新增已读存储 |
| camp_navigation_window_idx | 分组表达式、活动时间 DESC、序号 DESC、ID，排除删除中的 Camp |
| agent_run_navigation_active_idx | queued/running/waiting 的 camp_id |
| agent_run_navigation_legacy_active_idx | camp_id 为空的活跃 Run 的 camp_turn_id |
| camp_navigation_event_insert / sequence | 处理显式序号插入和自动序号分配，只维护目标 Camp；和事件一起回滚 |

迁移事务内按原 publication/terminal 规则进行一次回填；既有 camp_view_state、消息/事件字节和排序规则保留。
新数据在写入时更新三项摘要；正常一行、一组及完整快照不访问 event_log。不引入持久化组状态、删除记录、
保留期或通用增量同步；不另造数据库调度层，先移除无关刷新与昂贵读取。

## Sidecar Project order synchronization

`navigation.json` schema 4 的 `projectOrder: string[] | null` 只保存 canonical
`directory:<projectPath>` key。合法 schema 2 以 `null` 读取而不被视为损坏；`null` 与空数组不同，前者表示尚未
首次冻结，后者表示已经在空列表上完成冻结。第一次同步按 Core 当前 Project 数组顺序写入所有未被本机移除的
Project。后续每次同步执行同一确定性规则：

1. 从旧顺序删除本次列表中已不存在的 key；
2. 保留其余 key 的原相对顺序；
3. 把本次列表中尚未保存的 key 按发现顺序追加到末尾。

相同结果不写文件。Project 的消息、Run、时间或未读变化不会改变 key 集合，因此不能移动 Project；Core 仍在每个
Project 内按 `lastActivityAt`、global sequence 和 Camp ID 排列 Camp。刚选择但尚未形成 Core Project 的空目录由
Renderer 作为新项追加到当前列表尾部；形成 Camp 后再进入相同同步规则。

Project 本机移除会同时清理其顺序 key；重新选择或恢复后，它作为新发现项追加。偏好同步由与 pin/移除/恢复相同的
Main 串行队列保护，Renderer 用 generation 忽略迟到返回。同步失败可以显示本机保存错误，但已经提交的 Core
Navigation Snapshot 和协调器 generation 不回滚、不停止后续失效刷新。

## Local Project display names

`projectNames: Record<string, string>` 使用既有 canonical `directory:<projectPath>` key 保存本机显示名称。
合法 schema 2/3 在内存升级时补空映射，不因升级产生损坏提示，也不在读取时重写旧文件。schema 1 继续沿用
已有恢复规则。后续成功写入输出 schema 4；名称与置顶、移除、恢复、顺序共用 Main 串行队列和原子文件写入。
写入失败保留旧快照；返回完整快照只发生在成功保存后。

Main-owned `navigationPreferences.setProjectName(targetKey, name)` 接受字符串或 `null`；字符串去除首尾空白、
合并连续空白，非空且最多 80 个 Unicode scalar；`null` 删除覆盖、恢复目录名。名称可重复，同名不同路径独立保存。
移除项目、顺序同步中的暂时消失、无 Camp 的空目录均不删除名称；重新选择相同目录后恢复该名称。

Renderer 在 Core 原始 Navigation Snapshot 之外建立名称展示投影，并在加入当前空目录后再次应用覆盖。
侧栏/置顶、顶部、搜索、新建对话和定时任务项目选择共用该投影；Workspace inspection 返回的目录名称不会覆盖
已保存的显示名称。重命名不调用 Core mutation、Workspace inspection 或 Runtime；不修改项目路径、Camp ID、
消息、队员、记忆、Native Session、执行状态、活动时间或排序。渠道项目目录仍由既有 Core 投影拥有，本机别名不进入
模型上下文或渠道配置。旧 Overview 名称读取通过改名 generation 隔离；顺序和置顶写入的返回不更新名称状态。

## Failure and lifecycle boundaries

一次读取失败时，当前共享 Promise reject，completed generation 不前进，失效意图保留。后台重试使用
`1s -> 2s -> 5s -> 10s` 上限退避；普通事件和安全轮询只合并 generation，不绕过在途退避。窗口 focus 或用户
显式重试可以取消等待并立即尝试；一次成功的 quiet-point drain 重置退避。

App 隐藏时取消 debounce、周期 timer 和后台 retry timer，但保留 requested generation；已经在途的读取可以完成，
隐藏后新增的 trailing generation 等到重新可见。重新可见会恢复保留意图，重新聚焦立即刷新。20 秒刷新只修复
极少数丢失事件，不承担正常终态收敛，也不依赖 Overview 的全局 `ready | error` 状态。

Navigation 拥有独立 loading/ready/error 状态。Members、Runtime Installation、Memory Review 或 Navigation
preference 失败可以报告自己的错误，但不能停止 Navigation retry、事件刷新或安全轮询。Core restart 后的
`runtime.state = ready` 通过同一协调器立即恢复。

## Acceptance

- 多个 Camp 同时终态只形成一个在途刷新批次与必要的 trailing read；
- Migration 前后 table 名称集合完全相同；正常导航读取在禁止访问 event_log 时仍成功；
- 普通切换的请求记录中没有全侧栏、其他组、使命列表或技能扫描；
- 后台 Camp 终态无需打开该 Camp 或重载 Renderer 即可清除侧栏 spinner；
- trailing 失败 reject 当前调用者且自动按上限退避恢复，不形成热循环或 unhandled rejection；
- App 隐藏时不做周期 Navigation Snapshot，focus 后立即收敛；
- 即使失效事件丢失，前台 20 秒安全刷新仍能纠正；
- 用户消息导致 Camp 移出前五条后不会恢复旧 spinner；第六条在未展示时变化，展开后立即显示最新状态；
- 桌面和渠道用户消息推进 Camp 顺序；队员消息、A2A、终态和草稿编辑不重排，完成未读仍正常出现与清除；
- 已展开窗口的状态/已读/标题按行更新；删除和排序按组整体替换；收起再展开不复用旧业务对象；
- 多组并发展开、旧范围响应晚到、收起与展开交错、展开失败重试都保持最后确认的展示范围；
- Overview 附属模块失败不禁用侧栏刷新；
- Core 通知只在权威 mutation 已提交后发生。
- schema 2 第一次进入时冻结旧显示顺序，合法升级不产生偏好损坏提示；
- 老 Project 的消息活动不改顺序，新 Project 追加，消失或本机移除的 Project 清理；
- Sidecar Project 稳定顺序不改变 Project 内 Camp 最近活动、时间、marker 或未读更新。
- 改名后刷新与重启保留，独立路径互不覆盖，保存失败可重试；目录和 Camp/Runtime 身份不变。

## References

- [Core Snapshot 与 API 边界](foundational-invariants.md#core-read-side)
- [产品与导航不变量](foundational-invariants.md#product-navigation)
- [Camp Open Read Path](camp-open-read-path.md)
- [App Shell 与统一侧栏](../ui/components/app-shell-navigation.md)
