---
document_type: implementation-plan
version: v1.72
authority: implementation-status
last_updated: 2026-10-24
---

# Hermes 首次输入规则实施与验证

按 [R1](model-context-change-hermes-first-input.md) 和 User sequence 31 实施。
Core 继续拥有完整 B；Hermes 在首次、更新或可靠完成通知后的下一普通输入携带一份规则。
官方 ACP/Gateway 与逐 Run lease 不变；原生 system/personality/环境变量不再被 Adapter 解析或覆盖。

Migration 215 / schema 165 保留旧记录，仅增加 nullable 输入证据；初次交付 controller revision v4（下节补修升至 v5），Hermes
outer envelope v1；共享 Bootstrap v6、Charter 25、Dynamic 40/42 与 Profile 15/16 不变。
历史 system Evidence 不改写。prepared/unknown 不消费规则或补发 revision，也不自动重放旧业务任务。

## 生产 Core 与实际请求

[受控 Core 证据](../../research/hermes-runtime/first-input-core-acceptance-2026-10-23.json)：
`protect_first_n=3` 和 `0` 各运行七个成功 Run，同一 Native Session，投递类型均为
`initial → none → none → update → compaction_recovery → compaction_recovery → none`。
第三轮和第七轮都重启 Core；第七轮在两次补发已接受后冷恢复，不重复规则。
原生完成 Hook 使 requested revision 从 0→1→2，输入 ACK 分别消费 1、2；较早 ACK 不清理较晚通知。
每轮同一任务只发一次实际 `session/prompt`，主模型为一次 terminal Send 加一次 final，未增加规则确认调用。

使用生产 Core/CLI、未修改的官方 ACP/Gateway、确定性 loopback Responses 和真实请求捕获。
测试窗口 65536、阈值 0.5、尾部保护 2，第三/四轮合成 input usage 60000 触发原生自动摘要；
它证明运输、事件、账本与恢复链路，不冒充真实模型质量或原生默认配置验收。
Gateway 原生会 trim 消息首尾空白，模型请求与冻结输入经这一原生规范化后相等，B 内部完整原文不变。
源配置手写 system prompt 仍位于 system 层，B 位于 user 层。

初版验收遇到原生最小窗口 64000 的明确拒绝，已改正测试窗口；未把失败 Run 计为通过。
另有新 Home 的原生 `--version` 被同步联网更新检查拖到 15 秒超时，尚未提交任务。
loopback fixture 使用原生 `updates.check=false` 关闭这项联网行为；未放宽生产超时或版本门槛。

## 真实模型自动压缩

[真实请求/完成事件证据](../../research/hermes-runtime/first-input-automatic-compression-2026-10-23.json)：
官方 0.22.4 / source `4d04303818b61bf3aa09278af48356315515965b`，Sub2API `gpt-6.1-sol`。
正常文件读取触发两次已提交 summarize，分别来自 pre_api 与 post_tool；没有主动 compact 或压缩器补丁。
保持原生配置 protect_first_n=3 / protect_last_n=20 / threshold=0.5；原生实际窗口 272000，
实际阈值 204000，以原生日志为准，没有把配置比例直接乘作有效阈值。
官方 pre_api_request 观察完整规则正文是否在 user 历史、是否进入 system；post_compaction 只观察完成事实。
下一普通输入补发后及原 Session 冷恢复后的请求均有完整规则，未进入 system，冷恢复没有新增规则输入。
这一层使用较小的合成规则块，完整 Core B 的证据由上节拥有。

原生摘要可能逐字保留规则，历史中也可能仍有旧副本；本方案按可靠完成通知补发一次，
不编辑或清除原生历史。不能从某次摘要保留推导所有路径永远保留，亦不宣称同 Run 内立即恢复。
旧 system 层压缩报告不作为此次 user 规则永久保留证据。

## 回归、限制与复现

