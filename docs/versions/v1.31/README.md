---
document_type: version-overview
version: v1.31
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-08-30
---

# Rovai-ai v1.31：Availability-first Runtime v2

> 当前状态：data-dir lease、数据库准入票据、copy migration、Supervisor generation/revision、结构化请求失败、
> Desktop Bootstrap Shell 与本机偏好 fail-open 主路径已完成；全仓测试、`-D warnings` 静态检查、打包 App
> 隔离 authority/双主题/200%/reduced-motion 验收及文档 merge-base 门禁全部通过。
> 后续修正已验证 SQLite hot-journal 自动恢复、三条正式连接的 WAL 配置及真实 contextBridge 字段保留；
> 打包 App 在写事务中 SIGKILL Core 后自动重启并恢复工作区，1024 行已提交数据保留。
> 可选功能启动故障已从 authority ready 分离，真实 Core 与打包 App 验证单功能降级、同进程重试和工作区不重挂载；
> Windows 正式目录 preparation 改为壳层 assessment，跨平台组合测试通过。原生 Windows helper / 文件身份验证由
> Windows x64 CI 承担；macOS 结果不作为 Windows 实机 UI 验收。

前置基线：[v1.29](../v1.29/README.md)按本分支切换时事实转为 historical。
合入文件预览分支后，[v1.30](../v1.30/README.md)也按已有范围、实施状态与验收记录冻结；本版本继续作为唯一 current。

## 版本目标

Desktop 窗口和本机恢复能力不再与 SQLite authority 的成功打开绑定。Rovai 可以在数据库迁移、另一个 Core 占用、
偏好损坏或 Core 意外退出时保持壳层可用，同时仍保证只有一份经租约和票据准入的权威工作区。

## 交付范围

- BrowserWindow 在异步偏好加载和 Full Core 启动前创建；本机主题、重试、Supervisor 与 bootstrap diagnostics 不依赖
  SQLite；偏好损坏使用内存默认、告警并保留原文件；
- Core 先取得绑定 canonical directory/object identity 的 OS lease；第二个 Core 返回 typed owner state，不做 SQLite
  recovery；
- `DatabaseAdmission` 对 Rovai/Lumen main/WAL/journal/SHM 做无创建观察和只读优先合同探测；正常日志恢复在 lease 内
  由 SQLite 完成并重新准入，探测自建空 WAL/SHM 不误报 identity race，返回 one-shot ticket 或 typed blocker；
- confirmed absence 才在 staging 初始化 `rovai.sqlite`，发布前再核对并原子 create-if-absent；只有
  `lumen.sqlite` 时精确打开/迁移，不制造 `rovai.sqlite`；
- 支持旧合同用 SQLite Backup API 一致复制，在副本上迁移、seed、quick/FK check、checkpoint；原 artifacts、identity
  manifest 与 exact filename 原子切换支持进程中断恢复；
- existing/new/migrated 三条正式连接路径统一配置 WAL、NORMAL 同步与 foreign keys，DELETE 仅用于 staging 发布；
- bundled `rusqlite` 升到 0.40.2，bundled SQLite 为 3.53.2，满足 `>= 3.51.3`；
- Core stdout 发布 schema-1 startup frame；Main Supervisor 用 generation + child token fence 迟到 frame/event/exit，
  完整 snapshot revision 驱动 Renderer capability gate；
- 确定性准入阻断不使用 crash budget。只有显式 shutdown 跨 generation 失败全部请求；普通 child 只失败自己的 pending；
- Main/Preload 使用结构化 value/failure transport；failure 以普通对象穿过真实 contextBridge，Renderer outward API
  仍是 `Promise<T>`，错误保留类别、code、retryable、generation 与 details，统一读取函数不退化为 `[object Object]`；
- 正常 App tree 仅在 `authoritativeWorkspace` ready 后挂载，阻断期间不查询权威工作区、不展示合成空列表；
- First-run admission 从 Core ready 的 `current.origin = initialized | existing | migrated` 得出，不再检查 SQLite 文件名。
- DB 后的权威恢复失败发布 typed refusal；Skill/MCP/adapter/Builtin IPC/附件及维护移到 ready 后，以 `coreSubsystems`
  门禁和原进程重试隔离故障，不卸载工作区。pending cleanup 限定到启动候选，不能清理新建 Camp；
