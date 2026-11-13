---
document_type: implementation-proposal
version: v1.72
authority: proposed-runtime-integration
status: accepted
revision: 1
confirmation_status: confirmed
last_updated: 2026-11-13
---

# Goose 官方 ACP 接入提案 R1

User sequence 109 要求基于 Kilo 经验深入调研并开启 worktree 接入 Goose。
研究和原生探测已经完成，见 [14 轴矩阵及原生证据](../../research/goose-runtime/README.md)。
User sequence 117 已确认本 R1 并要求实施；[独立模型输入说明](model-context-change-goose-acp.md)记录相同输入合同和真实确认。

## 最小接入结构

| 事项 | R1 采用的方式 | 与 Kilo 的关系 |
| --- | --- | --- |
| 产品入口 | 新增 `goose-cli`，只启动完整官方 `goose acp`，以原生 1.59.0 为实测基线 | 同属共享 ACP；不借用 OpenCode 版本判断，不再注册小型 goose-acp 第二身份 |
| 认证／环境 | 原生配置与认证保留；只合并现有成员环境、CLI lease 和执行参数 | 不复制 HOME、keyring、OAuth 或其他 Runtime 的登录状态 |
| Host | 一个成员 Native Binding 一个 Host，原 Fleet 管健康、兼容、Warm、LRU 和回收 | 不新建池，不因为插话成功就退役 |
| Session | `session/new` 或保存 ID 的精确 `session/load`；兼容变化可换 Host、保持原 Session | 不靠 recent/list 猜恢复，不搬运原生历史 |
| Bootstrap | 同一 Session 的固定 key、append System RPC；成功后才发 P | 比 Kilo 少私有 instructions 文件与配置合并 |
| Steer | 原生 steer RPC，带 activeRunId，按 messageId 回执确认接收 | 不复用 Kilo 的第二个 session/prompt；不等 end_turn |
| 模型／档位 | 官方 Provider inventory；目标模型按需查 thinking_effort | 档位用 MiniMax/DSH 已有共享按需机制，不做全模型扫描 |
| 权限 | 原生 mode，创建默认 auto；可配置 approve/smart_approve/chat，原选项审批转交 | 没有新的 allow/ask/deny 翻译、权限 Hook 或第二求值器 |
| MCP | 标准 mcpServers 加官方 Session extensions list/remove；共享配置兼容判断 | 保存下一轮生效；补上 Goose 原生恢复不会删除旧工具的语义 |
| cwd | 仅 stdio 的显式 cwd 不同时使用 bundled Rovai launcher | 不增加隐式 Node，不猜命令里的路径；HTTP 不走 launcher |
| Skills | 原生技能继续原生；Rovai 平台／工具箱及显式引用沿共享索引、真实路径读取 | 不写用户全局 Skill 配置，不建立 Goose Skill 镜像 |
| 文件／输出／子代理 | 小型原生元数据转换，复用 Action/输出预算和既有子代理展示；合法 patch 才进共享 Diff | 不重复创建操作；没有完整补丁／前像就不伪造整文件 Diff |
| 用量 | 官方累计通知和逐消息缓存，复用共享基线、checkpoint 与监控 | 不再读 SQLite／反复扫描历史；估算费用如实标记 |
| 准入 | 原生研究不等于 First-Class；按平台逐项完成 Core/真实模型验收 | 不把 Kilo 的平台资格复制给 Goose，不在界面堆资格提示 |

实现薄层只负责 Goose 入口、原生请求/通知与既有 Runtime 类型之间的映射。
ACP Client、请求表、Activity、Approval、Delivery、Context、Fleet、MCP Assignment、Monitoring 和 CLI 所有权沿现有 owner。
不增加 Goose 私有队列、取消状态机、HTTP server、配置管理器、认证镜像、hash、nonce 或装载握手。
原生 1.59.0 是首个验证基线，不推断更低版本具备这些扩展；版本识别／范围和升级状态使用共享规则，
不添加精确版本锁或因看到新版本就自动退役旧 Host。更高版本不自动取得新的目标平台实测结论。

