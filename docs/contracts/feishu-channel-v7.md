---
document_type: protocol-contract
contract: feishu-channel-v7
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 7
last_updated: 2026-08-31
---

# Feishu Channel v7 Contract

本合同继承 [Feishu Channel v6](feishu-channel-v6.md) 的账号/发布、Owner、项目、admission、roster、Outbox、
不可变 sealed snapshot、双层终态卡、同步分页回包和永久正文/回复/接收对象卡。本次仅替换执行中呈现，增加
共享 `ExecutionStep.publicResult` 安全结果边界；不新增 Migration、Core 页面状态、IPC 或 Renderer 配置。

## 1. 紧凑实时卡

`queued/running/waiting` 使用 Card 2.0，默认正文只显示：

1. 最新公开 TextBlock，最多 5 行；超过时前 4 行加准确的截断提示。没有正文则省略；
2. 最后一条 running command；没有 running 时选择最后一条 waiting，否则展示最近 command。始终最多一条；
3. 真实进度摘要：已完成指令数、实际 running 数，以及存在时的 waiting/failed/stopped/recorded 数。失败不计作完成，
   不虚构总工作量或完成百分比；没有 command 时按 Run 的 queued/running/waiting 状态显示等待或准备；
4. 一个默认关闭的原生 `collapsible_panel`，标题为“执行过程 · 最近 N 条 / 共 M 条”；无 command 时为“执行过程”。

总面板只含当前时间线的连续尾部窗口：最多最近 10 条 command、20 个 timeline blocks。保持正文与 command 的顺序；
运行中 command 仅展示安全命令及真实状态，不附结果或二级折叠。窗口内文字最多 10 行，遵循终态的文字截断规则。
N 是窗口内 command 数，M 是该 Run 全部唯一 command 数，正文不计数。窗口外的指令提示“更早 K 条将在执行完成后查看”；
仅移出正文时使用明确的正文省略提示。提示不计 timeline block，但计入 Card element 和 byte 预算。

整卡同时遵守最多 30 个递归 body elements、16,000 UTF-8 JSON bytes。生成实际 Card JSON 后测量，超限依次移出最早
历史 block 并重新计算计数/提示/预算，始终保留当前正文和当前 command。单条不可拆 command 本身超过整卡容量时，
用“当前指令超出飞书卡片大小限制，请在 Rovai 查看。”替代整条展示，不截短为另一条命令。原 Evidence 不变。
不能只把全部历史放入折叠容器；此窗口不影响 Core 存储、sealed timeline、永久回复或钉钉投影。

实时卡仍走既有 upsert/updateCard。每次更新默认关闭总面板，允许本地展开在下一次整卡更新后重置；不保存折叠状态，
不增加 callback。稳定完整记录在 sealed 后提供。空记录、waiting 和失败均使用真实状态，不显示虚假运行。

## 2. 共享安全结果投影

`ExecutionStep` 增加 `publicResult: string | null`，是对外可用的结果预览，不是完整工具结果或本地详情：

- `publicCommand` 和 `executionStepPublicTitle` 继续提供安全命令；飞书保留非敏感 executable、flags、参数和路径，
  不翻译或重提取命令名。跨整个 Run 的敏感值过滤同时用于实时/终态正文及命令；原始 patch 不进入 header；
- `publicResult` 由共享 presentation 在 operation 归并后生成；running/waiting 尚不提供结果，无明确文本结果时为 null；
- 结果来源仅限明确的 `aggregatedOutput/output`、stdout/stderr、text content，以及受信 Core 的
  `coreEnvelope.result/error` 或 `operationProjection.canonicalResult`；不序列化完整 envelope；
- 不从 `detail`、tool input、stdin 或 `payload.input` 回退取结果。`detail` 的本地完整查看语义不变；
- 先去 ANSI/控制字符，再使用同 Run 全量 Evidence 中的敏感值脱敏，再过滤原始 patch、完整工具 JSON、二进制/base64，
  最后截断。stdin、Secret/Token/Cookie/Authorization、密码和敏感环境变量不公开；`rovai send` 的真实 body
  及其回显不在结果中重复展示。`apply_patch` 优先使用 canonical 结构化路径与增删行数；
- 每条结果最多 20 行、4,096 UTF-8 bytes；超过 20 行时取前 9 行、1 行准确截断提示、后 10 行。密集长行继续有
  512-byte 单行上限，按最终 4KiB 预算进一步收窄时保留所选首尾行和每行首尾，并标明截断，不切坏 Unicode；
- 飞书 command 面板只读取 `publicResult`，null 显示“（无可展示结果）”。展开后仅一个 Markdown 代码框，
  没有“指令／状态／输出”等二级标题，代码围栏内容不能逃逸结果框。

没有把新的预览写回 Core Evidence、模型输入或持久数据。钉钉仍使用原纯文本投影，不展示该结果。

## 3. 终态、分页与生命周期保持

继续使用 terminal → terminal_pending → 900ms quiet window → terminal_sealed → 最后一次 upsert；sealed 后后台
不再覆盖该卡。终态默认显示真实“用时 …”、分隔线与关闭的总面板，缺少可靠时间时不虚构时长。展开后当前页保留完整
timeline 的真实顺序：公开 narration/plan/diagnostic/最终正文及逐条 command，文字最多 10 行，长文取前 9 行加提示。
永久 Agent 回复仍完整独立发送，不套用执行卡截断。

每页最多 15 个 command、50 个递归 body elements、24,000 UTF-8 JSON bytes；外层容器、页码、按钮和 payload
全部计入。按候选实际 Card JSON 测量；block 不拆页，文字与紧随的首条 command 尽量同页。只放当前页，不预装全部页。
初次终态固定 `pageIndex=0, outerExpanded=false`；合法翻页总面板展开，所有单条 command 收起，返回第一页也一样。

分页严格保留 v6：先授权 Owner/冻结 App/原消息/terminal_sealed/exact sequence，再读 sealed source 并校验真实页码。
只在同步 callback response 中返回目标卡，由飞书更新同一张卡一次；不另发 PATCH/updateCard、不写 pageIndex/viewVersion、
不生成 nonce、不排 upsert、不触发 pump。成功无 Toast；保留 2.5 秒处理预算和安全错误。两层原生展开不请求 Rovai。
下一轮根 CampTurn admission 仍撤回上一轮执行卡。

## 4. 兼容与验收边界

当前 `rovai/channel-integration` 上实施本合同，不回退附件中的旧分支或基线。已发送旧 sealed 卡不批量回填，已发布
飞书应用资料不更新。合法新投递、更新及翻页使用当前渲染器；App/message/sequence/Owner 身份不变。
本地 JSON/Host 测试证明预算、顺序、安全、单次分页和永久回复独立；它们不等于真实飞书客户端视觉/点击验收。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道 UI](../ui/components/channel-settings.md#飞书执行卡)
- [Channel Storage v2](channel-storage-v2.md)
- [v1.36 实施计划](../versions/v1.36/implementation-plan.md)
