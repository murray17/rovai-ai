---
document_type: version-decisions
version: v0.20
lifecycle: historical
last_updated: 2026-08-18
---

# v0.20 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0066](#adr-0066) | Managed Product Runtime Discovery, Resolution, and Relocation | `accepted` |

<!-- legacy-adr:begin id=ADR-0066 source-file-sha256=fdbdc6575387fc0aa9cb2cae6919f03e3bdcca8bd6fa20bb18663bfd2fcda2c5 -->
<a id="adr-0066"></a>

## ADR-0066: Managed Product Runtime Discovery, Resolution, and Relocation

迁移时原路径：`docs/adr/0066-managed-product-runtime-resolution.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0066
title: Managed Product Runtime Discovery, Resolution, and Relocation
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.20
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0066 -->
<a id="adr-0066-context"></a>
### Context

Rovai 的九种已实现 Adapter 是稳定的产品能力目录，但用户本机是否安装、实际入口位于
何处、当前是否登录以及能力是否兼容，都是会随 Shell、包管理器升级和上游版本变化的
动态事实。旧流程把可执行文件发现、完整 Session 探测、Installation 登记和成员选择混在
一次 `health.check` 中，并在成员配置里直接暴露 Installation 路径。这会造成以下问题：

- Electron 启动环境通常拿不到用户登录 Shell 的完整 `PATH`；
- 成员页只有发现到路径的 Runtime 可选，并可能等待所有 CLI 的深度探测；
- CLI 升级或包管理器移动 shim 后，已有成员会因旧绝对路径失效而永久阻塞；
- 普通用户被迫理解 Installation、路径和能力快照，而不能只选择产品；
- 发现证据、最近一次成功能力证据和最近一次失败尝试相互覆盖，无法安全软刷新；
- Run 准入若临时发现状态过期，缺少一个既不丢发送请求、又不创建半冻结 Run 的恢复边界。

该问题涉及启动环境、安全探测、持久化身份、成员配置和 Run 冻结，改变成本高，必须形成
跨版本约束。

<a id="adr-0066-decision"></a>
### Decision

<a id="adr-0066-1-产品目录与本机可用性分离"></a>
#### 1. 产品目录与本机可用性分离

`Product Runtime Catalog` 是编译时封闭目录，只包含已经接入
`AgentRuntimeAdapter` 且可冻结 AgentRun 的九种 Runtime。目录项始终显示，不因本机
缺少可执行文件而消失。兼容性文档中的未接入候选不得进入目录、Contracts 或普通 UI。

`Product Runtime Availability` 是目录项在当前机器上的动态投影；成员自己的
`Runtime Readiness Projection` 是另一层状态。产品 UI 使用“已就绪”，不使用英文
`Ready` 作为用户文案。

<a id="adr-0066-2-使用应用自有的-runtime-search-environment"></a>
#### 2. 使用应用自有的 Runtime Search Environment

Core 在创建 Tokio Runtime 之前同步构建不可变的 `Runtime Search Environment`。它按
以下优先级提供候选来源：

1. 对既有 Installation，仅先验证其精确绝对路径；
2. 高级功能显式配置的自定义入口；
3. Adapter 专属 `ROVAI_*_BIN`；
4. Electron/Core 继承的 `PATH`；
5. 非交互 login shell 提供的 `PATH`；
6. 当前平台已知目录。

候选必须规范化、可执行校验并去重，同时保留来源。Core 不修改进程全局 `PATH`；发现、
版本命令、深度探测和真实 Runtime 启动都显式接收同一快照的 `PATH`。显式重新检测产生
新快照并原子替换，不能改变已经启动的 Agent 子进程。

自动启动阶段只允许以无 TTY、stdin 关闭的 `$SHELL -lc` 读取带随机边界标记的 `PATH`，
总时限三秒。不得读取、保存或记录其他 Shell 环境变量、凭据、原始 stdout 或 stderr。
用户显式点击重新检测时，可以运行 `$SHELL -ilc`；UI 必须说明这会执行用户的 Shell
初始化配置。Shell 失败时继续使用继承 `PATH` 和已知目录。

v0.20 的交付与验证平台仅为 macOS 14+ Apple Silicon。接口应允许未来增加 Windows 和
Linux 来源，但当前不得声称支持 Windows shim 或 Linux 桌面交付。

<a id="adr-0066-3-快速发现与深度探测拥有不同权威"></a>
#### 3. 快速发现与深度探测拥有不同权威

`Runtime Discovery Observation` 是可重建、非持久权威的快速观察，只包含路径解析、
文件存在性、可执行权限、来源、fingerprint 和可选版本。路径确认后必须立即发布
`found_uninspected`；Adapter 定义的 `--version` 类命令随后以最多两秒、无 stdin、
有界输出和完整进程树终止策略执行。版本失败不把已找到候选降为缺失。

快速发现不得执行认证、ACP initialize、临时 Session、模型目录或权限能力检查。UI
不等待发现完成：Core 完成数据库与 IPC 初始化即对 Electron 报内部 ready，首页不弹
Toast；九个目录项先显示“正在检测”并逐项更新。

`Adapter Capability Snapshot` 是某个 Installation 最近一次成功深度探测的持久证据，
包含协议、认证、模型、权限、必需能力与 Session 兼容信息。`Adapter Probe Attempt`
单独保存最近尝试、失败分类和退避，失败不得覆盖或伪造最近成功快照。

未登记候选默认不做深度探测。只有用户选择该 Product Runtime、创建或解析
Installation、刷新已登记 Installation、显式检查，或 Run 准入确有需要时才执行。
进入成员页只能读取/订阅缓存，不能重新启动全部 CLI。

<a id="adr-0066-4-普通成员持久选择产品installation-作为内部共享身份"></a>
#### 4. 普通成员持久选择产品，Installation 作为内部共享身份

普通成员配置持久保存 `Product Runtime Selection`，即 `AdapterKind`，而不是路径或
Installation ID。即使本机尚无 Installation，选择也必须保存；成员保持
`selected_unresolved` 且不可执行，不得回退到另一 Runtime，也不得伪造模型或权限默认值。

每个 `(AdapterKind, authScope)` 恰有一个 `Managed Default Installation` 为普通选择
服务。发现可用入口后，Rovai 自动深度探测，并创建或复用该共享 Installation 来解析所有
匹配选择。Installation ID 是成员、Camp 与恢复使用的稳定内部身份；执行路径可以改变。
自定义 wrapper 是高级功能，单独登记，只有显式提升后才替代 managed default。

真实快照产生后，模型可以自动使用 Adapter 声明的 `runtime_default`。权限只可自动采用
Rovai 审核过的安全推荐值；必填但没有安全默认值时保持 `configuration_incomplete`。
危险的 bypass、yolo、allow-all 类值不得自动启用。Schema 来源与版本必须入快照，
Schema 变化后重新验证成员配置。

<a id="adr-0066-5-刷新采用最近成功证据与失败分类"></a>
#### 5. 刷新采用最近成功证据与失败分类

已登记 Installation 最近一次成功深度探测超过 24 小时，仅产生软
`refresh_due`：后台刷新但不阻塞 Core ready、UI 或 Run，并在刷新期间继续使用上次成功
快照。失败尝试不重置成功时间，重试采用内部退避。

同一 fingerprint 下的 timeout、I/O、网络或模型目录失败默认属于暂时失败；保留
`ready`，UI 可显示“刷新失败，仍使用上次成功检查”。路径丢失、fingerprint 或启动配置
改变、明确未认证、协议不兼容或缺少必需能力属于硬失效，旧快照只保留作诊断，不再允许
准入。无法分类的失败在没有身份或安全事实变化时按暂时失败处理。

被停用的 Installation 不得在后台自动启动。24 小时策略只适用于已登记 Installation；
未登记候选仍只做快速发现。

<a id="adr-0066-6-路径失效时自动执行经过验证的原位迁移"></a>
#### 6. 路径失效时自动执行经过验证的原位迁移

既有 Installation 路径消失时，Rovai 按相同 Adapter、相同 `authScope` 与保存的原始
命令名搜索候选。每个候选依次通过规范路径、可执行权限、fingerprint、有界版本命令和
完整深度探测；首个达到该 Adapter 已就绪条件的候选才可提交。

提交必须在一个事务中更新同一个 Installation ID 的路径、来源、fingerprint、成功快照
和版本，并写入不含秘密的迁移审计。不得先写新路径再探测，也不得迁移到另一 Adapter。
首选失败时继续下一候选；全部失败时保留 Installation 并标记 `path_missing`。

已经启动的 Agent 子进程继续使用其冻结入口。历史 AgentRun 保存的路径、版本和
fingerprint 永不改写；尚未启动但已经冻结旧入口的 Run 进入现有 recovery/fencing
流程，不得静默改写冻结配置。

<a id="adr-0066-7-run-准入通过可持久恢复的-resolution-job-衔接"></a>
#### 7. Run 准入通过可持久恢复的 Resolution Job 衔接

发送时若产品选择尚未解析，或发现路径、fingerprint、快照发生硬失效，Core 必须为该
请求创建去重的 `Runtime Resolution Job` 和 `Pending Execution Intent`。UI 保留原草稿并
显示“正在检查执行引擎…”。只有解析成功后，原请求才继续，并原子创建公开消息、
CampTurn、AgentRun 和完整冻结配置。

解析失败或用户“取消发送”时，不得创建公开消息、CampTurn 或 AgentRun，草稿继续保留。
Pending intent 必须持久保存请求 identity、目标和有界输入，使 Core 重启后能继续同一次
发送；后台发现和健康刷新任务本身不需要持久化成 Job。

<a id="adr-0066-8-native-session-兼容性不由路径或版本单独决定"></a>
#### 8. Native Session 兼容性不由路径或版本单独决定

版本或 fingerprint 改变只触发重新探测，不自动禁止 Resume。Adapter 通过
`Native Session Compatibility Key` 声明已知兼容关系。兼容性未知时，允许在发送任何
用户输入之前进行一次 `Controlled Native Session Resume`。

受控尝试必须使用新的 binding generation/fence；每个 Conversation 与 Installation
generation 最多一次。明确不兼容、Session 不存在、超时或结果含糊时，终止并 fence
旧 Host，再创建新 Session。旧 Host 的迟到事件不得推进 marker。Camp、Conversation 和
Rovai 的便携上下文在任何结果下都不得丢失。

<a id="adr-0066-9-路径与诊断只属于高级界面"></a>
#### 9. 路径与诊断只属于高级界面

普通成员页只展示九种 Product Runtime 及其成员就绪状态。Runtime 设置页展示产品状态、
检查操作和安装说明；可执行路径、候选来源、fingerprint、最后探测时间、退避与自动迁移
审计只在高级诊断中显示。未找到项仍可点击，并提供重新扫描、安装说明和高级自定义入口。

项目仍处于预发布阶段。v0.20 采用干净的新 Runtime 数据模型，不为旧的路径型成员选择、
重复 Installation 或旧 snapshot 语义实现兼容迁移。

<a id="adr-0066-consequences"></a>
### Consequences

- 普通用户只需选择产品，选择在安装缺失、升级和路径移动后仍保持稳定。
- 启动可快速进入可交互状态，不会为九种 CLI 建立 Session，也不会污染全局环境。
- 最近成功证据和失败尝试分离后，软刷新可以提高时效性而不制造无谓停机。
- 自动迁移无需用户确认，但通过同 Adapter、完整探测、事务更新和审计降低误绑风险。
- Run 准入与恢复需要新的持久 Job、请求去重和取消语义，数据库与 Core 编排复杂度增加。
- Adapter 必须定义发现命令、深度探测的成功条件、安全默认值和 Session 兼容键。
- 高级 wrapper、未来 Windows/Linux 来源必须沿用相同权威与安全边界，不能绕过探测。

<a id="adr-0066-rejected-alternatives"></a>
### Rejected Alternatives

- **只显示本机已安装 Runtime。** 会让缺失产品无法持久选择，也无法自动恢复。
- **成员直接选择 Installation 或路径。** 把包管理器与文件系统细节暴露给普通用户，
  并让路径移动破坏领域引用。
- **启动时对全部候选执行完整 health.check。** 会阻塞界面并启动不必要的 CLI Session。
- **把 login-shell PATH 写回进程环境。** 会污染 Electron、MCP 和并发子进程，且难以审计
  每次执行实际使用的搜索环境。
- **发现新同名路径后立即改数据库。** 可能把全部成员静默切换到错误程序。
- **多个候选时要求普通用户确认。** 与无人干预恢复目标冲突；顺序探测已经提供安全门槛。
- **版本或 fingerprint 变化后一律丢弃 Native Session。** 会把实现变化误当作 Session
  不兼容，造成不必要的上下文重建。
- **为尚未发布的旧 Runtime 数据保留兼容层。** 会让新领域模型永久承担无产品价值的复杂度。

<a id="adr-0066-references"></a>
### References

- [v0.20 版本范围](README.md)
- [v0.20 架构设计](architecture.md)
- [ADR-0065：Verified Runtime Catalog](../v0.19/decisions.md#adr-0065)
- [ADR-0007：Portable Conversation Handoff](../v0.03/decisions.md#adr-0007)
- [ADR-0062：Interruptible Runs and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
<!-- legacy-adr-body:end id=ADR-0066 -->
<!-- legacy-adr:end id=ADR-0066 -->
