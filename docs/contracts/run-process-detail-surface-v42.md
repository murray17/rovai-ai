---
document_type: protocol-contract
contract: run-process-detail-surface-v42
authority: execution-evidence-lifecycle-and-persisted-tool-output
status: accepted
version: 42
source_version: v1.66
last_updated: 2026-09-25
---

# Run Process Detail Surface v42

继承 [v41](run-process-detail-surface-v41.md) 的三位置执行台、operation 单记录生命周期、独立
`changeSequence`、输入/结果分离 Blob、content-free thinking phase 与历史兼容读取。本版只改变新进入 Core 的
普通 Tool 结果文本：Runtime 实际交给 Agent 的结果不变，Rovai 的持久化与展示副本执行永久 7,680 UTF-8 字节上限。

## 统一持久化投影

Adapter/Core 必须先完成协议归一、operation 分类和结构化文件事实提取，再构造唯一 `PersistableResult`。只有该投影
可以进入 SQLite、Managed Blob、Execution Evidence 实时事件、详情读取与日志；被舍弃的普通输出后缀不得进入另一
Blob、Envelope、投影别名、日志或恢复接口。
为保持 Built-in CLI carrier 的精确展示关联，可以保存由既有 Agent-facing 投影计算的不可逆 digest；该 digest 不是第二份
结果正文，不能用于恢复已舍弃后缀。历史记录继续使用其既有完整结果比较路径。

普通输出只按以下优先级选择一个主来源：

1. 已归一化的 `aggregatedOutput`；选择后不得再拼接 `stdout/stderr`；
2. `output` 或协议明确的等价 result；字符串原样使用，typed text block 按数组顺序连接；
3. `stdout` 后接 `stderr`；
4. 其他 typed `content[].text`，保持数组顺序；
5. 只有前述来源均不存在时才使用 `summary`。

显式空字符串是有效结果，不触发低优先级回退。没有独立获准结构化用途的 object/array 使用确定性紧凑 JSON。主输出
之后可以接 `error`、`error.message` 与 stack；分隔符也计入同一个 7,680 字节预算。所有文本取不超过预算的最长合法
UTF-8 前缀，不拆分字符，不追加伪造的省略后缀；外层 Evidence JSON 始终保持有效。

输入、operation 身份、phase/outcome、退出码、错误码、时间、来源、公开命令、附件/图片引用以及已准入
`runtimeDiff`、`runtimeRunDiff`、before/after、file operation 和 Files Changed 事实不占普通输出预算，也不能从截断
文本重新推断。`resultByteCount` 表示实际持久化 result JSON 字节数，不表示截断前总量。

## 封闭更新状态

普通输出更新在规范化边界被标成且只能标成以下三态；归约器不得根据字段存在、字符串长度或看似 terminal 的 phase
自行猜测：

- `CompleteSnapshot`：按既有 identity、revision 与乱序规则接受后替换已保存文本，并由该快照重新计算
  `outputTruncated`；
- `OrderedDelta`：只有协议能证明同一 operation 和连续顺序时，才向剩余预算追加；预算耗尽后不再改变文本，只更新
  截断标记和其他事实；
- `MetadataOnly`：不得改变已保存文本或 `outputTruncated`。

互斥终态冲突继续保留先前已接受的文本与标记并把 outcome 保持为 `unsettled`。迟到 started、interruption 补齐和其他
纯元数据更新都不能清除已确认的截断事实。

## Built-in CLI 载体在单记录生命周期中的关联

本条修正继承自 v34 的 Shell 起止序号严格包围 Core 操作条件。v41 起 Shell started/completed 合为一条
Evidence，Shell 只有一个展示序号，无法形成包围区间；它可能先于或晚于 Core 调用落库。
这类单记录 Shell 只在同一 AgentRun、同一 execution epoch、同一 CLI operation、Core 和 Shell
各只有一个展示序号且两个序号紧邻时，才可使用既有 Agent-facing 结果 digest 的精确相等和
唯一匹配来折叠展示。旧多记录 Shell 仍使用严格包围条件和完整结果／digest 的既有比较。混合命令、
失败、结果不同、重复或不确定的匹配保持独立。跨页窗口可保存这个已验证的关联标记；Renderer 仍须确认
Shell 是纯 CLI 命令。该关联只影响展示，不更改 Evidence、Canonical 身份或持久化结果。

## Wire、历史与界面

Execution Evidence 新增可缺省 `outputTruncated`：`false` 表示该次完整快照已全部保存，`true` 表示至少一个普通输出
字节被永久舍弃，字段缺失/`null` 表示历史 unknown。它不复用 Blob/preview 的 `isTruncated` 或
`_rovaiContent.complete`，反序列化历史行时也不得默认为 `false`。

详情仍在用户展开精确 Tool 后按需读取，但只能读到已保存结果。`outputTruncated=true` 时 Renderer 在结果下显示：
“结果过长，部分内容已省略。”，并不得承诺或提供“读取完整结果”的恢复路径。结构化 diff、Files Changed、
输入和附件仍按各自合同读取。

Migration 170 只新增 nullable `output_truncated`，不回填、重写或清理历史 Evidence。历史缺失值继续按旧合同读取；本版
不增加存储系统、临时全文 spool 或新的 Blob owner。

## 验收

- 在普通输出第 7,680 字节之后放置唯一标记；SQLite、Managed Blob、实时事件、日志及详情读取中均找不到该标记；
- 同一次结果中的完整结构化 diff 与 Files Changed 仍可读取；
- ASCII、中文与 emoji 边界均不产生无效 UTF-8，显式空字符串不回退，错误文本共享同一预算；
- `CompleteSnapshot | OrderedDelta | MetadataOnly` 分别覆盖替换并重算、连续追加到剩余预算、文本/标记完全保持；
- 历史行的 `outputTruncated` 保持缺失，`isTruncated` 继续只表达 inline/Blob/preview 读取语义。
