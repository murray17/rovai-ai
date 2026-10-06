---
document_type: runtime-research
authority: research-evidence-only
status: verified-with-limitations
last_updated: 2026-10-06
---

# Command 原生 MCP 与 Cline System：追加验收及完整对照

User 消息 `f80961bc-8447-42f1-83e0-a1f02b8107b9` 要求继续原生 MCP、尽可能验收并对比其他 Runtime。
基线 `9a595505`；macOS arm64，Command Code 1.74.1、Cline 3.0.65，隔离 sub2api/gpt-6-sol 真实调用。
本轮查询 npm 当前版本为 Command 1.74.1 / Cline 3.0.68；没有修改全局安装或补丁修改上游。
已更新隔离开发包；日常 App、userData、Skill Library 和原生配置未修改。

本记录覆盖[10 月 5 日矩阵](command-cline-checklist-2026-10-05.md)中 Cline first_payload、插件缺失门禁
阻挡实施及 Command Session MCP 交付的旧结论；[故障恢复矩阵](command-cline-fault-recovery-2026-10-05.md)
继续有效，本轮没有重复运行全部 SIGKILL/网络/压力组合。两者仍为 Preview，未宣称 First-Class。
脱敏字段与 Run/Binding 对照见[本轮证据](command-cline-native-system-2026-10-06.evidence.json)。

## 实施变化

- Command 分配的 MCP 合入 Host 私有原生 `.commandcode/mcp.json`，不再重复传 ACP `mcpServers`。
  原生账号、模型、Session、Skill 和 Mod 仍使用原生路径；原生同名定义整体优先，Assignment 明确标记跳过。
  更新/撤销改变共享 Host compatibility。固定 argv launcher 保留 stdio cwd；env/headers 防止原生二次变量展开。
  无效的原生 MCP JSON 结构返回配置错误，不因索引错误而 panic。
- Cline 使用官方 Rule 将目标 Binding 的冻结 B 放入 System，普通 user 文本只有 P。每次 setup 捕获独立 Session；
  不用全局 active B 指针。保持 B 字节、预算、摘要及不可改写绑定；数值 observer 不变。
  旧交付 profile 经现有 fence 旋转，新 profile 的 warm/cold 保留绑定。
- Cline 停用 user 层 Bootstrap 补发，启动 reconciliation 仍保留以废止旧 detector epoch。数值压缩事件解析保留，
  不广告原生压缩能力。User 已明确不以故意移除受管 Plugin 的极端反例阻挡正常 Rule 交付。

## 真实验收

| 场景 | 结果与证据 |
| --- | --- |
| Cline System A→B→A | 同 PID 1732；beforeModel 观察 A/B 的 B 各恰好一次、user 消息中为零；A 回切仍记住 MEMORY_A60，无 B 串入 |
| Cline System exact cold | 新 PID 2057，原 Session ID 保留，System B 一次、user B 零，身份与早期记忆均正确 |
| 新包首次 / warm / cold | 两位队员通过普通发送、原生工具和 bundled CLI 发公开回帖；cold 前后各自 Session/Binding/generation 不变。Cline generation 13、Command 18；两者持久 delivery_mode 均为 managed_system_prompt |
| 文件读取与编辑 | 两者用原生工具创建/读取/替换/读回，before60→after60，keep60 保留；沿现有 reported_mutation 展示。在隔离新包实际点击两者的文件变化入口，均打开 +1/−1 面板并显示删除 before60、新增 after60。Command 精确包含末尾换行；Cline apply_patch 未补末尾换行，模型声称“有换行”与实际字节不符，未据回复冒领字节级通过 |
| Command 原生 stdio | 实际 native server 启动，cwd 等于分配目录；`${literal60}` 作为字面值到达服务器，未被二次展开；schema 被发现 |
| Command 原生 HTTP | initialize、tools/list 均到达本机服务器；测试请求头含字面 `${literal60}`，检查全为 true |
| 原生同名优先 | 原生 NATIVE_SAME60 启动；同名 Rovai Assignment 为 skipped_native_name_conflict；ASSIGNED_MUST_NOT_START60 未启动 |
| 原生配置更新 | 后续 Host 启动标记由 NATIVE60_V1 变为 NATIVE60_V2；普通执行和公开发送成功 |
| 撤销与关闭 | 后续 Command Run 的两个 Assignment 均为 unassigned；清理后的两者新 Run 的 MCP exposure 均为空。旧配置的空闲 Host 仍按共享 30 分钟 TTL 保留，未供新配置复用；正常退出隔离 App 后，Host 及测试 MCP 子进程均为零 |
| Command MCP 真实调用 | **未通过**：独立官方 ACP 探针和 packaged App 均搜索到 schema，但真正工具调用为零。App 模型还重复搜索，保留为模型未遵守次数限制，不能冒称调用成功 |
| 同服务器 Cline 正向对照 | 撤销 Command 分配后只分配给 Cline；stdio tools/call 一次、HTTP tools/call 一次，真实返回 NATIVE60_V2:CLINE_NATIVE60 与 HTTP60:CLINE_NATIVE60；header 检查通过 |
| Context / Usage | 两者 Context used/window 持久化、window=272000（来自精确模型原生配置）；四 token 桶均可采集。Cline 本轮实际有 reasoning；Command reasoning 和两者可归属于 Run 的原生费用仍未知 |

