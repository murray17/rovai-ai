---
document_type: contract
contract: run-process-detail-surface-v25
authority: runtime-activity-shell-and-web-detail-layout
status: accepted
source_version: v1.29
last_updated: 2026-08-29
---

# Run Process Detail Surface v25（Shell 与 Web 搜索详情连续呈现）

本合同完整继承 [Run Process Detail Surface v24](run-process-detail-surface-v24.md) 的 `activity-v2` 分类、Renderer
中文标题、七类图标、Rovai Catalog identity、typed Search Operation、Tool 分组、两级 disclosure 与惰性全文
读取。v25 只收敛 Shell command 和 Web 搜索的展开详情文本：第一行标明实际操作，公开结果从下一行连续显示，
不再使用分区标签或空白分隔行。它不改变 Evidence 准入、脱敏、query allowlist、operation identity、状态或
lifecycle。

## 1. Shell command 详情

拥有公开 command 的 Shell Activity 必须按以下结构生成详情：

1. 第一行是固定 presentation marker `$ `，紧接完整、已规范化且已脱敏的 command；`$` 不属于 Runtime
   command，也不得参与 identity、恢复或审计；
2. 存在非空公开 output 时，紧接一个换行并从第二行开始显示完整 output，不插入“命令”“输出”或空白分隔行；
3. output 自身的后续换行和末尾换行保持不变；不存在 output 时，详情只包含第一行 command。

规范示例：

```text
$ rovai app trial run --help
Usage: rovai app trial run --agent-id <id> --workspace <directory> --task-file <file> [--name <name>] [--timeout 30m] [--wait | --no-wait] [--export <directory>] [--open] [--json]  The Desktop App must already be running.
```

## 2. Web 搜索详情

v24 的 typed query 双门槛保持不变。只有 available `runtimeSearchOperation` 与 Canonical
`tool.web.search` 同时成立时，Renderer 才生成搜索首行：

1. 第一行固定为 `搜索 <query>`；多项 query 继续按 v24 的原始顺序使用中文逗号连接；“搜索”是
   presentation marker，不进入 Evidence，也不改变 query bytes；
2. 存在非空公开结果时，紧接一个换行并从第二行开始显示结果，不插入“搜索词”“结果”或空白分隔行；
3. 没有公开结果，或公开 input 与同一 query 完全相同时，只显示第一行，不能重复 query；
4. 缺失或不合格 typed projection 时，不生成 `搜索 ` 首行，继续诚实显示已有公开结果或空态。

规范示例：

```text
搜索 Codex command view
找到 3 条结果
```

## 3. Disclosure 与辅助技术

两类详情继续复用当前等宽、`white-space: pre-wrap`、有最大高度且可聚焦的 `role=region` 结果面；长结果继续
在内部滚动，惰性 Managed Blob 读取、loading、retry、焦点、键盘和底部/Inspector DOM 移动行为保持不变。
presentation marker 与实际 command/query 位于同一文本节点，不增加装饰性 DOM、复制按钮或 standalone raw
Evidence surface。

## 4. 验收

- Shell command 为 `pnpm test`、output 为 `tests passed` 时，详情精确为 `$ pnpm test\ntests passed`；
- Shell command 为 `true` 且没有 output 时，详情精确为 `$ true`；
- typed Web query 为 `Rovai AI`、结果为 `找到 3 条结果` 时，详情精确为
  `搜索 Rovai AI\n找到 3 条结果`；
- 多项 Web query 以中文逗号连接在同一 `搜索 ` 首行；没有结果时只显示该首行；
- Codex commandExecution/webSearch、Claude Bash/WebSearch、ACP execute/web_search 与完整 Evidence 恢复路径
  共用相应格式化函数；
- 既有脱敏、ANSI 清理、typed query fail-closed、七类图标、Tool 分组、结果惰性读取和内部滚动回归继续通过。

## References

- [Run Process Detail Surface v24](run-process-detail-surface-v24.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
