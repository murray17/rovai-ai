---
document_type: model-context-change
version: v1.72
change_id: html-quotes-simple
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User
confirmed_at: 2026-10-29
authority: confirmed-model-input-change-statement
implementation_baseline: 6996d1042bd1f0387e85d6c9455489500eb933b6
implementation_status: implemented
last_updated: 2026-10-29
---

# 安全 HTML 与选文引用简化

## 二次确认

User 在本 Thread sequence 3 提出默认 HTML 清洗、选文直接保存和来源可选的方案，
sequence 5 明确要求简单实现；助手随后复述唯一模型格式及删除边界。
User 在 sequence 7 明确要求“开启wt开始实现”。本文件在实现前记录该已审阅方案和直接授权，
不声称 User 阅读过本文件，不另加安全机制、渲染框架、开关或兼容投影。

## 变更前

新模型输入与历史读取的引用项包含来源和作者：

```json
{"kind":"message_excerpt","source":{"scope":"current_messages","messageId":"message-id","author":{"type":"user","displayName":"用户"}},"text":"用户保存的选文"}
```

历史工具使用相应的 source.scope；schema 要求 kind、source、text 及来源内部字段。
捕获请求要求原始 bodyAtSelection、startScalar、endScalar、text、messageId，
可带 currentUserDisplayName。Core 重读正文、比较版本、重算 Markdown 投影和字符范围，
生成 sourceContentDigest、locator（投影版本/范围/摘要）及 snapshotDigest。
发送、Context 与历史读取还按被引用消息的会话、可见性、投递和删除状态过滤引用。
Renderer 默认将原始 HTML 文本化，部分阅读面使用 drop。

## 变更后

所有新生成模型输入和工具读取统一使用一种引用项，非空 quotes 仍处于原位置，空数组仍省略：

```json
{"kind":"message_excerpt","text":"用户保存的选文"}
```

schema 只要求 kind、text，不再声明 source、scope 或 author。
UI 捕获请求只要求 text；messageId 可选，仅形成可选来源跳转元数据。
存储继续使用 version=1、quoteId、text、format=plain_text、capturedAt；source 和
authorAtCapture 可选。读取旧记录时忽略已退役的摘要/locator 字段，不验证或重算来源。
不再生成来源摘要、范围、投影版本和逐引用快照摘要；冻结上下文/Blob 的既有证据照常保存。
前端保留一个必要的可见选文提取入口，以保留换行、表格分隔和代码缩进；来源跳转只定位消息。

被引用原消息不再参与捕获准入、消息发送、Context 或历史读取的过滤和归属检查。
承载引用的新消息仍遵守原有会话权限、可见性、草稿归属、并发、幂等与上下文预算。
引用仅是用户提供的文字，不触发 Mention、Skill、接收者、指令或权限解析。

SafeMarkdown 沿用 react-markdown，按 rehype-raw → rehype-sanitize 默认 schema
→ 可信内部内容的顺序运行。未知标签按库默认处理；代码和转义内容保持字面值。
只调整既有 Mention、前缀和文件链接间距；间距按清洗后的可见内容计算。
删除 rawHtmlPolicy 分支，阅读面调用点仅作必要适配。

## 明确不变

Bootstrap 结构、Run Facts、消息正文、附件、Skills、成员路由及 section 顺序保持。
最近消息选择、条数、正文预算、总输入预算和 quote 的 12,000 scalar 上限不变。
quotes.text 的必要输入计费及历史整条省略规则不变。
引用的承载消息和私有会话继续通过既有读取/写入权限；来源提示不能增加读取能力。
不批量修改历史数据，不创建额外解析服务、标记注册系统或测试框架。

## 版本、迁移与兼容

使用既有版本轴：public Formatter/Manifest 43、non-batch 44，Profile 15/16、Run Facts 11/13、Bootstrap formatter 6 保持。
Migration 218 仅扩展 schema 167 → 168 的版本与配对准入，不修改旧业务行。
Transport/CLI 45、Agent Output 15（IPC 3、Envelope 2 不变），与新 quotes schema 配套。
Charter revision 26 只清理下列已失效字段说明，Binding compatibility 16 保持，不新增版本轴。

Single Chat Charter 变更前完整被删行：

    - In CURRENT_INPUT.quotes, source.scope=current_messages means the current Rovai message area, not the provider transcript; source.messageId identifies the original message there.

变更后：删除该行，其余 Charter 原文不变；已冻结 Bootstrap 不回写。
旧引用用于未来请求时，读取已保存 text，生成上述唯一新格式。
恢复已经冻结的输入时，直接使用原有冻结字节和证据，不重新投影或改写历史 Run。
现有 Message Quotes、ContextManifest、History、会话 UI 和架构仅同步相关约束。

## 验证

扩展 SafeMarkdown、前端选文、草稿恢复、引用/Core Context 和发送队列的既有测试。
覆盖 br/b、转义和代码、默认清洗、内部标记、可见间距、复制与表格滚动；
覆盖选中后正文变化、来源删除后的排队/编辑/发送/读取、无来源重启恢复；
验证旧快照新格式读取和冻结输入原字节恢复、承载消息权限与预算。
退出的 Rust 投影与来源过滤测试随生产合同一起退役，正常选文/持久化/恢复 case
由上述现有 owner 接续，不为相同路径新增一套全链路测试。
执行 typecheck、定向 Vitest/Node/Rust、默认 Rust workspace 回归和通用文档门禁。

## 工作记录