本轮产品包共 15 个 Run 到达 succeeded，并各有一次真实公开发送；前 11 个覆盖主矩阵，配置错误处理
修正和兼容性登记摘要同步后分别重新打包，两者各完成两次追加身份与发送复验。三版包的 Host SHA-256
均记录在证据中。这个终态仅证明执行和发送完成，
不把 Command MCP 零调用或 Cline 末尾换行反例计为功能通过。最终清理恢复了隔离原生 MCP 配置，
由此触发 Command 配置 fence，generation 从 18 变为 19；这次有意配置变化不属于前述 warm/cold 连续性测试。
隔离开发包已重新打开，测试成员配置保留。

Cline 文件末尾换行反例来自实际 apply_patch，不是 Rovai 擅自改写原文件。本轮再次说明编辑输入只能作为
原生报告片段，不能从模型最终文案或拟议 patch 推出 exact file state；现行 `reported_mutation` 边界保持正确。

Command 的问题并非“官方 ACP 不支持 MCP 注入”：[官方 MCP 文档](https://commandcode.ai/docs/mcp)
支持原生配置，而[官方 ACP 文档](https://commandcode.ai/docs/acp)亦有客户端 MCP。1.74.1 发布代码对
`sub2api/gpt-6-sol` 的 `supportsDeferredTools` 返回 true，`createToolCatalog.schemas` 排除 deferred MCP；
`search_tools` 返回 schema 文本，但不会把这些工具加入后续模型请求的 schema 集合。当前 BYOK 配置没有
已验证的关闭该策略的接口。该定位有源码与真实零调用对照；不把结论外推为所有模型都无法调用 MCP。
没有伪装模型 ID、用 shell 替代工具、覆盖 Provider 的 tools 数组或另建代理 Host 来制造通过。

随后按 User 消息 64 补齐[请求级 A/B 对照](../command-code-runtime/mcp-delivery-ab-2026-10-06.md)：
同版本、同模型的原生/ACP × stdio/HTTP 四组共 28 次出站请求，24 次已含搜索 schema 文本，目标工具在 callable tools 中始终为零。
独立 Provider 正向对照实际调用成功，但不算 Command ACP 验收。保持当前生产接线并准备上游复现；不再仅以源码推断替代请求证据。

Cline 的正常 Rule 加载已完成，但[固定版本 ACP](https://github.com/cline/cline/blob/cli-v3.0.65/apps/cli/src/acp/acpAgent.ts)
仍未将 compaction.enabled 传入 SDK；此前全局设置和真实预算探针未触发压缩。System Rule 不会启用该引擎。
没有把普通 `/compact` 生成回复当压缩，也未把旧的缺失插件反例继续当作本轮待授权项。

## 按 Checklist 的 14 轴比较

“其他 Runtime”引用现有代码及既有证据，本轮未逐个重新实测。共享合同相同不等于每种 Runtime 每字段均已通过。

| 能力轴 | 其他 Runtime 的代表实现 / 差异 | Command Code | Cline |
| --- | --- | --- | --- |
| Auth / Provider / Model | 原生账号/BYOK；显式选择以原生目录为准 | 原生默认 BYOK 可用；自定义 ID 未被 ACP picker 接受，因此 runtime-default 不发 set_model | 自身 BYOK 可用；仍需完整显式模型/凭据轮换矩阵 |
| Host / Fleet / LRU | Codex/ACP/Pi 可常驻；Claude/Antigravity 的进程策略不同 | 共享 ACP 常驻、多 Session、warm 已验 | 同左；完整并发/LRU 压力仍未验 |
| Native Session / Continuation | 都要求完整 ID、准确恢复、失败记录连续性丢失 | exact warm/cold 已验；额外用官方 session/list 防止上游错误 ID 假成功 | exact warm/cold 已验；原生错误 ID 拒绝已验 |
| Bootstrap / Context | Codex/Claude/Grok native append；Pi/DSH managed System；OpenCode/Copilot 等 first_payload | managed System Mod；有 required readiness/绑定门禁 | **本轮补齐 managed System Rule**；正常加载可靠，未新增 required-plugin 门禁 |
| Compaction continuity | 各原生引擎不同；System 保护或按完成信号补发 | manual/threshold/随后 cold 已验；overflow/retry、产品进度未全验 | **上游 ACP 未启用引擎**；System Rule 已接，不能声称压缩通过 |
| Skills | 工具箱索引共享，原生扫描路径各异 | 原生 .commandcode/skills 发现/读取/撤销已有证据 | 原生发现/读取/撤销已有证据；两者完整热更新/并发同名矩阵未全验 |
| External MCP | Codex/Claude/各 ACP 的交付通道及同名策略不同；Pi 明确不支持 External MCP | **原生私有配置**；发现/更新/撤销/同名边界已接；当前 BYOK 实际调用未过 | 原生私有配置；stdio/HTTP 实际调用已过，Rovai 同名定义优先 |
| Tool / Action / Output | 复用 Command、文件路径和分级 Diff；上游证据精度不同 | read/edit ±、正常/空/大输出已有证据；结构化非零 exit 不足 | read/edit ±、失败、非零已有证据；原生 patch 不保证完整字节或末尾换行 |
| Narration / Final / Missing-Send | 显式 send、合格 missing-send 恢复与公开去重共享 | 均已接、主路径及故障后终态已有证据 | 同左；模型结果声明不能代替实际工具验证 |
| Permission / Approval / Workspace | 原生权限权威、共享审批展示和响应 | 五种原生 mode，allow/deny/cancel 与动态切换已验 | allow/deny/cancel、manual→auto 刷新已验；更多选项组合未全验 |
| Built-in rovai CLI | 相同租约/身份和精确发送归属 | 新包真实首次、warm、cold 显式发送通过 | 同左；全 operation 矩阵仍未逐项重跑 |
| Usage / Cache / Cost | Codex/Claude 等原生字段各不相同，费用分原生/估算 | Prompt 四桶 + ACP Session Gauge；reasoning/Run 原生费用未知 | Plugin 根调用四桶、可选 reasoning、精确配置窗口；费用未知 |
| Retry / Queue / Cancel / Cleanup | 使用共享恢复与进程 owner；平台能力各异 | 已验 Runtime/Core/App 强杀、无迟到写入、排队恢复；本轮正常重启复验 | 同左；完整网络/过载/压力组合、不可观测后代仍有限制 |
| Ready / Version / Platform | 机器 Ready 与逐平台资格独立，不能用安装数量推导完整行为资格 | macOS arm64 **Preview**；其余未取得资格 | macOS arm64 **Preview**；其余未取得资格 |

输入位置的全量分组直接来自 `charter_delivery_mode_for_adapter`：native append 为 Codex、Claude、Grok；
managed System 为 Pi、DeepSeek Harness、Command、Cline；first_payload 为 OpenCode、Copilot、Antigravity、
Kiro、Qoder、ZCode、CodeBuddy、Qwen、TRAE、Cursor、Kimi。没有为了外观统一而掩盖真实原生差异。

## 九条 Golden Flow 与收口范围

| Flow | 当前已验 | 尚未闭合 |
| --- | --- | --- |
| Discovery / Setup | 隔离包、真实原生版本、自身 BYOK、成员选择 | 全部登录/凭据轮换、其他平台 |
| First Run | 两者 System 主路径、原生工具、显式发送 | 全模型/原生扩展组合 |
| Warm Host | 原生 A/B/A、新包 warm、权限刷新 | 大量 Session / LRU 压力 |
| Cold Resume | 新包 App/Core 重启保留 Session/Binding/generation | 全网络/协议故障组合 |
| Context / Compaction | 两者 used/window；Command manual/threshold/cold | Cline ACP 引擎、Command overflow/retry/产品进度 |
| Skill / MCP Projection | 原生发现、配置更新/撤销/同名；Cline 实际工具调用 | Command 当前 BYOK deferred tools 调用；完整热更新压力 |
| Safety / Output | 真实 read/edit/审批/失败/取消/输出及可审阅片段 | 全权限组合/大输出边界，原生字段缺口 |
| Monitoring | 四桶、缓存、272k、Cline reasoning、重启持久化 | 缺失 Run 原生费用，更多 retry/compaction 计量组合 |
| Shutdown / Recovery | 既有强杀矩阵及本轮正常关闭/重启 | 所有系统平台与高并发故障组合 |

## 验证门禁

本轮 Rust workspace 默认 **456 通过、2 ignored**；ACP extended **69 通过、2 ignored**；Cline owner 2、
compaction owner 3、交付 mode owner 1、平台证据 owner 5、Node System/observer/Mod 3 均通过。TypeScript typecheck、
macOS arm64 打包及 ad-hoc 签名检查通过。最终文档门禁和工作区状态记录在同名证据文件。
