---
document_type: implementation-plan
version: v1.72
authority: project-file-reference-implementation-and-verification
status: in_progress
last_updated: 2026-11-07
---

# 公开对话项目文件引用实施计划

本计划承接[模型输入 R1](model-context-change-project-file-reference.md)，确认门槛与完整 shape 只在该说明维护。
User 已在 sequence 21 确认 R1，现开始正式实现。v5.1 原型只作为交互参照，不复制其模拟服务。

## Worktree 交接

| 字段 | 记录 |
| --- | --- |
| Work item | 公开 Thread 项目文件引用：短标签、分组检索、身份恢复、发布与按需读取 |
| Worktree | `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-project-file-references` |
| Branch | `rovai/project-file-references` |
| Base | `55a83f89733393cfcad76b046e344c222577abe1`（已核对 origin/main） |
| Governance | none；无主线文档先行要求；R1 已由 User sequence 21 二次确认 |
| Status | ready；User sequence 32 要求本次 PR 合入 main，sequence 33 要求安装；R3 原失败保持，未确认 R2 为独立后续工作 |
| Validation | 见下方实际实现、确定性门禁、真实 UI 及 Runtime 分项结果 |
| Next | 通过主线整合门禁后合并并执行隔离 daily 安装验收；R2 revision 2 单独待确认，不随本 PR 修改 Charter |

保留此 worktree 跨后续 Run 复用。完成后按用户当前偏好提交并推送同名远端分支，不自动创建或重开 PR；
合入前不清理 worktree，不触碰其他活跃目录或日常 App 数据。

## 基线发现与边界

- `camp_content.rs` 和共享 TS 合同都只有成员、Skill、对话及使命 Atom。原型中的文件白名单修复尚未进入生产。
- `project_files.rs` 已有短锁 binding、锁外 root/source 解析和 scope 生命周期；当前 raw 来源绑定 Thread，
  跨对话不能复用 entryId 或直接替换 threadId。复用其相对路径、Root 对象和 Mission 代次规则。
- `DomainCommandGateway.replay_if_recorded` 和 execute 内的再次查询可复用；文件预检结果在 application 层
  锁外准备，collaboration 提交事务只消费私有结果并复核业务绑定，避免把文件系统放进事务。
- 现有 `load_structured_content_submission` 捕获对话／使命标题并拒绝纯引用；新增文件的实际输入判定与
  发布字段生成需要同时修改，不能只改前端按钮或普通 plain-text 转换。
  结构化纯成员在现有部分路径可因投影后非空而被接受，本次按 User 的空输入规则同时收敛前端与 Core；既有 Skill 发送语义保持。
- 本地存储、input-history、structured-message-clipboard、message-export、quote 投影与撤回重编都属于恢复链路。
  对封闭枚举逐一核对，禁止把文件落入 Skill、成员或 external_quote 的默认分支。

## 实施顺序

| 阶段 | 工作及主要文件 | 完成条件 |
| --- | --- | --- |
| 0 | R1 确认；当前版本说明登记；依照合同生命周期新增下一版本与路由，不原地改写 accepted 合同 | 真实确认记录、docs gates 可通过 |
| 1 | `camp_content.rs`、共享 contracts、新文件引用辅助模块、`project_files.rs` | 闭合草稿／正式段、统一 URI 与可见投影、Root/权限复用、UTF-8 预算、临时目录反例通过 |
| 2 | `application.rs`、`collaboration.rs`、`command.rs` seam、既有数据库迁移 | 回放先于 I/O、锁外预检、事务复查、32 个身份去重、Pending 原子性及拒绝定位通过 |
| 3（P1） | 正式 `composer-document`、Atom 节点、`input-history`、本地存储、展示函数、reference picker/menu | 文件不丢失，短标签消歧，四来源独立检索与手动筛选；先完成该阶段验收 |
| 4（P2） | 目标确认 API、Desktop/Web 适配和门禁、结构化复制、预览/文件树入口、消息/选区/导出、撤回重编 | 目标重绑、失败留稿、仅文件发送、选择保护/焦点/触屏一致；与当前合同一起收敛 |
| 5 | 真实 Host+UI、冻结 Runtime 任务、用户文档与脱敏证据 | 逐项报告真实通过/失败/未测；引用、发布与恢复完整后统一开启入口 |

