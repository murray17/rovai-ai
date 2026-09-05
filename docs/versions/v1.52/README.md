---
document_type: version-overview
version: v1.52
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in-progress
model_context_change: false
last_updated: 2026-09-06
---

# Rovai-ai v1.52：工具调用一致性与文件操作入口

前置：[v1.51](../v1.51/README.md)。本版本实现已确认的工具调用界面改动，真实 Runtime 验收尚未完成。
[第三版 HTML 交互稿](tool-call-consistency.html)与[实施及验收清单](implementation-plan.md)一并保存。

## 已确认范围

1. 所有普通工具详情复用现有 Shell 背景和 2px 左缩进；保留原内容、8px / 9px 内边距、字号与换行，不增加“指令 / 结果”标签、分隔线或空白行。文件 Diff 内容保持现状。
2. 子行沿用参考稿的执行中、成功、失败、跳过图形，补齐等待审批、停止和结果未知；排队只用于有对应事实的 Run。组右侧仅执行中、等待审批显示图标；终态只显示“完成了 x 个步骤”，不追加失败、停止或未知数量。x 仍按组内 Canonical Activity 计数。
3. 阅读显示“阅读 文件名”，行不展开；文件名有虚线底线，点击打开当前文件预览。Codex 的 cat、head、tail、sed 阅读和其他 Runtime 的结构化阅读需要专项覆盖。
4. 文件写入使用笔图标；明确新增显示“新增 文件名”，编辑或只能证明写入时显示“编辑 文件名”。文件名打开当前文件，独立箭头展开原有 Diff；没有可靠路径不制造链接，没有 Diff 不制造空展开。
5. 文件打开失败只在当前页面显示红色 Toast“无法打开该文件”，不打开、切换或替换预览。成功后才进入预览；文件名 Hover / Focus 点亮，动作文字和空白不提供点击反馈。
6. 取消中状态容器保持透明，停止请求与真实停止终态分开；静态行移除误导性的整行 hover。
7. Web、Built-in 与普通 Tool 的折叠标题按可靠公开信息表达动作与对象；缺字段时保留稳定回退。只改展示，不从 raw JSON、命令前缀或当前磁盘猜测历史活动。

## 当前状态与实施边界

本版本已进入编码。第三版组摘要和脚本语法已核对；Toast 的浏览器点击验证因控制连接失效未完成。合成原型、共享 fixture 和旧版 Runtime smoke 均不代表本版本产品验收通过。

Runtime 缺少可靠新增证据时回退“编辑”；缺少可靠文件操作证据时保留原工具或未知展示，不补造文件事件。阅读路径、事件投影、标题和预览的实施必须遵守当前权威边界，并在同一实现变更中更新相关合同与 UI 规范。本版本不修改 Agent 模型上下文或扩大 Runtime 平台资格。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v1.51](../v1.51/README.md)冻结为 historical；本概览、[实施计划](implementation-plan.md)、[版本索引](../README.md)与前后链接建立本分支唯一 current v1.52 |
| Decisions | 已更新 | [v1.51 决定](../v1.51/decisions.md)的生命周期元数据同步归档，保留原决定内容；本轮为局部可逆 UI 方案与实施，不新增重要决定 |
| Contracts | 确认无需更新 | 编码开始前仍由[运行过程详情](../../contracts/run-process-detail-surface-v30.md)、[文件变化观测](../../contracts/runtime-file-change-observation-v2.md)、[文件预览](../../contracts/file-preview-v7.md)约束；实施时同步更新受影响条款 |
| Architecture | 确认无需更新 | 当前准备不改变职责或授权；实现继续遵守 [Runtime 文件变化](../../architecture/runtime-file-change-observation.md)和[文件预览](../../architecture/file-preview.md)边界 |
| UI | 确认无需更新 | 第三版是版本内已确认设计，尚未替换生产规范；实施时同步[会话工作区](../../ui/components/conversation-workspace.md)、[文件预览](../../ui/components/file-preview.md)及[无障碍反馈](../../ui/qa/accessibility.md)的相关条款 |
| Runtime Activity | 确认无需更新 | 编码开始前尚未修改分类或投影；实现涉及映射时按[维护指南](../../runtime-activity/README.md)同步 Registry、正反例与生命周期 fixture |
| Runtime compatibility | 确认无需更新 | 未运行本版本真实 Runtime 测试，不修改[兼容性结论](../../runtime-compatibility.md)；逐 Runtime 结果进入实施计划 |
| Documentation routing | 确认无需更新 | 通用入口已动态跟随版本索引，不增加顶层路由或新的文档职责 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持范围未改变，实施中的 UI 范围不进入项目主页 |
