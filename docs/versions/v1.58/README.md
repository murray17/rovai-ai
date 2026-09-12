---
document_type: version-overview
version: v1.58
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-12
---

# Rovai-ai v1.58：上下文 Gate 与双轨评测

前置：[v1.57](../v1.57/README.md)。本版本实现[四项治理愿景](../../research/agent-governance-vision.md)中的第二项：Gate／每周真实任务回归与每日 Trace 规则分析。长期规则见 [Execution Evaluation v14](../../contracts/execution-evaluation-v14.md)，操作见[开发指南](../../development/evaluation.md)。

## 范围与状态

与 main 的 ZCode 版本并行开发期间，本分支曾使用 v1.57；合入时顺延为 v1.58，main 已有 v1.57 的正文与验收记录保留。历史评测报告仍按其实际提交、产品版本和摘要解释，不因文档迁移变成合并后版本的实测结果。合并验证与本机部署进度见[集成记录](merge-and-local-schedules.md)。

每日已完成 7 天非空真实记录复算和最新一天的真实 LLM 分析；实际采集覆盖、两次分析尝试及部署限制见[每日 Trace 实测结果](daily-trace-results.md)，冻结范围见[核验计划](daily-trace-verification.md)。

最新十二项回归已完成完整评价：12/12 硬性及关键语义验收通过，质量 100/100、覆盖 100%，112 个质量项与 17 个适用协作项均有有效判定，Runtime 用量可复算。版本、原始失败保留、完整性核验及未覆盖范围见[完整实测结果](evaluation-complete-results.md)。基线对照、保留集及重复可靠性仍未验收。

本次后续预算、并行和真实 Judge 验证见[预算校准记录](evaluation-budget-calibration.md)。

评测指标和离线报告的后续修订范围、旧检查项映射与验收边界见[指标修订计划](evaluation-metrics-revision.md)。

宿主与定时执行接入、旧失败复核见[宿主接入计划](evaluation-host-integration.md)。该增量正在进行真实验收，不由流程单测推断全部 Case 通过。

复用 Qualification Runner、Case admission、合同测试、双 View Judge、Core 持久证据、用户 CLI 和 Rovai Automation。新增受限只读 Trace 导出、日报与曲线、Host 报告准备、两级 Gate 及每周报告历史。通用集 12 个 Case；Memory 与 Review Duo 各有 3 个专属 Case。没有专属集的其他 Skill 先补样本，不能默认为已覆盖。

双轨评测增量本身没有新增数据库字段，沿用当时 main 的 Data Contract 99、Camp Snapshot 34、formatter/manifest 23 及 Built-in tool/context 语义。旧评测构建使用 Data Contract 98，不能冒充本次合并构建的执行证据。Memory 精确计数、文档体系重构和队员成长仍属后续项，日报中的两项 Memory 指标为未知。User Automation 新增 owner-only 元数据操作，不注入 Agent 上下文。

2026-09-10 开发者明确授权继续实现两条评测线，并授权实现者自行选择必要实现细节、最后汇总。该评测增量不修改核心模型可见机制或内置 Skill 内容，因此自身不触发产品模型上下文 revision；后续实际上下文／Skill 机制改动仍按 Gate 流程确认和验证。

2026-09-11 开发者另行确认 Source Attachment 的模型可见路径语义收敛：Run 前保留宿主重检，随后把 exact stored
source path 原样写入 `CURRENT_INPUT.attachments`，彻底删除 execution-root 分流和 Run Temp 复制。该独立 revision
见[完整前后对照与确认记录](model-context-change-source-attachment-live-reference.md)；它不改变 Context shape、选择预算、
formatter/profile/manifest 版本或其他附件类型。

代码及本地验证、隔离定时链路和首次真实 Judge 校准已运行；完整对照、独立保留集、固定模型 snapshot 与部分取证覆盖仍有缺口，版本状态保持 `in_progress`，详见[实施计划](implementation-plan.md)和[预算校准记录](evaluation-budget-calibration.md)。设计、Case 准入与合同测试不能证明任务质量提升；各类运行证据分别记录，不相互替代。

## Runtime 外层沙箱清理

