# Recovery：按业务指令恢复

把 CLI 的 `error.recovery` 当作下一步分类，不要仅凭错误文案猜测或盲目重试：

- `fix_input`：查看目标 operation 的精确 `--help`，修正闭合输入；不要尝试未声明字段。
- `refresh_then_decide`：重新读取权威对象，比较当前状态，再决定是否提交一项新的 mutation。
- `retry_same_request`：只按返回指示，用同一 request identity 做有界重试。
- `stop`：停止该操作并准确报告未提交。
- `confirm_outcome`：先判断返回是否包含可验证本次结果的权威 locator。

## `confirm_outcome`

有权威 CampMessage locator 时，查看 `rovai camp read --help`，用 stable message ID 做 exact item read，
再根据权威状态决定后续动作。成功 Send 只证明消息与冻结效果已提交；缺少下游完成不能反推 Send 失败。

没有 locator 时，公开说明 outcome 不确定并停止该 mutation。不得按正文、作者、时间或相似内容搜索，
不得猜测 request identity，也不得换 request identity 重发。近似命中既不能证明成功，也不能证明失败。

恢复之后仍要分别验证后续业务目标；CLI success 不证明测试、评审、交付或用户意图已经满足。
