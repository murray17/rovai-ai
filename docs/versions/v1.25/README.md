---
document_type: version-overview
version: v1.25
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-22
---

# Rovai-ai v1.25：Codex 最终 Camp 答案发布指导

> 当前状态：[模型上下文变更 revision 1](model-context-change-codex-final-camp-answer.md) 已由开发者二次确认，
> 可以严格按冻结文本、Codex-only compatibility rotation 与验证矩阵实施。
>
> 前置版本：[v1.24 Runtime Probe 完整边界与自动恢复](../v1.24/README.md)已按完成事实冻结为
> historical；其 Runtime Launch and Verification v18 与已安装结果继续作为本版基线。

## 版本目标

修复 Codex 稳定出现的双份最终输出质量差异：Agent 先用 `rovai send` 发布压缩的一段式摘要，随后才在
Runtime final 中输出结构更完整的 Markdown。仅向 Codex 的 evidence-backed Session Charter 增加一条最终
Camp 答案指导；过程、状态和中间结果仍可按现有规则多次发送。

## 提案范围

- Codex-only exact guidance：

  > When publishing the Camp-visible final answer with `rovai send`, use the complete final response in polished Markdown; do not send a compressed one-line summary and then write a richer Runtime final.

- 保持共享 [`charter-rovai-cli.md`](../../../crates/rovai-core/resources/charter-rovai-cli.md) bytes 不变，
  由 `ContextService` 在计算 Charter blob/digest 前仅为 `codex-cli` 追加上述指导；
- 新增 Codex-only Session Guidance revision 并只进入 Codex Native Binding compatibility digest；其他 Runtime
  的 Bootstrap bytes、Binding digest 与 Session 连续性不变；
- 正常 start/resume 与 resume 失败后的 replacement thread 继续传递同一份 Core-prepared Bootstrap，不在
  `main.rs` 另行拼接未取证 suffix；
- Bootstrap v3/Formatter 3、共享 Session Charter revision 2、Dynamic Formatter 21/Manifest 21/Profile v4、
  Built-in Tool Transport/CLI v20、Camp Message Send v12 与数据 Schema 保持不变。

## 明确不做

- 不禁止、合并或限制过程、状态、中间结果及 A2A `rovai send`；新句只约束 Camp-visible final answer；
- 不要求整个 AgentRun “compose once”，不把所有 CampMessage 与 Runtime narration/final 强制成同一正文；
- 不让 Host 自动发布 Runtime final，不新增 post-run equality validator、数据库关系或 Renderer 状态；
- 不修改共享 Charter resource，不向 Claude Code、OpenCode、Copilot、Kiro、TRAE、Antigravity 或其他 Runtime
  投递这条 Codex 专属指导；
- 不承诺概率模型在所有输入上确定性遵循指导；真实 AgentRun 只能作为行为观察，不能替代 exact bytes、digest
  与 Binding rotation 测试。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.24 按完成事实冻结；本概览、计划、模型上下文说明和版本索引建立唯一 current v1.25 proposal。 |
| Decisions | 确认无需更新 | Codex-only guidance、evidence-first 生成与 Binding rotation 直接落实既有 Session 不变量；替代方案和理由由本版模型上下文说明完整记录，不新增独立长期决定。 |
| Contracts | 确认无需更新 | 不改变 Camp Message Send v12、Built-in Tool Transport v20、Bootstrap/Formatter/Manifest/Profile wire 或业务语义。 |
| Architecture | 确认无需更新 | 现有 Bootstrap 不变量已经要求模型可见 bytes 先取证、既有 Session 不热改写、合同不兼容时 rotation；本版仅增加 Codex 条件化正文。 |
| UI | 确认无需更新 | Camp AgentMessage 已通过 SafeMarkdown 渲染；不修改 Renderer 结构、样式或交互。 |
| Runtime Activity | 确认无需更新 | 不增加 Evidence kind、Activity classifier 或执行台展示。 |
| Runtime compatibility | 确认无需更新 | 不改变支持 Runtime、实测版本、Probe 或平台准入；只轮换 Codex Native Binding compatibility。 |
| Documentation routing | 已更新 | 版本索引进入 v1.25；现有 Context/Built-in 路由继续指向拥有长期不变量的当前文档。 |
| Root README | 确认无需更新 | Codex 最终消息质量指导不改变项目定位、平台支持或安装入口。 |

## References

- [实施与验收计划](implementation-plan.md)
- [模型上下文变更 revision 1](model-context-change-codex-final-camp-answer.md)
- [核心模型上下文变更治理](../../development/model-context-change-governance.md)
- [Session 与 Bootstrap 不变量](../../architecture/foundational-invariants.md#context-session-bootstrap)
- [Camp Message Send v12](../../contracts/camp-message-send-v12.md)
