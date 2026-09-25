---
document_type: version-decisions
version: v1.69
authority: decision-rationale
lifecycle: historical
last_updated: 2026-09-24
---

# v1.69 版本决定

<a id="v1-69-d01"></a>
## V1.69-D01：主动查询与撤回资格分别由读取和 claim 决定

- 状态：accepted
- 日期：2026-09-24
- 当前权威：Camp History v10、公共历史不变量与 Public Camp Message/Delivery 架构

### 背景

v1.68 已将新公开 Run 的历史改为按需读取，但沿用旧过滤：recallable 消息和本队员 waiting Delivery 不能由 `camp.read` 或搜索取得。队员因此可能看不到刚发布的公屏消息；人类撤回后有时间线占位，Agent 再次读取却只能得到错误或跳过该序号。

### 选择

显式 `camp.read`、`camp.search` 和 `history.search` 可在各自发布边界内返回 claim 前原文。主动查询不改变 Delivery 或撤回资格；首个目标 claim 仍是撤回边界。撤回后搜索不返回原文，`camp.read` 只在原 sequence 返回英文无内容状态项。`RUN_INPUT`、冻结历史提示和 quote-source 继续保持原有隔离。

### 后果

- claim 前主动查询可能已把原文交给 Agent；撤回不追溯改写既有工具结果，后续读取才返回当前撤回状态。
- 显式查询与冻结输入使用不同的可见性策略；维护者必须分别验证 publication、tombstone、冻结搜索边界和 quote-source 重验。
- 撤回状态占一个 read 分页名额，但不成为可搜索正文，也不重建已清除的线程关联。

### 未选择方案

- **继续隐藏到 claim**：不能满足同一 Run 主动读取最新已发布公屏消息的目标。
- **首次 read/search 即关闭撤回资格**：改变用户已确认的 claim 前可撤回规则，且把只读查询变成业务状态转换。
- **把原文加入冻结 `RUN_INPUT`**：会改变本次输入和 Delivery 接受边界；主动查询已能满足按需查看需求。
