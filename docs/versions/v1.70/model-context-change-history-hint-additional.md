---
document_type: model-context-change
version: v1.70
change_id: public-history-hint-additional-messages
revision: 5
confirmation_status: confirmed
confirmed_by: Principal (Camp message a2cf9394-998f-4d23-ac28-88788fb3cc8a)
confirmed_at: 2026-09-25T04:17:34Z
confirmed_revision: 5
authority: proposed-model-input-change-statement
implementation_status: in_progress
last_updated: 2026-09-25
---

# 公共历史提示增加额外可见消息判断：revision 5（已确认）

本说明以已合入 main 的 [v1.70 Skills Rebuild revision 5](model-context-change.md) 和 [ContextManifest／Formatter 30](../../contracts/context-manifest-evidence-v30.md) 为**变更前基线**。它取代本分支相对于旧 main 写成的 [v1.69 revision 4](../v1.69/model-context-change-history-hint-additional.md) 的实施版本方案，不改写那个历史确认。Principal 要求版本数字冲突时顺延一位；仅改数字不足以保持主线的 Skills、历史恢复和已部署数据库合同，因此本说明将共存语义完整列出。Principal 已在本 revision 全文发出后确认执行；实施期间仍须遵守以下共存与恢复边界，PR #529 仅在冲突得到安全解决后合并。

## revision 4 → revision 5：语义差异与保留项

| 边界 | v1.69 revision 4（相对旧主线） | 本 revision（相对 v1.70 main） |
| --- | --- | --- |
| 公开新 Run 基线／目标 | 29／Profile 9／Run Facts 7 → 30／Profile 9／Run Facts 8 | **30／Profile 10／Run Facts 7 → 31／Profile 10／Run Facts 8**；Skills 动态 section 保持必有 |
| 数据库 | 在 v1.68/schema 122 上使用 migration 173、v1.69/schema 123 | 保留 main 已使用的 Skills migration 173、v1.69/schema 123；本次从该精确来源迁移 **174、v1.70/schema 124** |
| 旧公开 Manifest | revision 4 写成旧 29 不续派或恢复 | 沿用 main 已确认的**有界冻结恢复**：29／Profile 9／Facts 7、30／Profile 10／Facts 7 各按原证据与原 payload；28 及更早仍退役。不能把两种 30 混为一谈 |
| 其他旧输入 | revision 4 的非 batch 26、Bootstrap v4 | main 的新非 batch 27／Profile 7／Facts 5、旧非 batch 26／Profile 6／Facts 5 有界恢复；新 Bootstrap v5／Formatter 5 与旧 v4 冻结证据并存 |
| Charter／Binding | 新建 Charter 14、兼容摘要保留 Charter 13 | 新建 Charter **14**，保留 main 已实现的 Binding v4／Formatter 4／Charter **13**／非 batch 26 兼容投影；真实新 Bootstrap 仍是 v5／Formatter 5，真实新非 batch仍是 27；旧 Session 原系统提示词不变 |
| 冲突的 migration 173 | 本分支也曾写出不同的 173，且把 Manifest 30 定义成 Profile 9／Facts 8 | 不把这份 173 当成 main 的 Skills 173；只从确认是 main Skills schema 123 的数据库自动迁移。分支专有 173 若已应用，则**保留数据、拒绝自动升级／打开**，另议独立的无损转接；不得按 migration 数字相等直接放行、静默重标或清库 |

P／T／I／A 的查询规则、四句英文提示、新建 Charter 原文、旧 Session 不切换、容量不扩修、停止测试及不委派子 Agent 验收等 revision 4 已确认要求，在下文按新基线保留。本 revision 不撤销 main 的 Skills Rebuild，也不覆盖爱丽丝的文件预览修复。

## 变更前：main v1.70 的完整相关模型输入