- Windows 先准入 Core-independent 私有壳层并判定 single-instance，再 assessment 正式 data root；失败显示壳层而不
  spawn Core，重试用原参数 relaunch。正式数据布局与 DACL 约束不变。

## 明确不做

- 不建立 fallback/temporary SQLite，不把空库或空列表作为降级后的正常 Rovai；
- 不自动 quarantine、删除或覆盖未知 main/WAL/journal；孤立 SHM 也必须通过 ticketed identity revalidation；
- 不把每个 SQLite busy、偏好或边车错误永久升级为全产品不可用；
- 不在 Bootstrap Shell 暴露 Camp、成员、Memory、Navigation 或伪造业务 empty state；
- 不改变模型上下文、Agent Runtime、Camp/Message/Task/Memory 领域合同。

## 核心验收口径

- 两个 Core 同目录时第二个实例保持壳层并显示占用，且不创建/迁移数据库；
- `lumen.sqlite` 单独存在时不出现 `rovai.sqlite`；孤立 WAL/journal 阻断，孤立 SHM 仅在 identity 未变时清理；
- absence assessment 零写入，初始化竞态不能覆盖突然出现的 target；
- 支持历史 fixture 在副本上迁移并保留业务值；原子切换前强杀进程后可恢复再迁移，原 authority 保留；
- DELETE/WAL 写事务中强杀 Core 后，正常日志恢复保留已提交数据；打包 App 自动重启 Core 并重新挂载工作区；
- migration/lease/admission failure 只阻断 Full Core，主题、重试与 bootstrap diagnostics 可用；
- Snapshot revision 单调、ready 前 capability false、确定性阻断 restartAttempt 保持 0；
- domain rejection 与 infrastructure failure 跨 Core/Main/Preload/contextBridge 到真实 Renderer 后仍可区分；
- preference 损坏不被启动自动覆盖，并作为 `localDegradations` 展示；
- Renderer authority gate 前没有业务请求或 fake empty list。
- Skill/MCP/Runtime 私有目录与维护故障下，真实 Core ready、成员/导航 RPC 可用；移除故障后同 generation 恢复；
- Windows native preparer 不可用/超时/异常输出/ACL 拒绝仍提供壳层 assessment，secondary 不执行正式 preparer。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与版本索引保持唯一 current v1.31；v1.29 与合入的 [v1.30](../v1.30/README.md)按各自已有实施和验收事实转为 historical。 |
| Decisions | 已更新 | [V1.31-D01–D06](decisions.md#v1-31-d01)记录壳层分层、准入票据、copy migration、Supervisor/偏好/Onboarding、可选功能门禁与 Windows 独立壳层 profile。 |
| Contracts | 已更新 | 新增 [Desktop Runtime Availability v1](../../contracts/desktop-runtime-availability-v1.md)，补充 [Windows Private Storage v2](../../contracts/windows-private-storage-v2.md)，并以 [First-run Onboarding v3](../../contracts/first-run-onboarding-v3.md)替代 v2 当前入口。 |
| Architecture | 已更新 | 新增 [Availability-first Runtime](../../architecture/availability-first-runtime.md)，同步基础不变量与 First-run 组件边界。 |
| UI | 已更新 | 新增 [Desktop Bootstrap Shell](../../ui/components/bootstrap-shell.md)，首次训练明确位于 Full Core capability gate 之后。 |
| Runtime Activity | 确认无需更新 | 本版本不改变 Runtime Evidence、Canonical Activity 或 mapping registry。 |
| Runtime compatibility | 确认无需更新 | 不新增或改变 Agent Runtime；SQLite 库升级不是 Runtime compatibility 结论。 |
| Documentation routing | 已更新 | 总导航、Architecture、Contract、UI 与当前决定导航均加入 availability-first 入口。 |
| Root README | 确认无需更新 | 不改变产品定位或已经发布的常青能力声明。 |

## References

- [实施计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Availability-first Runtime](../../architecture/availability-first-runtime.md)
- [Desktop Runtime Availability v1](../../contracts/desktop-runtime-availability-v1.md)
- [First-run Onboarding v3](../../contracts/first-run-onboarding-v3.md)
- [Desktop Bootstrap Shell](../../ui/components/bootstrap-shell.md)

## 后续版本

2026-08-30 渠道分支合并后，本版本按主线既有范围与验收证据冻结为 historical；
[v1.33 钉钉与渠道集成](../v1.33/README.md)成为唯一 current，并保留本版本的启动准入与恢复能力。