- Worktree：`/Users/murray.xue/.codex/worktrees/html-quotes-simple/rovai-ai`
- Branch：`rovai/html-quotes-simple`
- Base：`6996d1042bd1f0387e85d6c9455489500eb933b6`
- Governance：与代码同分支；无主线文档先行要求。
- Status：实现完成；合入状态见 [PR #944](https://github.com/murray17/rovai-ai/pull/944)。
- Validation：下方本地验收通过。
- Next：User sequence 15 已授权 PR 到 main 并合并；检查通过后合入并清理本 worktree。


## 实施与验收记录

生产实现使用现有 Markdown、引用存储、Context 和 Migration 入口；删除 Comrak 依赖及来源证明逻辑。
清洗后的 HAST 只复用既有内部标记和间距类；前端选文使用一个 DOM 取文入口，无跨端协议。
旧 locator、摘要仅由宽松快照读取忽略，不保留捕获/重算算法。

Rust 测试退役：`camp_quote_projection_rechecks_source_visibility_for_each_agent` 随来源过滤合同退役；
`readable_projection_preserves_selected_text_without_markdown_wrappers` 随 Rust 投影/Comrak 退出。
原捕获 owner 改为 `capture_keeps_selected_text_without_rechecking_source`，覆盖正文已变、来源已删、
无来源、重启、旧证明字段忽略、文本上限及引用中的字面指令；前端取文用例迁至
`scripts/fixtures/message-quotes/selection-cases.json`，继续由原 Electron 交互 owner 执行。
现有 Single Chat materialization owner 追加 Migration 218 回滚和冻结数据保持断言；未新建测试框架。

| 验证 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| SafeMarkdown、safe-markdown-model、camp-composer-local-store 定向 Vitest | 70 项通过 |
| `pnpm test:message-quotes` | 通过；76 组可见文本用例，HTML/表格选文、原文变化、缺失来源、键盘/复制/跳转及双主题截图 |
| `pnpm test:markdown-code-copy` | 2 项通过，原生代码复制、文件阅读、失败恢复与网站复制 |
| `node --test scripts/lib/structured-mention-composer.test.mjs` | 2 项通过，Mention、选文与 Web URL 手势 |
| `cargo test --workspace` | 479 项通过，保留原有 1 项 ignored |
| `--features slow-tests,extended-tests --lib single_chat_` | 8 项通过，含冻结字节恢复、Migration 218 回滚及旧证据保持 |
| 同 feature 的 `pending_input_preserves_source_refs_and_publishes_after_the_active_run` | 通过；无来源选文在生产数据库重启后经排队、发布进入 CURRENT_INPUT |
| 同 feature 的 `active_inputs_preserve_initial_context_and_unsubmitted_sources` | 通过；来源删除后原选文进入实际追加输入，并保持冻结/重放规则 |
| 同 feature 的 `public_history_budget_is_shared_and_quote_groups_remain_atomic` | 通过；无来源引用仍完整计费 |
| `pnpm docs:test`、`pnpm docs:check`、带 base 的 `pnpm docs:check:ci` | 通过 |
| Impeccable 对实际修改的显示/取文入口检测 | 无发现；复核日/夜主题截图 |

自动 UI 验收使用临时 userData，未启动 Core/真实 Runtime，未接触日常 App 数据。
真实模型双轨 Gate 未执行；本任务未固定 Runtime/Judge 配置与评测预算。本分支记录实现与确定性验收，
不宣称已通过模型质量 Gate 或发布验收；正式模型 Gate 继续使用仓库已有流程，不另建评测机制。

## 审查后局部修正（2026-10-29）

针对 User sequence 11 对 eb8591723 的反馈，仅修正三个既有入口：选文保留行内元素之间的空格，
折叠 details 只读取 summary；QuoteSelection 忽略退役字段，以便升级前 Web pending 请求继续解析；
前缀按首个可见节点定位，清洗后保留的开头文字不会被跳过。生产代码净增 5 行，模型格式和来源语义不变。

先在原测试 owner 复现网址/HTML 空格丢失、折叠正文混入、前缀后移，以及 Rust 的
`unknown field bodyAtSelection`；修正后 80 组可见选文用例、71 项定向 Vitest、原 Rust 捕获 owner
和 typecheck 通过。取文用例使用实际 FileReferenceText、SafeMarkdown 和 Chromium 选区；
展开 details、br、表格分隔和代码空白继续通过。旧请求核对路径已静态确认，新增 Rust 断言覆盖其
嵌套 QuoteSelection 的解析；未额外建立 Web 升级端到端测试或重跑真实 Runtime 评测。

针对 User sequence 13，仅调整 INVALID_RANGE 判断：关闭 details 的非 summary 正文中，
隐藏控件不否决跨过它的选区；可见 summary 和展开后的代码控件继续沿用原有规则。
生产代码只改此处、净增 6 行。原 fixture 追加真实 MarkdownCodeFrame 的折叠代码块用例，
修复前复现返回空结果；修复后 81 组取文用例及上述两种可见控件对照通过，typecheck 通过。
首次完整交互回归在既有工具栏显示断言失败，代码不变重跑通过；未改该测试时序。
本次未改 Core、来源语义或模型格式，也未重跑 Rust 或真实 Runtime。

PR #944 收口时同步最新 main，版本概览保留 HTML/引用与 Windows Fleet 两边记录。
首轮 CI 发现五个旧 HTML 策略断言和一个脚注属性序列化断言未同步；仅更新原测试，生产实现不变。
本地全量 Vitest：259 个文件通过，3018 项通过、2 项跳过；Rust 格式检查通过。