新公开 Camp batch：Formatter／Manifest **30**、Profile **10**（冻结 JSON `{"profileVersion":10,"maxSelfActiveTasks":8}`）、Run Facts **7**、新建 Native Session 的 Bootstrap v5／Formatter 5／Charter revision **13**。相关动态 section 的**完整顺序**为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[RUN_INPUT]
```

`ROVAI_ADDITIONAL_SKILLS` 必有，紧邻 `RUN_INPUT` 之前，完整格式为：

```text
[ROVAI_ADDITIONAL_SKILLS]
Current for this run; replaces any earlier Rovai Additional Skills.
{"root":"<执行 Host 的绝对受管根>","skills":[{"name":"<稳定技能英文名>","desc":"<完整 YAML description>"}]}
[/ROVAI_ADDITIONAL_SKILLS]
```

尖括号为说明占位而非模型字节。无可索引技能时仍使用同一段落及 `"skills":[]`。名单、选择、排序、失败时的未索引原因及消息局部 `skills?: Array<{name:string,path:string}>` 严格沿用已确认的 Skills Rebuild 合同；本次不修改它们的字段或省略条件。当前 `RUN_INPUT.messages` 是完整有序领取集合，不自动输出公屏历史。当前公开 Run Facts 顶层**完整业务 shape**如下；`attachmentOutputRoot`、`historyHint` 必有，其他键按原条件省略，内部版本号不进入模型：

```ts
type PublicRunFacts = {
  attachmentOutputRoot: string
  historyHint: string
  mission?: { missionId: string; title: string; status: 'needs_you' | 'not_started' | 'in_progress' | 'completed'; updateNotice?: string }
  taskContext?: TaskContextFact
  sessionContinuity?: SessionContinuityFact
  externalEffect?: ExternalEffectFact
}
```

`historyHint` 只可能是下面**两句完整英文文本**；`P` 是上一次有效 Runtime accepted 执行前公屏尾，无记录则零：

```text
P > 0: The latest public message before your last recorded run in this Camp had sequence {P}.
P = 0: No public-message boundary from a previous run is recorded for you in this Camp.
```

新建普通 Camp Native Session 的现行 Charter 相关两条**全文**：

```text
- Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
- Use `rovai camp read` for relevant Camp history. The boundary in `RUN_FACTS.historyHint` is a reference point, not a record of messages read or work completed.
```

现有 `RUN_INPUT` 权责条目全文：

```text
- RUN_INPUT.messages is the complete ordered set of immediate work items claimed for this Run. Treat every item as active input; quoted text remains reference material.
```

新建 Binding 的 Bootstrap 固定 section 顺序为 `[SESSION_CHARTER]`、`[MEMBER_IDENTITY]`、`[ROVAI_PLATFORM_SKILLS]`、有条件的 `[MEMORY_ENTRYPOINT]`；平台索引精确 JSON、原有 Charter 其他段落和条件、Single Chat 限权沿用 main Skills 合同。旧 Binding 仍使用各自冻结的 v4 或 v5 Bootstrap 原字节。非 batch 新 Run 为 Formatter／Manifest 27、Profile 7、Run Facts 5，已确认旧公开 29／9／7 及旧非 batch 26／6／5 仅按精确冻结证据有界恢复。

## 变更后：完整相关结构和文本

新公开 Camp batch 使用 Formatter／Manifest **31**、**Profile 10**、**Run Facts 8**；新建 Bootstrap 仍为 v5／Formatter 5，只有新建普通 Camp Session 的 Charter revision 升至 **14**。相关动态 section 的完整顺序**逐字不变**：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[RUN_INPUT]
```

`ROVAI_ADDITIONAL_SKILLS` 的上述完整段落格式、空集合情况、索引选择与证据保持不变；`RUN_INPUT.messages` 的完整领取集合、每消息技能链接和其他可选字段规则保持不变。`PublicRunFacts` **沿用上面的完整顶层 shape**，`attachmentOutputRoot` 与 `historyHint` 仍必有，其余仍按原条件省略；不加入 schemaVersion、布尔字段、消息 ID、计数、历史正文或第二份边界。只替换 `historyHint` 的选择结果，四句**完整**英文文本为：

| 上次边界 | 额外可见消息 | 完整 `historyHint` 文本 |
| --- | --- | --- |
| `P > 0` | false | `The latest public message before your last recorded run in this Camp had sequence {P}. As of this run's start, all visible messages after that sequence are already in RUN_INPUT or were written by you.` |
| `P > 0` | true | `The latest public message before your last recorded run in this Camp had sequence {P}. As of this run's start, there are additional visible messages after that sequence beyond RUN_INPUT and messages written by you.` |
| `P = 0` | false | `As of this run's start, all visible messages in this Camp are already in RUN_INPUT or were written by you.` |
| `P = 0` | true | `As of this run's start, there are additional visible messages in this Camp beyond RUN_INPUT and messages written by you.` |

`this run's start` 仅指 claim 的消息快照；`P > 0` 不保证 `P` 以前的历史已提供。true 不要求调用读取工具或增加工作责任，false 不表示全历史已读、已处理、任务完成。失败不能生成第五种“未知”文本。

只有**新建**普通 Camp Native Session 的 Charter 相关两条变为下列**全文**，第一条与旧版逐字相同：

