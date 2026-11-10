---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-10
---

# Kilo 前台子代理展示与版本说明

User sequence 37 要求补全前台子代理，并核对输出截断、Skills 的 DocumentationOnly 与版本资格。
在原 `rovai/kilo-acp` worktree、基线 `929cde03ecbfb6d1247450771b9155368609c534` 实施。
本次遵循已有 [Surface v58](../../contracts/run-process-detail-surface-v58.md)，不改变调度、模型输入或平台资格。

## 前台子代理接线

官方 7.8.27 的 `task` 已能执行，缺口是 Rovai 没有把原生事件归一成现有子代理工具类型。
`runtime_subagent.rs` 现在接受 Kilo 的固定 `title=task + kind=think` 函数标签；
运行中标题变成任意任务描述时，使用 `kind=think + description/subagent_type/prompt` 字符串入参识别。
只有任意标题、不同 kind 或缺少结构化参数均不据此准入。

后续复用已有 Prompt-local 调用缓存：开始、执行和省略 kind/input 的完成事件对应同一 operation，
任务参数保留，真实报告进入该工具的返回。Core 产生既有 `runtimeToolType=agent`，
现有 activity-v5 分类器和普通工具详情直接显示机器人图标、参数、状态和报告。
没有新 Renderer 组件、子代理调度、原生历史补采或数据库迁移；旧 Evidence 不重分类。

完成结果的 metadata.sessionId 是被委派任务的目标 Session，不表示父 task 调用来自子代理。
本次不把这类结果 metadata 当作输出作者，也不把报告复制进主代理正文。
原生未在父 ACP 流中转发的独立 child Session 内部工具不主动补采，继续遵守共享平铺合同。
后台子代理仍由原生环境开关关闭。

原生来源固定为官方提交 `03a6f07d053cd7e6aa88fa1e258e93510335259f` 的
[ACP Tool 映射](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/tool.ts)
和 [task](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/task.ts)。

## 输出仍按共享预算截断

`execution_evidence::PERSISTED_TOOL_OUTPUT_LIMIT_BYTES` 仍为 **7,680 字节（7.5 KiB）**。
工具及命令返回共用 UTF-8 前缀预算；不会切断多字节字符。截断后的持久化结果携带 outputTruncated，
重开仍读取该前缀；展开详情不会恢复已舍弃的尾部。任务参数不属于这条输出预算。
该限制属于 Rovai 的执行记录与展示，不修改 Kilo 自身收到的工具结果或模型输入。

## DocumentationOnly 的含义

这是 Rovai 的 `SkillDiscoveryVerification` 验收状态，不是 Kilo 的能力开关。
Kilo 有原生 [skill 工具](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/skill.ts)；
Rovai 已接共享索引与 Kilo/Claude-compatible 原址发现。
目前标记仅表示尚未完成实际 Skill 读取、更新、禁用/删除、重启及相邻成员隔离的完整集成验收。
本次没有执行这套矩阵，也没有把状态提升为 Verified。

## 版本号与平台资格分开判断

7.8.27 是目前真实验收的版本，不是普通 Kilo 执行的精确版本白名单。
普通 ACP 解析要求 acp-v1，Kilo 没有单独的普通执行最低版本判断；旧版或新版仍按实际安装/ACP 检查处理。
命令或协议不兼容会在实际检查/执行阶段失败；不能仅凭版本号宣称已兼容。

| 用户安装版本 | 普通 ACP 对话 | Steer 版本判断 |
| --- | --- | --- |
| 稳定 7.x、低于 7.8.27 | 不因版本号直接拒绝，仍须通过实际 ACP 检查 | VersionIncompatible，关闭 Steer |
| 稳定 7.x、不低于 7.8.27 | 同上，不代表所有版本均已验收 | 通过版本判断，仍须满足当前 Run/协议/输入回执条件 |
| 8.x 或其他主版本 | 同上，不保证原生接口兼容 | VersionUnverified，关闭 Steer |
| 预发布版本或版本未知 | 普通执行没有新增版本门槛 | 分别为 VersionUnverified 或 RuntimeIdentityUnknown |

平台准入只允许 macOS arm64 Preview；其余平台仍为 NotQualified。
安装更高或更低版本都不会自动改变平台准入，macOS Intel 也不会因安装同版而取得资格。
本次只核对并补充现有版本 owner，不改变任何准入策略。

## 验证归属与结果

扩展已有 `display_calls_keep_scoped_identity_and_exclude_unattributed_child_prose`，
覆盖真实 Kilo 开始/改名/稀疏完成、稳定 ID、参数保留、目标 Session 不误作来源，以及未知反例。
原代码先在 task 名称缺失处失败，接线后通过。
事件归一化扩展 `acp_tool_events_expose_only_the_public_command_and_payload_digests`，
覆盖类型、任务参数、原生报告与私有 metadata 不进入公开返回。
既有 Steer admission owner 增加较新 7.x 与预发布版，保持旧版及新主版本反例。
没有新增 Rust 测试函数。

既有 `scripts/smoke-kilo-runtime.mjs` 扩展短/长前台报告和长命令，不增加平行验收入口。
官方 7.8.27、生产 Core/CLI 与本地受控 Provider 在 `rovai-kilo-task-51mwawvw`
完成 **26 个 Run：24 成功、2 主动取消**。

- 两次 task 均为一条 `tool.agent`，pending/running/completed 同 ID，任务 prompt 保留，报告只在工具返回中。
- 短报告 115 字节、未截断；长报告 7,680 字节、截断；长命令 7,679 字节、截断且中文有效。
- 超预算尾部标记不在公开结果中；重开 Core 后结果一致。受控 Provider 仍收到完整子代理报告。
- 原有三轮成功 Steer 后同 Host/Session 复用、取消换 Host、MCP cwd、无 Node、pure 权限与文件 Diff 继续通过。
- Core/Runtime 正常清理，隔离运行文件回收完成。没有调用付费模型，没有操作日常 App 或日常数据。

[白名单证据](../../research/kilo-runtime/subagent-display-7.8.27-macos-arm64.json)只保留关联 ID、计数和验收结果。
共享 Renderer 的 `command-view` 回归通过机器人图标、普通详情、更新去重、缓存竞态及焦点/滚动保留；
这是既有真实组件的自动化回归，不描述为本轮开发 App 人工点击验收。

最终门禁通过：`cargo test --workspace` **484 passed、1 项既有 ignored**；
上述三个 extended owners、平台证据 revision owner、共享 `command-view` 回归通过。
`TZ=UTC pnpm test`：Renderer **3193 passed / 2 skipped**，Node **377 passed / 2 skipped**；
`pnpm typecheck`、`pnpm build:desktop`、Cargo format、Node syntax 与 `git diff --check` 通过。
`pnpm docs:test` 10 项、`pnpm docs:check` 与
`DOCS_BASE_REF=958784f6e17fc32d8b2753d7f14fd6122dceea9d pnpm docs:check:ci` 通过。
