---
document_type: version-overview
version: v1.06
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-18
---

# Rovai-ai v1.06：统一 Camp History Target 与 Public A2A 可见性

> 当前状态：ADR、合同、Core/CLI 实现、定向/全量 Core 回归与文档治理门禁已经按
> [实施计划](implementation-plan.md)完成。
>
> 前置版本：[v1.05 Windows x64 平台闭环](../v1.05/README.md)
>
> 后续版本：[v1.07 A2A Public-only 与 Principal 投影提案](../v1.07/README.md)

## 版本目标

把 Camp 历史检索收敛为清晰的三段职责：`camp.search` 搜索一个当前或明确历史 Camp，`camp.read`
读取同一个解析后 Camp，`history.search` 继续承担目标未知时的多 Camp 发现。同时修复 Public A2A 在
跨 Camp 历史路径中的可见性、`camp.read item` 附件输出 Schema 漂移，以及 Core 成功后 CLI 投影失败被
误报为通用错误的问题。

v1.05 在 Windows 产品代码、打包与真实 Runtime 资格尚未实施时冻结为 historical/in_progress；v1.06
不继承或声称完成这些 Windows 交付。Built-in Transport v14 仍是已接受但尚未完成实施的独立平台设计。

## 交付范围

- `camp.search.campId` 与四种 `camp.read.campId` 统一为 optional；省略和显式当前 Camp 等价；
- 共用 `CampTarget` 解析当前 sequence boundary 或 Manifest 冻结历史 global boundary；
- 历史 Camp 必须同时满足 snapshot 与实时 active/no-leave/present authorization；格式错误先返回
  `camp.invalid_argument`，有效但不可用的搜索目标统一返回 `camp.search_unavailable`；
- 历史单 Camp 搜索复用候选/FTS/reference/reprojection/ranking 能力，但保持 `camp.search` 最大 20 条和无
  `campTitle` 的既有输出；
- 所有历史 message visibility 通过一个 Public Camp message publication seam 同时接受 ordinary send 与
  Public A2A，并按每条消息最早 global sequence 去重和 fence；
- `camp.read item.attachments[]` 的闭合 Schema 必填 `kind` 与 `fileCount`，集合模式仍只返回
  `attachmentCount`；
- Core Envelope 已成功但 Agent projection/schema 失败时，CLI 返回稳定
  `builtin_tool.output_contract_mismatch / stop`，完整错误只写受管本地 diagnostic；
- exact help、tool descriptions、CLI teaching、golden output 与 Built-in CLI smoke fixture 同步标准调用链。

## 明确不做

- 不让省略 `campId` 的 `camp.search` 自动搜索全部历史 Camp；
- 不删除、改名或收窄 `history.search` 的 `campIds[]`、日期和多 Camp 聚合；
- 不按 `messageId` 全局反查 Camp 或把 locator 当授权；
- 不放宽 Manifest、current/global boundary 或 live membership；
- 不迁移、改写或回填 Event Log，不把 private Delivery/Runtime 日志加入公共历史；
- 不把附件本地路径或内容暴露给 Agent；
- 不以本版完成状态暗示 v1.05 Windows 范围已经实现。

## 验收边界

- 当前 Camp 省略/显式 ID 搜索等价，read 省略 ID 返回真实当前 Camp；
- 历史单 Camp 搜索命中、空成功、无 `campTitle`、最大限制与不可用错误均稳定；
- Public A2A 可被 history/camp search、item/around/thread/timeline 和 root/parent 追溯读取，重复 publication
  不重复消息，Manifest boundary 之后仍不可见；
- 撤销 membership/profile 后 search/read fail closed，`history.search` 继续使用既有静默过滤；
- 附件 canonical result 与 Agent output golden 同时包含 `kind/fileCount` 且不含 `storagePath`；
- 投影漂移返回安全非重试错误，本地 private diagnostic 保留完整 error chain，
  `builtin_tool.outcome_indeterminate` 不变；
- Rust、CLI help、smoke script syntax、格式化与文档治理门禁通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.05 以 Windows 实施未完成状态冻结为 historical；本概览、计划和版本索引建立唯一 current v1.06。 |
| ADR | 已更新 | ADR-0215 冻结 shared single-Camp target 与统一 Public Camp message publication boundary，并局部覆盖 ADR-0108 两项旧条款。 |
| Contracts | 已更新 | Camp History Retrieval v1 冻结输入/输出/权限/附件语义；Built-in Tool Agent Output Projection v1 冻结投影失败错误与本地诊断。 |
| Architecture | 已更新 | Built-in Tool Runtime、Public A2A Message Delivery 与 Architecture 索引组合 target resolver、publication seam 和 safe projection failure。 |
| UI | 确认无需更新 | 本版不改变 Renderer 字段、交互、布局或视觉合同；Public A2A 仍显示为既有 CampMessage。 |
| Runtime Activity | 确认无需更新 | publication event 的历史读取归一化不改变 Canonical Runtime Activity mapping 或 evidence classifier。 |
| Runtime compatibility | 确认无需更新 | 十个 Runtime 的实测版本、能力和平台资格结论均未改变。 |
| Documentation routing | 已更新 | 顶层任务导航、ADR CURRENT/HISTORY、Contract/Architecture 索引与 `cli-operations` Camp History reference 指向新权威。 |
| Root README | 确认无需更新 | 这是既有内置 Camp 历史能力的契约修正，不改变项目定位或常青支持范围。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0215](../../adr/0215-unified-single-camp-history-target-and-publication-boundary.md)
- [Camp History Retrieval v1](../../contracts/camp-history-v1.md)
- [Built-in Tool Agent Output Projection v1](../../contracts/builtin-tool-agent-output-projection-v1.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Public A2A Message 与 Message Delivery](../../architecture/public-a2a-message-delivery.md)
