# Camp 与 History：选择读取范围

根据问题需要的范围选择最窄读取：

- 列出可见 Camp 或取得 Camp ID：`rovai camp list --help`
- 在当前 Camp 内搜索消息：`rovai camp search --query "amount"`
- 在一个已知、可访问的历史 Camp 内搜索消息：
  `rovai camp search --camp-id "<camp-id>" --query "amount"`
- 已有稳定 message ID，或需要 item、around、thread、timeline 视图：`rovai camp read --help`
- 不知道消息属于哪个 Camp，需要跨 Camp 搜索：`rovai history search --help`

`camp.search` 和 `camp.read` 都只解析一个 Camp target：省略 `--camp-id` 时是当前 Camp，显式传入时是
当前 AgentRun 冻结 Manifest 中仍有实时访问权的那个历史 Camp。显式传入当前 Camp ID 与省略完全等价；
不会因为省略而搜索全部历史 Camp，也不会仅凭 `messageId` 跨 Camp 反查。

标准调用链：

```text
目标 Camp 未知
  → rovai history search --query "amount"
  → 取得 campId + messageId
  → rovai camp read --camp-id "<camp-id>" --mode item --message-id "<message-id>"

目标 Camp 已知
  → rovai camp search --camp-id "<camp-id>" --query "amount"
  → 取得 messageId
  → rovai camp read --camp-id "<camp-id>" --mode item --message-id "<message-id>"
```

读取当前 Camp 时可省略范围：

```bash
rovai camp read --mode item --message-id "<message-id>"
```

`rovai send` 仍然隐式使用当前 authenticated AgentRun Camp；它不接受 Agent 提供 `campId`。

优先 stable-ID exact read 验证具体消息。搜索结果用于发现，不应替代 exact item 的权威字段；需要确认
Agent recipients 或 Current User Mention 时，读取 exact item 的 `addressing`。

跨 Camp 搜索只用于用户确实需要更宽历史范围时。不要为了确认一次 mutation 的 outcome，用正文、作者、
时间或近似搜索猜测 invocation identity；这种情况遵循 [Recovery](recovery.md)。