## 模型输入说明 R1

### 变更前

当前 Core Runtime 闭集没有 `goose-cli`，不会向 Goose 投递任何 Rovai Bootstrap 或 Dynamic Context。
相邻的 Kilo managed-system 路由通过原生 instructions 文件交付 B；MiniMax/DSH 等保留各自既有路由。
本次只增加 Goose，不变更已有 Runtime 的这些输入。

定义：

- B：共享 ContextService 为本 Run/Native Binding 准备并冻结的完整 `bootstrap.payload` UTF-8 字节。
- P：共享 ContextManifest/Delivery 冻结的 Dynamic Context UTF-8 字节；不重新选择历史、不重新格式化。
- S：共享 Binding 保存的精确 Goose nativeSessionId；不解析日期或截短。
- N：Goose 自己的 base System、用户原生规则、工具描述、时间／cwd turn-context 和其他原生内容。
- K：固定原生追加键 `rovai-session-bootstrap`；只用于替换本 Session 的这一项，不作为证据校验码。

### 变更后

仅为新 identity 选择现有 `managed_system_prompt` 模式，并使用以下原生 RPC 承载。
尖括号表示原有冻结值的完整字符串，不是要写入模型的占位说明。

**每个普通 Run 的准备阶段，在 Host 归属本 Run 且旧 Run 静止后：**

```json
{
  "method": "_goose/unstable/session/system-prompt/set",
  "params": {
    "sessionId": "<S>",
    "mode": "append",
    "key": "rovai-session-bootstrap",
    "text": "<B>"
  }
}
```

等待同一 RPC 的成功 result `{}`，再投递业务输入。错误、超时或连接中断沿共享准备失败路径处理，
不得回落为把 B 塞入 user 历史或在准备失败后继续发送 P。
不调用 mode=set，不清空或重排原生其他 System 项，不改写用户原生配置文件。
追加指令的展示包装和原生 Unicode tag 清理由 Goose 拥有；Rovai 发送层保持 B 原字节。

**普通业务输入：**

```json
{
  "method": "session/prompt",
  "params": {
    "sessionId": "<S>",
    "prompt": [{"type": "text", "text": "<P>"}]
  }
}
```

不在 prompt 里再拼一次 B，不加入 `/auto-approve`、伪用户请求、Goose 专属模板或承诺文本。
现有附件／内容块转换及访问规则继续由共享 owner 处理；这里的文本块为冻结 Dynamic Context。

| 时点 | 精确行为 |
| --- | --- |
| new Session | 原生 new 成功后设置 K=B，成功后发 P；首次输入不是 B+P |
| warm Run | 旧 Run 已隔离后以本 Run 的 B 替换同一个 K；不因 B 正文变化重启 Host |
| exact cold load | 用保存的 S 和数据根加载原 Session，隔离原生历史回放；发 P 前再设置当前 K=B |
| 自动阈值／overflow 压缩 | 由原生执行；后续普通业务生成继续使用 Session 的 K，不向 user 历史重补 B |
| 原生摘要／标题／子代理 | 各自 System 由 Goose 拥有；不承诺包含父 B，不把它们改成 Rovai 新成员 |
| 新普通 Run | 使用新的 Run/epoch/CLI lease、本轮冻结 B/P；不继承旧 Run 授权 |
| accepted／unknown 恢复 | 按共享 Delivery 保留事实，不重新发送原 P 或补充 P |

B 的 section shape 完整沿用现行 formatter；以下正文槽位由共享代码返回，不由 Goose 层重建：

```text
[SESSION_CHARTER]
<现有 Charter 原文>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
<现有本人身份 JSON>
[/MEMBER_IDENTITY]

[TEAM_GUIDANCE]
<仅现行来源非空时出现的团队指引原文>
[/TEAM_GUIDANCE]

[ROVAI_PLATFORM_SKILLS]
<现有平台 Skill 索引>
[/ROVAI_PLATFORM_SKILLS]

[MEMORY_ENTRYPOINT]
<仅现行来源非空时出现的记忆入口原文>
[/MEMORY_ENTRYPOINT]
```

