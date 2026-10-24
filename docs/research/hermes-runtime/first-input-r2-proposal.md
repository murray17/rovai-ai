---
document_type: research-note
authority: non-normative
status: proposed
change_id: hermes-first-input
revision: 2
confirmation_status: pending
implementation_status: not_started
last_updated: 2026-10-24
---

# Hermes 原生 ACP／原生 Home：R2 待确认说明

需求来源为 User 2026-10-24 sequence 46，message
`ee7116aa-66ec-4218-b720-c173640c77fc`。实现基线为
`0279267e6a1dfbe4c2611e84b855508589c50647`。
本文是完整提案，不是当前合同，也不是已取得的二次确认。确认后才将 revision 2 写入当前版本的
[模型上下文变更说明](../../versions/v1.72/model-context-change-hermes-first-input.md)，保留 R1 和历史验收的原义。
没有修改生产输入、Schema、当前合同或执行旧 Binding 切换。

## 变更前

令 B 为 Core 为本次输入准备的完整 Bootstrap，P 为现有 Dynamic Context Formatter 生成的普通任务正文。
B 包含既有 SESSION_CHARTER、MEMBER_IDENTITY、可选 TEAM_GUIDANCE、ROVAI_PLATFORM_SKILLS、
可选 MEMORY_ENTRYPOINT；省略条件、顺序和内容继续由各自合同拥有。

生产路径：共享 ACP 客户端 → Rovai Python 启动器 → 官方 ACP；启动器准备 Binding 私有 Home、
稀疏配置副本、认证与 Skills 链接、逐 Run 专用 Gateway、原生能力关闭覆盖与 post_compaction Hook。
Core 接受被准入的压缩完成事件后，生成下一普通输入的补发要求。

现有选文顺序：精确 Binding/代次中最近已接受规则摘要不同则 `update`；相同且存在补发要求则
`compaction_recovery`；相同且无要求则 `none`。没有规则证据但有历史 accepted 输入时为 `update`，
完全没有 accepted 输入时为 `initial`。prepared 和 delivery_unknown 不构成已接受规则。

首次正文完整形状：

```text
[Rovai 协作规则]
<B 原文>
[/Rovai 协作规则]

<P 原文>
```

真实更新正文完整形状：

```text
[Rovai 协作规则更新]
以下规则替换此前的 Rovai 协作规则，继续当前会话与任务。

<B 原文>
[/Rovai 协作规则更新]

<P 原文>
```

压缩恢复正文完整形状：

```text
[Rovai 协作规则恢复]
原生上下文压缩后，重新提供当前协作规则，继续当前会话与任务。

<B 原文>
[/Rovai 协作规则恢复]

<P 原文>
```

`none` 正文是 P。上述均通过同一次 `session/prompt` 提交；附件维持现有顺序和类型。
当前证据字段为 `hermes_rules_envelope_version = 1`、完整 B 的 SHA-256、
`initial | update | compaction_recovery | none` 和最终 text 的冻结 Blob ID。

## 变更后

### 输入正文与条件

新普通输入仅有以下三种形状；尖括号表示原文槽位，不作为字面量发送。

`initial`：新 Native Session 第一条实际任务，B/P 逐字保留：

```text
[Rovai 协作规则]
<B 原文>
[/Rovai 协作规则]

<P 原文>
```

`update`：同一 Native Session 最近已接受规则的完整 B 摘要与当前 B 不同：

```text
[Rovai 协作规则更新]
以下规则替换此前的 Rovai 协作规则，继续当前会话与任务。

<B 原文>
[/Rovai 协作规则更新]

<P 原文>
```

`none`：已接受相同 B 后的普通输入：

```text
<P 原文>
```

两个规则块的包装字节与 R1 完全相同。没有新 label、隐藏提醒、额外确认消息、额外模型调用或空任务。
原 Session 冷恢复、ACP 重启、Gateway 重启、压缩次数、Token 变化和输出文本都不改变上述选择。

删除新的 `compaction_recovery` 选择与正文生产。即使收到标准压缩事件，也不产生 Hermes 补发要求，
不重带 B，不创建 Run，不改变已冻结输入。当前规则摘要实际变化后，仍随下一普通 P 携带一次更新。
若合法原生绑定只有历史 accepted 输入而没有可识别规则证据，沿用既有一次 `update` 兼容分支；
不能把缺少证据当成已投递，不能据此重放历史 P。旧私有绑定则按下文切换到新 Session 的 `initial`。

**明确接受：user 层规则不具有 system/developer 优先级；多次压缩后不承诺完整 B 始终保留。**
不再以 protect_first_n 或历史压缩验收证明永久连续性。

### 证据与版本轴

