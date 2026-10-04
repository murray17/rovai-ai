---
document_type: research
status: verified-with-limitations
last_updated: 2026-10-04
---

# 上下文运行中可用性收口

基线 PR #631 / `58b838d3`，功能分支 `rovai/runtime-live-context`。当前合同为
[Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md)；保留
[前一轮证据](live-context-verification-2026-10-03.md)，不将旧限制改写为当时已经通过。

## 改动与归属

- 移除 `context_waits_for_input`、延后保存/重入缓冲和 Context 保存/读取中的 accepted 条件。
  delivery 只用于取得既有冻结 Session 绑定；不会被指标代码更新。prepared、delivery_unknown、失败/取消不阻止当前会话观测。
- 只更新现有 `runtime_session_context_latest`。纯 Gauge 不再创建消费 checkpoint；当前绑定、Run epoch、Host/根事件路由及新 Run owner 继续隔离迟到数据。
- 每条 Gauge 使用独立接收身份，单个 Session 只记相邻去重状态。压缩下降、返回旧数值和新的同值报告可更新新鲜度，不用历史数值集合去重。
- 已知实际模型/Provider 及配置不变时复用省略的 window；同时比较 Host 配置摘要和 Run 冻结的模型选择/选项。配置别名不初次建立实际模型身份。
- window 明确为零、配置/实际模型改变或 used 超过窗口时撤下分母；合格 used 仍保留。旧 used 和瞬时 native ratio 不继承。
- Pi、Antigravity、ZCode 的 used/window 独立准入。CodeBuddy/TRAE 的占用超过分母时交给 latest 层保留 used、撤下 window。
- ZCode 根 ModelComplete / 压缩完成触发 `session/read`，重复触发合并、单请求在途，读取和事件 reader 独立；bridge 结束清理 worker。运行中限制 `messageLimit: 1`，无新定时器或模型调用。
- 现有 4 秒 Flush 提交有效观测后发 `monitoring.changed`。Renderer 保持当前布局、隐藏暂停、单请求在途、有限终态尾读；仅 observedAt 改变时沿用显示对象。

没有数据库迁移、Context 历史、正文/思考存储或测速。日常 App 和用户数据库未被替换；没有合并 PR。

## 字段、运行中、终态与冷恢复分开记录

“共享路径回归”表示通过 parser/归属/存储/Reader 测试，不能替代该 Runtime 的新一轮真实调用。
既有字段证据入口为 [10-03 字段复核](kiro-and-field-audit-2026-10-03.md)。

| Runtime | 原生 Context 字段来源 | 运行中更新 | 终态 / 冷恢复 |
| --- | --- | --- | --- |
| Claude Code | 根调用输入三桶；result 中实际模型窗口 | 本轮真实 App 两轮验收，第二轮复用窗口 | 本轮终态；本轮未重跑 Core 冷恢复 |
| Codex | last.totalTokens / modelContextWindow | 既有通知；共享 latest 回归 | 保留历史证据；未新增动态承诺 |
| OpenCode | 最近完成根调用 used；ACP/显式模型窗口 | 既有低频 reader，移除共享确认阻塞 | 未重新跑有效窗口/冷恢复矩阵；窗口未知仍未知 |
| CodeBuddy | 匹配当前模型的最近调用 inputTokens / maxInputTokens | 既有低频 reader；共享路径回归 | 窗口/缓存写缺口沿用历史结论 |
| Qwen Code | ACP used / size | 受控标准 ACP App 验收；不能称当前原生 Qwen 新样本 | 受控终态通过；未新增原生冷恢复证据 |
| Pi | ctx.getContextUsage tokens / contextWindow | turn_end / session_compact；独立字段回归 | 本轮未取得新真实 used-only 样本 |
| ZCode | session/read runtime.contextUsage used / size | 本轮真实 App 至少两次终态前更新 | 本轮终态；旧版拒绝 messageLimit 时实时补采不可用、终态不受该参数影响 |
| DeepSeek Harness | ACP used / size | 共享确认阻塞已移除；未重跑真实 Gauge | 沿用历史证据，不新增完整支持结论 |
| Qoder | context_usage_ratio，可用时原生数量 | 既有低频 reader；共享路径回归 | 原生比例不反推 used；本轮未重跑冷恢复 |
| Kimi Code | ACP used / size，包括当前 owner 迟到值 | 共享确认阻塞已移除；未重跑原生时机 | 本轮未重跑冷恢复 |
| Grok Build | _meta.totalTokens / 匹配实际模型窗口 | 原生通知路径；共享 latest 回归 | 真实压缩/冷恢复沿用历史范围 |
| Antigravity | 同一完成根 step 的 gen_metadata | 既有逐 step 读取；独立字段回归 | 本轮未取得新真实缺窗口样本 |
| Kiro | 原生 contextUsagePercentage / Session 窗口 | 共享确认阻塞已移除 | 精确 used 仍未知，未从比例反推 |
| TRAE CLI CN | 最近 prompt_tokens / 当前 source_model 窗口 | 既有低频 reader；共享路径回归 | 本轮未重跑真实冷恢复 |
| Copilot CLI | 原生 ACP Gauge；usage 仍归 Run | 共享确认阻塞已移除 | 不把累计 token 当占用；本轮未重跑 |
| Cursor Agent | 按用户要求排除 | 排除 | 排除 |

