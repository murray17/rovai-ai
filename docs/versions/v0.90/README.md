---
document_type: version-overview
version: v0.90
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-16
---

# Rovai-ai v0.90：Gather 当前代最后结果与自包含 Completion

> 当前状态：设计、Core、Migration、Context、CLI/Skill 教学、合同与自动回归门禁均已完成。
>
> 前置版本：[v0.89 持久 Gather Barrier 与统一 Completion Delivery](../v0.89/README.md)

## 版本目标

收口 v0.89 Gather 在满员预算、进度消息、retry generation 和 durable continuation 上的四个正确性缺口：
保留普通 CampTurn A2A 安全上限，为不会物化 Run 的 captured return 建立独立限额；每个 Item 只把当前
generation 最后一条显式回传作为结果；Completion mandatory input 同时携带完整原请求。

## 交付范围

- 普通 Gather forward 继续消耗 frozen accepted-A2A 与 Run responsibility；`gather_captured` 改为 `0/0`，
  每个 dispatch Delivery、current target Run、retry generation 独立最多接受 16 条；
- 成员可公开发送进度，但最后一条被接受的当前代 return 是唯一 captured result；Context/CLI 教学明确最后
  一次 `rovai send` / `@Lead` 必须包含完整结论；
- Barrier 加载 `activeRetryGeneration` 与 current `targetAgentRunId`，旧 generation 结果保留审计但不进入当前
  Completion Input；
- Gather Completion Input 升级 v2，新增 schemaVersion、完整 `request={messageId,body,contentDigest}` 和每项
  activeRetryGeneration，capturedMessages 最多一项；
- Barrier input 上限从 48 KiB 调整为 512 KiB，覆盖 32 KiB request 与 16 个 fallback 的最坏 JSON escape；
  Completion complete-context 上限为 640 KiB，普通 Context 上限不变；
- Formatter v16 / ContextManifest Evidence v14 增加 member result protocol notice、request evidence 与当前代
  Item refs；Formatter v14/v15 和 Gather input v1 保持 exact recovery；
- Migration 88 将 Data Contract 更新为 v0.90 / projection schema 43，并保留 v14/v15 manifest；
- `rovai gather --help`、Session Charter 与 `skills/cli-operations/**` 同步最后结果和独立限额教学；
  `skills/campfire/**` 不修改。

## 明确不做

- 不移除、不提高普通 CampTurn accepted-A2A 或 AgentRun responsibility 上限；
- 不把 terminal final output 与显式 captured result 同时交给 Lead，也不自动判断哪段自然语言“更最终”；
- 不删除旧 generation 的 CampMessage、Delivery、Run 或 audit evidence；
- 不修改 Gather 的共享 body、Default Lead gate、Barrier/Completion FIFO、取消/转交或 UI 范围；
- 不升级 Built-in Tool Transport capability：命令、wire、Envelope、receipt、CLI mapping 与错误 code 集合不变。

## 验收边界

- 一个 16-member Gather 的 16 次结果回传不增加普通 accepted-A2A ledger，第 17 次同 Item/current generation
  capture 被原子拒绝；
- progress + final 只投影最后一条，zero-capture 仍使用 bounded terminal fallback；
- generation 0 的公开结果在 retry generation 1 后不进入 frozen completion，generation 1 结果唯一可见；
- Completion Current Input 即使 public history 被省略仍包含完整请求正文、digest、所有 Item 与当前结果；
- v0.89/schema-42 数据无损迁移；已冻结 input v1 / Formatter v15 continuation 可恢复；
- Rust、TypeScript、schema catalog、文档治理、strict Clippy 与 Desktop build 门禁通过后推送 `main`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.89 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.90。 |
| ADR | 已更新 | [ADR-0195](decisions.md#adr-0195)冻结 generation-scoped last-result/独立限额；[ADR-0196](decisions.md#adr-0196)冻结完整请求输入。 |
| Contracts | 已更新 | 切换 Gather v2、Camp Message Send v9、Message Delivery v4、ContextManifest Evidence v14 与 completion schema v2；Transport v13 wire 确认不变。 |
| Architecture | 已更新 | 持久 Gather Barrier、Public A2A Delivery 与 Built-in Tool Runtime 组合新的预算、结果和 Context 权威。 |
| UI | 确认无需更新 | 公开消息与现有 Delivery/Run 判别联合不变；本版本不新增 Renderer surface 或交互。 |
| Runtime Activity | 确认无需更新 | canonical activity vocabulary、start/terminal mapping 与 evidence source 不变。 |
| Runtime compatibility | 确认无需更新 | Transport capability、命令数、wire 与 Runtime 启动/调用协议保持 v13；无需重做 Runtime 准入结论。 |
| Documentation routing | 已更新 | 文档导航、ADR CURRENT、Contract/Architecture/schema 索引切换到 v0.90 current 入口。 |
| Root README | 确认无需更新 | 项目定位、常青能力和公开支持范围未变化。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Gather v2](../../contracts/gather-v2.md)
- [持久 Gather Barrier 架构](../../architecture/durable-gather-barrier.md)
