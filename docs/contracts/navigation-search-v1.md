---
document_type: contract
contract: navigation-search
version: v1
status: accepted
last_updated: 2026-11-20
---

# Navigation Search v1

认证的 Desktop 与 Web 界面使用两个只读请求搜索会话、使命及公开消息。两个请求独立于导航窗口读取，使用调用方的已验证客户端身份。查找不写已读状态。

## Requests and visibility

| 方法 | 封闭参数 | 范围 |
| --- | --- | --- |
| navigation.search | query，选填 hints | 标题、项目显示名、完整会话 ID、使命编号、描述和标签 |
| navigation.searchMessages | query，选填 cursor | 公开消息正文 |

query 去掉两端 Unicode 空白后最长 200 个 Unicode scalar。名称查询允许空值，返回最近活动的 12 个对象。正文查询至少两个 scalar，完整 Thread ID 走名称请求。完整 ID 使用现有 canonical Thread ID 校验与等值读取。

两个方法排除归档及删除中的对象。Active Thread 可见，Pending Thread 使用 [Navigation Read v1](navigation-read-v1.md) 的客户端草稿可见性。同一 Thread 有使命行时呈现为使命。只读搜索不读取单聊、附件、文件、记忆、工具输出或执行内部内容。

## Name matches

hints 包含可选的 groupKeys、channelKinds、threadIds 三个字符串数组，总数最多 200。项目目录键为 directory:<projectPath>，快速对话为 quick-chat。渠道以 provider:conversationKind 表示。客户端以当前界面语言判定项目名、渠道标签和已知的初次集结显示名，并在名称请求中传入这些提示。提示只参与匹配，可见性仍由 Core 判定。
`threadIds` 用于默认「初次集结」的本地化标题。Core 在同一名称快照中核对 Thread ID、保存的默认标题与无渠道绑定条件。

返回 schemaVersion 为 1，包含 throughGlobalSequence、规范化 query、items 和 truncated。每个 target 含 kind（thread 或 mission）、现有 NavigationThreadTarget、可空的 mission（missionId、number、status）、lastActivityAt 和可空的 match（field、snippet）。

非空查询按首个命中字段归类，顺序为 id、number、title、project、description、tag。使命编号支持数字本身、M 或 M- 前缀及 # 前缀，忽略大小写和前导零，有效数字至多九位。普通文本按 Unicode 码点转小写并匹配连续原文。只有描述、标签提供摘要。空输入的 match 为 null。

精确 ID 唯一，精确使命编号置顶。其他对象按会话用户活动时间降序、活动序号降序、Thread ID 升序排序。活动取 navigation_activity_at，缺失时取 created_at，只由 User 和外部成员公开发言推进。非空名称查询最多返回 50 条，余项使用 truncated 表示。

## Message pages

返回 schemaVersion 为 1，包含 throughGlobalSequence、规范化 query、items 和可空的 nextCursor。每项含 target（match 为 null）、message（id、sequence、authorType、authorId、authorName、createdAt）和 snippet。每页最多 20 个 Thread，每个 Thread 只取最新的一条命中。
authorName 和会话消息的 authorDisplayName 共用读模型的作者解析。队员资料保留的历史名称可用于署名。
没有可用名称时 authorName 为空字符串，界面显示对应作者类型的本地化标签。

按与普通名称匹配相同的活动顺序扫描含候选消息的对象，按 sequence 降序扫描每个对象的消息。正文候选为未墓碑的 User、Agent 或外部成员消息，使用 [会话内查找](camp-conversation-find-v1.md) 同一正文投影及匹配规则。撤回后的空正文无法命中。正文请求独立查找，Renderer 按实际在列表里展示的 Thread ID 去重。

摘要保留原文空白。从第一个命中前至多 16 个 scalar 开始，长度取 120 与包含完整首个命中所需长度的较大值。截断处加省略号。客户端基于原文求高亮范围，单行布局负责显示空白。

发现第 21 项时，游标续到该项。请求最多投影并匹配 5,000 条消息。扫描以 45ms 为协作式软预算，批次边界检查耗时，批次最多 128 条；首次推进一个批次后可提前返回。每个非末页游标都从尚未处理的位置继续。扫描完成时 nextCursor 为 null。

cursor 是 base64url 编码的不透明参数，绑定规范化 query。内部包含版本、query 的 SHA-256 前 8 字节、对象排序键及可空的排他消息序号上界。各页使用独立快照，期间发生的变更可能影响顺序及覆盖。客户端按 Thread ID 追加去重。

## Errors and scheduling

未知或非法参数返回 navigation.invalid_search_input。无效游标返回 navigation.invalid_search_cursor，客户端从第一页重查。读取失败可在界面重试。

名称与正文请求在主队列外的后台路径运行。正文扫描在独立单槽位串行执行，每个 Renderer 窗口单飞，跨弹窗开关生效。后台任务从 Core 已绑定的数据库路径取得只读连接。导航搜索与会话内查找共用至多四条闲置连接，每次读取使用独立事务，用完即释放快照。取得连接、建立快照和扫描均与写库锁分开。
