---
document_type: model-context-change
version: v1.72
change_id: message-literal-search
revision: 2
confirmed_revision: 2
confirmation_status: confirmed
confirmed_by: User
confirmed_at: 2026-11-19T14:05:15Z
authority: confirmed-model-input-change-statement
implementation_baseline: 0be46674519e6f0e3aabb63c42dcb104cf5b2f55
implementation_status: implemented
last_updated: 2026-11-19
---

# 消息搜索工具说明 R2

## 变更前

两个工具均要求单个 `query: string`。Schema 只给出查询的类型和长度，CLI 帮助只显示必填字符串。
`thread.search.limit`、`history.search.limit` 的 Schema 上限分别为 20、30，帮助只显示整数。
`history.search.dateFrom` 和 `dateTo` 的 Schema 格式为 `date-time`，帮助只显示字符串。
`history.search` 主描述首句为 `Discover messages across public historical Threads when the target Thread is unknown.`。

正文查询按词长进入不同的候选路径。旧窗口之外有符合条件的消息时，搜索可能返回零条且标记扫描未完成。

## 变更后

| 位置 | 实际英文 | 依据 |
| --- | --- | --- |
| 两个工具的 `query` | `Case-insensitive literal substring.` | 说明连续原文可匹配。已核查记录中没有足以确认空格分词误用的案例。 |
| `history.search` 主描述首句 | `Search public messages in other Threads.` | 同一轮 8 次尝试通过公屏搜索核实私聊内容。 |
| `thread.search.limit`、`history.search.limit` | `Maximum 20.`、`Maximum 30.` | 39 次调用超过上限。 |
| `history.search.dateFrom`、`history.search.dateTo` | `Inclusive RFC 3339 timestamp.`、`Exclusive RFC 3339 timestamp.` | 8 次调用只填日期。两句分别说明开始和结束端点。 |

Agent 工具目录和两个命令的帮助使用同一份字段说明。既有示例已给出 `--query`。
例如，`调度` 命中“任务调度器”，`调度 归档` 要求正文含这段连续文本。`调杜` 不命中“任务调度器”。
完整扫描许可范围后再裁剪结果，排序使用可见正文、引用和结构化提及。端点、排序和标志见[公开历史合同](../../contracts/camp-history-v17.md)。

## 明确不变

启动及每轮固定提示词新增 0 字。Bootstrap、Formatter、Manifest、投递及证据版本沿用原版本。
请求仍使用原工具名、字段及可选规则。省略 `threadId` 搜当前公屏，`history.search` 按冻结边界读取其他公屏。
返回沿用 `results`、`truncated`、`searchIncomplete` 和稳定消息 ID。旧的工具结果和已冻结的模型输入仍可按原记录读取。
导航里的用户级搜索属于后续阶段。

## 二次确认

Thread `rvcamp_01m7sqtt2rea8rkkrcmh1mga8p` 的 sequence 6 提交了精简的 Markdown 对照，sequence 8 澄清了连续原文和错字的检索行为。
User 在 sequence 9 明确回复“那你开始实现”，消息 ID 为 `b1acf4ae-616e-426d-9501-02eed5322067`。确认时间取消息的 UTC 时间，精确到秒。

## 验证

- 本机保留的历史证据共 278 次去重搜索。260 次可判定，其中 56 次确认误用。另有 4 次疑似、14 次证据不足。逐条结果未记录安装版本。
- Migration 228 接续主线消息编辑迁移 227，将 schema 177 升至 178。迁移原子删除消息索引和三个触发器，保留正文、引用、提及和其他索引。默认升级不运行 `VACUUM`。迁移回滚与重启、旧正文、新正文及删除后的搜索验收归属见[测试指南](../../development/testing.md#消息正文搜索与索引迁移)。
- 隔离库含 50,000 条历史公屏消息。在扫描第一批时并发发送，两个查询各重复三次。持有共享写库锁的候选耗时 789–1,058 毫秒，改用单独只读快照后耗时 7.57–9.25 毫秒。在整合主线编辑与删除后的代码上重建同一组样本，发送耗时 7.78–9.32 毫秒，完整扫描耗时 0.82–1.17 秒。
- CLI 根帮助及其列出的 21 个操作共 22 份输出中，两份搜索帮助有变化。以两版实际帮助为输入，同一模型在两个独立会话回答同一组合成题，预先确定 9 项答案。原帮助可确定 1 项，其余回答未知，新帮助 9 项均答对。该检查只测读懂帮助，正式的产品通用任务双轨评测属于 PR 验收。
- 已整合主线代码通过默认 Rust workspace（484 项通过、1 项按项目设置忽略）、搜索与迁移专项、旧 v37 迁移、RunCard 迁移、数据库准入、CLI 构建与文档门禁。