TEAM_GUIDANCE／MEMORY_ENTRYPOINT 不成立时整个 section 省略，不留下占位文字。
P 的完整 shape、字段、省略、顺序、来源选择和预算沿现行
[ContextManifest v43/v44](../../contracts/context-manifest-evidence-v44.md)与
[Context Delivery Profile v15/v16](../../contracts/context-delivery-profile-v15.md)，没有 Goose 私有 JSON 字段。

**补充输入的承载：**

```json
{
  "method": "_goose/unstable/session/steer",
  "params": {
    "sessionId": "<S>",
    "expectedRunId": "<本 Run 观察到的原生 activeRunId>",
    "prompt": [{"type": "text", "text": "<共享机制冻结的补充 P>"}]
  }
}
```

只在原始输入已按共享规则接收、同 Run 原生 ID 明确且请求仍活动时可发送。
原生成功返回的 runId/messageId 绑定本次补充 Delivery，确认的是“Goose 已接纳”，不是“模型已处理完”。
RPC 写出不等于接收；错误、超时／断连、错 Run 或迟到回应继续既有 rejected／unknown／epoch 规则。
同一 messageId 的后续消费通知不再次记接收、不再次入队。不新增重试保活或后台回执追踪器。

### 明确不变的边界和版本轴

基线的 Bootstrap contract v6、Bootstrap formatter 6、Charter revision 26，普通 Formatter/Manifest 44、
public-batch Formatter/Manifest 43、Profile 16／public-batch 15 全部保持。
不以新增 Runtime 为由改变其他 Adapter 的兼容键或使合法旧 Binding／冻结输入／Manifest 失效。

B/P 的选择、排序、省略、预算、身份、Memory Entrypoint、附件、Current Input、Skill 及公共历史权威不变。
沿用共享 Bootstrap Evidence 和 Runtime Input Delivery Evidence；不增加 Goose checksum、装载回执或运行时正文核对。
必须材料超预算仍由共享准备拒绝，不截断 B，不私自压缩、摘要或另开模型调用。
Native setter ACK 只证明 API 调用成功；实际模型可见证据由隔离验收的 Provider 请求证明，不把 ACK 伪造为读入证明。

### 数据、迁移和恢复

确认后仅做新 Runtime 身份所需的闭集 Migration，编号和 schema 目标按实施时主线尾号分配，不预占。
不迁移／导入用户 Goose 历史，不写其他 Runtime 的配置或认证，不改写旧 Run 事件及审计。
原生数据根参与现有兼容性判断；准备变化只按共享机制更换不兼容 Host，再精确 load S。
缺少 S 或原生报告不存在时沿既有恢复失败路径；不能猜一个最近 Session 来继续。
如果实施需要改变上述任何字段、输入语义、证据或版本轴，必须提升本提案 revision 并重新确认。

### 二次确认

