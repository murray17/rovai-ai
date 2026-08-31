---
document_type: protocol-contract
contract: feishu-channel-v3
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 3
last_updated: 2026-08-30
---

# Feishu Channel v3 Contract

本合同继承 [Feishu Channel v2](feishu-channel-v2.md) 的账号、发布、Owner、项目、admission、roster、Outbox、
`terminal_pending/terminal_sealed` 和分页授权语义，存储继续遵循 [Channel Storage v2](channel-storage-v2.md)。
只替换 v2 第 7 节中“终态一律平铺、没有查看/收起入口”及正文参与飞书执行过程分页的呈现规则。
没有新增 Core 命令、持久视图状态、Migration 或模型上下文变化。

## 1. 终态默认收起执行过程

运行中继续直接展示公开执行进度。`succeeded | failed | cancelled` 的首次终态投递与原卡更新必须同时满足：

- Header 保留真实队员和终态，稳定用时直接可见；失败不能因收起过程而变成成功。
- narration、plan、diagnostic、command 与所属 file changes 放入一个 Card JSON 2.0 原生 `collapsible_panel`，
  初始 `expanded=false`，标题为“查看执行过程”，并显示可翻转的标准箭头。
- 点击标题在飞书客户端展开/收起当前页，不依赖 Rovai 回调，不创建 delivery，不修改 Core 状态。
- 展开后仍按原始时序逐项呈现；不合并 command、不增加工具组折叠或“已执行 N 项”摘要。
- `publicOutput` 留在折叠面板外，每页都可见；与它完全相同的 narration 不再作为隐藏副本显示。
- 没有过程、只有正文时不提供空的展开入口；两者都为空时诚实显示“没有可展示的执行记录。”。

折叠只是已经发送的公开内容的呈现方式，不是新的权限边界。原有安全过滤继续执行：不得把原始 command payload、
stdin/stdout/stderr、aggregated output、tool input/output、完整 patch、凭据或推理文本放入面板；命令只使用 shared
presentation 已脱敏的 `publicCommand`，结构化文件变化保持原语义。

## 2. 展开后的分页

飞书只对执行过程分页，分页按钮位于折叠面板内。每页最多 20 条 command；文本预算约 10,000 字符，先预留面板外
正文的空间，再按过程语义 block 分页。沿用 v2 的不可拆分 block 规则，不拆开 command 与其 file changes 或 Markdown
code block；单个超预算 block 不因此被截断。

`execution_console_page` 的 action 字段、Owner/App/message/sealed sequence 授权、边界校验和单次 `updateCard` 不变。
初始 upsert 不指定页码，面板默认收起；已授权的显式翻页渲染指定页并设 `expanded=true`，包括返回第 1 页。
因此翻页不会把正在查看的过程重新收起，也不会重新触发执行或产生另一张卡。

Host 提交的 page count 与飞书实际过程分页使用同一生成逻辑；不把正文误算为额外的空过程页。共享的纯文本
`executionConsolePublicPage` 保留原来包含正文的时序投影，钉钉 AI 卡片/Markdown 不因本次飞书容器调整而改变。

## 3. 状态与兼容边界

终态仍由 Core 的 quiet window 封口，普通 materialization 不更新已 sealed 卡。客户端的展开/收起不重新启用旧的
`display_mode/page_index/view_version`，不恢复 `execution_console_expand/collapse` 命令、nonce 或持久 view state。
下一轮的 recall 和永久 Agent Markdown/附件投递完全不变。

旧的已发送 sealed 卡不会在启动时被批量改写。本次生成规则用于新投递、待重试投递和合法分页更新；既有历史、账号、
Bot、项目与 Camp 不迁移、不清理。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [飞书官方 Card JSON 2.0 折叠面板](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/collapsible-panel)
- [v1.36 实施计划](../versions/v1.36/implementation-plan.md)
