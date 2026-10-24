---
document_type: model-context-change
version: v1.72
change_id: hermes-first-input
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User
confirmed_at: 2026-10-23
authority: confirmed-model-input-change-statement
implementation_status: implemented
review_baseline: 166e59285e5eb0c3adf7078124d5ec74f556142f
last_updated: 2026-10-23
---

# Hermes 首次用户输入携带协作规则：R1

本文为已确认并实施的 R1 说明。User 在阅读说明及压缩边界解释后，于 sequence 31 确认下一条输入补发。需求来自 Hermes Thread
2026-10-23 sequence 27（message `18da0ba0-f5fe-410b-bbe2-b6e3ecf080e3`）。
它改变 Hermes 的模型输入权限层、投递时点和证据，因此适用
[核心模型上下文变更治理](../../development/model-context-change-governance.md)。

## 变更前

令 B 为 Core 为本次输入准备的完整 Bootstrap 原文，P 为既有 Dynamic Context Formatter 生成的
普通任务输入。B 包含既有 SESSION_CHARTER、MEMBER_IDENTITY、可选 TEAM_GUIDANCE、
ROVAI_PLATFORM_SKILLS、可选 MEMORY_ENTRYPOINT；省略规则、各段内容和次序由当前 Core 合同拥有。

当前 Hermes 使用 `managed_system_prompt`：

```text
Core startup B -> 私有 bootstrap.txt -> ROVAI_HERMES_BOOTSTRAP_FILE
controller 调用 Hermes resolver -> native overlay O
子 Gateway HERMES_EPHEMERAL_SYSTEM_PROMPT = O + "\n\n" + B
_rovai/bind(sessionId, B, sha256(B)) -> ACK
session/prompt(sessionId, [{type: "text", text: P}, ...原有附件])
```

O 非空时才有上述分隔符。resolver 目前按 env、有效 personality、system_prompt 回退解析。
每 Run 新建 Gateway，所以每次启动重新绑定 B；生产 ACP 提交的普通用户正文仅为 P。
Bootstrap 位于原生 system overlay，不能把原先的压缩验收移作 user 层保留证明。

## 变更后

### 一、唯一正文来源与完整运输形状

Hermes 改为 `first_payload`。Core 仍唯一生成 B 和 P；Hermes Adapter/controller 不重新生成身份、
协作规则、Memory 入口，不调用原生 system/personality resolver，不读取或拼接这些字段用于注入。
Hermes 原生环境变量原样继承，原生 config 的这几个字段原样保留，让官方 Gateway 自行解析。

新 Native Session 的第一条实际普通任务输入：

```text
[Rovai 协作规则]
<B 原文，逐字保留>
[/Rovai 协作规则]

<P 原文，逐字保留>
```

已经接受相同规则且没有待补发要求的普通后继输入，正文只有 P。原 Session 冷恢复遵循同一判断。
不额外提交确认消息，不增加模型调用。附件保持原顺序、原类型；包装只影响 text 内容。

同一 Session 的已接受规则摘要与本次 Core 准备的 B 不同，下一条普通任务输入使用：

```text
[Rovai 协作规则更新]
以下规则替换此前的 Rovai 协作规则，继续当前会话与任务。

<B 原文，逐字保留>
[/Rovai 协作规则更新]

<P 原文，逐字保留>
```

包装本身为 Hermes input envelope v1。B/P 内部 Formatter 不改，其他 Adapter 的 first_payload
格式也不改。规则更新不新建 Native Session；进行中的 Run 继续使用已冻结内容，更新不插入其 Steer。
规则是 user 层输入，不能承诺 system/developer 层优先级，也不覆盖 Hermes 的原生高优先级指令。

### 二、接受事实与规则更新

“首次”与“已更新”以 `native_binding_id + generation` 对应的精确 Native Session 和已接受
Runtime Input Delivery 为准，不以 PID、Gateway、Run 次数或 controller 的 `bound` 布尔值为准。

