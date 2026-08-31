---
document_type: protocol-contract
contract: feishu-channel-v4
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 4
last_updated: 2026-08-30
---

# Feishu Channel v4 Contract

本合同继承 [Feishu Channel v3](feishu-channel-v3.md) 及其 v2 的账号、发布、Owner、项目、admission、roster、Outbox、
900ms quiet window 和无状态分页授权。存储秘密边界继续遵循 [Channel Storage v2](channel-storage-v2.md)。
本次替换终态外层折叠、仅过程分页及完全不展示 command 结果的规则，并使 terminal snapshot 的内容真正不可变。
不改变模型上下文、Bot 发布、钉钉卡片格式、永久 Markdown/附件和下一轮 root CampTurn 的撤回语义。

## 1. 两种呈现阶段

执行中继续发送普通 Card JSON 2.0，通过既有 `updateCard` 更新公开进度，不使用任何 `collapsible_panel`。
终态静默窗口结束后发送最终卡：Header 保留队员、真实终态与稳定用时，body 是真实顺序的完整 timeline：

```text
TextBlock -> CommandBlock -> CommandBlock -> TextBlock -> CommandBlock -> TextBlock
```

终态不再有外层“查看执行过程”分组，不把 narration 移到 command 列表之前，也不增加“已执行 N 项”摘要。
公开 Agent narration、plan/diagnostic 的已有安全呈现和最后的 `publicOutput` 组成 TextBlock；同内容公开 narration
与 `publicOutput` 去重。正文只在它所属的 timeline 位置出现，不在每页重复。

每个 TextBlock 使用一个 Markdown，最多前 10 行。不得先应用运行中 presentation 的尾部字符窗口而丢失原始开头；
超过行数时可在第 10 行内附截断提示，不另增第 11 行。TextBlock 和 CommandBlock 均不可拆页。

## 2. Command 的原生折叠与安全结果

每条 command 为独立 `collapsible_panel`，默认 `expanded=false`，包含翻转标准箭头。
标题沿用 shared execution presentation 的完整安全 `publicCommand` 和真实状态：保留 executable、flags、参数及路径，
不另提取命令名或翻译命令。`apply_patch` 使用明确的工具名，不把 patch payload 当命令标题。

展开后恰好一个 Markdown 代码结果框，不重复命令，不出现“指令／状态／输出”等二级标题。
结果内代码围栏必须转义，不能逃出该框。展开/收起仅由飞书客户端处理，没有 callback behavior、Core 命令或 Outbox。
翻页后每条 command 仍按初始关闭状态渲染，不维护跨页展开状态。

结果只提取明确的文本结果字段：例如 `aggregatedOutput`、文本 `output`、stdout/stderr 或 typed text content。
禁止使用混合 command/input/output 的 `ExecutionStep.detail`，禁止对整个工具 input/output envelope 作 JSON stringify。
未识别的结构化结果、原始 patch 和没有公开文本结果的操作在框内显示诚实的不可展示提示，不伪造成功或错误正文。
`apply_patch` 优先展示 canonical diff projection 的 `path +additions −deletions`，不展示 diff/patch body。

所有结果先做敏感值过滤，再选取行：排除 stdin、Secret/Token/Cookie/Authorization、密码、敏感环境变量值、完整工具
input/output JSON 和原始 patch。同 Run 所有已知敏感字段和值（包括稍后被截掉的中段）参与过滤，避免其在尾部被原样
回显。`rovai send` 和 `camp.message.send` 的结果不重复展示消息内容，真实 `--body` 继续隐藏。
推理事件从 Core source 排除，不因结果预览而公开。折叠不是安全边界，所有发往飞书的数据须在发送前完成过滤。

结果不超过 20 行时全部展示；超过时严格为：

```text
前 9 行
… 已截断 N 行 …
后 10 行
```

`N = 完整脱敏结果行数 − 19`，总计正好 20 行。例如 210 行显示 1–9、提示隐藏 191 行、201–210。

## 3. 整条 timeline 的分页预算

每页最多 15 个 CommandBlock、50 个 body Card elements。command panel 与其内部 Markdown 计为两个 elements；
用时、页码、按钮及其 column/column_set 容器也占预算。先触及任何预算即换页。
TextBlock 与紧接的第一条 CommandBlock 如能一起放进独立一页，就作为相邻单元分页；当前页只放得下文字时两者一起后移。
只有这一对本身超过独立一页预算时才分别放置，但不拆分任何 block。

