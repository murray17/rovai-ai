---
document_type: version-overview
version: v1.52
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-06
---

# Rovai-ai v1.52：项目文件恢复与工具调用一致性

前置：[v1.51](../v1.51/README.md)。本版本让项目内预览子文件取得独立恢复来源，并实现工具调用界面一致性、
typed read/write 文件入口、文件打开成功后提交与 `activity-v3`；[第三版 HTML 交互稿](tool-call-consistency.html)、
[实施及验收清单](implementation-plan.md)和[真实 Runtime 验收](runtime-acceptance.md)一并保存。

## 已确认范围

项目文件恢复沿用现有来源、Viewer、布局、权限和窗口内 Camp 恢复流程。Main 只在
`child_of_handle` 已成功打开、文件位于当前 Camp workspace 且能形成无歧义相对引用时，返回独立
`camp_workspace` 恢复来源；Renderer 以它和 `previewKey` 稳定去重。父 handle 释放或删除后，子文件仍能在
A→B→A 后独立重验；外部、临时、Root Grant child 与系统应用格式不取得该来源，也不产生父能力链或原生副作用。

1. 所有普通工具详情复用现有 Shell 背景和 2px 左缩进；保留原内容、8px / 9px 内边距、字号与换行，不增加“指令 / 结果”标签、分隔线或空白行。文件 Diff 内容保持现状。
2. 子行沿用参考稿的执行中、成功、失败、跳过图形，补齐等待审批、停止和结果未知；排队只用于有对应事实的 Run。组右侧仅执行中、等待审批显示图标；终态只显示“完成了 x 个步骤”，不追加失败、停止或未知数量。x 仍按组内 Canonical Activity 计数。
3. 阅读显示“阅读 文件名”，行不展开；文件名有虚线底线，点击打开当前文件预览。Codex 的 cat、head、tail、sed 阅读和其他 Runtime 的结构化阅读需要专项覆盖。
4. 文件写入使用笔图标；明确新增显示“新增 文件名”，编辑或只能证明写入时显示“编辑 文件名”。文件名打开当前文件，独立箭头展开原有 Diff；没有可靠路径不制造链接，没有 Diff 不制造空展开。
5. 文件打开失败只在当前页面显示红色 Toast“无法打开该文件”，不打开、切换或替换预览。成功后才进入预览；文件名 Hover / Focus 点亮，动作文字和空白不提供点击反馈。
6. 取消中状态容器保持透明，停止请求与真实停止终态分开；静态行移除误导性的整行 hover。
7. Web、Built-in 与普通 Tool 的折叠标题按可靠公开信息表达动作与对象；缺字段时保留稳定回退。只改展示，不从 raw JSON、命令前缀或当前磁盘猜测历史活动。

## 当前状态与实施边界

`ResolvedFilePreview.restoreRequest` 已作为可选字段接入 Main 成功结果；来源由 Main 独立取得 workspace authority，
在发布 handle 前再次经过 binding generation fence。Renderer 保留稳定业务来源，临时 child 不覆盖它。

Migration 141 已原子切换 `v1.52 / projection schema 92 / activity-v3`。Core 只从 Codex structured
`commandActions.read`、ACP/Claude/Pi 的 matching 成功终态建立 typed read/write；Renderer 使用同一公开
projection 命名文件行，read 不进入 `Files Changed`。文件入口在 Main 校验和 Renderer 首屏读取都成功后才激活
预览；失败只显示红色 Toast，并保留原页面与已有预览。

本机真实矩阵覆盖 14 个 Runtime：12 个完成模型执行，其中可靠 typed read/write、保守“编辑”与无证据回退均按
合同通过；Antigravity 缺少公开单文件终态而保持回退，Grok 的写入未完成，CodeBuddy 缺可用默认模型、Cursor 缺
当前平台准入证据而阻断。具体版本、每项结果和 Qwen basename-only Diff 边界见[Runtime 验收](runtime-acceptance.md)。
这些结果不改变 Runtime 平台资格。本版本不修改 Agent 模型上下文。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v1.51](../v1.51/README.md)冻结为 historical；本概览、[实施计划](implementation-plan.md)、[版本索引](../README.md)与前后链接共同维护唯一 current v1.52 |
| Decisions | 已更新 | [V1.52-D01](decisions.md#v1-52-d01)记录独立 workspace locator；工具展示与 typed operation 沿用既有权威／诚实投影原则，无新增重要决定；[CURRENT](../../decisions/CURRENT.md)已纳入导航 |
| Contracts | 已更新 | [运行过程详情 v31](../../contracts/run-process-detail-surface-v31.md)、[文件变化观测 v3](../../contracts/runtime-file-change-observation-v3.md)与[文件预览 v8](../../contracts/file-preview-v8.md)分别冻结展示、typed operation、独立子文件恢复与成功后提交边界 |
| Architecture | 已更新 | [Runtime 文件变化](../../architecture/runtime-file-change-observation.md)、[文件预览](../../architecture/file-preview.md)及基础 Evidence/Activity 不变量同步新的职责、独立 workspace 投影与迁移边界 |
| UI | 已更新 | [会话工作区](../../ui/components/conversation-workspace.md)与[文件预览](../../ui/components/file-preview.md)记录统一状态、稳定子文件 Tab、文件名／Diff 双入口和失败 Toast 行为 |
| Runtime Activity | 已更新 | [Registry](../../runtime-activity/registry.md)切换 `activity-v3`，列出各协议的 typed read/write 准入、正反例和真实验收链接 |
| Runtime compatibility | 确认无需更新 | [真实 Runtime 验收](runtime-acceptance.md)是版本功能证据，不改变 Adapter 支持级别、模型合同或平台资格 |
| Documentation routing | 已更新 | 文档任务导航、Contracts 索引与当前权威导航已指向 v31/v3/v8；版本索引保留 v1.52 为唯一 current |
| Root README | 确认无需更新 | 项目定位、常青能力和支持范围未改变，实施中的 UI 范围不进入项目主页 |

## References

- [实施与验收清单](implementation-plan.md)
- [版本决定](decisions.md)
- [真实 Runtime 文件操作验收](runtime-acceptance.md)
- [第三版 HTML 交互稿](tool-call-consistency.html)
- [Run Process Detail Surface v31](../../contracts/run-process-detail-surface-v31.md)
- [Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)
- [File Preview v8](../../contracts/file-preview-v8.md)