现有 `native_charter_digest` 只覆盖稳定组件，没有包含 MEMBER_IDENTITY，不能单独用它检测身份变化。
Hermes 使用 **完整 B 的 SHA-256** 比较规则，读取本次 Core claim 已冻结的身份，不从 Adapter 另读 Profile。

复用 `runtime_input_delivery` 的既有 prepared / accepted / delivery_unknown 等状态与回执归属。
仅为 Hermes 的投递证据补充 nullable 字段；不建立第二份发送状态机、独立 first_sent 文件或进程缓存：

| 拟增内部证据字段 | 含义 |
| --- | --- |
| `hermes_rules_envelope_version` | 本策略为 1；旧投递及其他 Runtime 为 null |
| `hermes_rules_digest` | 本输入采用的完整 B 的 SHA-256，包含成员身份；不冒充已接受状态 |
| `hermes_rules_delivery_kind` | `initial`、`update`、`compaction_recovery` 或 `none` |
| `hermes_runtime_payload_blob_id` | 指向既有 managed_blob 中冻结的最终 text 正文；不另建 Blob 管理器 |

当前表已经包含绑定代次、Run/epoch、Manifest、native input ID 和 Runtime request digest，继续用于
归属、幂等及排序。上述证据随 prepared 原子写入；只查询 status=accepted 且实际包含 B 的记录来
判定上一份已接受规则。最终正文摘要继续参与 Runtime request digest。

行为约束：

- prepared、写管道成功、Gateway 启动和模型终态均不能替代该输入的接受回执。
- 明确未接受时，不推进规则水位；后继合法输入仍需要规则。是否重试原任务由原有投递机制决定。
- 结果未知时保留不确定态，不因规则未 ACK 自动重放原任务；需要先沿原有精确回执恢复路径结算。
- 晚到回执不能覆盖后继 Binding、输入顺序或较新的已接受规则。
- 相同 B 在正常后继 Run、进程重启及原 Session 恢复后不重复携带；B 改变后与下一普通 P 一次提交。
- 恢复冻结输入使用原 Blob；正文不可因之后的 Profile/Memory 编辑而改写。
- 一条输入最多携带一份 B；首次、规则更新和压缩恢复同时适用时合并，不叠加三个全文块。
- Steer、取消、控制命令和仅探测 Session 不消耗首次规则投递机会；本策略只作用于普通任务输入。

最终正文必须进入既有整体字节预算。预留包括 B、Hermes 包装和分隔符；超限明确拒绝，不截断规则或任务。

### 三、压缩：先有失效证据，再限定补发范围