```text
- Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
- Proceed directly when `RUN_INPUT` and your existing context are sufficient; use `rovai camp read` only for missing Camp context needed by the current work. The boundary in `RUN_FACTS.historyHint` is a reference point, not a read or completion marker.
```

现有 `RUN_INPUT` 权责条目仍为上文原文。Charter 其他段落、身份、平台技能、Memory、条件出现规则与 Bootstrap section 顺序沿用 main，不热更新既有 Session：其已冻结 Charter、Bootstrap Evidence、平台 section 是否存在及系统提示词保持**原字节**；后续新 Run 在同一健康 Session 接收新动态 Facts 8 和 Skills section。旧 Binding 的 compaction/redelivery 只能使用其已冻结 v4／v5 Bootstrap 字节，不能以新版 Charter 替换或给旧 v4 强插平台段。没有因本次文案变化而切换 Session。

## Claim 选择、冻结及可见性

在当前 Camp／Agent 的**同一个 batch claim `TransactionBehavior::Immediate` 事务**内，取 `P`＝当前 Agent 上一次有效 Runtime accepted ACK 对应 Run 执行前公屏尾（无记录为零）、`T`＝本轮冻结的公屏尾、`I`＝**最终**进入本轮 `RUN_INPUT.messages` 的**全部** message ID、`A`＝当前 Agent ID。判断只读当前 Camp 实际 `camp_message` 时间线：同 Camp、`tombstoned_at IS NULL`；已撤回且可投影为 `Message withdrawn` 的占位符计入。`P > 0` 检查 `(P,T]`，`P = 0` 检查 `<=T`。**仅**排除 `I` 与本 Agent 作者身份；发给其他 Agent 但当前 Agent 可见的消息、未领取队尾及超出 `camp.read` 单页的消息仍计入。不得以 waiting Delivery 候选代替公屏集合。

SQL 的语义形状如下，`I` 通过一份 JSON 数组输入而不是限制 SQLite 参数数；不得取正文、计数或加分页上限：

```sql
SELECT EXISTS(
    SELECT 1 FROM camp_message AS message
    WHERE message.camp_id = ?1
      AND message.sequence > ?2 AND message.sequence <= ?3
      AND message.tombstoned_at IS NULL
      AND NOT (message.author_type = 'agent' AND message.author_id = ?4)
      AND message.id NOT IN (SELECT value FROM json_each(?5))
)
```

`?2=P`，无上次边界时为 0；`?3=T`，`?4=A`，`?5=I` 的完整 JSON 数组。读取、序列化或查询失败必须回滚整个 claim，不领取 Delivery、不创建该 Run。新公开 batch `agent_run` 内只冻结非空 `claim_previous_public_boundary_sequence=P` 与 `claim_has_additional_public_messages∈{0,1}`；已有 Run 两列为空，不回填、不借空值重算历史。Run Facts 8 从冻结两值选择文本，物化并冻结原始 Facts JSON／digest 和完整 Manifest／payload；同 Run 重试或恢复使用已冻结证据，不从后来的撤回、公屏状态或 accepted 水位重算。读取与判断不领取 Delivery、不改变撤回资格或 accepted 水位；只有现有有效 Runtime accepted ACK 推进水位。

## 明确不变：输入、权限与证据边界

`RUN_INPUT.messages` 仍是完整有序的领取集合，不新增自动历史或工作项；`ROVAI_ADDITIONAL_SKILLS` 的完整段落、空集合、Selection／Resolution 和每消息 Skills 链接保持 main 已确认的形状及冻结规则。`RUN_FACTS` 只改变必有 `historyHint` 的文本选择，其他业务字段、省略条件、Profile 10 JSON 与选择预算不变；容量临界估算低估不在本次扩修。`camp.read` 默认 20、显式上限 100 和分页不变；accepted 水位仅由既有有效 Runtime accepted ACK 推进。既有 Native Session 的系统提示词及 Bootstrap 原字节不修改、不因这次 Charter 文案变化换 Session；旧 Manifest 和 payload 不重写。以下版本轴明确新输入与有界恢复的差别。

