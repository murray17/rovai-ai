---
document_type: version-overview
version: v1.26
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-08-22
---

# Rovai-ai v1.26：Cursor Agent Catalog 接入与保守平台准入

> 后续版本：[v1.27 Kimi Code + MiniMax M3 本地 Runtime 接入](../v1.27/README.md)。

> 完成状态：Cursor Agent 的 closed identity、Adapter、Migration、ACP launch、保守权限、private extension
> router、Skill delivery target、Runtime Activity、planned shutdown 与 Renderer projection 已实现。隔离探测只
> 通过 initialize，authenticate 超时且没有 authenticated Session；因此三个目标平台都保持
> `not_qualified`，不对用户开放检查、配置或执行。
>
> 前置版本：[v1.25 Codex 最终 Camp 答案发布指导](../v1.25/README.md)按冻结时事实转为 historical；其中
> 未完成的多次真实 Codex 行为观察没有被本版本冒充完成。

## 版本目标

把 Cursor Agent 作为第十一种 Product Runtime identity 安全接入 Rovai 的 closed catalog，同时严格执行
[Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)：实现存在不等于平台通过，
initialize 成功也不等于 Runtime Ready。当前交付允许产品和数据合同认识 Cursor，但在完整行为 Smoke 前不
启动它。

## 交付范围

- 新增稳定 `AdapterKind = cursor-agent`、`SkillDeliveryGroupKey = cursor`、Migration 104 与 Data Contract
  `v1.18 / projection schema 59`；
- canonical executable 为 `cursor-agent`；兼容别名 `agent` 必须严格匹配 Cursor build identity，拒绝本机
  Grok Build 同名程序；
- 复用 ACP v1 Host，启动 `<resolved-executable> acp`，initialize 后有界执行
  `authenticate(cursor_login)`，再建立 Session；
- 实现 Cursor ask/plan private request 的唯一 Prompt 路由与 safe skip/reject，隔离 todo/task/image
  notifications，未知 Cursor request 返回 Method not found；
- 提供 runtime-default model、静态 execution/approval 配置与 read-only 收窄；External MCP、History Restore、
  Missing-Send、Usage、Compaction 和 warm Host reuse 保持关闭；
- 项目 `.cursor/skills` 进入 Rovai managed projection，但上游加载/调用只有 DocumentationOnly，不作为准入证据；
- Runtime 设置、Onboarding、成员配置、侧栏与监控加入 Cursor 官方图标和 identity；macOS 未准入显示
  “当前平台尚未验证”，不误写成 Windows 状态；
- macOS arm64、macOS x64、Windows x64 均保持
  `not_qualified / runtime_platform.qualification_evidence_missing`。

## 明确不做

- 不运行 `agent login`，不改写用户 Cursor 凭据、配置、MCP 或 Skill；
- 不把临时下载的 Cursor CLI 安装到 PATH，也不替换本机 Grok Build `agent`；
- 不声称 authenticated Session、模型目录、Tool output、Approval、cancel、resume/load、MCP、Built-in CLI、
  Missing-Send、Usage 或 Compaction 已通过；
- 不因 Catalog row 存在而绕过 Runtime Platform Admission；
- 不从官方文档或通用 ACP parser 反推当前 Cursor build 的行为资格。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.25 按未完成真实观察的事实冻结；本概览、计划、决定与版本索引建立唯一 current v1.26。 |
| Decisions | 已更新 | [V1.26-D01](decisions.md#v1-26-d01)记录 canonical command 防碰撞与 Catalog/平台准入分离的高成本取舍。 |
| Contracts | 已更新 | [Runtime Launch and Verification v19](../../contracts/runtime-launch-and-verification-v19.md)定义 Cursor identity、ACP、配置收窄、禁用能力与未准入语义。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)扩展为十一种 identity，并记录 Cursor 当前边界。 |
| UI | 已更新 | Settings/Member surface brief 记录未准入 Cursor row、平台文案与 disabled selector 行为。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)加入 Cursor ACP v1 `run_level` baseline 与真实证据缺口。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录版本、同名碰撞、initialize/auth 结果与三个未准入平台。 |
| Documentation routing | 已更新 | 文档导航、合同索引与当前决定导航路由到 v19、本版本和 Cursor Research。 |
| Root README | 已更新 | 常青能力改为十一种 Product Runtime identity，并明确只有平台已准入 Runtime 才动态发现。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Cursor Agent Runtime Research](../../research/cursor-agent-runtime-research.md)
- [Agent Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
- [Runtime Launch and Verification v19](../../contracts/runtime-launch-and-verification-v19.md)