## App 证据与时间口径

最终构建复验数据见[数值 fixture](fixtures/live-context-usability-2026-10-04.json)。验证实例位于仓库外独立
`RovaiMetricsAcceptance/context-usability-20261004`，每条路径独立 userData、Skill Library、MCP 和工作区。
真实任务要求三个顺序只读工具调用，中间两次 12 秒停顿，避免短任务只有终态。

`observedAt` 是 Core 收到/解析数值观测的时间，并非未经捕获的网络包时间；
`committedAt` 在 SQLite transaction.commit 成功返回后立即记录；Renderer 每秒检查一次，
因此显示时间为首次采样上界，不能声称毫秒精确的浏览器 paint 时间。
ZCode 另记录 session/read 原生响应返回、seq/revision、used/size、读取耗时及总次数。
所有记录仅保留数字、归属和时间，不保留模型正文/思考、消息快照或凭据。

App 0.4.3 / macOS arm64，最终 Core SHA-256：
`d66128f9e8a66b9a54890705988723f9e8c65826264c45e44a38c69ee0787128`。
下面均为最终包同次样本；时间为 **2026-10-03 UTC**（本地 10-04），不是截图时间猜测。

| 样本 | 原生观测进入 Core | SQLite 提交返回 | 首次匹配 Renderer | 最终响应观测 | 运行中证据 |
| --- | --- | --- | --- | --- | --- |
| 受控标准 ACP | 17:29:46.969 | 17:29:48.681 | 17:29:49.240 | 17:30:22.980 | 12800/200000；delivery 仍 prepared，acceptedAt/endedAt 均空 |
| Claude 第 1 轮 | 17:29:48.695 | 17:29:52.674 | 17:29:53.254 | 17:31:23.619 | 11151/未知；正文工具回合仍继续 |
| Claude 第 2 轮 | 17:31:29.884 | 17:31:32.674 | 17:31:33.127 | 17:32:31.285 | 新观测 window=null，读回 13561/200000，界面 13.6k/200k、6.8% |
| ZCode | 17:29:49.283 | 17:29:52.683 | 17:29:53.565 | 17:30:39.478 | 原生 snapshot 于 17:29:49.283082 返回；15407/200000 在最终事件前可见 |

ACP 的最终时间取 Core 收到受控 prompt 返回后的输入确认时间；Claude/ZCode 直接在原生 result/terminal 处理入口记录。
每行的完整精度、Run/Session ID、原生字段、期望解析与数据库/API/气泡对照均在 fixture；没有把终态截图当作运行中证明。

### 各路径结果

- **ACP**：4 个新观测全部在最终响应前提交并显示：12800 → 15000 → 8000 → 12800。
  后三条原始通知省略窗口，持续复用 200000；旧瞬时比例不沿用。执行面板隐藏 5 秒后重开立即读取当前已提交值。
  这是 Qwen adapter 上的受控标准 ACP，版本字符串 0.24.5 来自夹具，不能冒充本机真实 Qwen 新样本。
- **Claude Code 2.1.280**：本机 sub2api 配置，选择别名 opus，实际 model 为 gpt-6.1-sol。
  两个 Run 复用同一个原生 Session `3a1398ee-ca20-473f-8c62-b63d168dc475` 和绑定代次 1。
  第一轮运行中 5 个不同占用、终态确认 200000 窗口；第二轮在新 result 到达前有 4 个不同占用，均复用该窗口。
  第二轮展开第一轮历史卡，圆环仍保留当前 Session 的值。
