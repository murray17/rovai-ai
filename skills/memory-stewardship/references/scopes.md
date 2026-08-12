# Scopes、Kind 与方向

多个 Scope 看似合理时，选择能完整表达含义的最小 Scope。

## Hearth

Hearth 保存所有同行者都应理解的共享偏好、原则或经验，允许 `preference`、`agreement`、`lesson`。
队员不能直接写 Hearth；使用 `rovai memory propose-hearth` 提交建议。成功 receipt 只证明 pending
proposal 存在，只有用户采纳后才成为有效 Memory。

判断问题：这件事是否应该让用户的所有队员都知道？

## Companion

Companion 保存用户与当前队员之间的稳定协作理解，允许 `preference`、`agreement`、`lesson`。使用
`rovai memory write`；当前队员只能写自己的 Companion 范围。

判断问题：这件事是否只需要我以后与用户协作时记住？

## Relationship

Relationship 保存当前队员与当前 Camp 中另一位在场队员之间的协作约定或经验，只允许
`agreement`、`lesson`，不允许 `preference`。

方向：

- `mutual`：双方都应遵循。
- `directed`：当前队员对 counterparty 承担未来责任，方向始终是
  `当前队员 → counterparty`。

不能替另一位队员写下其对当前队员的责任。判断问题：这件事是否只影响我与某位队员今后的协作方式？

修订不能改变既有 Memory 的 Scope、Kind、counterparty 或 Relationship direction；这些字段组成身份，
若候选含义要求不同身份，应重新判断是否需要独立 Memory，而不是用 revise 偷换范围。