| 投递类型 | 目标组合 | 恢复组合与准入 |
| --- | --- | --- |
| 新公开 batch | Manifest／Formatter **31／31**，Profile **10**，Run Facts **8**；必有动态 Skills section | 主线冻结 **30／30＋Profile 10＋Facts 7**、**29／29＋Profile 9＋Facts 7**，仅在版本与完整历史证据匹配时有界恢复；既有证据按原 payload 字节，不添加 Skills 或重算 `historyHint`。公开 28 及更早仍不派发、不转换、不重播 |
| 新非 batch | Manifest／Formatter **27／27**，Profile **7**，Run Facts **5**；必有动态 Skills section | 冻结 **26／26＋Profile 6＋Facts 5** 按 main 已确认机制有界恢复；不补 Skills section |
| Native Bootstrap | 新 Binding：v5／Formatter 5；普通 Camp Charter **14**，平台技能 section 按 main 已确认规则输出 | 已有 Binding：原 v4 或 v5 Bootstrap、Charter、系统提示词及证据原字节；旧 Binding 继续使用 main 的 v4／Formatter 4／Charter **13**／非 batch 26 **兼容摘要投影**，其他安装、协议、配置、权限、特定指导版本等相等检查不放松 |
| 其他 | Profile 10 的冻结 JSON `{"profileVersion":10,"maxSelfActiveTasks":8}`、选择与预算数值不变 | `camp.read` 默认 20／显式上限 100／分页不变；`RUN_INPUT` 完整有序、Skills Selection／Resolution v2、附件与其他 Run Facts 字段不变 |

实际新 Bootstrap v5／Formatter 5、非 batch v27 与 Binding **兼容摘要**中的旧 v4／Formatter 4／非 batch v26 本来就由 main 分开计算；此次只让实际新建 Charter 到 14，摘要中的 Charter 兼容值继续保持 **13**。不得把实际新建 Charter 14、新公开 Manifest 31 或实际 Bootstrap 5 代入旧 Binding 的兼容投影，也不得删掉该投影里的 Charter 字段。只有文案这一受限兼容变更不旋转已有健康 Binding；其他真实不兼容仍依原机制切换。已有 Bootstrap Evidence 的 Binding 继续加载原字节并校验 delivery mode、Blob 与平台 Skills 摘要，损坏时拒绝；缺失证据的 Binding 按原有首次准备路径冻结一次，不因 `native_session_id` 已存在单独拒绝。是否实际交付仍由原有 Input Delivery 与 Charter digest 门禁决定，不默认重建 Session 或重复注入 Bootstrap。不得把这条例外解释为忽略未来所有 Charter 变更。

## 数据迁移、准入与恢复

**保留主线 migration 173 的全部含义与已安装标记**：Skills Rebuild 在 v1.68/schema 122 之上产生 `v1.69`／schema 123、公开 30／Profile 10／Facts 7、Bootstrap v5、非 batch 27 和旧 29／26 的有界恢复。产品版本 v1.70 不改写历史数据合同标记。本次**新增** migration **174**，仅从经 main Skills schema 验证的 `v1.69`／schema **123** 来源前进到目标数据合同 `v1.70`／schema **124**；版本数字相同但实际是本分支早期“historyHint migration 173”的数据库**不是合格来源**。迁移前以主线 Skills 专有表、Bootstrap v5／Manifest 30＋Profile 10＋Facts 7 约束与保护触发器等现有结构识别来源；不凭 migration 173 标记、`v1.69` 字符串或 schema 123 数字单独放行。

174 只增加 `agent_run` 的两列 claim 冻结数据及校验、为新公开 31／10／8 扩展 Manifest／Input 的约束与新写入守卫，并保留 30／10／7、29／9／7、27／7／5、26／6／5 的历史配对和 main Skills 专有表、Bootstrap 及证据。原有 manifest 30 和 input 30 **不批量改号**为 31；原始 Facts、Skill index、Bootstrap、payload、Delivery、附件 refs 与摘要不重写。重建表时事务内校对历史行数、关键摘要、外键和约束；失败回滚并维持旧标记，外键保护必须恢复。新建公开 Run 的 Input 和 Manifest 只写 31；旧 30 与 29 的物化仅在各自**已冻结**输入、对应版本组合与完整证据下允许，不能用一条只看版本号的宽松触发器接受伪造新 30。旧 30／10／7 的已冻结 Manifest／payload 直接复用；若仅有冻结 Input、尚无 Manifest，则缺少可恢复旧版动态 Skills section 的完整冻结证据，本次明确拒绝物化该旧 30，不从当前文件状态重新生成或冒充新 31。已投递／已接受的冻结 Runtime Delivery 继续复用原证据。旧 29／9／7 与非 batch 26／6／5 的有界恢复纪律原封不动；旧非 batch 27／7／5 也保持原版本。派发和负向校验应同时核查 Formatter、Manifest、Profile、Facts 和源输入／冻结证据，避免仅看 `manifest_version=30`。