- **Claude 原生用量自检**：读取上述测试 Session journal 的数字，按原生根 message ID 去重。
  第一轮 6 调用：Input 70888 / Output 1328 / Read 11776 / Write 0；第二轮 5 调用：69688 / 625 / 17664 / 0。
  四项与落盘和气泡一致，证明 Context 路径没有把最近占用当累计消耗或改变 Run 归一化。
- **ZCode**：安装 App 3.14.4，原生 CLI 报告 0.16.9，实际选择 new-provider/gpt-6-sol。
  最终事件前，Renderer 匹配了 15407、15530、15640、16400 四个不同占用。
  共 6 次事件触发的有界 live read，每个原生 eventSeq 一次；另有 2 次既有 foreground/background 终态读取。
  RPC 耗时 86–238ms，未被 prompt 串行阻塞；整个任务没有新增轮询定时器。
- 在上述仍运行且界面可见的样本中，Core 观测到提交最多 3.979 秒，提交到首次匹配 Renderer 采样最多 1.093 秒。
  这是本机样本及 1 秒测试采样的观测上界，不是所有 Provider 的延迟保证。

截图/完整范围报告在同根 `acp-verified/captures`、`claude-verified/captures`、`zcode-verified/captures`；
最终副本为 `build-e/Rovai AI.app`。夹具队员固定名为“Codex CLI 验收”，实际 Runtime 以卡头右侧与 JSON 的 runtimeKind 为准。
测试完成后只退出验收 App/Core，保留这些隔离夹具和数字报告。

中间验收发现 ZCode 同一次原生调用会触发相同 snapshot 两次；最终实现按返回 eventSeq 撤销已经覆盖的待读，
上述 6 个 live revision 均只读取一次。还修正了验收脚本第二轮切换气泡的开关和数值诊断分片问题；
那次脚本超时不计入健康两轮验收。先前 build-a/b/d 的记录只作过程证据，不替代最终包证据。

## 资源边界及未决项

- 单次 Flush 继续使用既有 4 秒节拍；增加的是有效提交后的现有失效通知，不是全量历史查询。仅 freshness 变化不会替换 Renderer 显示对象。
- ZCode 以事件驱动，多个触发合并；双工测试将第一次读取暂扣，20 次较新触发仅追加一次读取；第二份快照覆盖的 3 个后续触发不再查询，且 prompt 最终响应仍被暂扣。
- 本机 ZCode 官方 `session/read` 支持 messageLimit；源码读取原生持久化消息/事件后再限制返回条数。Rovai 不反复接收/保存完整聊天，但不能宣称原生内部没有历史读取成本。没有新增定时补偿。
- 原生明确不支持 live read 或拒绝 messageLimit 时保留未知；原有终态收尾参数保持兼容。不为指标建立版本白名单。
- Pi/Antigravity 的缺字段由合成数值回归证明，未伪称取得新的原生稀疏字段样本。
- 本轮不重跑全部 Runtime、真实取消/崩溃/压缩/切模型/冷恢复组合。对应绑定/配置/下降边界由现有 owner 的定向回归验证；App 结论仅限下述同次样本。
- 原生配置文件在同一进程外部被修改但既有 Host 兼容检查未观测的情形，不新增一套配置监听服务来猜测；没有原生确认的模型/窗口不建立初始分母。

## 回归入口

测试归属与命令见[开发测试说明](../../development/testing.md#原生-usagecontext-测试准入2026-09-30)。
本轮扩展现有 Rust owner；没有新增、删除或停用测试。原生 Usage 分批刷盘 fixture 继续保持数字、请求计数和完整性一致。

结果：默认 Rust workspace 452 passed、1 项既有人工作业 ignored；monitoring 13、Claude 33、native_usage 3、
ZCode transport 3、Pi 数值 owner 1、Antigravity 数值 owner 1、ACP ACK/历史回放 owner 1 通过。
ZCode 最后一次合并修订由其双工 owner 和最终真实 App 再次验证。
Renderer reader 9 项及生产 Renderer 的可见范围/隐藏/迟到结果集成 owner 通过；后者启动隔离 Electron，不调用 Core/模型。
`pnpm typecheck`、格式检查、`pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=11c4cc0c pnpm docs:check:ci`、
`pnpm package:mac` 通过。未新增不可见面板查询、全量历史读取或第二套 Context 状态。
