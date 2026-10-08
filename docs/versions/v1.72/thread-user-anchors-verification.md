---
document_type: verification-report
version: v1.72
last_updated: 2026-10-08
---

# 全会话用户消息锚点验收

范围依据 User 确认：完整用户目录、Core 权威首条有效直接回复、按需预览、单个独立定位窗口及必要失效处理。
保留正文分页、单行标题、三行回复、原有宽度门槛、横线样式、内部滚动与键盘操作；不增加通用历史窗口框架。
合同为 [Camp Open Projection v26](../../contracts/camp-open-projection-v26.md)。

## 原问题与实现

原锚点由 `conversationTimeline` 中的已加载消息投影，数量和范围受正文首屏限制。用户提供的会话当时有 22 条用户
消息，20 条首屏正文中仅有 9 条用户消息。取消分页会同时放大正文传输、hydration、布局测量和消息 DOM。

新增 Core 轻量读模型从当前 Thread 用户业务字段生成完整目录；批量读取名称及附件 metadata，不读取全部 Agent
正文或执行历史。首条回复先定位 ID，再生成一个摘要。两个入口沿 Desktop allowlist 与已授权 Web operation 进入
同一 Core 实现。前端局部状态隔离索引／预览／点击代次与正文分页，消息合并按 ID 和版本处理。

实际消息写入在同步事务作用域收集提示，Gateway／Channel Host 在 commit 后沿 Host 输出通知消息变化，Web SSE 只保留公开失效元数据。目录不随普通 Run 状态刷新；
已访问预览按会话失效，不后台预取。实际下一条消息的 sequence 作为 around 窗口边界补充，避免把编号跳号当作缺口。

## 4563d23d 基线修正

User 后续明确将预览收窄为直接 reply 子消息，替代此前 Run／输入／Turn 的补全要求。直接回复按 `(sequence, id)`
选择首条有效 Agent 消息，无符合项只保留标题，不作“未回答”判断；历史关系和发送逻辑不改写。Migration 185 /
schema 135 只增加 reply 等值前缀组合索引，与 receipt 同事务提交，旧数据保持。

定位缓存不因 `known` 曾见过目标就清窗。resync／目录失效立即撤销可信状态，旧目录仍可显示；刷新失败和旧响应
不能恢复快速定位。点击等待当前有效索引读取，或通过 around 检查；有效缓存仍免请求。新定位窗口替换旧窗口。

进入／恢复取消提前 prefetch，正文可用并提交页面后由 hook 启动目录，同代请求合并。索引与预览先在一致事务取得
材料和水位，释放 Database 锁后格式化；Unicode 摘要使用有界迭代，不再为整个文本创建字符数组。

消息变更提示在真实发布、撤回、删除路径收集最小元数据；同步事务作用域按连接隔离，退出丢弃未提交材料。
只有确有消息变化时才在提交前取得水位，提交成功后沿原 Host 通道发送。无关命令不读取导航水位或反查事件范围，
幂等回放不重复通知；Channel Host 既有维护事务同样保留此边界。

## 4563d23d 基线修正的验证记录

| Owner / 命令 | 验证边界 |
| --- | --- |
| `cargo test --workspace` | 默认工作区 455 项通过，包含 Core、Host、Web 与 CLI 边界；既有真实 Runtime 手动 Smoke 1 项按原策略 ignored |
| `pnpm docs:test` / `pnpm docs:check` / `DOCS_BASE_REF=4563d23d pnpm docs:check:ci` | 通用文档和基于变更的治理门禁通过 |
| `pnpm typecheck` | Desktop/Web/共享合同类型一致 |
| `pnpm exec vitest run` | 239 文件、2,604 项通过；包含失效立即撤销信任、失败／旧响应不恢复信任、共享目录请求、等待刷新与 around 竞态、保留缓存窗口、预览合并／失败重试、撤回缓存、SSE 元数据与界面英文词条 |
| `pnpm test:message-anchors` | 隔离 Electron 使用生产 ThreadWorkspace，14 个检查通过：首屏挂载后只启动一次目录，缓存重复点击保持目标；240 条锚点保持既有样式，1,000 条完整目录仅挂载首屏及单个定位窗口，连续跳转不累积，分页和自动加载仍从正常区间起点读取；预览失败保留标题，键盘重试后焦点留在锚点 |
| `cargo test -p rovai-core --features slow-tests --lib user_anchor` | 3 项：2 个 SQL owner 加 1 个迁移 owner；完整目录不受正文窗口影响，禁止读取 Run/Turn/Evidence/Managed 文件/事件历史仍成功；只读计数不变，Unicode/附件/提及/引用/空文本回退、外部用户与撤回删除过滤；只选直接子回复，禁止 Run／Turn 读取；顺序、撤回／删除过滤；无关后续消息增加 10,001 条前后候选查询均为 18 VM steps，计划使用组合索引且无临时排序；迁移失败原子回滚并可重开 |
| `cargo test -p rovai-core --features slow-tests --lib command::tests::committed_results_replay_after_reopen_and_handler_errors_roll_back_atomically` | 复用事务 owner 验证提示只在提交后产生，Handler／receipt 失败丢弃、重启后幂等回放不重发；authorizer 禁止导航读取时无关命令仍成功 |
| `cargo test -p rovai-core --features slow-tests --lib read_model::slow_tests::message_around_reads_a_bounded_old_window_without_leaking_unavailable_sources` | 沿用基线结果，around 实现本轮未变；验证 41 条窗口及真实下一行边界，保留不存在／跨会话／删除语义 |

