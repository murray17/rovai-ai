---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-10
---

# Kilo 自动压缩、进程复用与模型选项核对

User sequence 41 要求比较进程复用与权限，明确自动压缩验收，并确认其他模型的推理选项能否查询。
在原 `rovai/kilo-acp` worktree、基线 `0780ed59662b49f3bed6d33c0532efc88f7e7027` 继续。
本次扩展原生 probe 和生产 Core smoke；不改变生产模型输入、压缩阈值、权限或模型目录策略。

## 进程复用的比较修正

“一个成员的会话绑定使用自己的进程”并不是 Kilo 独有的额外限制。
Kilo 与 OpenCode 走相同 `RuntimeCompatibilityKey::member_session`：Thread、成员、原生绑定及配置都匹配才复用；
Codex 也使用这一复用范围。Command Code/Hermes 使用 Native Binding 与工作目录策略，仍不跨 Thread/成员/绑定共享。
兼容、空闲且未被 LRU/TTL 回收时，同一绑定可以跨多个 Run 使用同一进程；回收后仍可新建进程恢复旧 Session。

Claude 当前使用 RuntimeOneShot print 进程：一轮内保留流式控制，轮次结束后清理进程，下一轮恢复原生 Session。
这是与 Kilo 常驻进程最明显的差别。不能把“多个绑定可能需要多个进程”只算成 Kilo 特有的资源成本。
Kilo 对不兼容旧 Host 的显式退役与 MCP mutation invalidation 是既有 Fleet 路径；正常成功 Steer 后继续复用。

## 自动压缩的验收方式

原手动 `/compact` 记录只证明当时的手动路径，不能用作自动压缩的验收替代。
现有 `probe-kilo-runtime.mjs` 将该主场景换成原生自动阈值及 Provider overflow 自动恢复；
`smoke-kilo-runtime.mjs` 追加相同两条路径和压缩后 Core 重启。没有新增并行验收入口。

夹具模型窗口为 200,000，output limit 为 2,048，显式 `compaction.auto=true, threshold_percent=50`。
受控 Provider 在 seed 返回 110,000 prompt tokens，推动下一次请求走 100,000 阈值的原生自动路径；
该值低于原生绝对可用上限，不用上下文超限错误代替阈值场景。
另一次请求只返回一回标准 `context_length_exceeded`，验证原生自动压缩和重试。
其余请求和摘要返回小用量。未修改官方二进制，也没有向原生数据库写入摘要或压缩标记。

验证分别读取真实原生 `part.type=compaction` 的 `auto/overflow` 和 assistant `summary=true`，
再检查受控 Provider 实际收到的后续普通模型请求：完整 instructions/Bootstrap 存在，原生摘要已被消费。
摘要生成请求使用 Kilo 自己的提示；本次不要求给摘要请求额外拼接 Rovai Bootstrap。
Core 还核对摘要不作为公开主代理正文发布、自动压缩不重启 Host，以及重启后恢复同一 Session/摘要。

这是官方 CLI、真实协议与受控 Provider 的功能验收；Token 用量和超限响应由夹具控制，
不宣称真实付费模型自然消耗了 110,000 tokens，也不评估摘要的语义质量或所有配置阈值。

原生 7.8.27 在 `rovai-kilo-auto-native-pyc0bhmr` 通过两条自动路径，分别产生一个真实 summary，
`auto=1`，overflow 场景另有 `overflow=1`；后续普通请求均保留更新后的 instructions。
冷恢复保留自动摘要，两个原生 Host 均正常清理。

生产 Core/CLI 在 `rovai-kilo-auto-verified-wt4w11rg` 完成 **30 个 Run：28 成功、2 主动取消**。
阈值与 overflow 各产生一个原生自动 summary，压缩后的普通请求逐字收到当前完整 Bootstrap；
两个 Run 各只有一条 KILO_CORE_PUBLIC，摘要没有进入公开正文。同 Host 连续完成压缩及恢复；
重启 Core 后换新 Host、恢复同一 Session，并在实际 Provider 请求中保留自动摘要。
原 Steer 三轮复用、CLI lease、取消、文件/输出与无 Node MCP 场景均继续通过。
Core、Runtime 和隔离运行文件正常清理。
[白名单证据](../../research/kilo-runtime/automatic-compaction-7.8.27-macos-arm64.json)保留结果与关联 ID，不发布原始模型输入。

## 模型选项：原生能力与当前目录范围

Kilo 单次 `configOptions` 只报告临时 Session 当前所选模型的 `effort`，不在每个模型条目内提供完整 variants。
但官方 `session/set_config_option(configId=model)` 会切换模型并返回新模型的 configOptions，
因此可以在临时会话里继续查询其他模型，无需生成请求或改用户全局默认模型。

