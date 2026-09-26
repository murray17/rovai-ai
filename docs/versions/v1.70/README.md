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

前置：[v1.69](../v1.69/README.md)。本版将 Rovai 平台技能与工具箱技能作为普通受管资源提供，设置页只读发现 Harness 原生 Skills，工具箱按队员配置，会话按当前 Camp 全队与项目发现候选。新 Run 使用冻结的动态工具箱索引，新 Native Session 使用独立的平台技能 Bootstrap section。Skills Rebuild 的模型输入和旧会话边界见[Skills 变更说明 revision 5](model-context-change.md)；其公开 30／Profile 10／Facts 7 是随后新增公屏历史提示的**变更前基线**。独立的 [historyHint 变更说明 revision 5](model-context-change-history-hint-additional.md) 已获 Principal 二次确认，目标公开 31／Profile 10／Facts 8 与新建 Charter 14；旧 Session 原系统提示词及冻结证据不变。v1.69 的 Camp 主动读取不改变两份说明各自的权限边界。

后续独立修复按已确认的 [Charter 精简稿 revision 1](model-context-change-charter-simplification.md) 压缩公开 Camp 正文，去掉 `Authority boundaries` 小标题，将等待队友回复时结束 Run 的规则放在正文末尾并从 CLI Contract 删除重复句。当前新建 Charter revision 16，Binding 兼容摘要也升至 16，让已有 Session 在下一次正常执行时切换；旧冻结输入与 Bootstrap Evidence 不回写。当前规则见 [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md) 与 [ContextManifest v31](../../contracts/context-manifest-evidence-v31.md)。

实施步骤与验收证据见[实施计划](implementation-plan.md)。旧导入记录、受管 Revision、冻结的 Run 和 Native Binding 保留；新的 Skills 路径不再以项目投影或旧 Revision 校验作为准入。旧项目入口不随升级自动删除；诊断与修复提供唯一问题和用户显式触发的统一清理动作。Windows 对九个固定官方 Skill 名称使用 [D04](decisions.md#v1-70-d04) 的显式清理规则，并按 [D05](decisions.md#v1-70-d05) 补足已登记项目中无 observation 的残留目录。

同期交付桌面「关于与更新」页的已安装版本日志：构建时内置的发布说明按运行版本校验并离线展示；新版日志继续复用更新检查结果，可在两版之间切换而不增加在线查询。合同见 [App Update v5](../../contracts/app-update-v5.md)，用户已验收开发包界面。

Skills migration 173 及其已安装本地构建的数据合同标记仍为 `v1.69`／schema 123，公开 Manifest 30／10／7 的含义不重写。独立 historyHint 变更新增 migration **174**：只接受经 Skills 主线结构核验的 173 来源，目标为 `v1.70`／schema **124**、公开 31／10／8。早期分支也使用过同一个 173／标记、却定义不同的 30／9／8；不得误识别并自动升级。historyHint 已随 PR #529 合入；其 Bootstrap 缺失门禁的后续修正和验收状态见[实施计划](implementation-plan.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v1.69](../v1.69/README.md) 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[索引](../README.md)保持唯一 current v1.70，Skills 173 原标记保留、追加 historyHint 174 |
| Decisions | 已更新 | [V1.70-D01/D02/D03/D04/D05](decisions.md)记录来源切换、冻结兼容、旧入口显式清理及 Windows 无 observation 名称准入取舍，并同步[当前决定](../../decisions/CURRENT.md)导航 |
| Contracts | 已更新 | [Skills Rebuild v2](../../contracts/skills-rebuild-v2.md)、[Windows Skill Projection v2](../../contracts/windows-skill-projection-v2.md)、[Diagnostics Center v2](../../contracts/diagnostics-center-v2.md)、当前 [ContextManifest v31](../../contracts/context-manifest-evidence-v31.md)、历史主线 [v30](../../contracts/context-manifest-evidence-v30.md)、[Profile 10](../../contracts/context-delivery-profile-v10.md)、[Run Facts 8](../../contracts/run-facts-v8.md)、[App Update v5](../../contracts/app-update-v5.md)及[合同索引](../../contracts/README.md) |
| Architecture | 已更新 | [Skills 架构](../../architecture/skills.md)、[当前不变量](../../architecture/foundational-invariants.md#skills-library-projection)、[Diagnostics Center](../../architecture/diagnostics-center.md)、[Desktop App Updates](../../architecture/desktop-app-updates.md)及[索引](../../architecture/README.md) |
| UI | 已更新 | [Skills／工具箱／会话组件](../../ui/components/skills-settings.md)、[App Update v5 展示合同](../../contracts/app-update-v5.md#candidate-and-presentation)、[设置页策略](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md#关于与更新)与[UI 导航](../../ui/README.md) |
| Runtime Activity | 确认无需更新 | 本版不改变 Canonical Activity identity、phase、outcome 或 Adapter 映射 |
| Runtime compatibility | 已更新 | [清单](../../runtime-compatibility.md)限定旧项目投递实测证据；新索引跨 Runtime 调用目前为 Unverified |
| Documentation routing | 已更新 | [文档导航](../../README.md)路由到当前 Skills 架构与合同 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；本版调整 Skills 内部来源与配置 |

## 正文 Principal 提及补齐

按 Principal 在 2026-09-26 确认的规则，显式 Agent Send 支持行首连续提及中的 `@Principal`，与 `--to-principal`
合并；PublicOnly 仍不唤醒 Agent，但保留对用户的提及。昵称使用当前资料，非前缀位置保留 Markdown。
当前合同为 [Send v24](../../contracts/camp-message-send-v24.md)，验证记录见[实施计划](implementation-plan.md)。

本项跨版本影响：Version/Contracts/Architecture/UI/文档路由已更新；Decisions 确认无需新增（现有身份和通知模型的
可逆输入兼容扩展，合同已完整解释）；Runtime Activity、Runtime compatibility、Root README 确认无需更新（无新增
Runtime、活动或产品入口）。Bootstrap、CLI 教学、Context formatter/选择/预算与冻结证据不变；不新增核心模型上下文格式变更。

后续版本：[v1.71](../v1.71/README.md)。本版范围和验收事实冻结。