| 字段／版本 | R2 行为 |
| --- | --- |
| `hermes_rules_envelope_version` | 仍为 1，保留现有包装及证据 shape；策略变化由本说明 revision 2 记录 |
| `hermes_rules_digest` | 当前完整 B 的 SHA-256，只用于内容比较，不构成额外执行／恢复门槛 |
| `hermes_rules_delivery_kind` 新写入 | `initial`、`update`、`none` |
| 同字段历史读取 | 继续读取 `compaction_recovery`，包括用已接受旧记录确定最近 B；不倒填、不伪造成功 |
| `hermes_runtime_payload_blob_id` | 保持现有 managed_blob 归属和最终 text 冻结语义；不修改已有 Blob |
| 归属与接受状态 | 复用 Binding ID/generation、Run/epoch、Manifest、请求摘要、native input ID 及 prepared/accepted/delivery_unknown |
| Hermes 补发要求 | 不新建、不消费旧待补发；已有 requested/acknowledged 数值保留，不为失效而伪造 ACK |
| Compaction policy/observer | Hermes 固定停用；旧有效 observer 按现有退役方式失效，配置 override 不能重新启用；其他 Runtime 不变 |
| 数据库 | 不删除旧字段、枚举或历史行，不新增第二套输入账本；实现如需超出此范围须先更新说明 |
| 共享 Formatter/Profile/Manifest | 不改 B/P 的现行版本轴；Hermes envelope v1 不影响其他适配器 |

只用明确 accepted 的规则记录判定已经投递。准备发送、写入管道或进程启动均不能推进规则状态。
已经接受或结果未知的业务输入不能因规则未确认或旧 Home 切换而自动重发。
冻结输入继续可读；切换本身不重新发送旧 frozen/prepared 内容，也不原地重写旧正文。
明确未提交输入的后续处理仍由既有恢复规则决定，不能借补发或迁移创造一次隐式重试。

### 原生输入来源与执行边界

直接使用用户选定的官方 `hermes --profile default acp` 和真实用户 `~/.hermes`。
在子进程参数／环境中排除旧私有目录选择；不修改用户 Shell、`.env` 或原生配置。
不替换 Python 入口，不生成 host.py、不创建运行用 Home/overlay/链接目录、不启动或接管专用 Gateway。
只保留安装发现、最低版本检查、必要原生错误识别及共享 ACP 处理。

原生 personality、system prompt、memory、画像、Skills、工具、MCP、用户 Hook/插件及默认 ACP 工具取舍
重新完全交给 Hermes 现有配置和原生行为。Rovai 不自行打开所有工具，也不批准用户 Hook。
这明确改变 R1 中的原生能力关闭／私有 Home 决定，不意味着改变 Core 生成的 B/P。
原生会话保存、memory 更新、认证刷新仍可以正常写数据；不将用户 Home 设为只读。

只回收 Rovai 启动的 ACP 连接进程；取消走官方 `session/cancel`。
原生自动创建的共享 Gateway 即使是 ACP 后代，也不属于本 Run 的递归回收树。
连接断开、ACP 被杀与 Gateway 仍执行可以同时发生；结算必须保留未知事实，不把连接退出当作执行已停。

不同成员保持不同 Session ID，同一 Session 的业务输入仍串行；共享 Home 意味着原生长期记忆不隔离。
模型、权限、新建与恢复使用官方 ACP。删除私有 prepare_session/steer/recover_unknown 控制路径；
没有可用官方同轮插话接口时进入现有后续队列。MCP 仅采用官方会话参数和可确认结果，空恢复列表不冒充撤销。
原生恢复失败不偷偷新建 Session。未知执行保留事实并使用经核对的原生维护入口，不另造恢复子系统。

## 明确不变

- B/P 内部 section、内容来源、选择和省略规则、共享 FIFO 与截断策略、附件类型和顺序不改。
- 保留最终正文的精确整体预算；删除恢复块所需的 Hermes 专属预留，不通过截断 B/P 通过预算。
- 接受账本、输入去重、公开 Send 与任务结算的公共产品规则不改，不以模型自然语言猜成功。
- CLI lease、当前 Run/epoch 和 Binding 校验不弱化；没有传递上下文就不能猜身份或使用旧 lease。
- 其他 Runtime 的 system/FirstPayload、压缩补发、进程树回收与存储均不改变。
- 本次不实现进程热复用、新常驻服务、缓存、轮询、数据库合并器、全局锁或 CLI→MCP 运输替换。

## 数据迁移、失效与恢复