图标使用当前 ProjectFileIcon 与现有 Lexical/React 节点机制，完整路径不替换成短标签。
新文件候选 hook 仅拥有自己的 scope、约 150ms 防抖和 revision；文件树的 watch/poll 不进入候选生命周期。
结果身份驱动键盘高亮，预览只由主动打开触发；迟到来源不得插入新节点或新的 Thread。

## 测试归属与准入

优先扩展既有 owner，不为每个枚举分支新建同等 fixture：

| 边界 | 最低成本 owner |
| --- | --- |
| 闭合类型、Unicode 字节预算、投影和出现次序 | camp_content 的 composer_v2、serde/normalization owners；TS 对应 composer-document 与共用 golden |
| Root、符号链接、读取、重绑和 scope | project_files 的 `references_outlive_views_but_cannot_cross_roots_clients_or_rebound_generations`，及原 list/search owner |
| 首次发布、回执竞争、Pending 回滚 | 既有 Pending 邀请/发布事务 owner 与 command 回放 owner；只在真实事务用 SQLite fixture |
| 初始/Steer 冻结及原字节恢复 | 既有 active input/context owner；不在每条历史引用触发文件 I/O |
| 前端恢复、剪贴板和展示 | 现有 input-history、local-store、Composer、message-clipboard、message-export 与 quote owners；图标映射按生产组件比对 |
| Host/Web 能力与协议 | 原 Host HTTP、ConsoleClient、鉴权和浏览器适配 owner；关闭入口与未知文档保护不能只由菜单单测代替 |
| 原生输入与全页 UI | 正式生产组件夹具，真实键鼠/IME/触屏、Web 与 Desktop owner；不依赖 docs/prototypes |
| 真实 Runtime 读取 | R1 冻结的 R1～R4 Smoke，与纯转换/模拟数据分开记录 |

