---
document_type: version-overview
version: v0.49
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-09
---

# Rovai-ai v0.49：通用、启动与新对话设置、双人追问 Skill

> 当前状态：通用与启动设置已完成 Desktop Shell、Preload、Renderer 生产实现、自动回归与打包 App
> 的主窗口会话验收；已安装 App 的真实登录项开关、系统授权态和外接显示器矩阵仍待最终人工验收。
> 两个自包含双人追问官方 Skill 已完成源码、Core bundled manifest 和定向验收。
> 两个范围都不改变 Camp、Task、AgentRun、Native Session、Memory、Approval 或执行恢复语义。
>
> 前置版本：[v0.48 Native Session Compaction Bootstrap Redelivery](../v0.48/README.md)
>
> 后续版本：[v0.50 Self Identity 与 Collaboration Projection 边界](../v0.50/README.md)

## 版本目标

v0.49 在设置侧栏顶部增加“通用”，形成以下固定顺序：

1. 通用；
2. Skill；
3. MCP；
4. Agent 运行时；
5. 外观；
6. 通知；
7. 诊断。

“通用”页面管理四类桌面体验：

- 使用 macOS 登录项开启或关闭“登录时启动 Rovai-ai”；
- 选择每个新的 Main Window Session 打开 Quick Chat 还是最近的 Restorable Location；
- 显式保存新对话默认队员与 Lead，并可在确认后开启一键创建；
- 说明窗口大小与位置会自动保存，并提供“重置窗口大小与位置”。

再次进入设置时继续打开用户最后选择的设置分类；设置本身以及 Dialog、Drawer、命令面板、
Approval、Toast 等临时表面不成为启动目标。

## 新对话与当前项目

默认队员/Lead 在全新安装时保持未配置，只有满足约束并点击“保存默认配置”后才原子生效。一键
创建默认关闭，每次开启都显示包含四类入口项目规则、队员与 Lead 的明确确认 Dialog。队员永久移除、暂时
离队、缺失或 Lead 失效时，保存配置锁存为需要重新确认；不删除队员、不替换 Lead、不自动关闭
开关，Runtime readiness 不参与结构有效性判断。

Renderer 持久维护当前项目。项目名称主行同时选择当前项目并切换展开，不显示独立折叠按钮；`＋` 只按对应项目创建；
普通、置顶和快速对话分组统一按 5 条起步、每次 10 条“查看更多”。取消 Dialog 不改变当前项目。
关闭一键创建时左上入口、两个文件夹 `＋` 与“项目”标题 `＋` 都打开同一个创建 Dialog；开启且配置有效时直接
使用目标项目、默认队员、默认 Lead 和固定 `peer` 语义创建空 Camp，失败或失效则保留项目回退
Dialog，并明确列出本次过滤的队员、Lead 临时调整及不回写保存配置。创建 Dialog 删除全部协作方式 UI，并把可选名称升级为可聚焦折叠面板、Unicode 80 字计数
与清空操作；Core/SQLite 的既有 collaboration mode 合同不变。

## 官方双人追问 Skill

v0.49 把以下两个 Skill 加入 Rovai 官方受管集合；它们与既有官方 Skill 一样默认启用、默认不选择
任何 Skill Delivery Group：

- `rovai-grill-duo`（“双人追问”）：当前队员逐项追问，一位固定的合格 Camp 搭档通过显式公共 A2A
  往返提供独立解释、利弊、可逆性和推荐答案；
- `rovai-grill-duo-with-docs`（“双人追问与文档”）：执行同一双人协议，并在结论形成时维护领域词汇和
  满足门槛的 ADR。

两者都是完整不可变 Revision，不依赖同一 Runtime 另行发现或分配 `grill-me`、`grill-with-docs`、
`grilling` 或 `domain-modeling`。文档版随包携带 duo protocol、domain-modeling、词汇表和 ADR 参考；
仓库自己的 `AGENTS.md`、文档导航和格式规则始终优先。

协作只使用当前 `camp.message.send` / `rovai send` 公共 A2A 与 Message Delivery。发送成功不代表搭档
已经开始或完成，Skill 不轮询、不伪造第二观点，也不建立协议级自动回复义务。没有合格搭档时明确降级
为单人逐项追问。长期边界见 [ADR-0144](../../adr/0144-self-contained-duo-grilling-bundled-skills.md)。

## 已确认的启动语义

### 每个主窗口会话只解析一次

`启动后打开` 的边界是新的 Main Window Session，不是 Electron 进程冷启动：