Controller 4 个确定性回归通过。wire fixture `rovai-hermes-wire-NdYZkg` 的 7 个实际请求通过：
user 规则、原生 env/config/personality 各按优先级生效一次、控制命令、并发拒绝、失败与 usage delta。
原生 `gateway: null` 配置启动兼容已修复并随 wire 验证。
experience fixture `rovai-hermes-experience-dFMn8a` 通过文件片段、reasoning、问卷关闭及同 Session MCP 增改撤销。

[真实 Core 回归](../../research/hermes-runtime/first-input-core-recovery-2026-10-23.json)通过同 Run Steer、
唯一公开 Send、文件证据和冷续轮的真实终端取消。但强杀 Core 后的继续执行**未通过**：
原生 admission 留在 `unknown`，controller 拒绝 unsettled Session；Core 保留
`accepted_input_outcome_unknown`，没有自动重放旧任务、清理原生未知记录或换 Session 绕过。
这限制强杀后的即时续接，不混同已通过的正常冷恢复。所有已记录后代均退出；临时凭据副本已清除。

定向 Rust：Hermes 4、Bootstrap 11（另 1 个 Command Code 原生用例未启用）、compaction 16、redelivery 2、
CLI hook 1、catalog migration 1、迁移准入矩阵 1、数据库打开准入 1、Managed Blob 3 均通过；筛选间有重叠。
迁移夹具跟进 schema 165；缺当前 receipt/规则字段拒绝，历史可选统计缺失仍可重开。
新增最终 Blob 纳入现有 FK 引用保护与 Thread 删除回收。
`pnpm typecheck`、文档测试 10 项、通用/diff-aware 文档门禁、Rust fmt、脚本语法和 whitespace 检查通过。

复现入口：`scripts/smoke-hermes-first-input.mjs --compression` 与 `--compression --unprotected`；
真实模型使用 `scripts/smoke-hermes-auto-compression.mjs`。均声明独立 Home、data-dir、Skill Library 与 MCP。

## 合入前补修与显式恢复