**分支专有 173 冲突的显式阻断**：早期 PR 分支将同一 `schema_migration(173)` 与 `v1.69`／123 写成非 Skills 迁移，并使用公开 **30／Profile 9／Facts 8**，缺 main 的 Skills 表及 Bootstrap v5。它不是 main 已确认的 30／10／7；仅将迁移编号改成 174 既不能让它获得 Skills 表，也不能把旧冻结 30 的字节解释成主线的 30。此 revision 的自动迁移不接纳这种数据库；检测到应保持原文件及字节不变并报告明确的不受支持来源，**不删除、不清库、不重标、不重写旧 payload**。如果实际需要把该变体的数据带入合并后的程序，须另行定义、确认并验证无损桥接；本提案不以虚构兼容性为由默许自动升级。该边界不妨碍以主线 173 为来源的正常 174 升级，但也不意味着已存在该变体的安装能直接使用合并后的版本。

## 验证计划与负向案例（本轮不执行）

1. 四句提示完整文本：首轮只有 `I` 中消息为 false；首轮另有可见历史为 true；`P>0` 各覆盖 true／false。额外历史超过 100、发给其他 Agent 的可见消息、当前 lane 未领取队尾与撤回占位符为 true；`I` 中**全部** ID 与自己写的消息排除，tombstone 不计入。
2. 在 claim 后新发布、撤回、推进 accepted 水位，冻结判断与 payload 不漂移；查询或 JSON 构造失败回滚整个事务，不生成没有判断结果的新 Run；原 accepted ACK 规则、`camp.read` 的 20／100 与分页完全不变。
3. 新公开 31／10／8 按上文 Skills section 顺序、完整 Run Facts shape 和 Profile 10 JSON 输出，完整 hint 参与 claim 原有容量估算与最终 payload 字节校验，`RUN_INPUT` 不截断。**不扩修**既有容量临界估算低估，作为已知限制记录。
4. 旧 29／9／7、main 30／10／7、非 batch 26／6／5 以及 27／7／5 已物化的冻结证据与 payload 原字节有界恢复；旧公开 28 拒绝派发；旧 30 只有冻结 Input 而尚未物化 Manifest 时，因缺完整动态 Skills section 冻结证据拒绝物化，不能临时生成原版或替换为新版。混搭 30／9／8、31／9／8、31／10／7、伪造新写入 30、缺失 Skills 证据均不得误放行。
5. 从 main 的 `v1.69`／123 经 174 到 `v1.70`／124；旧行、Bootstrap 和 Skills 证据不重写，行数／摘要／外键一致；分支专有 173 虽同号同标记仍被识别并拒绝自动升级，不发生数据清空或部分迁移。
6. 相同 Binding 安装／协议／权限／配置未变时，新 Run 31／10／8 在同一 Native Session 投递，新 Charter 不重发；已有旧 v4／v5 Bootstrap 在 compaction 只按原字节重投。自然新建 Session 使用 Charter 14 与 Bootstrap v5；证据缺失时沿原首次准备路径冻结，已存证据损坏时拒绝；真正不兼容仍依现有检查切换。验证各 Runtime 首轮与续轮不重复注入 Bootstrap。

此前 Principal 曾要求停止测试、不委派子 Agent 验收、容量低估不处理；2026-09-25 的新指令已明确要求验证本次 Bootstrap 修复的首轮、续轮和目标 Camp 重试。旧分支扩展 DB 测试此前为 73 通过、14 失败，随后静态调整未复测；主线 Skills 的既有验证不能替代本次修复验证。容量低估仍不在本次修复范围。

## 二次确认记录

此前 Principal 于 2026-09-24T18:02:40Z 确认 [v1.69 revision 4](../v1.69/model-context-change-history-hint-additional.md) 并授权实现、推送；2026-09-25 消息 `131792b3-2e60-4c42-9b54-d507ec9ae18e` 指示“版本数字冲突了你就延后一位”。这些发生在本 revision 5 **完整写出之前**，不构成对上述 Skills 共存、旧 30 恢复、迁移来源阻断和 174 方案的二次确认。完整 revision 5 已作为附件随 Camp 消息 `d06aa167-4dac-4404-9dd8-fd782b277175` 发出供 Principal 阅读；Principal 随后在 2026-09-25T04:17:34Z 的消息 `a2cf9394-998f-4d23-ac28-88788fb3cc8a` 回复“执行”，并要求完成后基于最新 main 安装、处理 Applications backup、同步本地 main。故 `confirmation_status: confirmed`、`revision: 5`、`confirmed_revision: 5`，允许按本 revision 实施、更新 PR #529；此前停止测试、容量不处理、不委派子 Agent 验收的约束继续生效。
