---
document_type: version-overview
version: v1.70
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-25
---

# Rovai-ai v1.70：Skills Rebuild

前置：[v1.69](../v1.69/README.md)。本版将 Rovai 平台技能与工具箱技能作为普通受管资源提供，设置页只读发现 Harness 原生 Skills，工具箱按队员配置，会话按当前 Camp 全队与项目发现候选。新 Run 使用冻结的动态工具箱索引，新 Native Session 使用独立的平台技能 Bootstrap section。前后模型输入与旧会话边界见[模型上下文变更说明 revision 5](model-context-change.md)；该 revision 已获开发者二次确认。v1.69 新增的 Camp 主动读取语义只改变工具结果，不改变该说明确认的模型输入结构与恢复边界。

实施步骤与验收证据见[实施计划](implementation-plan.md)。旧导入记录、受管 Revision、冻结的 Run 和 Native Binding 保留；新的 Skills 路径不再以项目投影或旧 Revision 校验作为准入。旧项目入口不随升级自动删除；诊断与修复提供唯一问题和用户显式触发的统一清理动作。

后续：[v1.71](../v1.71/README.md)。

同期交付桌面「关于与更新」页的已安装版本日志：构建时内置的发布说明按运行版本校验并离线展示；新版日志继续复用更新检查结果，可在两版之间切换而不增加在线查询。合同见 [App Update v5](../../contracts/app-update-v5.md)，用户已验收开发包界面。

迁移 173 及已安装本地构建使用的数据合同标记仍为 `v1.69`／schema 123；本次产品版本顺延不重写该持久标记。main 的 v1.69 Camp 历史变更没有数据库迁移，原数据合同仍为 `v1.68`／schema 122。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v1.69](../v1.69/README.md) 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[索引](../README.md)建立唯一 current v1.70，迁移 173 保持已部署标记 |
| Decisions | 已更新 | [V1.70-D01/D02/D03](decisions.md)记录来源切换、冻结兼容与旧入口显式清理取舍，并同步[当前决定](../../decisions/CURRENT.md)导航 |
| Contracts | 已更新 | [Skills Rebuild v1](../../contracts/skills-rebuild-v1.md)、[ContextManifest v30](../../contracts/context-manifest-evidence-v30.md)、[Profile 10](../../contracts/context-delivery-profile-v10.md)、[App Update v5](../../contracts/app-update-v5.md)及[合同索引](../../contracts/README.md) |
| Architecture | 已更新 | [Skills 架构](../../architecture/skills.md)、[当前不变量](../../architecture/foundational-invariants.md#skills-library-projection)、[Desktop App Updates](../../architecture/desktop-app-updates.md)及[索引](../../architecture/README.md) |
| UI | 已更新 | [Skills／工具箱／会话组件](../../ui/components/skills-settings.md)、[App Update v5 展示合同](../../contracts/app-update-v5.md#candidate-and-presentation)、[设置页策略](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md#关于与更新)与[UI 导航](../../ui/README.md) |
| Runtime Activity | 确认无需更新 | 本版不改变 Canonical Activity identity、phase、outcome 或 Adapter 映射 |
| Runtime compatibility | 已更新 | [清单](../../runtime-compatibility.md)限定旧项目投递实测证据；新索引跨 Runtime 调用目前为 Unverified |
| Documentation routing | 已更新 | [文档导航](../../README.md)路由到当前 Skills 架构与合同 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；本版调整 Skills 内部来源与配置 |
