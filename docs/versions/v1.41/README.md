---
document_type: version-overview
version: v1.41
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-04
---

# Rovai-ai v1.41：Sidecar Project 稳定顺序

前置：[v1.40](../v1.40/README.md)。本版本把 Sidecar 的 Project 层级顺序从消息活动排序改为
首次升级时冻结、之后只同步成员变化的本机偏好；Project 内部 Camp 仍按最近活动排序。

## 范围与当前状态

- Electron Main 将 `userData/navigation.json` 升级为 schema 3，新增
  `projectOrder: string[] | null`；元素是 canonical `directory:<projectPath>` key。
- 合法 schema 2 偏好以 `projectOrder = null` 读取且不误报损坏。Sidecar 第一次同时取得 Project
  列表与偏好时，按升级前 Core Snapshot 的当前显示顺序原子写入可见 Project key。
- 后续 Navigation Snapshot 只同步成员：仍存在的 key 保持原相对顺序，新 key 按本次发现顺序追加，
  不再存在或已从本机侧栏移除的 key 清理。相同成员集合不会产生文件写入。
- Renderer 的侧栏和新对话 Project 列表统一使用 `projectOrder`；刚选择且尚无 Camp 的空 Project
  也追加到现有 Project 末尾。
- 老 Project 收到消息、Run 状态变化或未读变化时，Project 不移动；`lastActivityAt`、
  `lastActivityGlobalSequence` 与 marker 继续服务 Project 内 Camp 排序、时间和未读展示。
- Core Navigation Read Model 的 SQLite 投影、Project 聚合和 Camp 活动排序不变；其 Project 数组只作为
  首次冻结与新发现项的确定性输入，不再直接决定 Sidecar 的已保存 Project 顺序。

## 数据合同

本版本没有 SQLite Migration，也不改变 Core Navigation Snapshot schema。变化只发生在 Main-owned
`navigation.json` 和同进程 Preload API：schema 2 原文件在首次成功同步前保持不变，成功后由既有私有
JSON 原子写入升级为 schema 3；畸形来源继续只做内存归一并保留原文件作为恢复证据。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.40 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.41 |
| Decisions | 已更新 | [V1.41-D01](decisions.md#v1-41-d01)记录首次冻结、增量同步以及 Main/Renderer 与 Core 的排序权威分工；CURRENT 已纳入导航 |
| Contracts | 确认无需更新 | Core Navigation Snapshot、IPC Router Envelope 和数据库字段均不变；`NavigationPreferencesSnapshot` 是 Desktop Preload 的应用内类型，随 Main-owned JSON schema 原子演进 |
| Architecture | 已更新 | [Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md)和[产品与导航不变量](../../architecture/foundational-invariants.md#product-navigation)明确 Core 活动投影与 Main-owned Sidecar 顺序的分层 |
| UI | 已更新 | [App Shell 与统一侧栏](../../ui/components/app-shell-navigation.md)拥有 Project 稳定顺序、新增追加和 Camp 内活动排序的呈现合同 |
| Runtime Activity | 确认无需更新 | 不改变 AgentRun、Canonical Activity、Evidence 或展示映射；活动仅不再移动 Project 行 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime Adapter、协议、版本、模型或平台准入 |
| Documentation routing | 已更新 | 文档总导航、Architecture 索引和当前决定导航均路由到 Sidecar Project 顺序边界 |
| Root README | 确认无需更新 | 项目定位、安装方式和公开能力清单不因本机侧栏顺序策略改变 |

## References

- 下一版本：[v1.42](../v1.42/README.md)
- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md)
- [App Shell 与统一侧栏](../../ui/components/app-shell-navigation.md)
