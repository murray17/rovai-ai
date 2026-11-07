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
| Status | active；正式主链与界面通过，R3 模型行为仍未通过 |
| Validation | 见下方实际实现、确定性门禁、真实 UI 及 Runtime 分项结果 |
| Next | User 决定补充 R2 后，只实施获准提示并定向复查 R3；保持原失败证据 |

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
- 兼容：ComposerDocument 保持 2；schema 169→170 由 migration 220 仅更新准入标记，无新业务表或历史重写。
  Host Web 协议 5→6；app.info 的能力声明同时通过 Desktop 与过滤后的 HTTP 投影提供，仍不暴露 dataDir。
  相关新版本合同、当前路由、UI 和操作指南已同步。

### 确定性与界面结果

| 验证 | 实际结果 |
| --- | --- |
| TypeScript / 生产构建 | `pnpm typecheck`、`pnpm build:desktop` 通过 |
| 全量 Vitest | 270 文件，3,132 通过、2 项既有 skip；使用 UTC 运行既有日期断言 |
| Rust 默认 workspace | 全过：Core 438 通过／1 项既有 ignored；其余 crate 与 CLI 通过 |
| 定向 Rust owner | camp_content 16 项、Pending 原子发送 1 项、初始／Steer 冻结 1 项通过；project_files 根边界由既有 3 项 owner 覆盖 |
| 原生 Composer | 3 个 Electron owner 通过，包含成员邀请、输入、IME、恢复和 Web 链接 |
| 原生项目目录 | 既有真实 Host 项目目录 owner 通过，包括预览、编辑保存、主题、窄屏及缩放；不据此宣称文件 Mention 的 200% 专项已测 |
| Host 文件烟测 | 6 组通过：独立 scope、重绑、预览收紧、Pending 拒绝及重放、伪造字段、Web 鉴权与旧协议拒绝 |
| Host Desktop＋Web 主 owner | 通过；Core 生命周期、HTTP 投影、权限、旧协议及文件编辑均保持 |
| 正式文件界面 | Desktop＋认证 Web 16 项通过，覆盖原生复制、同根／异根粘贴、短标签、预览、仅文件按钮、文件树、Tab／Enter／删除／Undo、预览插入、中文 IME、输入历史、消息复制、真实删除后拒绝留稿、窄屏触控长按详情及 44px 操作区 |
| 布局 | day／night × 390／1040／1440／2560；实际输入框与文件扩展名可见，无页面横向溢出 |
| 文档治理 | docs:test 10 项及 require-base 的决定／链接门禁通过；version 门禁仅余补充 R2 的 4 项真实确认记录，未补造确认 |

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
[补充 R2](model-context-change-project-file-reference-clarification.md)提出公开 Charter 的一句澄清规则，仍为 pending；
本次不修改 Charter 26、Bootstrap v6、Binding compatibility 16 或冻结输入，不将 R1 确认移作 R2 确认。

### 已知限制与交接

- 既有 `file-preview-layout` 的图片重建滚动位置失败，以及 `file-reference-navigation` 的 HTML 链接／边距断言失败，
  均在原始基线的独立 checkout 上复现。保留原失败，没有改动断言、扩大超时或修复无关业务来冒充本功能通过。
- 本次未做真实 Windows／Linux、移动设备硬件、文件 Mention 200% 专项或所有 Runtime 的平台资格验证。
  异步隔离、来源失败及预算的确定性边界由对应 owner 负责，不把一次真实快速搜索当作性能或遍历完整性保证。
- worktree 与分支保留；按当前偏好提交、推送，不自动创建 PR、合并、安装或重启日常 App。

本项九范围复核：Version lifecycle 仍为 v1.72；Decisions 的当前合同路由已更新，无额外版本切换决定；
Contracts、Architecture、UI 与 Documentation routing 已同步。Runtime Activity 不新增事件映射；
Runtime compatibility 仅记录上述两个已测版本，不扩大平台资格。Root README 在未收口前不增加已发布能力声明。
