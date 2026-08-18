---
document_type: version-overview
version: v0.97
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-17
---

# Rovai-ai v0.97：持久首次训练与“初次集结”

> 当前状态：首次安装判定、三页强制训练、断点恢复、幂等 provisioning、真实“初次集结”Camp 与
> Draft-only starter 已实现；与 v0.96 合并后的全量门禁、1040×700 隔离 App 验收、最终打包和
> `/Applications` 安装验收均已通过。
>
> 前置版本：[v0.96 运行监控与原生 Usage 观测](../v0.96/README.md)
>
> 后续版本：[v0.98 结构化 Skill 文件链接](../v0.98/README.md)

## 版本目标

为真正的首次安装提供不可跳过、可精确恢复的三页新手训练，并在完成 Runtime 配置时通过现有 Core
权威创建一个可长期保留的快速对话“初次集结”。第四页直接进入该真实 Active Camp；用户可选择 starter
把文字写入持久 Composer Draft，但是否发送完全由用户决定。

升级用户不进入训练。首次安装状态必须在 Core 启动建库之前判定并由 Electron Main 持久化，不能依赖
React、浏览器存储或新建后的空数据库反推。

## 已确认产品语义

- 四个用户可见页面依次为欢迎、内置队员选择、Runtime/模型配置、真实“初次集结”快速对话；
- 前三页不可跳过，每次有效选择与前进/返回都先持久化；重启回到精确未完成页并保留已有选择；
- 第三页成功完成真实 provisioning 后即标记新手训练完成，第四页 starter 操作可不做；
- “初次集结”只包含用户选择的那名内置队员，并由同一队员担任 Default Lead；Camp 为 Active、Quick
  Chat、peer collaboration，数据不会在训练结束时清理；
- Runtime 页只让用户选择 Runtime 与模型。权限来自所选 managed Installation 的
  `memberRuntimeDefaults.permissions`，并在 provisioning 开始前与命令 ID 一起冻结；
- 三条 starter 只替换持久 Composer Draft、聚焦并把光标置于末尾；不创建 Message、Turn、AgentRun、
  Skill 调用或 Runtime 输入。

## 交付范围

### Desktop admission 与状态机

- 在 Core 启动前检查私有 `onboarding.json`、当前数据库与遗留数据库存在性；
- 新安装写入 `in_progress(welcome)`，已有产品数据写入
  `completed(origin = "existing_installation")`；已持久化状态始终优先；
- 使用 closed `schemaVersion: 1` union、exact-key 校验、串行原子写与 `0600` 权限；
- preload 只暴露 typed transition，Renderer 无法初始化、跳页或直接读写文件。

### 三页强制训练

- 全窗口 welcome、四个现有内置队员卡片与 Runtime/模型页，不显示跳过或可点击进度控制；
- Runtime 页复用真实 Adapter scan/health/model catalog，并只选择 managed-default/default-auth
  Installation；`installed_unverified` 保持诚实可见；
- 返回上一页保留已选队员与 Runtime/model draft；provisioning 开始后不允许回退改变载荷。

### 幂等 provisioning

- 预先持久化 Member、Runtime、Camp 三个 command ID、冻结权限载荷与逐阶段检查点；
- 优先保留对应内置头像的 present seeded Member，不存在时才通过现有命令创建；
- 通过现有原子 Runtime 配置命令写入模型与 Adapter 默认权限；
- 通过现有 Camp 命令创建“初次集结”，再持久化 restorable Camp location，最后写完成状态；
- 崩溃重试复用相同命令与冻结载荷，跳过已记录阶段；即使 Runtime Installation 暂时不可发现也能完成
  已开始的恢复。

### 真实第四页与 starter Draft

- 完成后进入 normal App shell 的真实 Camp，而不是 onboarding 假页面；
- 空的首次 Camp 显示一段欢迎内容和三条 starter；选择后走既有 Composer Draft authority；
- restart 同时恢复 Camp 与未发送 Draft；用户导航、发送与后续消息行为全部回到普通 Quick Chat 合同。

## 明确不做

- 不给升级用户补建 onboarding Camp，不迁移或重写既有产品数据；
- 不增加权限编辑器、Runtime 凭据流或新的 Adapter 默认值；
- 不从 onboarding 直接写 Core 数据库，不创建第二套 Member/Camp/Draft authority；
- 不让 starter 自动发送、自动运行 Agent、调用 Skill 或制造示例消息；
- 不把第四页交互变成完成门槛，也不增加跳过前三页的隐藏通道；
- 不改变模型上下文、Runtime Activity mapping 或 Runtime compatibility 结论。

## 验收边界

- fresh install 与 existing installation admission 都有自动测试，Core 建库不能误把 fresh install 识别为升级；
- welcome、member、runtime 每个未完成页都能在 App 重启后精确恢复；返回/前进保留选择且不可跳页；
- Runtime 页在 1040×700 下双主题无页面级横向/纵向溢出，状态、模型与错误可读，键盘和 reduced motion
  保持可用；
- provisioning 每个崩溃窗口都不会重复 Member、Runtime mutation 或 Camp；同一 command ID 不会发生
  权限载荷漂移；
- “初次集结”为 Active Quick Chat，只有一名选中队员且同一队员为 Default Lead；restart 后仍可打开；
- 三条 starter 的点击只持久化 Draft 并聚焦末尾，Message/Turn/Run 数量不变；restart 后 Draft 仍在；
- TypeScript、Renderer/Node 全量测试、文档门禁、arm64 macOS 打包与隔离 Application 验收通过；
- 最终构建安装到 `/Applications/Rovai AI.app`，代码签名、关键二进制与启动进程来源通过核验。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.96 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后版本链接建立唯一 current v0.97。 |
| ADR | 已更新 | [ADR-0202](decisions.md#adr-0202)冻结 pre-Core Desktop admission、既有 Core authority 与检查点恢复边界。 |
| Contracts | 已更新 | [First-run Onboarding v1](../../contracts/first-run-onboarding-v1.md)定义 closed state、typed transition、冻结 provisioning payload、Camp 与 starter Draft-only 语义。 |
| Architecture | 已更新 | [First-run Onboarding 架构](../../architecture/first-run-onboarding.md)定义 Main、preload、Renderer gate、saga、Core service、Draft 与 restore store 的职责组合。 |
| UI | 已更新 | [首次训练 UI](../../ui/components/first-run-onboarding.md)与 UI 索引记录 1040×700、双主题、页面结构、状态、键盘、错误及第四页呈现合同。 |
| Runtime Activity | 确认无需更新 | onboarding 只消费现有 Runtime catalog/configuration；starter 明确不创建 AgentRun、Runtime input、Tool 或 Canonical Activity。 |
| Runtime compatibility | 确认无需更新 | 本版不建立新的 Runtime/version 资格；配置页按现有 managed Installation、health 与 model catalog 如实展示。 |
| Documentation routing | 已更新 | 文档导航及 Architecture、Contract、UI、开发测试/验收索引加入首次安装与新手训练入口。 |
| Root README | 确认无需更新 | 项目定位、常青能力与公开 Runtime 支持范围没有因首次使用流程改变；版本状态仍从唯一 current 版本进入。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0202](decisions.md#adr-0202)
- [First-run Onboarding v1](../../contracts/first-run-onboarding-v1.md)
- [First-run Onboarding 架构](../../architecture/first-run-onboarding.md)
- [首次训练 UI](../../ui/components/first-run-onboarding.md)
- [Camp Composer Draft v2](../../contracts/camp-composer-draft-v2.md)
- [Runtime Launch and Verification v1](../../contracts/runtime-launch-and-verification-v1.md)