按用户确认的防误调用边界，移除 Rovai 的 macOS Runtime 外层沙箱，保留 Agent CLI 对 `rovai app` 的拒绝。
取舍见 [V1.58-D05](decisions.md#v1-58-d05)，当前合同为 [User Automation v5](../../contracts/user-automation-v5.md)
与 [Managed Runtime Process v2](../../contracts/managed-runtime-process-v2.md)。实现与定向验证记录见[实施计划](implementation-plan.md#runtime-外层沙箱清理)。原评测与平台验收缺口保持独立。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | main 的 v1.57 冻结，本概览、实施计划及[版本索引](../README.md)建立唯一 current v1.58；旧分支报告身份不重写 |
| Decisions | 已更新 | [V1.58-D01](decisions.md#v1-58-d01)记录元数据与分析 Agent 的权限分离；[V1.58-D05](decisions.md#v1-58-d05)明确 CLI 防误调用边界并移除 Runtime 外层沙箱；[V1.58-D06](decisions.md#v1-58-d06)记录 Source Attachment 原路径投影 clean cutover |
| Contracts | 已更新 | [Execution Evaluation v14](../../contracts/execution-evaluation-v14.md)、[User Automation v5](../../contracts/user-automation-v5.md)、[Managed Runtime Process v2](../../contracts/managed-runtime-process-v2.md)、[ACP Client Terminal v3](../../contracts/acp-client-terminal-v3.md)、[Camp Attachment v9](../../contracts/camp-attachment-v9.md)、[Single Chat v4](../../contracts/single-chat-v4.md)及索引 |
| Architecture | 已更新 | [双轨执行评测](../../architecture/execution-evaluation.md)、User Automation 当前路由、[Camp Attachments](../../architecture/camp-published-attachment-view.md)、[Single Chat](../../architecture/single-chat.md)与基础不变量 |
| UI | 已更新 | 复用 Camp 与文件入口，增加离线 HTML、质量和协作对照；保留 SVG/Markdown/JSON，Runtime 外层沙箱清理与 Source Attachment 投影均不改变 Renderer 或 Electron 沙箱 |
| Runtime Activity | 确认无需更新 | 只读取当前 classifier 既有证据，不修改分类、事件或 Activity 投影 |
| Runtime compatibility | 确认无需更新 | 复用现有 Runtime Adapter；Source Attachment 不新增 read root/capability 或可读保证，局部评测验证也不提升平台或 Runtime 资格 |
| Documentation routing | 已更新 | 文档导航、开发入口、上下文治理、Contracts、Architecture 与 CURRENT 纳入双轨评测及 Source Attachment v9/v4 |
| Root README | 确认无需更新 | 项目定位与支持平台不变；开发评测操作由 development 入口拥有 |

评测证据采集、Judge 未知处理及报告结论修订见[证据与报告完整性修订](evaluation-evidence-completeness.md)。

较早批次的十二项真实执行证据曾完成重评：质量 94.27/100、覆盖 100%、硬验收 11/12、全条件验收 10/12；无基线比较。实际版本、未通过项合理性、发布故障修复与限制见[可观察指标实测记录](evaluation-observable-results.md)，保留为历史结果。

102／106／107 的后续诊断、校准与新一轮实测见[声明评价校准计划](evaluation-claim-calibration.md)。前述 94.27 分保留为旧标准记录，不等于校准后结论。

普通 Runtime Probe 的原生 Home 收敛与两项保留差异见[实施记录](runtime-probe-native-home.md)；本增量不涉及 Renderer、正式 AgentRun 或 Pi 图片。

混合队伍实测暴露的 Outcome 来源正文遗漏，按[来源材料闭合](evaluation-source-materials.md)修订为 Judge v10 / 评分 2.8；原始执行失败与旧分数保留，实际重评状态见该记录。

正式交付被后续确认遮蔽、Judge 超时分类和恢复按[正式交付与有限恢复](evaluation-delivery-recovery.md)推进，当前评分 2.10 / Judge v12；既有 Case 和历史结果保留。

Claude Code 模型目录从 help 别名改为无 Prompt 控制初始化，原生元数据、统一缓存、失败保留和验证状态见
[实施计划](implementation-plan.md#claude-code-动态模型目录)；当前合同为
[Runtime Launch v39](../../contracts/runtime-launch-and-verification-v39.md)。此项不改变当前版本状态或 Runtime 平台资格。


## Built-in 工具入参展示

按用户确认的设计，本地执行台与单聊只调整 UI：23 项 Built-in 显示对应 CLI 名称，七种状态只显示现有公共入参，
省略正文参数与占位，并将可靠关联的纯 Shell 载体折叠为一次操作。内部操作身份和历史数据保持不变。
当前合同为 [Run Process Detail Surface v32](../../contracts/run-process-detail-surface-v32.md)，UI 与开发验收入口同步；
没有架构数据流、模型上下文、Runtime classifier、兼容性或版本指针变更，其他 v1.58 验收缺口保持独立。
实施与验证见[工具入参展示记录](builtin-tool-input-presentation.md)。

## 待发送消息移回输入框

按用户确认，公屏及单聊的编辑入口改为退出队列、覆盖普通输入框；剩余 FIFO 正常推进，重新发送进入当前队尾。
当前合同为 [Pending Camp Input v4](../../contracts/pending-camp-input-v4.md)、[Camp Composer Draft v13](../../contracts/camp-composer-draft-v13.md)
与 [Single Chat v5](../../contracts/single-chat-v5.md)。不改变数据库 schema、Runtime 或模型上下文；实现与验证见[实施计划](implementation-plan.md#待发送消息移回输入框)。


## Runtime 自定义启动设置

按用户确认的交互提供自定义程序路径与按 Runtime 注入的环境变量。Core 拥有保存与草稿检查；
管理列表保持白色、状态无圆点，启动设置操作行始终可见。该独立增量通过 Migration 150 将
Data Contract 从 v1.57 / schema 99 升为 v1.58 / schema 100；不改变模型上下文、事件协议或平台资格。
当前合同为 [Runtime Launch v40](../../contracts/runtime-launch-and-verification-v40.md)，架构与设置 brief
同步。实现、测试 owner 与交付证据见[实施计划](implementation-plan.md#runtime-自定义启动设置)。