已检查的原生版本为 0.22.4，源码 commit
`4d04303818b61bf3aa09278af48356315515965b`，工作树无改动。
官方[配置页](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)介绍了
`protect_first_n`；但这个安装的
[`_effective_protect_first_n()`](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/agent/context_compressor.py#L4566)
在首次压缩后返回 0，
冷恢复时也根据原生 summary 标记维持这一行为。因此不能从配置值 3 推导无限次保留。

[受控原生压缩器证据](../../research/hermes-runtime/first-input-retention-probe-2026-10-23.json)：

| 条件 | 第一次压缩后 | 第二次压缩后 | 第一次压缩后重建压缩器 |
| --- | --- | --- | --- |
| `lean / protect_first_n=3` | B 全文在 | B 全文不在 | 有效保护数为 0 |
| `legacy / protect_first_n=3` | B 全文在 | B 全文不在 | 有效保护数为 0 |
| `lean / protect_first_n=0` | B 全文不在 | B 全文不在 | 有效保护数为 0 |

这使用未修改的原生 ContextCompressor、合成历史、固定摘要响应和 `force=True`；没有真实模型请求，
也没有运行 Gateway 自动触发。它证明“全文必然保留”不成立，**不冒充生产自动压缩验收**。
本机 compression 配置的保护数为 3、尾部数为 20、threshold=0.5，tail_mode 未显式配置；原生会解析
最终阈值。验收仍须记录模型、窗口、实际阈值及其余有效配置，不改变用户配置来制造通过。

R1 因上述失效证据允许接入官方 `post_compaction` observer hook，限定如下：

1. 只在私有受管 Home 中配置官方 Hook；不补丁原生压缩器、不替换工具、不修改用户安装或原生 config。
2. 原生 [compaction_events](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/agent/compaction_events.py#L239)
   仅在 committed rewrite 后派发该 Hook；`hermes_cli/plugins.py`
   将它定义为 observer。使用它提交既有 Bootstrap Redelivery Requirement，不通过 Hook 修改模型历史。
3. 按当前 Host/Run lease、精确 Native Session、Binding generation 校验事件，接入已有去重/回收机制。
   原生的旋转 Session、旧 lease、后台/旁支 Session 或无法归属的事件不能猜测为当前 Session。
4. 只接受可能改变 user 历史的已提交 summarize 完成事件；started、失败、取消、普通输出、token 降低
   不推进补发。Hook 不携带 B、P、摘要正文或秘密到日志。若能力探测或事件归属未建立，不宣称恢复成功。
5. 补发时点为**下一次尚未物化的普通任务输入**，使用下述规则恢复块加这次 P；不新建 Run、不发送空任务，
   不重放上一条业务 P。已物化或结果未知的输入保持原字节。

```text
[Rovai 协作规则恢复]
原生上下文压缩后，重新提供当前协作规则，继续当前会话与任务。

<B 原文，逐字保留>
[/Rovai 协作规则恢复]

<当前 P 原文，逐字保留>
```

现有 Redelivery requested/acknowledged revision 继续拥有“需要/已接受”状态；只有携带对应 revision
的输入被接受才确认补发。新事件晚于本次输入物化时，不能被该输入的较旧 ACK 一并消除。

**边界：这不保证同一 Run 内压缩后的下一次模型调用立即恢复 B。** 当前官方 post_compaction 是观察
钩子，没有在此处插入规则的返回值通道；R1 不绕过它覆写原生聊天循环。压缩后的完整规则在下一次
普通输入恢复前可能仅残留于摘要。如要求同 Run 无间隙保证，必须另有官方扩展点证据与新 revision，
不能把本方案记成满足该保证。未接通 Hook 的配置不能记作已完成规则恢复验收。

### 四、清理与升级兼容

删除 Hermes 专属 `_rovai/bind`、bootstrap 文件/环境变量、native overlay resolver 和拼接、B 变化触发的
Gateway 重启，以及仅为 system 绑定存在的 prompt 门禁。保留 `_rovai/ready` 的身份、版本、PID 与能力检查。
Hermes controller revision 从 v3 推进到 v4，以拒绝新旧协议混接；不改变最低版本策略。

只因进程代码变化而重建 Host，仍精确恢复原 Native Session。历史 managed_system_prompt Evidence 保留原义，
不倒填成 first_payload，也不把旧系统层 ACK 当作已完成 user 层投递。升级后的下一条新普通输入对既有
Hermes Session 携带一次“规则更新”；之后按新账本判断，不能每次冷启动都重复迁移。

旧 accepted/delivery_unknown 输入不自动重放；旧 frozen/prepared 输入不在原记录上重写。只有原机制已明确
判定未提交并准许重准备时，才建立有来源关联的新投递，否则保留待处理状态。其他 Runtime 不迁移、不换代。

## 明确不变

- B 的各 section、身份来源、Team 指引冻结、Memory 选择、平台 Skills、P 的动态字段/顺序/选择均不改。
- 除计入 Hermes 包装的精确预算外，不改变共享 FIFO 选择规则、截断策略或其他 Adapter 的模型输入。
- 原生能力关闭策略、隔离 Home、官方 ACP/Gateway、逐 Run 启停、Fleet 所有权、CLI lease 刷新不改。
- 会话恢复、取消、权限、MCP/Skills、输入去重、公开 Send、工具/文件/失败 usage 收尾继续走既有路径。
- 不把 user 层投递推导为可复用旧 CLI lease，不增加 warm Gateway 或后台执行方案。
- 低版本 UI 提示、图片质量及其他未验平台不混入此次变更。

## 合同、版本与迁移

本次更新 Hermes Managed Runtime v1、Runtime Catalog 的 Hermes 章节、Bootstrap v6 的 Hermes 投递例外、
Bootstrap Redelivery 架构中的 Hermes 事件/时点、当前版本概览/实施记录与当前决定导航。
以新的版本决定记录 system 层保证转为 user 层规则及压缩恢复的取舍，不改写其他 Runtime 的行为。

共享 Bootstrap v6 / formatter 6、Charter 25、Dynamic Manifest/formatter 40/42、Profile 15/16 维持原值。
Hermes 外层 envelope/证据为 v1，controller revision v4。数据库迁移仅增加上述 nullable evidence 字段和
Hermes 的现有 Redelivery 闭集准入；实施分配 Migration 215 / schema 165，不占用或改写已有迁移。
如果实现需要超出本文的模型可见结构或共享版本变化，须递增本文 revision，不能以“内部优化”静默扩大。

## 二次确认

User 于 2026-10-23 sequence 31（message `f5508b98-f111-42b0-94d0-ab65b4555495`）在阅读完整 R1
及 sequence 30 的压缩边界解释后确认：“那hermes有什么压缩完成后的事件通知吧，接收到压缩完成的通知的下一条追加提示词也可以的”。
此确认接受 R1 的官方完成通知和下一普通输入补发时点，不要求同一 Run 内立即恢复。
`confirmed_revision: 1`；不扩大原有修改范围。

## 验证

变更前已完成 Core/Controller/输入账本及 Hermes 原生源码调查、上述离线压缩器复现，
连续两遍得到相同结果。确认后的实现和分层验收结果见
[实施记录](hermes-first-input-implementation.md)，不为本文增加 checker 例外。
验收标准如下：

| 验收 | 通过标准 |
| --- | --- |
| 首次输入 | 同一次 session/prompt 的 user text 为完整包装 B+P；主模型请求中 B 在 user 层且仅一份；无额外确认调用 |
| 后继与冷恢复 | 已接受后普通输入 P 不重复 B；重启原 Session 后仍不重复，原生 ID 不变 |
| 规则更新 | 只改身份也能触发下一普通输入的一份更新；接受后不重复、不新建 Session；旧回执不覆盖新摘要 |
| 拒绝/未知/崩溃 | prepared 不算已交付；准确未接受与未知分支分开；不自动重放原业务任务；旧 epoch ACK 只留证据 |
| 压缩证据 | 官方自动路径至少两次压缩，每次保留原生完成事实、后续真实请求/原生 active context 的完整规则摘要比较；冷恢复再核对 |
| 补发边界 | 已提交 Hook 触发 pending；下一普通输入只恢复一份 B+本次 P；旧 P 不出现；同 Run 压缩后未补发窗口如实记录 |
| 非完成事件 | started/失败/取消/错 Session/旧 lease/重复事件不产生错误补发或错误 ACK |
| 原生提示词 | env、personality、手写 system_prompt 分别按原生优先级生效；系统请求内容与未注入 B 的官方路径相符，B 不进入 system |
| 配置差异 | 实际配置与 protect_first_n=0 的隔离配置分别记录；不从一个配置推广所有版本/模型 |
| 既有路径 | 复验 Steer、取消、换 Run lease、公开 Send、终态与工具文件证据；其他 Adapter 的输入字节保持原样 |

受控 Provider 验证真实 wire 与失败状态；真实模型验证自动触发和原生上下文，不能只询问模型是否记得。
Rust 优先扩展已有 Context/输入 ACK/ACP/Compaction owner；按测试准入政策选择必要 seam。
运行 Hermes controller/wire/Core smoke、定向 Rust、类型与文档门禁；跨共享 seam 时按开发文档扩大回归。
