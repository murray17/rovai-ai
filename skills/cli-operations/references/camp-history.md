# Camp 与 History：选择读取范围

根据问题需要的范围选择最窄读取：

- 列出可见 Camp 或取得 Camp ID：`rovai camp list --help`
- 在一个明确 Camp 内搜索消息：`rovai camp search --help`
- 已有稳定 message ID，或需要 item、around、thread、timeline 视图：`rovai camp read --help`
- 不知道消息属于哪个 Camp，需要跨 Camp 搜索：`rovai history search --help`

`rovai send` 隐式使用当前 authenticated AgentRun Camp；读取操作只在自己的精确 help 明示时接受或省略
Camp 范围。不要把 Send 的隐式 Camp 规则推广到其他 operation。

优先 stable-ID exact read 验证具体消息。搜索结果用于发现，不应替代 exact item 的权威字段；需要确认
Agent recipients 或 Current User Mention 时，读取 exact item 的 `addressing`。

跨 Camp 搜索只用于用户确实需要更宽历史范围时。不要为了确认一次 mutation 的 outcome，用正文、作者、
时间或近似搜索猜测 invocation identity；这种情况遵循 [Recovery](recovery.md)。
