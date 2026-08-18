---
document_type: version-decisions
version: v0.98
lifecycle: historical
last_updated: 2026-08-18
---

# v0.98 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0203](#adr-0203) | Structured Current Input Skill Links | `accepted` |
| [ADR-0204](#adr-0204) | On-Demand Runtime Deep Verification with Manager-Owned Attempts | `accepted` |

<!-- legacy-adr:begin id=ADR-0203 source-file-sha256=3215c490130b719b1af1f7ec5c3ca8006e594de49f83e7f34eb2886429f7cebc -->
<a id="adr-0203"></a>

## ADR-0203: Structured Current Input Skill Links

迁移时原路径：`docs/adr/0203-structured-current-input-skill-links.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0203
title: Structured Current Input Skill Links
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v0.98
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0203 -->
<a id="adr-0203-context"></a>
### Context

Composer 的 Skill Picker 过去只写普通 `/name` 文本。Core 因而无法区别用户明确选择的 Rovai Skill 与
手写 lookalike，也无法在不解析自然语言的前提下，把当前 AgentRun 真正可见且经完整性验证的 Skill 文件
告诉模型。另一方面，SkillProjection 是 execution-root、Runtime Group 和 start-time 状态相关的共享可变
视图；把路径写进 CampMessage、在 Draft 时冻结，或仅凭仍存在的旧 link 决定可用性，都会产生错误身份或
绕过后来 disable/unassign/delete 的结果。

ADR-0105 已拒绝为不支持 Runtime 原生发现的场景注入 Prompt Skill fallback。当前需要的是更窄的能力：
用户明确选择、发送时有资格且在该 Run start time 已由现有原生投影 preflight 证明为 ready 时，只提供同一
原生投影中 `SKILL.md` 的文件指针，不内联内容、不模拟不支持的 discovery，也不宣称 Runtime 已加载。

<a id="adr-0203-decision"></a>
### Decision

Picker 选择保存为 closed Structured Content 中的 `SkillMention(skillId,nameAtSend)`，正文始终投影为
`/nameAtSend`。普通输入、粘贴和历史 Slash 文本不升级为结构化 Skill。

Direct user send 在每个 AgentRun 的冻结 Runtime 配置已确定后，于同一事务保存 per-Run
`SkillSelectionSnapshot`。只有发送时 Skill 仍存在且 active、enabled、名称一致，并至少有一个 Assignment
与该 Run 的冻结 Delivery Groups 相交，选择才有发送资格。发送时无资格不能因后来启用或重新分配而回溯。

首次 Context materialization 在 Core serialized preparation critical section 内重新冻结当前 Library
availability，并与该 Run 的全量 verified `SkillExposureSnapshot` 相交。一个 Core-owned、只读的解析
Module 按稳定 Group precedence 选择同 ID、同名、ready 的 exposure，并只从可信 `entryPath` 派生
`entryPath/SKILL.md`。合法 missing、disabled、unassigned、renamed、shadowed 或非-ready 状态静默省略；
任何现有全量 projection `error`、`stale`、Revision/content digest 或 ownership 完整性失败仍阻止 Runtime
launch，不能缩窄为 selected-only preflight。

成功解析的选择进入 mandatory final `CURRENT_INPUT` 的 optional sibling field：
`skills: [{name,path}]`。正文和附件不改变；零 entry 时省略整个字段。`skillId`、Revision、digest、Group、
availability 和 omission reason 只属于 Core state 与 ContextManifest Evidence。Runtime Adapter 继续传输
现有完整 Dynamic Context，不增加 Provider-specific Skill item。

这不是 ADR-0105 所拒绝的 Prompt Skill fallback：它不为 unsupported discovery 内联或复制 Skill，不从
name 猜路径，不绕过 Assignment/Enablement/Projection，也不建立第二套 Runtime Skill protocol。
SkillProjectionReconciler 继续独占 filesystem side effect；Resolver 只消费已验证 Exposure。

ADR-0147 的四层 authority 保持分离：selection 与 start-time availability 是 Context Source State；
`CURRENT_INPUT.skills` 是 Model Context Projection；Exposure、resolution 和 exact bytes 是 Context
Projection Evidence；Runtime Input Delivery accepted ACK 不证明 Skill 文件被模型读取。

<a id="adr-0203-consequences"></a>
### Consequences

- 用户看见和发送的 Slash Marker 保持稳定，同时 Core 获得不可由 lookalike 文本伪造的选择身份。
- 同一共享消息的不同 AgentRun 可以根据各自冻结 Runtime Group 与 execution root 得到不同路径或省略结果；
  CampMessage 不被 Run-specific path 污染。
- 发送时与 start time 的双时点资格避免 late enable 回溯，也避免 active-Run protection 暂时保留的旧 link
  绕过当前 desired state。
- Context Formatter、ContextManifest 和 Data Contract 必须升级并 clean break 不兼容技术状态；旧普通文本
  不回填。
- 文件指针仍依赖 Runtime/模型自行读取；Rovai 只能证明指针的选择与投影完整性，不能证明实际 load。

<a id="adr-0203-rejected-alternatives"></a>
### Rejected Alternatives

- 扫描 `/name` 普通文本并匹配 Library：拒绝，因为手写/paste lookalike 会获得隐藏身份，历史文本也会被
  后来的 Library 状态重新解释。
- 在 CampMessage 或 Draft 中冻结绝对路径：拒绝，因为路径属于每个 Run 的 execution root、Runtime Group
  与 start-time Exposure，不属于共享消息或编辑期状态。
- 只读取 start-time Exposure、不保存发送时资格：拒绝，因为发送后启用或重新分配会回溯改变已接受输入。
- 只检查发送时资格、不读取 start-time desired state：拒绝，因为 disable/unassign/delete 后仍被 active
  Run protection 保留的旧 link 可能错误进入新 Run。
- 内联 Skill 内容、创建 per-Run copy 或增加 Provider-native Skill item：拒绝，因为会建立第二套 Skill
  protocol、改变 Adapter transport，并混淆 Projection 与 Runtime load evidence。
- 对 selected Skill fail open、把未选择 Skill 从 preflight 排除：拒绝，因为会削弱现有 execution-time
  integrity 和 shared root ownership 门禁。

<a id="adr-0203-references"></a>
### References

- [v0.98 版本概览](README.md)
- [确认的模型上下文变更 revision 1](model-context-change.md)
- [ADR-0105](../v0.37/decisions.md#adr-0105)
- [ADR-0147](../v0.50/decisions.md#adr-0147)
- [ADR-0161](../v0.58/decisions.md#adr-0161)
- [ADR-0188](../v0.82/decisions.md#adr-0188)
- [Current Input Skill Links v1](../../contracts/current-input-skill-links-v1.md)
- [ContextManifest Evidence v16](../../contracts/context-manifest-evidence-v16.md)
<!-- legacy-adr-body:end id=ADR-0203 -->
<!-- legacy-adr:end id=ADR-0203 -->

<!-- legacy-adr:begin id=ADR-0204 source-file-sha256=22a12d17f31ad0223db1772be974eb72311f572554cd217aceeb1d6839926f4a -->
<a id="adr-0204"></a>

## ADR-0204: On-Demand Runtime Deep Verification with Manager-Owned Attempts

迁移时原路径：`docs/adr/0204-on-demand-runtime-deep-verification.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0204
title: On-Demand Runtime Deep Verification with Manager-Owned Attempts
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v0.98
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0204 -->
<a id="adr-0204-context"></a>
### Context

Product Runtime discovery曾在启动和重扫结束后隐式排队主动 Probe。Probe 会启动第三方 CLI、建立协议
Session、读取认证与模型目录；任一子进程、reader 或 worker 未正常返回时，分散在 worker 内的
`checking`/`scheduled` 清理还会留下永久“正在检查”。文件已安装、可以尝试运行与已经验证登录和协议能力
是不同证据，但旧公共状态把前两者投影为持续 checking。

<a id="adr-0204-decision"></a>
### Decision

1. 启动和 `runtime.discovery.rescan` 只执行 executable path、权限、metadata/fingerprint 与 Adapter 声明为
   无副作用的有界 one-shot 身份命令。只有该命令成功、输出未超限且能够识别基础版本或身份，非 TRAE
   Runtime 才生成 `light_ready` 静态证据；单纯找到 executable 是 `found_uninspected`，不能冒充 checking 或
   light-ready。`light_ready` 允许 Runtime-default 成员配置和尝试真实运行，但不声明认证、协议、模型、
   Session 或 capability Ready。TRAE 继续使用 ADR-0192 的 `installed_unverified` execution-deferred 特例，
   且静态阶段不执行 `traecli --version`。
2. discovery、rescan、应用启动、页面加载、成员选择、缓存失效和定时过期都不得自动触发深检。深检只由
   用户显式“检查可用性”或首次真实 AgentRun admission 发起；Adapter launch policy 可以进一步收窄允许目的。
3. UI 可以把 `light_ready` 表示为“可用”，其含义严格限定为当前 executable 已通过有界轻度启动与身份验证，
   是可选择、可尝试执行的候选。
   明确深检或真实启动失败后表示“需要处理”；fingerprint、待复验与 attempt identity 只属于内部诊断。
4. Runtime Check Manager 是 attempt lifecycle 的唯一所有者。每个 attempt 具有内部 `attempt_id`、Runtime、
   总 deadline 和 task identity；success、error、timeout、panic/JoinError、abort、cancel 与 shutdown 都通过同一
   finalize 路径移除 activity、唤醒 waiters并至多发布一个 terminal availability event。产品失败写产品诊断，
   supervisor deadline/panic 写 transient/internal 诊断；superseded、cancel 与 shutdown 只清理，不伪造产品失败
   或退避。
5. 同一 Runtime 同时最多一个 attempt；全局深检并发上限为二。真实执行优先于用户检查，用户检查优先于任何
   后台工作。本决定不启用后台深检或 24 小时自动刷新。
6. 深检提交必须同时匹配当前 search generation 与 executable fingerprint。身份改变只使旧深检证据失效并
   写入新的静态快照，不自动启动 Probe；旧 attempt 不得覆盖新身份。
7. 所有短生命周期 Runtime 子进程使用统一的受限 Probe process owner：独立进程树、绝对总 deadline、有限
   stdout/stderr 与单行容量、truncation 记录、bounded child/reader cleanup。当前交付平台使用 Unix process
   group 整树终止；未来支持 Windows 前必须提供等价 Job Object `KILL_ON_JOB_CLOSE`。

本决定局部覆盖 ADR-0083 的统一后台主动检查与 24 小时刷新语义、ADR-0192 中“其他 Runtime 保持主动检查”
的默认策略，以及旧 UI 对 `found_uninspected` 的 checking 投影；不改变 Product Runtime Catalog、TRAE
同进程执行验证、Ready capability evidence 或真实 AgentRun 的 admission authority。

<a id="adr-0204-consequences"></a>
### Consequences

- Core ready 与重扫响应不再被 ACP、Session、认证或模型枚举阻塞，第三方 CLI 副作用只发生在明确的产品动作。
- 用户可能在首次任务或显式检查时才发现登录、版本或 capability 问题；界面必须区分“可尝试”与深检证明。
- manager 和 Probe process owner 承担更多集中式生命周期责任，但 panic、取消和孙进程继承 stdio 不再制造
  永久 checking。
- 静态权限 descriptor 与 Runtime-default sentinel 只用于配置/admission，不成为 capability evidence；深检成功
  后必须用真实 catalog 重绑再启动非 TRAE Runtime。

<a id="adr-0204-rejected-alternatives"></a>
### Rejected Alternatives

- **减少启动 ACP 步骤但仍自动 Probe。** 仍执行第三方产品代码，也无法消除认证和子进程生命周期风险。
- **给 checking 增加 UI 超时。** 只隐藏 stale manager state，不清理任务、waiter、进程树或错误提交。
- **把 executable 存在写成 Ready。** 会伪造认证、协议、模型和 capability 证据。
- **fingerprint 改变后立即后台复验。** 把不可预测的第三方启动重新放回发现关键路径。
- **每个 Probe 自己实现 timeout/kill/read。** 分散实现会继续遗漏孙进程、无限输出或 reader cleanup 路径。

<a id="adr-0204-references"></a>
### References

- [v0.98 version scope](README.md)
- [Runtime Launch and Verification v3](../../contracts/runtime-launch-and-verification-v3.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [ADR-0083](../v0.26/decisions.md#adr-0083)
- [ADR-0192](../v0.87/decisions.md#adr-0192)
<!-- legacy-adr-body:end id=ADR-0204 -->
<!-- legacy-adr:end id=ADR-0204 -->