- 冷启动创建主窗口时解析一次；
- macOS 关闭最后窗口但进程仍存活，之后从 Dock 重新创建主窗口时重新解析一次；
- 已有窗口时再次启动应用或点击 Dock，只恢复、聚焦该窗口，不改变当前页面；
- 最小化恢复、Core restart、Navigation refresh 和普通页面切换不重新解析。

默认模式是“上次使用的位置”。全新安装没有恢复记录时进入 Quick Chat；用户选择“快速对话”
后，每个新 Main Window Session 都从 Quick Chat 首页开始。

### 成功显示即提交稳定位置

Restorable Location 是最近一次经过权威数据验证并成功显示的稳定一级位置，而不是退出时对
最后一帧 UI 的快照。Quick Chat、Camp、队员页及其可选队员/页签、记忆页成功显示后立即提交；
设置页和所有临时表面不写入。应用崩溃或被强制退出不需要执行额外的 quit-time 保存。

恢复时必须区分“确定失效”和“暂时不可验证”：

- Camp 已被权威数据确认删除：回退 Quick Chat，并在 Quick Chat 成功显示后提交新目标；
- 队员已被权威数据确认移除：进入队员页，按 Member Order 选择首个可管理队员并保留所请求
  的“身份 / 运行配置”页签；没有可管理队员时显示队员空状态；
- 偏好或恢复记录损坏：使用安全默认值并回退 Quick Chat，不能阻止窗口显示；
- Core 尚未就绪、正在重启或发生暂时通信失败：保留原目标并继续等待/重试，不清除记录，
  也不重新执行启动路由。

Camp 和队员的有效性必须读取现有 Core 权威数据，不能只凭 Electron 文件中的 ID、旧 Navigation
Snapshot 或 Renderer 内存状态判断。

## 登录项与窗口边界

登录项只在已安装的 macOS 应用中可配置。Electron Development 模式显示
“仅在已安装的 Rovai-ai 应用中可配置”，不尝试注册开发入口。系统状态是唯一真源：
全新安装不会自动注册登录项，因此默认关闭；若系统已经保留有效注册，则界面直接呈现系统状态，
不能为了实现“默认值”强制覆盖它。

| macOS 状态 | 开关 | 产品说明 |
| --- | --- | --- |
| `enabled` | 开 | 已生效 |
| `not-registered` | 关 | 未注册 |
| `requires-approval` | 开 | 已注册但等待系统授权，当前尚未生效；提供“打开系统设置” |
| `not-found` | 关 | 登录项服务不可用；提示重新安装或修复应用 |

`requires-approval` 时用户仍可关闭开关以取消注册。每次写入后必须从系统重新读取；应用偏好文件
不保存第二份登录项 Boolean。本版本不设置 `openAsHidden`，登录启动与普通启动使用相同可见窗口。

窗口大小与位置始终自动保存。重新打开时，保存的几何必须限制在当前可见显示器的 work area；
原外接显示器已经移除时，窗口仍须完整可见。“重置窗口大小与位置”恢复 `1440×920` 默认尺寸
（受当前显示器 work area 约束）并在当前显示器居中，不改变页面、Camp、草稿或运行状态。
全屏时禁用重置并说明先退出全屏，不排队延迟执行。

## 数据与架构边界

v0.49 的启动模式、最后设置分类、新对话默认配置、Restorable Location 和窗口几何只属于
Electron Desktop Shell；当前项目属于 Renderer 本地偏好：

- 不进入 Rust Core 或 SQLite；
- 不产生 Camp event、Task mutation、AgentRun、Native Session、Approval 或 audit；
- Renderer 只通过受类型约束的 preload bridge 读取和提交 Shell 状态，不读取任意本地文件；
- Shell 文件缺失、字段未知、版本不支持或 JSON 损坏都必须退化到安全默认值；
- Core 只继续提供已有的权威只读查询，用于验证 Camp 或 Member 是否仍有效，不接收桌面偏好写入。

桌面设置范围不创建 ADR：它没有改变现有 Core、Runtime、合同或跨版本系统结构，属于可在 Desktop
Shell 内部演进的产品偏好与 Renderer 交互。官方 Skill 集合和自包含协作边界由 ADR-0144 单独拥有；
其 Rust 改动扩展 bundled manifest，不改变 SQLite schema、Skill 投递合同或 Runtime Adapter。
本版本另行修复既有启动兼容标记漂移：启动检查现在与 Migration 66 写入的 Data Contract
`v0.48 / schema 26` 一致，避免当前数据库在 Core restart 时被误判为旧合同并执行 clean reset；
该修复不新增 Migration，也不放宽对真正旧合同的拒绝。

## 本版本不做