按 User sequence 34 / [D61](decisions.md#v1-72-d61) 实施，保持 FirstPayload。生产 Ready 能力独立声明
`context.charter.first_payload`、`context.compaction.signal_driven`、`context.compaction.best_effort`，
移除 Hermes 的两个旧 system 保证；模型、effort、权限和 session.load 保留。
普通目录映射测试修复前实际失败，现已改正。静态发现使旧 Ready 变为 installed_unverified；
深检缓存也拒绝旧合同，运行检查后回到新 Ready，不为刷新能力而轮换原生 binding。

新增用户 CLI 查询和明确确认入口，合同见 [Hermes Managed Runtime](../../contracts/hermes-managed-runtime-v1.md#用户明确处理未知执行)。
Core 持久记录精确 Run/binding/admission/generation 的用户同意，再调用官方 `prompt.resolve_unknown`；
controller v5 使用独立控制连接，不加载普通 ACP Session，不发送任务。确认结果未知时重用同一检查文件，
先查询精确 receipt；同一个 commandId 不可更换确认目标。原 Run、输入和公开发送证据均不改为成功。
维护 Host 仍由 Fleet 回收；复用逐 Run 的原始 Session 存储，不复用旧 CLI lease。

[受控与真实恢复摘要](../../research/hermes-runtime/explicit-unknown-recovery-2026-10-23.json)分开保存：

- `rovai-hermes-first-input-566fmf`：官方原生执行＋loopback Responses，六阶段覆盖首次、后继、冷恢复及旧 Ready
  升级、规则更新、Core 强杀和显式处理后的新任务。错误 binding/generation、缺少确认和 commandId 换目标均拒绝；
  检查不消除 unknown，恢复零模型调用、零额外业务 Run，Core 再重启后的同确认重试幂等，旧任务失败且执行一次。
- `rovai-hermes-core-h3UHnB`：生产 Core/CLI＋真实 Sub2API `gpt-6.1-sol`。同 Run Steer、文件证据、公开 Send 和
  真实终端取消通过；同时强杀专用 Gateway 与 Core，明确得到 unknown；用户确认后原 Session 的新任务成功，
  旧任务仍失败、旧输入未重放、公开 marker 各一次，受管进程全部退出。

三个先行尝试保留为诊断：旧 Ready 升级首次未命中静态发现分支，现已修正；一次 Host 启动身份校验遇到
`try_lock` 读 PID 的竞争，改为只在 Hermes Ready 校验处等待 child 锁，保留 PID/revision/version 校验；
一次仅强杀 Core 的真实模型运行已经由原生结算为空闲，不计入 unknown 恢复通过。
后续 `--force-unknown` 明确同时强杀独占 Gateway，避免把原生正常结算路径冒充未知执行处理。
这批验收的凭据/config 副本已清理，源 Home 未改，保留脱敏摘要和隔离执行证据。

普通 Rust 全量回归单独执行；首次发现兼容性文档证据 hash 过期（431 passed / 1 failed / 1 ignored），
按实际文档更新 hash 后重跑，不跳过原断言。补修与主线合并提交 `2cdadec68` 的
`cargo test --workspace -j 2 -- --test-threads=1` 为 **478 passed / 0 failed / 1 ignored**；
最后将缓存校验严格限定为 Hermes，最终提交的同命令复核结果记录在 [PR #878](https://github.com/murray17/rovai-ai/pull/878)。
CI 的 fmt/check 不替代 Rust 单测。
Controller 确定性回归 5 项、User Automation 定向测试 10 项与 TypeScript 检查通过。
本次不重跑已记录的自动压缩矩阵，不把显式恢复当作同 Run 压缩恢复；未新增 Renderer 按钮或日常 App 安装验收。

## 原会话优先与可用性收口（2026-10-24）

按 User sequence 36 / [D62](decisions.md#v1-72-d62) 与共享同类 CLI Resume 规则对齐。原生 Session
选择本来就不应按历史指纹拒绝；此次删除 Hermes 额外的 Session 配置冻结和维护入口旧安装相等门槛，
保留实际启动的最低版本、原生能力和身份检查。正常任务及维护都使用当前选定安装，原 binding 的
Home/profile/Session 保留，版本和指纹只影响必要探测与进程更新。controller revision 为 v6。

历史恢复成功后先返回原生状态；Core 在投递前分别报告 running、approval、queued、unknown，模型、
权限和 MCP 变更留在空闲时准备。实际缺失或无恢复能力仍保留目标并报错，Hermes 不走自动新 Session
回退。没有输入在途时允许对同一专用 Gateway 的状态读取重连一次；不重启执行者、不重发业务请求。
删除跨 Hermes Session 长锁，复用 Fleet 的 binding owner 与同 Home 文件锁。

[本轮脱敏证据](../../research/hermes-runtime/availability-recovery-2026-10-24.json)对应
`rovai-hermes-first-input-k58OJV`，生产 Core＋未修改官方 0.22.4＋loopback Responses 全链通过：

- 原地修改 launcher 指纹后续聊；切换 launcher 路径并冷启动后续聊；启动 Home 改变后实际模型请求
  仍使用原 Home 的 system prompt，首次规则不重复，身份更新仅一次。
- Core 强杀留下 unknown 后，隔离 Core 安装夹具停用旧安装记录，选择新记录并加入过期 0.22.3 缓存，
  再切换路径/指纹。检查与确认使用当前安装，原 Session/绑定和旧 Run 证据保留。未编辑原生 SessionDB。
- unknown 时普通续聊的历史恢复成功，新 Run 以 `hermes_session_unknown` 失败且没有 dispatch。
  检查和错误确认不消除 unknown；明确确认只处理精确执行，重启后同确认幂等，旧任务保持失败。
- 处理后原 Session 新任务成功；旧业务动作一次，公开 Send 各一次，恢复过程零模型调用，强杀后代全部退出。
  新安装的目录深检在普通续聊已经成功之后单独执行，Ready 不是续聊的前置条件。

本轮普通 `cargo test --workspace -j 2 -- --test-threads=1`：**478 passed / 0 failed / 1 ignored**。
三个既有 extended owners 分别覆盖安装/路径/版本/指纹漂移仍选择原 Session、Hermes load-only 恢复，
以及不同 Hermes binding 同时进入启动、相同 binding 拒绝第二 owner。Python controller 8 项通过，
包括状态分类、读取断线重连、固定 Home 和无 marker 旧存储接续。未增加 Rust 测试入口。

首轮发现路径变化时已失效快照仍残留 system 能力，现已在发现阶段清除；其余先行夹具失败涉及取错
上一失败 Run、SQLite 纳秒时间需 BigInt，以及把新安装未验证快照当成 Ready。原始失败目录和原因保留，
不作为验收通过。实际执行版本只有 0.22.4，wrapper 与缓存变化不能冒充新版原生兼容性验收。
读取重连和运行/审批/排队分类本轮只有确定性控制器证据；真实模型与自动压缩沿用上节分层记录，
没有重跑或扩大平台资格。普通续聊不需要 CLI 维护；无法确认的 unknown 仍须用户明确处理，当前异常入口为 User CLI。


## 官方 ACP 直连简化（2026-10-24）

按 User sequence 38 和 [D63](decisions.md#v1-72-d63)，controller v7 改为启动器：原生 ACP 直接拥有协议
管道，删除消息转发、工具事件过滤/重建、额外 Gateway 订阅、连续序号 replay、逐 prompt receipt 门禁、
私有 Diff 解析、reasoning mutation、`_rovai/*` Hermes 协议和额外 storage flock。配置/凭据摘要不再参与
Hermes 进程兼容性。保留原 Home、SessionDB、原生能力关闭策略、FirstPayload、完成 Hook 和共享 Fleet/lease。

按需控制只处理 ACP 缺口：恢复后的完整 MCP assignment（包含空列表撤销）、同轮 Steer、已有 unknown
检查/明确处理。原生模型和权限直接使用 set_model/set_mode，失败保留 native details。旧 Ready 通过现有
发现入口失效并重探；本次没有新数据库迁移、新恢复框架或其他 Adapter 的行为切换。

明确降级：不再承诺完整工具参数、结构化 Files Changed/Diff、单 prompt 消耗或受管 reasoning effort。
官方 ACP 的 Session usage 不能当本轮 delta；失败之前的用量若 ACP 未独立报告，也保留未知。已有文件
修改、原生成功/失败/取消与公开 Send 不因这些详情缺失而改变。

本轮使用 macOS arm64 上未修改的官方 Hermes 0.22.4、loopback Responses 和新建隔离 Core/Home/Skills/MCP；
没有使用日常 userData，也没有调用真实付费模型。已完成：

| 既有验收入口 | fixture 后缀 | 结果 |
| --- | --- | --- |
| wire | `aWXwAP` | user 规则/更新、原生终态、env/config/personality 各一次、控制命令无模型调用 |
| experience | `aMneR9` | 文件实际写入/多文件更新、缺少增强信息仍成功、原生 reasoning、Steer、取消后续聊、两 Binding 并发、MCP 增改撤销 |
| first-input --availability | `wYbiyD` | 当前安装/指纹/路径/Home 变化仍原 Session；强杀无重放，明确解除 unknown 后原 Session 新任务，公开 Send 无重复 |
| first-input --compression --unprotected | `oHOuwd` | 首条/后继/冷恢复/规则变化；两次原生完成 Hook，下一普通输入补发，末次冷恢复不重复 |
| first-input（普通模式） | `eF68S0` | 四轮生产 Core 均 succeeded，补充 token/费用字段明确为空；首条/后继/冷恢复/规则更新正常 |
| failed-usage | `l63c2G` | 第一调用有用量和真实工具、第二调用失败；Run failed、无重放、缺失 prompt 消耗不虚构 |

迁移中先后发现并修正了旧探测能力要求、按需控制的 Home/socket 来源和 Steer 原生 queued 字段；最终
通过使用新 fixture。体验脚本的 MCP 撤销断言也改为检查本次 tool result，避免把保留历史中的旧结果
误当成当前仍可调用。旧失败 fixture 不计通过。
取消接受边界同时补齐：未观察到本轮活动的 cancelled 响应不独自确认 FirstPayload 接受；保留原生取消终态，不重放任务。

Rust 原生 patch 独立 owner 随其生产职责退役；launcher、目录/Ready、稀疏 usage、runtime_diff、恢复与
Fleet 复用现有 owner。Python 启动器/控制测试 5 项通过；普通 Rust workspace 为 477 passed / 0 failed / 1 ignored，
ACP extended 为 67 passed / 0 failed / 2 ignored，runtime_diff 17 项、稀疏 usage/目录/launcher 各 1 项通过。
文档单测 10 项、当前检查及相对 main 的治理检查通过。runtime_diff 首次定向回归发现一处旧私有片段
成功断言，按已退役合同改验拒绝后 17 项全过；未跳过失败测试。此前 controller 阶段的通过不替代本轮结果。

保留 Preview；本轮不扩展 warm 协议、专用聊天恢复按钮或其他平台资格。真实模型识图、所有历史版本和
所有边角组合不作为本轮简化的已完成宣称。

## 稀疏配置与 MCP 部分可用性（2026-10-24）

按 User sequence 40 在直连版本上补齐两处边界：`prepare_home()` 接受缺失/空白/注释/null 配置，
只对实际改写的节与追加列表兼容 null；保留未知字段、原生表达式和源文件，不载入完整默认配置。
原生允许的 disabled_toolsets 字符串形式交给原生小函数解析后追加关闭项，已有条目和 Hook 不重复。

恢复时 MCP mutation 正常返回部分或空发现集合，保留成功服务并沿现有 HostDiagnostic 报告缺失名称，
允许普通对话与原生工具继续。RPC 断线、状态冲突、异常结构与未确认撤销仍报错，不循环重连。
新建只随 `session/new` 绑定；冷恢复仍先恢复历史，再以一次快照的 revision/generation 执行一次 mutation。
这两条调用路径、直接官方 set_mode、删除 refresh_efforts/session_info 重复读取，已在直连简化中完成，
本次没有恢复旧 controller 或添加缓存、锁、轮询与新的恢复系统。

Python 既有入口 6 项通过，覆盖空配置/空节、错误类型/语法边界、源文件不变与重复准备、部分/全部失败、
空列表撤销、异常返回及 running/approval/queued/unknown 不改分配；调用计数只统计受管控制主动发起的
一次 resume 与至多一次 mutation，不包含官方 ACP 自己的必要查询。workspace check、fmt、既有 ACP
诊断脱敏用例及文档治理检查通过。本次没有新增 Rust 测试入口；上节完整 Rust 结果属于此前提交。

隔离官方 Hermes 0.22.4 + loopback Responses 的既有 experience 流程通过，最终 fixture 为
`rovai-hermes-experience-kXKqO4`。真实 YAML 空节可启动；新 Session 同时分配一个可用/一个失败的 MCP，
成功工具和普通对话可用；同 Session 冷恢复保留历史、重新连接相同分配、更新凭据、从有效分配明确清空后
旧工具消失；全部外部 MCP 不可用仍正常结束对话，原生日志报告失败。原有文件工具、取消、Steer、并发和
增强观测缺失仍成功的断言同次通过。未改官方源码、未使用日常数据或真实付费模型，未扩大平台矩阵。

## 显式模型选择与初始化预算（2026-10-24）

按 User sequence 42 修正 Core 的显式模型选择分支：Hermes 与 Kiro/Grok 复用已有 `set_model()`，
发送官方 `session/set_model`；不再进入只返回空配置 ACK 的 `set_config_option("model", ...)`。
此前直接调用官方接口的体验测试、以及默认模型与目标相同的 Core 流程，未覆盖这个遗漏。

既有 first-input 普通模式扩展为默认模型 A → Core 显式选择 B → Core 冷恢复 → 规则更新，始终断言
原 Session ID 不变，并检查每轮实际模型请求。修复前基线 `542fd99e9` 的 fixture `bVqS2A` 在选择 B 后
仍请求 A，断言失败；修复后 fixture `f62Pj4` 四轮全部通过，请求模型依次为 A/B/B/B。使用未修改的
官方 Hermes 0.22.4 和本地受控 Responses，未调用真实付费模型。

Hermes 正式 Host initialize 由 45 秒改为 90 秒，覆盖私有 Home 准备、Gateway 55 秒就绪预算和
官方 ACP 导入/握手余量，与既有 Hermes 探测预算一致。保留原超时清理，不增加重试；本次只对齐预算，
没有把正常启动验收当作慢机失败率或性能矩阵。插话锁、逐 Run 冷启动、按需恢复快照和启动串处理保持原状。

共享 ACP extended 回归 67 passed / 0 failed / 2 ignored；Core build、workspace check、fmt、脚本语法、
whitespace 和通用文档门禁通过。没有新增 Rust 测试入口或恢复/缓存机制。

## Skills 路径与普通绑定刷新范围（2026-10-24）

本轮只修改私有 Home 的 Skills 路径转换，以及共享工具上下文刷新目标。`external_dirs` 的单个字符串
与列表项采用原生 scalar/list 语义，先转字符串、trim、过滤空项，再展开变量/`~`，以 binding 记录的
来源 Home 处理相对目录；`create_dir` 只转换 trim 后的非空字符串。实际发现仍由 Hermes 执行，
源 config、稀疏未知字段和 Skills 链接保留。没有修改原生 personality/system prompt 或 Session 规则。

普通绑定向现有刷新函数传入 process/Run/epoch，只投影当前 ActiveLease；已解绑或换绑的旧目标跳过。
既有 invocation gate → 最新设置读取 → processes 锁顺序保持。全局设置保存、同值修复和有界重试仍用
全量入口，事务先提交并释放；投影错误不撤销 lease。当前进程仍可写两次小文件，其他无变化进程不写。
没有新增锁、服务、缓存或后台轮询；本轮不把减少文件写入描述为已测得的性能提升。

### 验证归属与结果

- Python 既有稀疏配置 owner 增加路径边界，6 个普通测试通过。原生模式 `--native-skills` 使用本机未修改
  Hermes 0.22.4（`4d04303818b61bf3aa09278af48356315515965b`）及已准备依赖；7 组隔离实际 Skill 发现通过，
  包含空项不引入 Home 搜索根、源 config 不改写、Skills 链接保留及重新准备时沿用记录的来源 Home。
- lease owner `builtin_tool_runtime::tests::lease_rotates_fences_and_replays_exact_request` 扩展当前进程写入、
  当前 lease 轮换、解绑/Run/epoch 换绑跳过和投影失败后认证仍有效。通过保留合法 JSON 的非标准空白检测
  同值重写，不依赖 inode、mtime 或磁盘耗时。
- 新增 slow owner `application::tests::task_discovery_refresh_scopes_bindings_and_repairs_saved_preferences`：
  原 registry owner 没有 SQLite/公开设置保存，不能证明 gate 之后读取最新设置、普通 bind 的定向调用、
  同值保存和有界重试的跨模块传递。复用既有私有 Core/数据库/Run fixture，不启动 Runtime；暂停 Tokio
  时钟驱动既有重试，显式 poll 到 gate 等待处后提交设置，不以线程调度猜测竞态。修复前绑定 B 会重写 A。
  最小命令：`cargo test -p rovai-core --lib --features slow-tests,extended-tests task_discovery_refresh_scopes_bindings_and_repairs_saved_preferences`；
  lease owner 使用同一入口的 `builtin_tool_runtime::tests::` 过滤器。两项 lease 回归和一项 Core 设置回归均通过。

普通 workspace 首轮在 Core 测试阶段停止，430 passed / 1 failed / 1 ignored：既有 Cursor 身份探测在 2 秒预算内超时，
未到达预期的身份不匹配断言。该项单独复核通过；未修改其实现或超时预算，完整 workspace 以
`--test-threads=2` 复跑为 477 passed / 0 failed / 1 ignored，保留首轮失败记录。Core/CLI build、workspace
check、fmt、whitespace、文档单测及通用文档门禁通过。

没有新增真实付费模型、自动压缩、平台扩展或性能矩阵验收；原 Session、Gateway、Fleet 和 CLI lease
机制保持，本轮在这两项局部修改处结束。
