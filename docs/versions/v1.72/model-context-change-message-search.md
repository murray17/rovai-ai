---
document_type: model-context-change
version: v1.72
change_id: message-literal-search
revision: 3
confirmed_revision: 3
confirmation_status: confirmed
confirmed_by: User
confirmed_at: 2026-11-19T15:19:36Z
authority: confirmed-model-input-change-statement
implementation_baseline: 9d1a9c6de62b1ae6f926cbd550245120ebb58f99
implementation_status: implemented
last_updated: 2026-11-19
---

# 消息搜索工具说明 R3

## 变更前

两个工具均要求单个 `query: string`。Schema 只给出查询的类型和长度，CLI 帮助只显示必填字符串。
`thread.search.limit`、`history.search.limit` 的 Schema 上限分别为 20、30，帮助只显示整数。
`history.search.dateFrom` 和 `dateTo` 的 Schema 格式为 `date-time`，帮助只显示字符串。
`history.search` 主描述首句为 `Discover messages across public historical Threads when the target Thread is unknown.`。

主线正文查询按词长进入不同的候选路径。旧窗口之外有符合条件的消息时，搜索可能返回零条且标记扫描未完成。
R2 已执行完整扫描，成功仍返回必填的 `searchIncomplete: false`。完整零命中结果为
`{"results":[],"truncated":false,"searchIncomplete":false}`。R2 原样匹配查询两端的空白。

## 变更后

| 位置 | 实际英文 | 依据 |
| --- | --- | --- |
| 两个工具的 `query` | `Case-insensitive literal substring.` | 说明连续原文可匹配。已核查记录中没有足以确认空格分词误用的案例。 |
| `history.search` 主描述首句 | `Search public messages in other Threads.` | 同一轮 8 次尝试通过公屏搜索核实私聊内容。 |
| `thread.search.limit`、`history.search.limit` | `Maximum 20.`、`Maximum 30.` | 39 次调用超过上限。 |
| `history.search.dateFrom`、`history.search.dateTo` | `Inclusive RFC 3339 timestamp.`、`Exclusive RFC 3339 timestamp.` | 8 次调用只填日期。两句分别说明开始和结束端点。 |

Agent 工具目录和两个命令的帮助使用同一份字段说明。既有示例已给出 `--query`。
例如，`调度` 命中“任务调度器”，`调度 归档` 要求正文含这段连续文本。`调杜` 不命中“任务调度器”。
R3 先去掉查询两端空白。`" 调度 "` 命中“任务调度器”，全空白输入仍报错。许可范围内的扫描完成后，才按排序和预算返回成功。
当前两个工具的成功结果顶层均为封闭对象，仅要求 `results` 数组和 `truncated` 布尔值；每项字段沿用 R2。
零命中为 `{"results":[],"truncated":false}`。数量或响应预算裁剪时 `truncated=true`，扫描失败走工具错误。
内置工具的 Agent Output 从 15 升至 16，配套的 Built-in Tool Transport 与 CLI Command 从 45 升至 46。
端点、排序和字段见[公开历史合同](../../contracts/camp-history-v18.md)。

## 明确不变

启动及每轮固定提示词新增 0 字。Native Session Bootstrap、AgentRun Formatter、ContextManifest、上下文投递配置（Context Delivery Profile）及输入投递证据均沿用原版本。
请求仍使用原工具名、字段及可选规则。省略 `threadId` 搜当前公屏，`history.search` 按冻结边界读取其他公屏。
稳定消息 ID 与结果项字段沿用 R2。工具 IPC 协议和 Envelope 分别沿用 v3 和 v2。
原有回执及冻结投递按原样读取，包括历史 `searchIncomplete:true`、空结果数组和两种发送者字段格式。现有库中保存的输出无须改写。
导航里的用户级搜索属于后续阶段。

## 二次确认

Thread `rvcamp_01m7sqtt2rea8rkkrcmh1mga8p` 的 sequence 6 提交了精简的 Markdown 对照，sequence 8 澄清了连续原文和错字的检索行为。
User 在 sequence 9 明确回复“那你开始实现”，消息 ID 为 `b1acf4ae-616e-426d-9501-02eed5322067`。确认时间取消息的 UTC 时间，精确到秒。
sequence 13 提交了 R3 的逐字段对照。User 在 sequence 14 回复“一确认”，确认删除新结果与 Schema 中的 `searchIncomplete`。
消息 ID 为 `db4dbba7-97df-4eeb-b2f9-5f1a0c0f52aa`。关于本机数据库副本的提问单独处理。

## 验证

- 本机保留的历史证据共 278 次去重搜索。260 次可判定，其中 56 次确认误用。另有 4 次疑似、14 次证据不足。逐条结果未记录安装版本。
- 主线 227、228 分别处理消息编辑与投递索引。搜索迁移 229 将 schema 178 升至 179，原子删除消息索引和三个触发器，保留正文、引用、提及和其他索引。默认升级不运行 `VACUUM`。迁移回滚与重启、旧正文、新正文及删除后的搜索验收归属见[测试指南](../../development/testing.md#消息正文搜索与索引迁移)。
- 隔离库含 50,000 条历史公屏消息。在扫描第一批时并发发送，两个查询各重复三次。持有共享写库锁的候选耗时 789–1,058 毫秒，改用单独只读快照后耗时 7.57–9.25 毫秒。在整合主线编辑与删除后的代码上重建同一组样本，发送耗时 7.78–9.32 毫秒，完整扫描耗时 0.82–1.17 秒。
- CLI 根帮助及其列出的 21 个操作共 22 份输出中，两份搜索帮助有变化。以两版实际帮助为输入，同一模型在两个独立会话回答同一组合成题，预先确定 9 项答案。原帮助可确定 1 项，其余回答未知，新帮助 9 项均答对。该检查只测读懂帮助，正式的产品通用任务双轨评测属于 PR 验收。
- 已整合主线代码通过默认 Rust workspace（484 项通过、1 项按项目设置忽略）、搜索与迁移专项、旧 v37 迁移、RunCard 迁移、数据库准入、CLI 构建与文档门禁。
- R3 再次通过默认 workspace（484 项通过、1 项忽略），并通过搜索、迁移、当前会话续做、封闭输出 Schema、CLI 投影与执行证据专项。
  用候选 CLI 和隔离的 IPC 响应样本验证两个搜索命令均可交付新零命中、读取旧的零命中且扫描未完成回执，并拒绝类型非法的旧标志。
- 正式数据库准入和升级入口已验证两条路径。真实 schema 176 的隔离副本通过两个协调步骤、原有 116 检查、主线 227、228 和搜索 229；主线 `9d1a9c6de` 实际初始化的 schema 178 库仅追加 229。两者均连续重开两次，消息正文与引用摘要一致，SQLite 完整性和外键检查通过。
- 在另一份升级至 schema 179 的本机副本上，用候选 CLI 各执行一次零命中搜索。`history.search` 实际扫描 12,035 条，省略 `threadId` 的 `thread.search` 扫描 18 条，均返回 `{"results":[],"truncated":false}`。21 条已撤回消息和 1 条缺少跨会话公开发布事件的消息在这两次调用的可见范围以外。对库内全部 12,075 条消息另行执行同一严格解析、校验和可见正文渲染，失败 0 条。
