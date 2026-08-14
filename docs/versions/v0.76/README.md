---
document_type: version-overview
version: v0.76
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-14
---

# Rovai-ai v0.76：显示名 Inline Alias 行首寻址门禁

> 当前状态：位置语法与长期边界已冻结；Core、help、合同和回归已经完成。
>
> 前置版本：[v0.75 显示名 Inline Alias、Review Duo 与 Memory 正确性收口](../v0.75/README.md)
>
> 后续版本：[v0.77 持久消息回复链与显式接收者修复](../v0.77/README.md)

## 版本目标

把 v0.75 的显示名 alias 从“正文任意可解析位置”收紧为显式寻址行，避免普通 prose 中讨论某位成员时
意外创建 Delivery。例如：

```text
让 Bob 分析一下 @Alice 提出的迁移方案
```

即使 `Alice` 是当前 Camp 有效成员，也保持普通文本。显式路由改写为：

```text
@Alice 请分析这个迁移方案
```

或在长正文末尾使用专门的最后一行：

```text
迁移背景与约束……

@Alice 请分析这个迁移方案
```

## 交付范围

### 行首位置门禁

- display-name alias 的 `@` 必须是正文第一行或任意后续逻辑行的第一个非空白 token；空格、Tab 与
  CRLF 的 `\r` 可作为行首缩进；
- 推荐把 trailing routing 写在最后一个非空行，且该行仍必须以 alias 作为第一个非空白 token；
- 行内 prose、Markdown list/quote 前缀后的 alias 和最后一行中已有普通文字之后的 alias 都不寻址；
- 完整显示名之后仍只接受 Unicode whitespace 或正文结束；代码区、URL、转义、标点、歧义、最长匹配
  与 active/current-Camp eligibility 规则不变；
- canonical `@agent_N` 与 `--to agent_N` 保持 v0.75 语义，不受显示名 presentation-alias 位置门禁影响。

### Canonical freeze 与教学

- 通过位置门禁的 alias 继续在同一事务内转换为 canonical Agent ID，再复用 Structured Mention、校验、
  去重、Delivery、幂等与 compact output；
- `rovai send --help`、schema description 与 smoke 明确“first non-whitespace token on a line”，并推荐专门的
  final routing line；
- `effectiveRecipients=[]` 继续是 public-only 的权威后置条件。

## 非目标与冻结边界

- 不解析普通句子中的 display-name mention，即使它位于最后一个逻辑行；
- 不新增 Markdown list/quote 特例、标点边界、昵称、模糊或大小写折叠；
- 不改变 canonical `@agent_N`、`--to`、Current User Attention、Message Delivery、数据库或 Renderer；
- 不修改 Built-in Tool Transport v10 的 wire/Envelope/command version；help/schema 变化只进入 catalog digest；
- 不合入 message reply chain、Memory、Review Duo、品牌或其它并行范围。

## 发布门槛

1. parser tests 证明正文开头、缩进行首和专门的最后寻址行可解析；
2. 单行/最后一行 prose 中的 mid-line alias、Markdown prefix、代码、URL 与转义不解析；
3. canonical inline token 保持任意既有可解析位置；
4. 集成测试证明 mid-line display alias 创建零 Delivery，行首 alias 仍创建一条 canonical Delivery；
5. Camp Message Send v7、ADR-0184、Architecture、CURRENT、Contract 与 Version 路由一致；
6. 定向/完整 Core tests、Rust format、script syntax、文档治理和 diff 检查通过后方可标记 complete。

## 验收证据

- `cargo test -p rovai-core`：433 个 library tests、11 个 CLI tests、73 个 Core binary tests 通过，
  3 个需要真实 Runtime 的手工 smoke tests 按既有配置 ignored；
- `pnpm docs:test`：21 个文档治理 tests 通过；
- `pnpm docs:check`、以当前 `origin/main` SHA 为 `DOCS_BASE_REF` 的 `pnpm docs:check:ci` 与
  `pnpm docs:adr:generate -- --check` 通过；
- `cargo fmt --all -- --check`、`node --check scripts/smoke-builtin-cli.mjs` 与 `git diff --check` 通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v0.75](../v0.75/README.md)按 complete 事实冻结为 historical；v0.76 成为唯一 current，并新增本概览与[实施计划](implementation-plan.md) |
| ADR | 已更新 | 新增 [ADR-0184](../../adr/0184-line-leading-display-name-inline-addressing-alias.md)，局部收窄 ADR-0182 的 alias position |
| Contracts | 已更新 | 新增 [Camp Message Send v7](../../contracts/camp-message-send-v7.md)，v6 转为 historical current-entry；closed input、result、Delivery 与 wire 不变 |
| Architecture | 已更新 | [Public A2A Message 与 Message Delivery](../../architecture/public-a2a-message-delivery.md)和[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)增加 line-leading alias ownership |
| UI | 确认无需更新 | Renderer 继续只消费 canonical Structured Mention，不新增 composer 或视觉合同 |
| Runtime Activity | 确认无需更新 | 位置门禁不新增 provider event、activity domain、semantic kind 或 evidence shape |
| Runtime compatibility | 确认无需更新 | Transport v10 capability 与 command version不变，本版本不声称新的真实 Runtime 实测结论 |
| Documentation routing | 已更新 | 文档导航、CURRENT、ADR/Contract/Architecture/Version 索引切换到 v0.76、ADR-0184 与 Camp Message Send v7 |
| Root README | 确认无需更新 | 项目定位、常青能力和 Runtime 支持范围不变；根 README 不记录 parser 局部规则 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0184: Line-Leading Display-Name Inline Addressing Alias](../../adr/0184-line-leading-display-name-inline-addressing-alias.md)
- [Camp Message Send v7](../../contracts/camp-message-send-v7.md)
- [Built-in Tool Transport v10](../../contracts/builtin-tool-transport-v10.md)
- [Public A2A Message 与 Message Delivery architecture](../../architecture/public-a2a-message-delivery.md)