上述原生 probe 使用两个配置不同 variants 的受控模型完成：

| 操作 | 实际原生结果 |
| --- | --- |
| 初始 local-model | effort 选项 low/high |
| 切到 local-other | effort 选项 medium/max |
| 设置 effort=max | 返回 currentValue=max |
| 恢复 local-model | effort 重新为 low/high |

这一组查询产生零个 Provider 生成请求。它证明逐模型选项发现与原生 setter，
不声明每个真实模型都有这些档位或相应 Provider 支持同样的生成参数。

当前 Rovai 的 Kilo 目录仍只保存临时探测会话当前模型的 effort；尚未逐模型收集。
因此其他模型的推理选项可能在选择器中缺失，属于当前目录发现范围，不应表述成 Kilo 原生无法提供。
MiniMax 的完整目录路径已尝试逐模型切换并收集，原生不能选中或返回不足的模型继续保持未知。
两段类似代码只是在“读取当前模型选项并填入目录”上相似，不证明两家上游能力相同。
本次不为消除几行重复而改变模型选项发现、保存或 UI 行为。

## 权限具体是什么

Kilo 队员配置的 allow/ask/deny 是默认权限，具体工具和自定义 Agent 的原生规则继续生效。
例如原生已明确允许某个工具、拒绝另一个工具时，改变默认值不会直接抹掉这两条具体规则。
原生最后匹配规则生效；配置跨来源合并后默认 wildcard 可能排在具体规则后，所以使用最终 config 回调调整顺序。

Claude 通过 permission-mode 和原生工具禁用入口；OpenCode 按现有语义应用默认规则，
并显式保留 Shell/Skill 允许及 build/plan 设置。Kilo 则保留具体原生规则，仅重设默认值与 question deny。
局部递归保序与 8 行回调是为实现这个合并语义，审批仍由原生和共享 ACP 路径拥有。
执行覆盖 KILO_PURE=false 的行为与原生插件接口依赖保持，不增加权限求值器、审批层或加载校验。

## 自动验收中发现的共享 PID 竞态

首个 Core fixture `rovai-kilo-auto-core-z49baeoz` 在 Provider 首次请求前报告 Runtime startup could not commit。
启动登记会同步读取 ACP Host PID；旧实现用 child.try_lock，监视器或清理持锁时返回 None。
原 TRAE warm/Fleet owner 增加确定性反例：持有 child 锁时读取同一 Host PID，旧实现稳定得到 None，修正后得到原 PID。
根 PID 在成功 spawn 后固定保存，不依赖进程监视锁；没有增加重试、轮询、进程管理器或新 Rust 测试函数。
首个 fixture 的错误没有细分 health/ownership 分支，不能把它描述成该次失败根因已被完整日志证明。

后续 `rovai-kilo-auto-fixed-3xh43wzt` 已经过启动及原有 26 个 Run，到自动摘要请求时发现夹具分流错误：
摘要包含历史任务文本，但不提供工具，旧脚本仍尝试派发 task 并返回 500。
修正为只在提供工具的普通生成请求派发脚本工具；这是夹具修复，不是 Kilo 自动压缩失败。

## 最终门禁与范围

`cargo test --workspace` **484 passed、1 项既有 ignored**；原 TRAE warm/Fleet、active-input receipt、
leader-exit extended owners 及平台 evidence revision owners 通过。PID owner 在旧实现得到 None，修正后保留根 PID。
`TZ=UTC pnpm test` 为 Renderer **3193 passed / 2 skipped**、Node **377 passed / 2 skipped**；
`pnpm typecheck`、`pnpm build:desktop`、Cargo format、两个 Node 入口的语法与 `git diff --check` 通过。
`pnpm docs:test` 10 项、`pnpm docs:check` 与
`DOCS_BASE_REF=958784f6e17fc32d8b2753d7f14fd6122dceea9d pnpm docs:check:ci` 通过。

只实跑官方 7.8.27、macOS arm64 与隔离数据；本轮没有付费模型或开发 App 人工点击验收，
没有扩大其他平台/版本资格。生产行为仅修共享 ACP 的固定进程身份读取，不改 Kilo 权限或模型选项目录策略。

官方原生依据固定在 `03a6f07d053cd7e6aa88fa1e258e93510335259f`：
[模型 configOptions](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/config-option.ts)、
[自动阈值](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/kilocode/session/overflow.ts)、
[原生 prompt 收口](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/session/prompt.ts)。