- 语言切换；
- 隐藏启动或后台静默启动；
- 关闭窗口时退出或留在后台的设置；
- 自动批准或恢复未完成执行的开关；
- 默认模型、Runtime、权限或 Memory 配置；
- 把某个固定 Project 配置为启动后一级页面；当前项目只服务新建目标，不改变启动路由；
- 系统通知规则；
- 自动更新。

## 验收阈值

1. 全新安装默认进入 Quick Chat，默认启动偏好仍显示“上次使用的位置”；
2. Camp、队员及页签、记忆页分别可跨 Main Window Session 恢复；从设置或任意临时表面关闭
   窗口时仍恢复之前的稳定一级位置；
3. Camp 删除、队员移除、偏好损坏与恢复记录损坏均按上述确定性规则安全降级；Core 暂时失败
   不清除仍可能有效的目标；
4. 外接显示器移除后窗口仍可见；重置恢复默认尺寸并在当前显示器居中；全屏时不执行或排队；
5. 已安装的 macOS App 可开启、关闭登录项，并诚实呈现 `requires-approval` 与 `not-found`；
   Development 模式不可配置；
6. `pnpm docs:check`、TypeScript typecheck、相关 Vitest、Desktop build、packaged App
   双窗口会话与登录项实测全部通过；
7. 对 General 设置进行读写、重置窗口和解析启动位置不会新增 Camp、Task、AgentRun 或 audit 事实。
8. 新 Core 安装四个官方 Skill，全部默认启用且未分组；两个 Duo Revision 均携带完整运行依赖，
   Skill 结构校验、Core bundled installation test、Skill smoke 的默认集合断言和文档校验通过。
9. 默认配置必须显式原子保存；Member lifecycle 失效锁存且不自动修补，Runtime readiness 不误伤；
10. 当前项目跨新主窗口恢复；目录整行按顺序选择并切换展开，`...` / `＋` 独立；三类分组按
    5/10 规则增量展开，三类创建入口按开关直接创建或回退同一 Dialog；
11. 创建 Dialog 不再出现任何协作方式文案，Footer 无模式摘要，名称面板具备聚焦、计数和清空。
12. 当前 Data Contract 在 Core restart 后保持原数据库，Imported Skill 与正在沿用的记忆均不会因
    `v0.47 / schema 25` 的过期启动常量而被 clean reset。

实施检查点与证据入口见[实施与验收计划](implementation-plan.md)，精确 UI 与 Shell 合同见
[生产设计](production-design.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | `docs/versions/README.md` 将 v0.48 冻结为 historical，并把 v0.49 设为唯一 current；本概览与实施计划已建立 |
| ADR | 已更新 | ADR-0144 替代 ADR-0109，冻结四个官方 Skill、自包含 Duo Revision 与异步公共 A2A 协作边界；Desktop Shell 范围仍确认无需独立 ADR |
| Contracts | 确认无需更新 | 不改变 Agent/Core CLI、Envelope、receipt、Task、Message Delivery 或其它长期 wire contract；Duo Skill 只使用既有 `camp.message.send` v2，Main/Preload/Renderer 类型属于版本内桌面实现 |
| Architecture | 确认无需更新 | 现有 Skill Library、immutable Revision、Runtime-group projection、Built-in Tool、A2A 与 Bootstrap 组件职责和传输关系均未改变；除扩展 bundled content manifest 外，只同步启动兼容标记与既有 Migration 66 Data Contract，不改变 reset 架构 |
| UI | 已更新 | `docs/ui/README.md` 与 `docs/ui/arctic-dawn.md` 增加七分类设置、General 页面、启动恢复、登录项、窗口行为及四个内置 Skill 清单；领域词汇同步更新 `CONTEXT.md` |
| Runtime Activity | 确认无需更新 | Desktop Shell 偏好、窗口几何和登录项不产生或改变 Canonical Runtime Activity |
| Runtime compatibility | 确认无需更新 | 不改变任何 Agent Runtime adapter、版本或发现能力；既有 Skill native-discovery smoke 仅扩展官方默认集合断言，不产生新的兼容性结论 |
| Documentation routing | 确认无需更新 | `docs/README.md` 已通过版本索引的唯一 current 指针路由版本工作，不需要硬编码 v0.49 专门入口 |
| Root README | 确认无需更新 | 项目定位、常青能力与支持的 Agent Runtime 范围没有变化；版本流水账只属于 `docs/versions/` |

## References

- [v0.49 生产设计](production-design.md)
- [v0.49 实施与验收计划](implementation-plan.md)
- [ADR-0144：自包含双人追问官方 Skill](../../adr/0144-self-contained-duo-grilling-bundled-skills.md)
- [Arctic Dawn V3 设置与窗口合同](../../ui/arctic-dawn.md#设置)
- [Rovai-ai 领域词汇表](../../../CONTEXT.md)