本轮保留两个已有 SQL owner；回复 owner 改名为 `user_anchor_preview_resolves_first_valid_direct_reply`，退出的
Run／Turn 推断正向断言改为“不能产生预览”的负向回归，其余顺序和不可用来源边界保留。新增的
`db::user_anchors::tests::direct_reply_index_migration_is_atomic` 拥有新的 schema 134→135 升级、receipt 失败回滚和重开
边界：现有读取 owner 无法证明 DDL／marker 原子性，因此复用隔离的 seeded fixture，归入 extended-tests，最小命令为
`cargo test -p rovai-core --features extended-tests --lib direct_reply_index_migration`（上表 slow-tests 同样包含它）。
真实发布／撤回提示扩展既有 `recallable_local_composer_message_is_erased_and_cannot_be_republished`；事务失败／重放仍归
原 Gateway owner。渠道绑定既有 `group_binding_freezes_messages_sends_one_card_and_promotes_fifo_atomically` 验证非发送
命令内部发布的两条外部用户消息仍合并发出目录提示；迁移 admission matrix 与旧 continuation 迁移链也定向通过。
不建立新进程夹具。Electron 首次运行暴露夹具未等待轨道滚动结束的 hover 竞态，已补齐等待并重跑通过，
未改动产品预览样式。所有数据库和 Electron userData 均由隔离 fixture 创建，不写日常数据库，不启动真实模型。

## 性能与验证范围

目录传输随用户问题数增长，每项只含 ID、顺序、短标题和版本；传输摘要沿用 240 scalar 预算，不限制 UI 行数。
正文窗口仍有界，预览只按访问目标读取，普通执行事件不发起全量目录请求。索引的读取成本仍与该会话用户文本总量
相关；纯格式化已离开共享锁，但必要 SQL 和提及解析仍随用户材料量增长。极大数量问题的负载和网络时延没有通过这次功能夹具推断成性能承诺。此记录证明读取边界和有界正文挂载，
不把模拟数据的响应时间作为真实会话或跨设备压测结果。

## 0d449a91 基线即时回执修正

仅调整 `ThreadUserAnchorNavigation` 中的临时公开回执收敛，保留切换 Thread 时的完整目录与即时回执缓存。
正文观察和消息变更通知移除明确不可用的临时条目及顺序映射；成功的权威目录接管请求发出前已经确认的条目，
缺席条目标记不可用，防止旧发送回执重新加入。请求后新增回执继续受原有代次隔离保护，失败或旧响应不清理缓存。
该修正不新增接口、数据库读取或目录刷新触发，不改变预览缓存生命周期、定位窗口或正文分页。

基线新增状态回归先复现了切换后撤回残留、权威目录缺席仍保留临时条目的失败。修复后的验证：

| 命令 | 本次结果 |
| --- | --- |
| `pnpm exec vitest run apps/desktop/src/renderer/src/thread-user-anchor-navigation.test.ts apps/desktop/src/renderer/src/user-message-anchors.test.ts` | 2 文件、11 项通过；覆盖切换保留缓存、撤回／删除精准移除、旧回执不重入、目录失败保留、成功接管、旧响应不误删新回执；断言读取次数与已有预览缓存复用 |
| `pnpm typecheck` | 通过 |
| `pnpm docs:test` / `pnpm docs:check` / `DOCS_BASE_REF=0d449a91 pnpm docs:check:ci` | 通用文档与变更治理门禁通过 |

本次验证为局部状态回归，未新增真实会话性能测量；上方 Rust、全量 Vitest 与隔离 Electron 记录属于前一轮修正。

## PR #673 主线集成

集成 `52ecf398` 主线时，Migration 185 / schema 135 已用于使命描述。锚点索引迁移顺延为 **Migration 186，
schema 135 → 136**；主线的使命描述表和既有迁移保持，准入矩阵、升级入口与测试降级链同步衔接。上方 185 / 135
是独立分支阶段的验证记录，最终发布编号以 [Camp Open Projection v26](../../contracts/camp-open-projection-v26.md) 为准。

合并后 `pnpm typecheck` 与全量 Vitest（239 文件、2,612 项）通过，`pnpm test:message-anchors` 的隔离 Electron
生产界面验收通过；双方文案、使命提及、草稿邀请和直接回复目录功能均保留。

`cargo test --workspace` 通过 456 项，保留 1 项既有手动 Runtime smoke 忽略；`cargo fmt --all --check` 与
`pnpm build:desktop` 通过。显式启用 `slow-tests` 后，`user_anchor`、`current_migration_state_admission_matrix`、
`migration_preserves_literal_text_and_rolls_back_schema_receipt_and_evidence`、
`continuation_migration_rolls_back_and_preserves_frozen_evidence` 和 `v163_requeues_unfrozen_public_work` 五组过滤
共 7 项通过，覆盖直接回复查询、186 原子回滚、135 准入、使命描述保留及旧续接升级链。未新增平行 Rust owner。
文档门禁以 `DOCS_BASE_REF=52ecf398` 核对主线差异。