User sequence 117 已明确要求实施 revision 1；完整确认记录见
[独立模型输入说明](model-context-change-goose-acp.md#二次确认)。

## 需要批准的上游差异与小型映射

### 模型目录与目标档位

健康／安装检查和完整目录仍分开。目录读取官方 Provider inventory，投影已配置且可用的原生模型；
不把标准 provider 下拉里的未配置项当成可执行模型，不拼接另一份静态模型表来补全。
显式目录身份用 `providerId/modelId`，只拆第一段原生 Provider 路由，后面的 modelId 原样保留，
包括模型名本身可能含有的 `/`；原生 ID 不按模型名称推断。
没有显式模型覆盖时跟随 Goose 原生默认，不为了列目录改动业务 Session。

显式执行按原生 provider、model、thinking_effort 的顺序设置，失败不悄悄换模型继续。
目标模型档位用共享按需目录查询收集其 configOptions，再在执行 Session 应用原始选项值；
不遍历所有模型，不读取／改写全局 preferences，不把 reasoning 布尔值转换成自造档位。
缺少档位和目录刷新失败继续既有 partial／缓存语义，不降低已冻结的用户选择。
标准 ACP authenticate 在 1.59.0 不执行登录，不作为已认证证据；readiness/check 仅适用嵌套 ACP Provider。
继续用原生配置、明确凭证状态和真实请求结果表达认证事实，不新建统一 OAuth／验密系统，不以握手伪装账号验收。

### 原生模式、审批与问卷

新成员默认原生 auto，与既有产品默认自动执行方向一致；保存的 mode 原值通过 `session/set_mode` 应用。
approve/smart_approve/chat 仍是 Goose 自己的语义，不包装成其他 Runtime 的 allow/ask/deny 或硬沙箱等级。
不声明 Goose 提供 Core 强制 readonly；原生审批保留原 optionId 与 exact-once/迟到保护。
不广告当前未实现的 ACP elicitation form；Goose 会取消，已用真实 MCP 夹具验证取消及后继输入。

### MCP 下一轮生效与归属

共享保存操作只保存，不主动清理 Goose Host。Run 读取冻结投影；下次准备使用最新配置。
保留共享兼容判断与获取时旧 Host 清理，A→B→A 未运行允许复用原 A；实际替换后不复活旧 Host。

Goose 在原生 Session 中保存 mcpServers，empty/load 不删除旧工具，因此仅换 Host 不足够。
利用现有投影条目的 server_id 和 runtime_name，以 `rovai_assigned_<server_id>` 作为稳定运行名，
同时更新线上 mcpServers 键与既有 exposure 的 runtime_name，不另存一份所有权表。
该名字跨 Run 稳定，删除／禁用后不会因分配标签不同而藏住残留。

准备时官方 list 得到 extensionKey，只对属于这段保留命名空间且已不在本轮投影中的项调用 remove。
本轮项通过标准 mcpServers 添加／替换；保留原生用户扩展，不能用 `_meta.gooseExtensions` 排他替换全部扩展。
命名空间里的项目由 Rovai 管理；用户自建原生扩展不应使用这段前缀。产品显示仍用现有逻辑名称。
逻辑同名不删除用户原生扩展；实际运行名碰撞按现有 RovaiWins 归属策略处理。
不新增配置版本、dirty 标志、队列或保存阻塞。
原生 load 可能先恢复旧扩展连接，撤销在 load 之后、业务 P 之前完成；不宣称撤销项零启动动作。

仅显式 stdio cwd 不同才复用 bundled `rovai __mcp-stdio-cwd`；不引入裸 node，不解析语言命令。
当前仅原生 stdio 同 cwd 与删除通过，正式不同 cwd、HTTP 和分配 A→B→A 的 Core 验收仍必须完成。

### 文件结果、输出与子代理

工具名／扩展身份优先读原生 `_meta.goose.toolCall`，rawInput/rawOutput 沿共享 Action。
edit 的 before/after 作为原生替换片段展示，未知原文件行号不补造；只有原生给出合法 patch 才交既有 normalizer。
当前默认 write/edit 没有标准完整文件 Diff，write 也没有完整 preimage，显示真实操作结果，
不事后读文件假装取得修改前内容，不虚构全文件删改计数；操作只投影一次。
这是新 Runtime 原生传输的明确差异，须在实施时的 Version Decision 接受，不能默认为全功能 Diff 已支持。

shell 结构化 stdout/stderr/exit_code 优先于展示文本；沿共享 snapshot/delta 去重和永久 7.5 KiB 输出预算。
不广告 toolCallLabelEnrichment，不为显示工具标题另加一次模型生成。
前台 delegate 用已有子代理展示，不把早返回的工具完成当 child 完成；原生父 prompt 负责 join。
不增加子代理调度器，不扫描子历史填充看不见的步骤；原生子代理身份和 System 归 Goose 管理。

### Skills 与公开消息

延续现有 readonly native Skill 发现与菜单，加入已核实的 Goose 项目／用户目录；
启用插件的实际加载仍由 Goose 决定，不声称 Core 已枚举全部插件。
Rovai 的平台、工具箱、显式引用沿共享索引与真实路径交付，并验收模型实际读取和更新删除。
不虚构额外 Skill 路径变量，不写用户项目或全局原生 Skill 目录。

现有 bundled CLI 与业务凭证交付不变。模型 narration/final 不自动变成公开 Thread 消息；
合法空 end_turn、取消和 Missing-Send 继续共享行为，不为补消息另调用一次模型。

### 用量基线与来源

仅选官方 custom 累计 input/output/cost 为主计数源，context used/limit 是 gauge。
new 的明确 0、cold load 的累计末值、warm Host 的已观察末值在 dispatch 前建立现有 checkpoint；
缺少可证基线时标 partial，不能先吃掉第一条生成数值再宣称完成。
逐消息仅补充 cache/provenance，不叠加已被累计计入的 input/output/cost；历史回放不计新 Run。
输入采用 CacheInclusiveTotal，原生 estimated 映射既有 runtime_estimate；没有来源的累计成本不能升级为 provider_reported。
摘要缺少缓存桶保持 unknown/partial，不用 0 补齐；子调用和辅助调用仅按明确的原生归属观察。
不新增数据库扫描器、价格推断服务、用量账本或私有 counter reducer。

### 取消与复用

使用共享 ACP cancel、Run/epoch/Prompt 围栏和 Fleet Reusable/Reaped 证明。
公共清理截止点仍为开始后 2 秒 interrupt、2.5 秒 flush、非 Windows 3 秒／Windows 5 秒总等待预算。
提前收尾立即继续；不加内部 Goose 二次计时，不以本地 token 取消、已发通知或“找不到 handle”代替真实清理。
静止、健康、旧授权／审批／终端／事件已解除且无退役原因才 Warm；超时、异常或未知继续停止／回收。
应用退出、禁用、成员删除、配置不兼容等必须停 Host 的情形保持原边界；不泛化覆盖 ZCode/Hermes 专属所有权。

## 验证和实施顺序

1. R1 二次确认、独立模型输入说明和 Version Decision；按主线尾号增加闭集 identity。
2. 发现／版本／轻检查／平台状态，模型 Provider 路由及目标模型档位；原生 auth 与握手结论分离。
3. 共享 ACP/Fleet Session、B→setter ACK→P、initial acceptance、原生 Steer、精确恢复。
4. MCP 归属删除／cwd、原生 Skills 与共享索引、Tool/Diff/输出、前台子代理、Monitoring。
5. 扩展现有 Rust 测试 owner，完成 schema／恢复负向、准备失败零 P、wrong-run、历史隔离、
   累计基线／去重／压缩成本、文件单投影、7.5 KiB、MCP 撤销、迟到审批、超时与无假 ACK；遵守测试准入政策。
6. 独立官方 CLI/Core smoke：new/warm/exact cold/压缩后 cold、连续 Steer、取消及子代理取消后真实同 Host、
   新 CLI lease/epoch、公开 `rovai send` 唯一消息、Skill 实读及更新删除、MCP A→B→空与 A→B→A。
7. 自动阈值和 overflow 必须实际触发，不能拿手动 compact 替代；新旧共享 ACP 快慢取消和专属 Runtime 回归。
8. 配置完成的真实模型和独立开发 App 验收；macOS arm64 原生探测不代替真实 auth、Intel/Linux/Windows。
   按 [14 轴及 9 Flow](../../development/runtime-integration-checklist.md)分别收口，缺资格如实保留。

上述方案是 Research→实施输入，不把 Core Compatible 称为已完成接入。
需要提前开放的平台必须有新的当前 Version Decision 接受 Preview，不能借用 Kilo 的资格，也不新增常驻 UI 资格说明。

## 本次交付状态

分支 `rovai/goose-acp`，worktree `../rovai-ai-goose-acp`，状态 active。
已完成固定源码核查、官方二进制原生探测、14 轴矩阵、可复现脚本和本 R1。
User sequence 117 后进入实施；继续在同一分支／worktree 修改产品接线并逐项验收。