如发现现有 owner 无法拥有新的独立失败语义，先按[Rust 测试准入](../../development/testing.md#新增独立测试)
记录新 owner 的理由、反例和最低 fixture，再新增；不通过禁用旧测试绕过失败。

## 计划执行的验证

```sh
pnpm typecheck
pnpm exec vitest run <受影响的正式转换与组件 owner>
pnpm test:composer-input
pnpm test:project-files
pnpm test:file-preview-layout
pnpm test:file-reference-navigation
cargo test -p rovai-core --lib camp_content::
cargo test -p rovai-core --lib project_files::
cargo test -p rovai-core --features slow-tests --lib pending_invitations_commit_with_first_message_and_roll_back_every_failure
cargo test -p rovai-core --features slow-tests,extended-tests --lib active_inputs_preserve_initial_context_and_unsubmitted_sources
cargo test --workspace
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=55a83f89733393cfcad76b046e344c222577abe1 pnpm docs:check:ci
```

先通过定向检查，再执行仓库要求的完整门禁；没有新修改、失败或未决问题时不无意义重复全量测试。
所有启动与 Runtime 都按[本地隔离流程](../../development/local-workflow.md)执行，worktree 使用自己的依赖和 target。
真实任务的输入投影、读取调用、错误与结果只在隔离 fixture 中留证，导出必要脱敏摘要。

## 准备与确认记录

- 已创建独立 worktree，并确认工作基线与 origin/main 一致。
- 已完成当前发送、回放、来源解析、封闭内容与版本边界调查；已冻结 R1 范围、预算和真实任务条件。
- 提案提交时 R1 为 pending；现已登记 sequence 21 的真实确认。未运行正式实现测试，不将原型的 51 项或图标 8 项检查登记为生产通过。
- `pnpm docs:test`：10 项通过。
- `DOCS_BASE_REF=55a83f89733393cfcad76b046e344c222577abe1 pnpm docs:check:decisions -- --require-base`：通过，版本决定、历史冻结与链接检查无错误。
- `pnpm docs:check`：按预期在新 R1 的 4 项确认记录上拒绝：confirmed_revision、confirmation_status、confirmed_by、confirmed_at。没有补造记录或跳过版本门禁。
- `git diff --check`：通过。worktree 私有依赖按原 lockfile 串行核对完成，lockfile 无改动；未启动 App/Core/Runtime。
- 2026-11-07：收到 User sequence 21 确认，登记 R1 后重跑文档门禁，正式实现开始。

## Sequence 26 复核修复与补强计划

User 对固定提交 `4c3b5d330` 的复核提出三个前端边界和证据缺口。本轮不修改 R1 的文件身份、Core 发布、
模型投影、版本轴或仅文件发送语义；R2 Charter 指导保持独立待确认，R3 原失败证据保持。

| 边界 | 修复及预先冻结的通过标准 |
| --- | --- |
| 未完成插入与提交 | 候选确认、文件树 open＋确认、预览确认共用待插入状态；鼠标、键盘和直接表单提交均不能发送残余查询词。采用暂禁发送，正常草稿保存仍可 flush，不先锁编辑器等待插入 |
| 可用性错误分类 | 请求级 root_unavailable 等明确业务错误为 unavailable；连接／超时为 network_error；畸形 DTO 为 protocol_error 并记录协议警告，不能伪装成文件消失或连接失败 |
| 拒绝与旧检查竞态 | Core 拒绝使此前检查代次失效；延迟旧成功不得清除拒绝，仅拒绝之后发起的新检查可解除 |

扩展既有生产 Desktop＋认证 Web owner，以真实 Host 返回的响应作为 deferred Promise，明确控制插入等待和
“旧检查成功→删除文件→真实发送拒绝→旧成功迟到”的顺序。状态分类使用同一入口的受控响应，保留模拟性质说明。
防误发送屏障记录并阻止待插入用例中的任何意外 send RPC；通过标准要求零发送尝试，不用拦截后的失败冒充通过。

### 复杂定位真实读取（运行前冻结）

使用新的隔离 fixture、真实 Core 与既有合格 Codex／Claude，各执行三项读取；两次 Mission 准备单独计数。
总计八个真实任务输入（六次读取＋两次工作副本准备），与原七项证据分开保存。不会在本轮加入未获准的 Charter 文本。

| Case（每个 Runtime 各一次） | 操作与通过标准 |
| --- | --- |
| I1 同名 | auth/config.ts 与 billing/config.ts 写不同随机值，只引用 billing；正式路径、冻结 URI、真实工具读取及回复均指向被选中文件，回复不含诱饵值；输入未注入随机值 |
| I2 特殊路径 | 引用 `src/中文 目录/参数 (草稿)#1.ts`，另放无井号诱饵；从正式 URI 到实际读取正确还原中文、空格、括号与井号，返回被选值而非诱饵 |
| I3 有效工作副本 | 按正常 Mission 投递准备真实 ready 工作副本，主项目及工作副本 config.ts 放不同值；上文明确待文件后读取，再仅补交工作副本引用。路径与实际工具指向有效工作副本，不能读取主项目诱饵 |

准备任务只确认就绪，不读取或修改项目文件；不伪造 Mission workspace 数据库状态。正例各一次，失败原样留证，
只在夹具或未完成任务有明确新依据时定向复查。原 R3 不在本轮重跑、不因复杂定位通过而改判。

## 实际实现与验收

实施基于同一独立分支，使用正式组件、真实 Host/Core 和临时文件系统，不依赖离线原型。

- Core：封闭草稿／正式文件段、锁外预检、事务内绑定复核、回执优先重放、Pending 原子邀请／激活／投递、
  最多 32 个身份和实际 UTF-8／URI 投影预算。发布路径与标签只能由 Core 构造。
- Host：复用项目目录与 Mission ready 工作副本；新增目标确认，根内可读普通文件和符号链接遵守原边界。
  同根跨对话重新签发；跨根保留身份并要求重新选择；历史预览比较冻结路径。
- Renderer：四来源独立分组、手动固定、独立 scope、防抖／取消／迟到过滤；原生文件图标、文件名与同名消歧，
  完整路径仍保存在身份中。选择直接回编辑，无装饰性加载动画；点击和键盘打开原预览。
- 恢复：补齐输入历史、私有剪贴板、整条消息复制、本机草稿和失败留稿；未知格式保留原记录并阻止覆盖。
  文件树／预览共用插入函数，文件加其他引用和仅文件均构成实际输入，不参与成员寻址。
- 兼容：ComposerDocument 保持 2；基线功能分支 schema 169→170／migration 220 仅更新准入标记。
  整合新主线后该标记顺延为 schema 171／migration 221，无新业务表或历史重写。
  Host Web 协议 5→6；app.info 的能力声明同时通过 Desktop 与过滤后的 HTTP 投影提供，仍不暴露 dataDir。
  相关新版本合同、当前路由、UI 和操作指南已同步。

### 确定性与界面结果

| 验证 | 实际结果 |
| --- | --- |
| TypeScript / 生产构建 | `pnpm typecheck`、`pnpm build:desktop` 通过 |
| 全量 Vitest | 整合主线后 273 文件，3,167 通过、2 项既有 skip；UTC 的完整 pnpm test 通过，末尾 Node 测试 377 通过、2 项平台 skip |
| Rust 默认 workspace | 原 R1 基线 Core 438 通过／1 项既有 ignored，其余 crate 与 CLI 通过；本次主线整合采用 4 个测试线程复验，完整结果随 PR 登记 |
| 定向 Rust owner | camp_content 16 项、Pending 原子发送 1 项、初始／Steer 冻结 1 项通过；project_files 根边界由既有 3 项 owner 覆盖 |
| 原生 Composer | 3 个 Electron owner 通过，包含成员邀请、输入、IME、恢复和 Web 链接 |
| 原生项目目录 | 既有真实 Host 项目目录 owner 通过，包括预览、编辑保存、主题、窄屏及缩放；不据此宣称文件 Mention 的 200% 专项已测 |
| Host 文件烟测 | 6 组通过：独立 scope、重绑、预览收紧、Pending 拒绝及重放、伪造字段、Web 鉴权与旧协议拒绝 |
| Host Desktop＋Web 主 owner | 通过；Core 生命周期、HTTP 投影、权限、旧协议及文件编辑均保持 |
| 正式文件界面 | sequence 30 后 Desktop＋认证 Web 22 项通过，保留原 20 项路径并增加快速对话隐藏文件类别及键盘跳过；结果见[界面证据](project-file-reference-review-ui-evidence.json) |
| 布局 | day／night × 390／1040／1440／2560；实际输入框与文件扩展名可见，无页面横向溢出 |
| 文档治理 | 整合后 docs:test 10 项、完整 docs:check:ci 及 require-base 决定／链接门禁通过；本 PR 只包含已确认 R1，未确认 R2 提案完整保留在不可变历史与 Thread 附件 |

`composer-trigger` 扩展了路径、扩展名、Unicode 和邮箱／URL 的既有边界 owner。
文件 URI 的共用 golden 覆盖 Unicode、空格、括号、井号、百分号、Unix 反斜线、Windows drive、UNC 及 canonicalize 的 verbatim 前缀；只规范 URI，不改冻结路径字段。
输入／Steer owner 用已发布但不可再解析的文件定位证明恢复只用冻结字段；完整 URI 经 JSON 编码后核对。
当前 quote_text 保存可见选文快照，没有 URI 偏移映射；不重算旧选文。

### 真实 Runtime 结果

macOS arm64 的真实 Codex CLI 0.166.0 与 Claude Code 2.1.311 使用新的 Core／Native Home、项目及 Skills／MCP。
只复制认证与 Provider 配置，不复制日常 Session、hooks 或 MCP；结束后清理本次 Native Home。
版本初始冻结值、观察值、实际输入 SHA-256、正文投影、读取工具与返回结果见[脱敏证据](project-file-reference-evidence.json)。
原始冻结输入只保留在权限受限的本机 fixture，未导出凭据、私有推理或完整原生日志。

| Case | 结果 |
| --- | --- |
| R1 Codex / Claude 各两文件 | 均通过；返回只存在于文件中的随机值，消息正文未注入文件内容 |
| R2 既有任务只补交日志 | 两个 Runtime 均通过；只有文件引用也可继续上文任务 |
| R3 新对话只有文件 | **失败**：可发布且未修改文件，但回复只说明没有具体任务，未主动询问；保留原断言与输出 |
| R4 发布后修改内容 | 通过；真实工具读到新值，历史发布字段和正文不变 |
| R4 发布后撤读权限 | 通过；返回真实 Permission denied，不擅自 chmod 或改用其他路径 |

共七例，六例通过；没有把执行终态 succeeded 等同于产品验收通过。首个漏带 execution 的夹具只发布而未运行，
修正夹具后才进行真实调用。后续只补跑未执行的 R4，不重复消耗已通过的四个读取任务。
[补充 R2](https://github.com/murray17/rovai-ai/blob/1e3dec453ce2358c3863ad2e2cae90cbc7a3c4f2/docs/versions/v1.72/model-context-change-project-file-reference-clarification.md)提出公开 Charter 的一句澄清规则，仍为 pending；
本次不修改 Charter 26、Bootstrap v6、Binding compatibility 16 或冻结输入，不将 R1 确认移作 R2 确认。

### Sequence 26 实际修复与复验（2026-11-07）

- 所有公开发送入口先读取编辑器同步的待插入状态，再锁编辑器；提交专用 flush 再检查一次，普通保存 flush 保持可用。
  候选、文件树的首次 open 和预览确认分别持有独立插入令牌；某个请求结束不会误清除另一个仍在等待的请求。
- 可用性响应解码区分明确业务错误、传输异常及协议异常，14 个定向 TS 用例通过。异常响应保留身份与可重试提示；
  `root_unavailable` 不再显示连接失败。协议异常单独警告并阻止以未确认状态发送，不伪造文件消失。
- 发送拒绝递增检查代次；真实 UI 延迟一份 Host 已确认 available 的成功响应，随后删除文件并实际提交，Core 拒绝后
  文档和 Atom 保留且无新增消息／执行。放行旧成功后仍不可用，恢复文件并发起新的检查后才解除。
- 三处插入等待均验证鼠标及直接 form 提交零 send RPC 尝试，不发送残留 `@query`；预览操作仍由用户主动触发。
  分类用例的请求级业务／畸形 DTO 为受控注入；拒绝时序使用真实文件删除和真实 Core 结果，不混称真实文件系统故障。
- 新增[复杂定位证据](project-file-reference-identity-evidence.json)：Codex CLI 0.166.0 与 Claude Code 2.1.311 的
  I1／I2／I3 共六次真实读取全部通过；两个真实 Mission 准备任务另计，通过正常 dispatcher 产生 ready Git 工作副本。
  同名、中文／空格／括号／井号，以及主项目与有效工作副本的不同随机值均核对正确，没有读到诱饵值。
  正式路径、实际 RUN_INPUT 消息、冻结哈希、执行根、Core read operation 和原生读取结果相互核对；
  实际消息包含原有默认接收者前缀，URI 保持发布定位，senderId 为 `user`，没有 files 区块或文件全文注入。
- 复杂读取首轮在两个 Codex 任务通过后被夹具的 `mission.invalid_tag` 阻断，恢复入口又遇到既有目录 EEXIST；
  两次中断均保留，修正夹具后只继续剩余六个输入，没有重跑已通过任务或删除原 R3 失败。结束后本次 Native Home 已清理。
- `pnpm typecheck`、UTC 全量 Vitest、`pnpm test:composer-input`（3 项）及生产构建通过；Rust／Core 源码本轮未修改，
  上表 Rust 结果为此前 R1 实施时的实际记录，本轮未重复全 workspace。
- `pnpm test` 的组合命令在 docs:test 10 项通过后，被尚未确认 R2 的四项记录门禁阻止；因此单独运行完整 Vitest，
  不把组合命令报告为通过。require-base 的文档决定／链接门禁通过；没有添加 checker 例外或补造确认。
- R1 两个模型输入示例的 senderId 按现有实现勘误为 `user`；R1 确认仍有效。R2 提案 revision 2 补足
  “新对话无任务应询问／上文日志任务直接继续／本轮明确分析直接执行”，Charter 文本尚未实施。

### Sequence 30 快速对话入口收敛（2026-11-07）

User 要求快速对话移除不可用的文件 Tab。当前关联项目的会话／使命仍提供文件类别，快速对话仅显示
队员／对话／使命；可见 Tab、Tab／Shift+Tab 与标签方向键共用 picker 的类别集合，不能导航到隐藏类别。
项目已关联但根不可访问时保留文件入口及重试，避免把临时目录故障当作未关联项目。
没有 ready WT 的使命仍直接引用关联项目目录；本轮仅改入口，不改变目录解析、文件身份、Core 或模型输入。

`pnpm typecheck`、`pnpm build:desktop` 通过。既有生产 Desktop＋认证 Web owner 扩展后 22 项通过，
新增两个快速对话场景，并明确核对项目会话仍有四类入口。本轮未重复真实 Runtime 读取或 Rust 测试；
此前证据及 R2 待确认状态保持，文档门禁仍不能因未确认 R2 记作全通过。

### 合并范围与迁移整合（User sequence 32／33）

User 要求提交 PR 合入 main，并安装到本机日常 App。本 PR 只合入已确认 R1 与后续前端修复；
未确认 R2 从本次实施变更中拆出，完整提案保留在上方不可变提交链接及本 Thread 附件中，仍为 pending。
不伪造确认、不修改 Charter、不把 R3 原失败改判为通过，也不修改通用 checker。

整合主线 `4984480ac` 的原生交互后，主线 migration 220／schema 170 保留；文件引用的只读准入标记
顺延至 migration 221／schema 171。两条升级路径均先执行原生交互迁移，再提交文件引用标记。
原迁移 owner 保留回滚、旧数据不变及准入验证，沿用 populated fixture，不新增 Rust 测试函数。
整合后 `pnpm typecheck`、UTC 完整 `pnpm test` 及以 `4984480ac` 为 base 的 `docs:check:ci` 通过。
旧 Product Contract Fingerprint 的 schema 170 断言同步至实际 171；没有禁用测试或放宽判定。
首次默认 Rust 运行有一个既有 Cursor alias 探测 fixture 返回 runtime_probe_timed_out；该项隔离复验 0.35 秒通过。
完整 workspace 复验控制为 4 个测试线程，保留首轮记录，不修改探测超时。完整结果随本次 PR 登记。
前述功能分支原始证据保持对应的旧版本和哈希。待安装 daily 包另使用隔离生产 App 验收，当前日常进程与用户数据保持。

### 已知限制与交接

- 既有 `file-preview-layout` 的图片重建滚动位置失败，以及 `file-reference-navigation` 的 HTML 链接／边距断言失败，
  均在原始基线的独立 checkout 上复现。保留原失败，没有改动断言、扩大超时或修复无关业务来冒充本功能通过。
- 本次未做真实 Windows／Linux、移动设备硬件、文件 Mention 200% 专项或所有 Runtime 的平台资格验证。
  异步隔离、来源失败及预算的确定性边界由对应 owner 负责，不把一次真实快速搜索当作性能或遍历完整性保证。
- worktree 与分支保留；按当前偏好提交、推送，不自动创建 PR、合并、安装或重启日常 App。

本项九范围复核：Version lifecycle 仍为 v1.72；Decisions 的当前合同路由已更新，无额外版本切换决定；
Contracts、Architecture、UI 与 Documentation routing 已同步。Runtime Activity 不新增事件映射；
Runtime compatibility 仅记录上述两个已测版本，不扩大平台资格。Root README 在未收口前不增加已发布能力声明。
