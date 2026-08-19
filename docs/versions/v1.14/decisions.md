---
document_type: version-decisions
version: v1.14
lifecycle: current
last_updated: 2026-08-19
---

# v1.14 决策记录

本文件只解释 v1.14 的重要取舍；当前字段与行为规范由 Architecture 和 Contracts 直接拥有。

<a id="v1-14-d01"></a>

## V1.14-D01：安全 Timeline 默认与显式消息锚点模式

### 背景

canonical `camp.read` 使用 `item | around | thread | timeline` 四种模式。要求每次浏览最近消息都重复
`--mode timeline --direction before --limit 20`，让高频只读路径过于机械；但根据 `messageId`、`before` 等
字段猜测模式，会在 item/around/thread 三种真实意图之间制造不可见且不稳定的选择。

CLI 还支持 direct flags、stdin/heredoc 与 input file。若只在某个 parser 分支添加默认，或直接放宽 Core
Schema，会让输入来源、Agent CLI 与其他 Core caller 产生不同 canonical 合同。

### 决定

把省略 `camp.read.mode` 唯一解释为 Timeline，并只在 bundled CLI 的统一对象边界补全
`mode=timeline`、`direction=before`、`limit=20`。补全发生在三种互斥输入源完成解析之后、canonical catalog
Schema 校验之前；显式值覆盖相应默认，cursor 不设默认。

任何 message-anchored 字段都不推断 item/around/thread。省略 mode 与 Timeline 不接受的字段组合返回定向
`fix_input`，要求调用者显式选模式。Core Schema 继续要求 canonical mode 和相应 direction；Core 收到的仍是
完整输入，不拥有或重演 CLI shorthand。

### 后果

- bare `rovai camp read` 与显式 Camp target 都稳定读取最新 20 条可见消息；
- `--direction after` 可以从最早页开始，分页仍要求复用同 mode/direction 的 `nextCursor`；
- direct/stdin/input-file 在校验、错误和传给 Core 的 JSON 上一致；
- catalog/help/Skill 可以如实教学 CLI optional/default，而 Core Schema requiredness 保持严格；
- Transport v17 与 Camp History v4 为新的 CLI/catalog digest 建立兼容 fence；
- Session Charter、Formatter、Manifest、授权、receipt 与 replay 字节均不改变。

### 被拒绝方案

- 保持 mode/direction 每次必填：安全但保留高频机械负担，不能解决裸 read 失败；
- 根据 `messageId` 或模式专属字段自动选择 item/around/thread：存在真实歧义，会把调用错误静默变成错误读取；
- 放宽或默认化 Core canonical Schema：把运输便利扩散为所有 caller 的隐式领域语义，削弱 Core 边界；
- 仅为 direct flags 添加默认：会使 stdin 和 input file 产生不一致行为；
- 把命令默认写入 Session Charter：会增加稳定模型上下文字节和 Session rotation 成本，而 exact help、catalog
  与按需 Skill 已能拥有命令级教学。

### 当前权威影响

- [Camp History Retrieval v4](../../contracts/camp-history-v4.md)
- [Built-in Tool Transport v17](../../contracts/builtin-tool-transport-v17.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Built-in 运输不变量](../../architecture/foundational-invariants.md#skills-builtin-transport)
- [History 与寻址不变量](../../architecture/foundational-invariants.md#collaboration-history-addressing)
