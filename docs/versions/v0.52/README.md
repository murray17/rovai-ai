---
document_type: version-overview
version: v0.52
lifecycle: current
authority: version-scope-and-status
design_status: complete
implementation_status: complete
last_updated: 2026-08-09
---

# Rovai-ai v0.52：Dynamic Context 精确恢复与有界 Evidence

> 当前状态：设计与实施完成。该版本修复 Public A2A Current Input 来源、Run Notice exact bytes、
> structured history continuation、whole-history omission Evidence 和公开 CampSnapshot schema 的发布阻塞问题。
>
> 前置版本：[v0.51 可操作诊断中心与 v5 导出](../v0.51/README.md)

## 版本目标

v0.52 保持 Context Delivery Profile v2 的选择算法、预算数值和 accepted-ACK 语义不变，同时修复五个
合同实现缺陷：Public A2A target Run 的 Current Input 必须保留可信 sender Agent 身份，不能伪装为用户；
Run Notice 只能渲染一次并在 Frozen Delivery、模型 section 与 Manifest 复用相同字节；
structured CampMessage 的截断前缀与 `camp.read` continuation 必须使用同一持久正文文本空间；
`max_public_messages` 不得把任意长历史 ID 列表复制到 Frozen/Manifest JSON；公开 CampSnapshot
schemaVersion 必须随已经改变的 Read Model shape 升到 27。

## 合同切换

- Native Session Bootstrap v3、Bootstrap Formatter v3、Context Formatter v11、Context Delivery Profile v2、
  Redelivery Envelope/Formatter v2 保持；
- ContextManifest v8 → v9，只改变 whole-history omission machine evidence；
- Data Contract v0.50/schema 27 → v0.52/schema 28，Migration 69 只接受完整 v0.50/schema 27/
  Migrations 66–68 source；
- CampSnapshot Read Model schemaVersion 26 → 27，与数据库 projection schema 保持独立版本轴；
- 不保留 v8/v9 ContextManifest、旧 Runtime Input Delivery 或旧 CampSnapshot 的兼容读取逻辑。

Migration 69 终止非终态 Run/Turn 与未完成 Delivery，清除旧 ContextManifest、Runtime Input Delivery、
Bootstrap Evidence、Binding/Session 技术状态和水位；已经完成的 Camp、Message、Task、终态 Run/Turn
业务历史不清空。该切换由 Manifest 合同变化触发，不是 Identity 编辑触发 Session rotation。
Public A2A source 修复是既有 Context Formatter v11 的 conformance fix，不创建 Formatter v12；任何
pre-release 数据库中已经冻结的错误 source bytes 都会 fail closed，不能在恢复时静默重算或投递。

## 本版本不做

- 不改变 Profile v2 的 15/24000/2000/3 数值、候选选择、排序或 Unicode-scalar 计量；
- 不改变 `sourceConversationId` 的已接受 Evidence 边界；
- 不引入 sequence-range locator、第二套 Camp 领域词汇或模型字段缩写；
- 不改变 Runtime Input Delivery accepted、failure、`not_accepted`、`delivery_unknown` 的权威语义；
- 不增加 v8/v9 或 CampSnapshot 26/27 兼容分支。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.51 冻结为 historical，v0.52 成为唯一 current；建立本概览与实施计划 |
| ADR | 已更新 | ADR-0149 冻结 whole-history aggregate 与 bounded exact omission evidence 的分界 |
| Contracts | 已更新 | 新增 ContextManifest Evidence v9；Profile v2 选择/预算合同保持不变 |
| Architecture | 已更新 | Built-in Tool Runtime 更新为 ContextManifest v9，并保留四层 Context/Evidence authority |
| UI | 确认无需更新 | 只把现有 CampSnapshot 公开 shape 的版本号升到 27，不改变 Renderer 交互或视觉合同 |
| Runtime Activity | 确认无需更新 | 不新增或重分类 Canonical Runtime Activity |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter 能力、协议、发现或上游兼容性结论 |
| Documentation routing | 已更新 | 文档导航、Contract/ADR/Version 索引加入 v9 Evidence 当前入口 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 范围没有变化 |

## References

- [v0.52 实施与验收计划](implementation-plan.md)
- [ADR-0149](../../adr/0149-bounded-whole-history-omission-evidence.md)
- [ContextManifest Evidence v9](../../contracts/context-manifest-evidence-v9.md)
- [Context Delivery Profile v2](../../contracts/context-delivery-profile-v2.md)
