---
document_type: implementation-plan
version: v1.72
authority: project-file-reference-implementation-and-verification
status: proposed
last_updated: 2026-11-07
---

# 公开对话项目文件引用实施计划

本计划承接[模型输入 R1](model-context-change-project-file-reference.md)，确认门槛与完整 shape 只在该说明维护。
当前完成 worktree 和基线调查，正式实现尚未开始。v5.1 原型只作为交互参照，不复制其模拟服务。

## Worktree 交接

| 字段 | 记录 |
| --- | --- |
| Work item | 公开 Thread 项目文件引用：短标签、分组检索、身份恢复、发布与按需读取 |
| Worktree | `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-project-file-references` |
| Branch | `rovai/project-file-references` |
| Base | `55a83f89733393cfcad76b046e344c222577abe1`（已核对 origin/main） |
| Governance | none；无主线文档先行要求；R1 等待二次确认 |
| Status | active；准备实施，未开始正式代码／Schema／当前合同修改 |
| Validation | 本轮文档结构／链接与待确认门禁结果在下方记录 |
| Next | 取得 R1 确认后在本 worktree 完成 Core 预检与发布，再接正式 Renderer/Host |

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

## 本轮准备结果

- 已创建独立 worktree，并确认工作基线与 origin/main 一致。
- 已完成当前发送、回放、来源解析、封闭内容与版本边界调查；已冻结 R1 范围、预算和真实任务条件。
- R1 当前为 pending。未运行正式实现测试，不将原型的 51 项或图标 8 项检查登记为生产通过。
- `pnpm docs:test`：10 项通过。
- `DOCS_BASE_REF=55a83f89733393cfcad76b046e344c222577abe1 pnpm docs:check:decisions -- --require-base`：通过，版本决定、历史冻结与链接检查无错误。
- `pnpm docs:check`：按预期在新 R1 的 4 项确认记录上拒绝：confirmed_revision、confirmation_status、confirmed_by、confirmed_at。没有补造记录或跳过版本门禁。
- `git diff --check`：通过。worktree 私有依赖按原 lockfile 串行核对完成，lockfile 无改动；未启动 App/Core/Runtime。
- 后续收到真实确认后补记录并重跑全部文档门禁，才开始正式代码。