同时以序列化后 UTF-8 JSON 28,000 bytes 为保守上限。普通安全命令不会因分页被缩成短命令；结果/文字中的极长单行
按 512 UTF-8 bytes 内截断并在同行标明。若单条 command 连结果仍过大，先保留完整命令并改为结果不可展示提示；
连完整命令本身也无法容纳时，该位置明确提示“超出飞书单卡大小限制，请在 Rovai 查看完整记录”，不悄悄改变命令。

单页没有翻页按钮；多页显示 `第 X / Y 页` 和有意义的上一页/下一页，第一页/末页不提供无效方向。
保留唯一 action：

```ts
{
  action: 'execution_console_page'
  agentRunId: string
  snapshotSequence: number
  pageIndex: number
}
```

## 4. 内容封存与无状态翻页

Core 保留 `agentRunId`、冻结 App/external message identity、`latestSequence` 和生命周期状态。
Run terminal 后先进入 `terminal_pending`；公开内容连续 900ms 不变后，在同一事务中：

1. 捕获 schema-1 terminal snapshot，冻结 Run identity/sequence、队员名、状态/时间、公开 evidence 及其 canonical
   activity/diff projection、公开正文；
2. 写入 `terminal_snapshot_json`，转为 `terminal_sealed`；
3. 只排一次最终 `execution_console_upsert`。

snapshot 一经写入不可清除、修改或推进 sequence。迟到 evidence、公开消息、profile 或 canonical 更新不再改变它；
后续普通 materialization 为 no-op。当前 App/external message 和 recall 生命周期仍由原 console row 拥有。

超出 inline 限制的 Evidence 在 snapshot 中固定内容寻址 Blob ID。Core 在读取飞书 sealed source 时通过 ManagedBlobStore
校验并恢复完整 payload，Main 再提取与脱敏；不得对本地 4,000 字符 preview 再取“尾 10 行”并冒充完整结果。
Blob 缺失、损坏或 snapshot 版本/identity 不匹配均 fail closed，不回退到当前 Evidence 或残缺 preview。
这些原始内容只留在已有 Core/Main 边界，不能进入 Renderer 渠道 DTO、日志、diagnostics 或外部 Card JSON。

翻页先调用 Host-only `channels.executionConsole.page.authorize`。Owner 只来自可信 callback operator envelope；
Core 先校验 Owner、target App、external message、`terminal_sealed` 和 exact sequence，未授权不读取完整结果 Blob。
授权成功后 Main 读取同一 sealed source，以本地渲染器计算的页数校验 pageIndex，渲染目标页，并对同一 external message
调用一次 `updateCard`。内部授权命令的 `pageCount` 为可选字段：飞书不传，钉钉仍可传已有的纯文本页数；外部 callback
不得提供可信 pageCount。Core 限制页码为非负整数且小于 10,000，Main 必须再校验真实页面范围。
不写 pageIndex/displayMode/viewVersion，不生成 nonce，不排 `execution_console_upsert`，不触发 delivery pump，
不同时在 callback response 内回传另一张更新卡。重复点击同页可再次成功，但每次只有一次 patch。

下一轮根 CampTurn admission 仍将上一轮的执行卡转入 recall；等待已有在途 upsert 结束后由原 App 撤回。
永久正文/附件、历史消息/Run 和项目绑定不受影响。

## 5. Migration 与兼容

Migration 125 将 `Data Contract v1.37 / projection schema 78` 升到 `v1.38 / schema 79`：

- 给 `channel_execution_console` 添加 `terminal_snapshot_json` 与不可变 trigger；
- 物理删除已经退出正常路径的 `display_mode/page_index/view_version`；
- 对旧 `terminal_sealed` 行在 copy-migration 事务内一次性冻结当时可读取的内容和 Blob reference。旧实现未保存封存时的
  完整内容，不能声称恢复了已丢失的历史封存视图；迁移不推进 sequence、不重发卡片、不改 App/message identity。

沿用现有 authority ticket、staging copy、验证与备份/切换路径，不修改日用数据来验收，不新建或删除远端应用。
旧 sealed 卡不会在启动时批量改写；新投递、待重试投递和合法翻页使用新呈现规则。
共享 Core console 获得内容封存，但钉钉 `executionConsolePublicPage` 的纯文本格式、20-operation/字符分页和禁用结果展示
仍保持原合同；飞书 15-command/50-element 预算不传播到钉钉。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [飞书官方 Card JSON 2.0 折叠面板](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/collapsible-panel)
- [飞书官方 Card JSON 2.0 Markdown](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/content-components/rich-text)
- [Desktop Runtime Availability v1](desktop-runtime-availability-v1.md)
- [v1.36 实施计划](../versions/v1.36/implementation-plan.md)
