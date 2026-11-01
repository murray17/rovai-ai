---
document_type: implementation-record
version: v1.72
authority: implementation-and-acceptance-evidence
status: implemented-and-validated
last_updated: 2026-11-01
---

# 原生子代理平铺 command

User 已确认 [Surface v58](../../contracts/run-process-detail-surface-v58.md) 与 [D72](decisions.md#v1-72-d72)。
本次独立 worktree 为 `rovai/subagent-flat-execution`，基于 `b3c9522d3`，先带入原生协议调研，再实施生产链路。
未替换日常 App、未改模型上下文、任务调度或自动续跑；不涉及 Cline/Cursor。
最初的平铺实现保留后台策略；后续按 User 明确授权增加 Qoder 原生 env 限制，见末尾补验。

## 实现边界

- `runtime_subagent.rs` 在原生 Prompt 作用域内归属工具、保留公开工具名与参数，按 Session/Prompt/来源/原生调用 ID 建立 operation。
  稀疏更新只补齐唯一已知归属；冲突不猜测。ZCode 继续复用 bridge 的原生身份与既有迟到后台结果处理。
- ACP、Claude、Codex、Pi 和 Antigravity 归一工具类型；`execution_text` 在聚合前拒绝已确认 child 和不明并发正文。
  实际工具返回仍沿现有公开内容和结果预算。没有子工具事件的 Runtime 不补造步骤。
- Codex 的 `subAgentActivity(kind=started)` 形成一条实际启动记录；其原生 item 没有任务入参，不虚构为 `spawn_agent` 参数。
  `kind=completed` 与 TRAE、Qwen 的原生生命周期通知不新增 command 或覆盖启动回执。
- Renderer 复用 `ExecutionToolGroup` 与普通详情文本区，只增加机器人图标。按首次 `sequence` 排序，同 ID 结果更新不移动位置。
  相邻主／子工具共用步骤分组；结果缓存按 revision/changeSequence 刷新，旧请求不能覆盖新结果，刷新保留文本节点、焦点和滚动。

Copilot/Qoder 匿名并发文本无法凭协议确认作者，委派活跃时保守过滤；后台启动成功但无法证明子任务结束时维持过滤。
启动明确失败或取消时解除该次调用的过滤；其他仍活跃的调用继续保留自己的过滤。
TRAE 根消息有 `messageId`，转发的匿名 child chunk 单独处理。这可能减少根代理的过程文字，不影响实际工具报告。
原生未返回调用终态时保持未知，不把根 Run 完成变成子任务成功。

## 迁移与兼容

Migration 219：schema 168/activity-v4 → schema 169/activity-v5，只原子更新 marker 与完成记录，不改旧 Evidence。
旧 v1–v4 operation 使用冻结分类器完成；新 operation 才使用 `tool.agent`。读侧同时兼容五代分类器与现有存储格式。
旧版应用不能直接打开 schema 169；迁移失败事务回滚。本次不把历史工具改成新机器人图标，也不更换当前产品版本指针。

## 验证归属

新增一个纯函数 Rust owner `runtime_subagent::tests::display_calls_keep_scoped_identity_and_exclude_unattributed_child_prose`，
拥有新的 Prompt 内归属状态机：同 raw ID 的不同来源、稀疏更新冲突、跨 Prompt、匿名文本、原生名字映射及独立通知。
没有 Core、数据库或进程 fixture。其余扩展既有 owner：Codex 归一、Evidence 生命周期／冻结分类器、正文交错、数据库准入矩阵。
Migration 219 的失败回滚与不重写历史，在既有 Evidence 生命周期的真实行上断言；不新增等价数据库测试。

前端扩展既有执行映射、合并、计数和生产组件 Electron fixture：所有工具共用操作、无额外输入输出分区、读取失败重试、
空结果／截断、乱序结果请求、保留展开／焦点／滚动与 Day/Night。截图人工复核；fixture 明确标注模拟数据。

最低回归命令：

```sh
pnpm typecheck
pnpm test
pnpm test:command-view
cargo test --workspace
cargo test -p rovai-core --features extended-tests --lib execution_evidence::tests::
cargo test -p rovai-core --features extended-tests --lib runtime_subagent
cargo test -p rovai-core --features extended-tests --lib current_migration_state_admission_matrix
cargo test -p rovai-core --features slow-tests --lib text_blocks_preserve_interleaving
DOCS_BASE_REF=b3c9522d3 pnpm docs:check:ci
```

## 真实模型验收

`scripts/smoke-native-subagents.mjs` 是显式手动运行、会调用模型的验收入口，不加入默认测试。
它复制当次编译的 Core/CLI，记录二进制及源码 Diff 摘要，每个样例创建独立 data、managed-skill-library、MCP、workspace 和缓存。
原生 Runtime 复用用户已有登录／原生 Home；这不等于原生 Home 完全隔离。提示要求子代理只读合成 fixture，父代理不直接读取。
按真实返回评估，不以 prompt 要求或 Run succeeded 代替子代理能力证明。

本轮私有证据位于 `/private/tmp/rovai-subagent-flat-5a73ebda-46ba-480b-9a4d-705ddd6f90ec`，
原始事件、结果和 stderr 仅在本机，权限 0600，认证信息／完整配置／reasoning 不发布或提交。
补验目录为 `/private/tmp/rovai-subagent-flat-qwen-final-20261101` 与 `/private/tmp/rovai-subagent-flat-grok-final-20261101`。
结构化的脱敏摘要、分批二进制身份和每个样例的检查结果见 [subagent-flat-evidence.json](subagent-flat-evidence.json)。

25 次隔离 Core 尝试覆盖 18 种 Runtime；22 次根 Run succeeded、3 次 failed（Kiro 未登录一次、Qoder 后台两次）。
另做了两次 Grok 原生 ACP probe，确认真实函数名、原生元数据与独立 child Session；不把登录失败算作模型能力通过。
Pi 虽然根 Run 成功，但实际报告无 native subagent，不能算委派成功。各 Core 均已由验收脚本正常关闭（code 0）。

以下只列原生子代理链路，不含根代理的帮助查询、普通 shell 和 Thread 发布 command；完整步骤数仍包含所有真实调用。

| Runtime | 实际链路／边界 |
| --- | --- |
| Copilot | 同步 task + child read；后台 task + child read + read_agent；双并发分别保留两次 task、两次 child read、两次 read_agent。独立正文不进入列表，报告留在实际返回调用 |
| Claude / CodeBuddy | Agent + Read；沿用当前禁用后台的运行配置，未解除限制 |
| Codex | subAgentActivity 启动记录 + wait；child 内部工具在另一 Thread，未补采。独立 completion 不增加步骤 |
| OpenCode | subagent + read；已确认 child-session 正文过滤 |
| Qwen | 后台 agent 启动回执；带 backgroundTask 原生标记的两类完成通知均不进入正文，补验通过 |
| Qoder | 同步 Agent + Read。后台只有 Agent 回执，未观察到报告读取调用；启动行仍成功。匿名最终文本不能安全归为根代理，未有 public send 时沿现有终态门槛得到 runtime_missing_final_output，不补正文或续跑 |
| TRAE | spawn_agent + 已转发 child 工具；subagent_completion 通知不生成伪 command，根 messageId 与匿名 child chunk 分离 |
| Kimi / ZCode | Agent + TaskOutput；ZCode 的既有后台 fencing 和身份保持 |
| MiniMax | task + task_output，分别保存各自实际结果 |
| Command Code / DSH | agent / subagent 同步返回；没有转发内部工具时只显示一行委派 |
| Grok Build | 同步 spawn_subagent；后台另有 get_command_or_subagent_output。使用 x.ai/tool.name 保留真名；共享读取工具也处理后台 shell，因此维持普通工具图标，不冒充专用 Agent 类型。最后两次 Core 补验均成功 |
| Hermes | delegate_task 返回 dispatched；观察窗口内未返回 child 报告。共享 Gateway 中 CLI 无活动 Run 的既有 run_not_bound 被如实保留；不据根 Run succeeded 声称子任务已完成或消息已发布 |
| Antigravity | invoke_subagent 已出现，但原生未给它调用终态；该行保持结果未知，不能以根 Run succeeded 补成成功 |
| Pi / Kiro | Pi 默认未加载 subagent 扩展；Kiro 未登录，保持未通过边界 |

Core 的 CLI 工具记录通过权威 Evidence 读取进入 UI，不保证每条都单独发 notification。
回放比较生产的「历史 Evidence + live update」路径与历史页；另外直接比较 native Agent／明确 child 来源工具的通知身份、顺序和状态。
最终样例这两项均一致，原始 event-only 工具数量也保留在摘要中，未把缺少 CLI notification 伪装成完整 live stream。
逐案复核报告字样：根代理主动引用子报告并附 PARENT_DONE 是根正文，不能仅因出现 CHILD marker 把它删掉。
没有以全文关键词替代协议归属判断。

## 回归结果

- `pnpm test` 通过：259 个 Vitest 文件，3023 passed / 2 skipped；其后的 Node 脚本测试 365 passed / 2 平台 skipped。
- `pnpm typecheck` 通过。补充混合旧 notification 的顺序处理后，相关 3 个前端文件共 202 tests 再次通过。
- `pnpm test:command-view` 通过；生产组件验证机器人图标、共享详情、读取失败重试、原文保留、键盘与两套主题、revision 乱序请求、焦点与滚动保留。
  Day/Night 截图及最后 Agent 组件截图均已人工复核；这项是隔离组件验收，不声称做过日常 App 安装。
- `cargo test --workspace --no-fail-fast` 通过：478 passed、1 个既有 ignored。
- 定向 slow-tests owners 通过：Prompt 来源状态机、Canonical 版本、迁移准入矩阵、实际新库重开、交错正文、Codex 归一、ACP 稀疏终态与权限元数据、公开任务参数。
- Evidence 生命周期及历史分类 owner 17 tests 通过，覆盖 v1–v4 冻结与新 v5、存储格式 3/4 的原位结束、升级中 marker 写入失败后 receipt 回滚、旧行不重写。
- `cargo fmt --all --check`、`git diff --check`、文档测试及固定 base 的通用文档门禁通过。

## 评审修补

针对 `d9606b8f4` 的读取与正文归属缺口，在原路径内修补：

- 文件预览的 storage 3/4 版本列表和 storage 1/2 查询补入 v4；历史 canonical 查询按 v5、v4、v3、v2、v1 选择。
  不改历史行，不回填分类器。
- Claude 只让 root 的流式与最终正文更新正文状态；带 `parent_tool_use_id` 的纯正文 assistant 包不再绕过过滤，
  混合包中的实际工具调用及工具返回继续保留。
- 后台启动明确失败或取消后，该调用不再维持匿名正文过滤；迟到进度不能重新打开过滤，其他并发调用不受影响。
- 同一 command 从内联正文切换到按需读取时保留已显示的文本节点；加载、重试与旧请求隔离继续走通用组件。

回归扩展既有 owner，没有新增 Rust 测试函数或测试框架：`run_activity_file_uses_the_exact_evidence_and_mission_worktree`
覆盖四种存储格式的 v4 文件预览及 append-only 来源定位；`snapshot_batches_canonical_activity_for_the_full_evidence_window`
覆盖旧 canonical 的版本优先级、摘要与完整读取；Claude 正文 owner 覆盖子正文与主正文身份交错；Prompt 来源 owner
覆盖 Copilot/Qoder 失败、取消、其他并发任务与迟到进度。前端沿用生产组件的隔离 Electron fixture，验证内联转按需读取。
这些缺口使用确定性的原生事件和存储样例复现；本轮不把前一节的真实模型结果当作修补后的重新验收。

本轮结果：修补前的三个后端 owner 和 command 组件用例按预期失败；修补后定向 Rust 8 项通过
（上述四项，以及既有正文聚合、Claude 工具返回、usage 和 thinking owners）。
`pnpm typecheck`、`pnpm test`（Vitest 3,023 passed／2 skipped；Node 365 passed／2 skipped）、
`pnpm test:command-view`、格式检查与 `DOCS_BASE_REF=d9606b8f4 pnpm docs:check:ci` 通过。
组件截图已复核；内联转按需读取、revision 乱序、焦点与滚动均由真实生产组件验证。

最小复现命令：

```sh
cargo test -p rovai-core --features slow-tests --lib -j2 -- \
  public_text_streams_and_success_fallback_create_narration_without_thinking \
  display_calls_keep_scoped_identity_and_exclude_unattributed_child_prose \
  snapshot_batches_canonical_activity_for_the_full_evidence_window \
  run_activity_file_uses_the_exact_evidence_and_mission_worktree
pnpm test:command-view
```

实际平台为 macOS arm64；本次没有 Windows/Linux 真实运行或完整打包安装验收。后台原生能力、缺少事件与认证失败分别保留，不合并成“18 种均支持”。

## 开发 App 问题补验

本轮继续使用 `/private/tmp/rovai-subagent-app-demo-Rod71e/user-data` 与其独立 managed-skill-library/MCP，
通过 `pnpm dev` 加载任务 worktree。日常 App 保持运行；以下是开发 App 与真实 LLM 结果，区别于前面的隔离 Core 验收。

| 案例 | 实际结果 |
|---|---|
| ZCode `rvcamp_01m6b8f0xyfjhssxd6abhh1jcc` | 原失败 Run 的原生模型错误为 `Concurrency limit exceeded for account, please retry later`，此前 Agent 已成功。串行补跑 `a1a71b26-8a96-487c-a262-baa5a783cf1e` 成功，Agent 返回随机标记 `ROVAI_aacc7848`；完成说明发布成功 |
| Kiro `rvcamp_01m6b8f43ef299qbh821rrhht0` | 登录后补跑 `ed9d7a6b-2c5e-4494-8c85-ee35ff2c21c9` 成功，但暴露工具名称/报告归一化遗漏。修补后重跑 `ac928ad6-7900-4246-8660-d819aa7e4136` 成功，唯一 subagent command 的实际输出含 `ROVAI_439bc466`，正文没有该报告标记 |
| Qoder `rvcamp_01m6b8f8zafwhvs21mdjxj3npx` | 复核原生记录确认后台 child 已成功；补跑 `474cf7fd-991e-4476-852c-4b721f05e610` 的 `runtime_missing_final_output` 属于根回合/后台交接缺口，未修复。最初的 `runtime_launch_failed` 仅确认启动提交失败，不臆测凭据或 Provider 原因 |

Kiro 另用既有原生协议探针得到标准 ACP 起始 metadata、同 ID 的完整 rawOutput，以及独立 child Session。
只补 `runtime_subagent.rs` 的真实函数名来源和 agent 工具类型，让原有参数/结果路径生效。
不增加后台调度、子任务状态或 UI。child Session 的内部工具维持现有接入边界，不从原生日志补造执行记录。
真实版本及能力范围由[兼容性清单](../../runtime-compatibility.md#2026-11-01-kiro-登录后子代理与-zcode-限流后补验)记录。

ZCode 将两个已知 error 字段中的精确并发错误映射到固定安全原因，并归入现有 `runtime_rate_limited`。
未知错误仍走通用失败；认证优先级、历史失败记录、原有重试门槛与 Renderer 交互均不改。
运行卡继续显示安全 detail，其他错误入口可显示中文 summary；没有为了演示再次触发真实并发限流。

回归扩展原有 owners，不新增 Rust 测试函数：ZCode 原生事件 owner 覆盖两个已知字段与敏感字段隔离，
公开错误 owner 覆盖限流分类；Prompt 来源及 ACP 参数 owner 覆盖 Kiro metadata、仅标题拒绝、同 ID 稀疏终态和完整报告。
最小命令均通过：

```sh
cargo test -p rovai-core --lib zcode::events::tests::
cargo test -p rovai-core --lib runtime_failure::tests::
cargo test -p rovai-core --features extended-tests --lib runtime_subagent::
cargo test -p rovai-core --features extended-tests --lib acp_tool_events_expose_only_the_public_command_and_payload_digests
pnpm exec vitest run apps/desktop/src/renderer/src/RuntimeFailureNotice.test.ts apps/desktop/src/renderer/src/runtime-status.test.ts
```

上述 Rust 10 项、前端 33 项通过。ZCode 修补后的默认 workspace 回归 478 passed、1 ignored；之后的 Kiro
名称归一化由两项定向 owner 和重建后的真实 App 重跑验证。App 展开详情已人工复核；Kiro 的实时末次通知与历史
Evidence 的调用身份、Canonical 类型、状态和报告一致，旧失败记录保留。

## Qoder 同步启动策略补验

User 在原生开关对照和直接 env 传递说明后，明确要求接入并用开发包重试。
仅在 Qoder 专属启动分支、普通环境及 Built-in 环境合并后设置 `QODER_ENABLE_AGENT_SESSIONS=0`。
Host compatibility 增加 `nativeBackgroundPolicy=agent-sessions-disabled-v1`；不改变 Session compatibility、Bootstrap、
输入选择或上下文证据，不重写已确认的模型上下文说明。没有用户配置文件、新状态机、后台任务管理器或 UI 改动。

扩展既有 `warm_compatibility_matches_process_inputs_across_acp_adapters` owner，覆盖同名启动环境覆盖、
其余变量保留、有／无 MCP 的提前返回、新旧 Host 摘要区别和 Native Session 身份保持；不新增 Rust 测试函数。
最小命令：`cargo test -p rovai-core --features extended-tests --lib warm_compatibility_matches_process_inputs_across_acp_adapters`。
隔离开发 App 仍使用前述 fixture，通过 `pnpm dev` 重建；启动父进程故意继承 `QODER_ENABLE_AGENT_SESSIONS=1`，
实际 Qoder ACP 子进程的同名环境值为 `0`。Host 二进制 SHA-256 为
`af3eb80d3223e83c244ebb96e9602e672698571bab9d4df11e241ae858c2c3a5`。
本机 Qoder **1.1.81**、真实 `deepseek/deepseek-v4-flash-pg` 结果如下：

- 原 Thread `rvcamp_01m6b8f8zafwhvs21mdjxj3npx`，新 Run `6a614725-1d7f-43d5-8e7a-6b9c081108ce` 为 `succeeded`。
- 恢复原生 Session `93d18aa5-1257-4c4b-ac35-81aec6c2abce`；没有清空 Session 或重放旧失败。
- 模型仍提交 `name` 与 `run_in_background:true`，原生开关强制普通 Agent 同步执行，实际输出直接包含
  `CHILD_REPORT_BEGIN`、随机文件标记 `ROVAI_02e89a7f`、琥珀色、数量 3、`CHILD_REPORT_END`。
  原始入参不删改；没有 `Async agent launched successfully.` 回执。
- 唯一 Agent 与唯一 child Read 都成功，主代理公开完成说明成功；narration 不含子报告或随机文件标记。
- App 人工复核机器人图标、普通单文本详情、同一「已完成 4 个步骤」分组，包含 Agent、Read、发布 shell 和
  Built-in send 记录；此前两次失败保留。开发 App 停留在成功报告处供 User 查看。

原始本机证据在上述 fixture 的 `evidence/qoder-cli-background/qoder-sync-policy-*`，
仅发布脱敏结果；没有替换日常 App。兼容性清单追加证据后同步其冻结摘要，未改变平台准入状态。
定向 owner、格式检查、文档单测 10 项和 diff-aware 文档门禁通过；默认 workspace 复验 478 passed、1 ignored。