| 既有状态 | 行为 |
| --- | --- |
| 精确 Session 已在用户原生存储 | 使用当前可用 Hermes 实际恢复；安装路径、版本、指纹变化只触发必要重探测/进程更新 |
| 私有 Home 的已结束任务／会话 | 保留旧 Binding、历史、输入、证据和目录；下一条新业务输入建立新的原生 Session 与 Binding 代次 |
| 私有 Home 的在执行、审批、排队或 unknown | 不因升级自动迁移、放弃、重放或重新执行；保留原事实并先按已有规则处理 |
| 原生存储归属不能证明 | 不猜测为用户 Home，不用相同 ID 伪恢复；保留明确诊断 |
| 旧 Hermes 待补发 | 停止生效与消费，不将其标成已完成；历史记录仍可读 |
| 旧冻结正文／旧恢复投递 | 保留原字节、接受状态和历史 kind；新输入不继承旧恢复要求 |
| 旧能力快照 | 重新探测；删除 Hermes `context.compaction.signal_driven`、`context.compaction.best_effort` 和未验证能力，不因此给原生绑定换 Session |

私有 Home 切换必须可见：

> 已切换到用户原生 Hermes 会话。旧记录仍保留，但旧私有会话上下文未自动迁入。

新 Session 的 B 属于正常 `initial`。不复制／合并数据库，不删除旧目录，不提供私有 Home 生产回退开关。

## 实施前提与本轮证据

[共享 Gateway 边界实测](native-acp-boundaries-2026-10-24.md) 已确认普通 ACP、原 Session 冷恢复、
定向取消、连接退出与 Gateway 生命周期边界；也复现了 CLI 环境未传递、真实 `send` 失败。
没有找到当前官方 ACP 可直接使用的会话级 CLI 身份运输，CLI/TUI 的 client_env 不是 ACP 已有能力。
原生自动启动的 Gateway 仍可能是 ACP 后代，连接级回收必须显式实现。

因此本说明的确认只批准上述输入／原生边界，**不授予完整协作验收通过**。
保持这些边界时，当前版本的内置 CLI 仍是明确接入缺口。不能为通过它重建私有 Home、专用 Gateway、
全局覆盖、cwd 身份推断或临时 MCP 桥；也不能悄悄把公开 Send 要求改成模型回复即完成。
如需改变运输设计，应另行说明；本提案不预先选择新产品模式或虚构可用能力。

## 可执行验证与关键负向测试

沿用现有测试 owner、隔离流程和文档门禁，不新增验收框架。实现后至少覆盖：

| Case | 通过标准／反例 |
| --- | --- |
| 实际原生启动 | argv 为官方 ACP；不落盘/加载 host.py，不创建私有 Home，不改用户配置/Hook/指令文件 |
| 初次／后继／冷恢复 | wire 中首次恰好 B+P，接受后仅 P；原 Session ID 保持，PID/Run 变化不触发 B |
| 真正规则变化 | B 摘要变化时仅一个更新块；接受后不重复，不新建 Session |
| 压缩及旧 pending | 接受原生事件或已有待补发均不产生要求／新恢复投递；相同 B 的下一输入仅 P；ACK 不伪推进 |
| 未接受与未知输入 | prepared 不计接受；未知不重放；旧 Blob 原样可读 |
| 两 Session 并发／取消 | 取消 A 不影响 B 或共享 Gateway；结果属于其他请求时不关联 |
| 退出与崩溃 | 覆盖现有 ManagedProcess/Fleet owner；不捕获/杀共享 Gateway；ACP 退出不能证明远端任务停止 |
| CLI 身份 | 预先运行 Gateway、两个真实成员、下一 Run lease 更新均正确 Send；未通过须明确缺口 |
| MCP | 新建、冷恢复、Gateway 重启后的凭据重供与配置变化；空列表不误报撤销 |
| 切换旧绑定 | 结束会话可见新代次；旧历史保留；running/unknown 不自动切换；已有原生会话继续精确恢复 |
| 跨 Runtime 回归 | Hermes 策略停用不影响其他 Runtime 压缩/上下文/进程回收；共享工具上下文定向刷新保留 |

真实验收仍使用隔离原生环境与受控端点。当前仅完成第一阶段诊断，不把旧私有 Home 验收计入 R2。
实施后的格式、构建、相关 Rust/Python 回归及 docs:test/docs:check/docs:check:ci 记录另行追加。

## 二次确认

`revision: 2`，`confirmation_status: pending`；没有 `confirmed_revision`、`confirmed_by` 或 `confirmed_at`。
User sequence 46 是本次新需求，不冒充已阅读这份完整 R2 后的二次确认。
[治理规则](../../development/model-context-change-governance.md#二次确认门槛)明确要求：
“说明内容发生语义变化时必须递增 revision，旧确认立即失效，重新取得开发者确认”。
确认前可继续调查和提案，不能修改实现、Schema、当前合同或执行 clean break。
确认后把本说明落入当前版本文件并记录实际确认；保留 R1 的历史语义，不再把其压缩补发要求约束 R2。
