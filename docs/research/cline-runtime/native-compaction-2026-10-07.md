---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: verified-with-limitations
observed_version: 3.0.65
observed_platform: macos-arm64
last_updated: 2026-10-07
---

# Cline 零干预原生 Compaction：真实高水位与 Overflow 验收

**结论：C — `native_compaction_not_observed`。** 正式 `cline --acp` 接线下，同一个 Native
Session 的成功请求 input usage 达到 **918,618 tokens**；第 42 批发生真实 context overflow，
没有观察到原生 compaction 或成功恢复。正常关闭并重开隔离 App 后仍加载同一 Session，
简短身份查询再次 overflow。没有把失败、Session 重建或模型总结文字计为压缩。

本记录响应 User 消息 `4517da9f-d1c9-4898-ab06-e329d2a98e56`。测试时间为
2026-10-07 00:42–01:16（Asia/Shanghai；原始证据用 2026-10-06 UTC）。
这是本组合的一次真实负向验收，不是对所有 Cline 版本、Provider 或运行入口的能力断言。

User 随后要求“再把上限用满试试”；[追加满长输入复测](#追加满长输入复测user-消息-68)仍得到真实
Provider overflow，无原生 compaction，没有更高的成功 usage。

## 固定环境与约束

| 项目 | 固定值 |
| --- | --- |
| Rovai checkout | `9faf819d5e130295c37de70374568a740504d2f0`；该 checkout 的 Runtime 实现最后修改于 `be9bdd3c` |
| Cline | 官方 CLI **3.0.65**；[上游固定提交](https://github.com/cline/cline/tree/9131e36429314ea614491bf749678adbacb3d3cb) `9131e36429314ea614491bf749678adbacb3d3cb` |
| Provider / Model | 沿用已有 sub2api BYOK，Cline 原生 `openai-compatible` / `gpt-6-sol` |
| 原生模型目录窗口 | **272,000**，测试前后未修改；它不是本次实验证明的 Provider 硬上限 |
| 入口 | 现有隔离开发包的正常 `thread.messages.send` → Rovai Run → 官方 `cline --acp`；队员叮叮 `agent_1` |
| Native Session | `1791217949748_FrXN__cli` |
| Conversation | `74e30826-f072-4773-b2f1-054ad5e70955` |
| Binding / generation | `301e9573-3a00-4ee3-b84e-7150067f5128` / **13**，全程不变 |
| Host | 高水位阶段 `a1af7dec-9f76-4b87-a89c-ad8e5288e80a`；冷恢复新 Host `ba84a8d3-d4a9-470a-9468-dd22743c0c73` |

保持现有 Session、Fleet、权限、MCP、System Rule 与 observer。没有发送 `/compact`，没有
修改上游源码或可执行文件，没有安装测试触发 hook，没有增加 Rovai compaction/retry，没有
删除历史、替换 Session 或调小窗口。没有调用失败 Run 的手动重试。日常 App / userData 未参与。

`rovai-host` SHA-256 为 `c032615948b76f462165f416846dab2a14fc4242f783fcf03599ed968eb307e4`；
Cline 可执行文件 SHA-256 为 `c23a6dc7796a4bb04f6ab0804576a353bc3360b2bac1b2fb16236dd0efae360e`。
可执行文件、wrapper、providers/models/MCP 配置和生产 Rule/observer 的前后摘要均一致，完整值见证据 JSON。

## 方法及观测边界

1. 沿用已验收的 Native Session，先植入早期标记 `ROSE66_729f813acb41`。真实模型通过
   `rovai send --public-only` 回复 **“叮叮：ROSE66_729f813acb41”**，公开消息及 Run 归属已核对。
2. 串行发送 42 批真实用户输入，每批约 32 KB 的不同合成数据，同 Session 持续积累。数据由
   `base64(sha512("rovai-cline-natural-context66:{round}:{index}"))`、每批 360 项拼接产生，
   无需文件读取或工具回填。要求模型保留数据、只发送该批 ACK，随后给出普通最终回复；没有请求总结或压缩。
3. 只读采集生产 observer 的原始数值事件、Core Run/Binding/Context 行，以及 Cline 自有
   session 文件的消息数量、成功 assistant metrics、文件名和摘要。公开证据不含完整 history、
   凭据、请求 headers 或无关 Prompt。合成输入仅发布长度与摘要。
4. 第 42 批 overflow 后停止加长输入。确认没有活动 Run，正常退出隔离 App，核对旧所属进程
   全部退出，再用同一 userData 重开。发送不含完整早期标记答案的普通身份查询，检查真实冷恢复。

数值 observer 与仓库生产文件相同，只读取生命周期、`afterModel` 和原生 `status-notice`。
它不修改 Prompt、工具、审批、模型结果，也不调用 compaction。System Rule 只返回目标 Session
的冻结 Bootstrap。42 批加冷恢复共 **43 个原生 Run、170 条 observer 记录**，每个 Run 的
`seq` 均完整连续；文件轮询的收集顺序可能是 `1,2,4,3`，应按原生 `seq` 还原，不能按文件枚举
顺序推断事件先后。起始标记轮使用原生持久记录和产品公开消息佐证，没有混算进这 170 条记录。

**usage 是真实 Cline 原生 assistant metrics / `afterModel` 所记录的 Provider 用量，不是
本地字符估算；它也不是逐个底层 HTTP 尝试的 wire 日志。** 尤其第一批发送 ACK 后出现
`Model returned empty response`：成功持久消息为 31,745 input tokens，失败 completion 的
observer 报告 95,586。后者可能包含原生内部尝试的聚合，不能用作单请求上下文水位，已排除。
随后只是发送新的独立数据批次，没有重试该失败 Run；该负例保留在证据中。

## Threshold 与 Overflow 结果

每批成功模型响应的全部 input/output/cache 数值及 request/message ID 见证据 JSON 的
`rounds[].newMetrics` 和 `observerCorrelation.models`。以下仅列水位节点：

| 批次 | 最后成功请求 input tokens | 原生消息数（轮后） | 结果 |
| --- | ---: | ---: | --- |
| 起始标记 | 9,711 | 44 | 身份与标记正确 |
| 1 | 31,745 | 48 | ACK 已发送，后续 empty response；95,586 聚合值排除 |
| 10 | 231,649 | 84 | 成功，无 compaction |
| 11 | 253,796 | 88 | 接近配置窗口，无 compaction |
| 12 | 275,918 | 92 | 超过配置窗口仍成功，无 compaction |
| 14 | 320,176 | 100 | 成功，无 compaction |
| 23 | 519,799 | 136 | 成功，无 compaction |
| 32 | 719,167 | 172 | 成功，无 compaction |
| 39 | 874,339 | 200 | 成功，无 compaction |
| 40 | 896,424 | 204 | 成功，无 compaction |
| 41 | **918,618** | **208** | 最高成功水位，无 compaction |
| 42 | 未返回成功 usage | **210** | 真实 overflow，Run failed |
| 冷恢复查询 | 未返回成功 usage | **212** | 同 Session 再次 overflow，Run failed |

配置目录的 272,000 分母没有调大。实测已超过此值，Core 后续成功轮将矛盾的窗口投影为未知；
不能用这个配置值计算一个看似可信的超限百分比，也不能根据失败轮估算精确 Provider 上限。
918,618 是最后一次成功请求的真实输入量，**不是失败请求的输入量**。

第 42 批 Run `853d8ada-108d-4adb-89dd-74613df1f663`，UTC
`17:02:39.527610` 开始、`17:04:10.287252` 失败；上游返回：

```text
Your input exceeds the context window of this model. Please adjust your input and try again.
```

对应原生 `agent_error` 为 iteration 1；observer 是 `run_started → model_completed →
run_finished(failed)`。这里的 `model_completed` **requestId 为 null、metrics 为空**，是错误
路径的记录，不是一次成功模型响应。没有紧接着的成功生成。原生消息从 208 增至 210，没有缩短。

| 原生事件类型 | started | completed | skipped |
| --- | ---: | ---: | ---: |
| `manual_compaction` | 0 | 0 | 0 |
| `auto_compaction` | 0 | 0 | 0 |
| `overflow_recovery_compaction` | 0 | 0 | 0 |

`tokensBefore/tokensAfter/messagesBefore/messagesAfter` 的 compaction 事件字段均**未出现**，
不是观测到零 token 压缩。Core `native_session_compaction_observation` 无记录；逐轮原生目录
只有原来的 `.json` 和 `.messages.json`，未出现 compaction sidecar。没有以未发送配置的源码
判断代替此处真实的高水位与 overflow 证据。

## Retry、Bootstrap、身份与 Cold resume

- **自动 retry：没有观察到成功的原生 compact + retry 恢复。** Core `automatic_retry_count=0`。
  现有 observer 不记录失败 HTTP 请求的逐次开始/结束，故“overflow 后是否另发底层 HTTP 请求”
  及其次数保持 **unknown**，不能写成 0。只读网络包观察需要额外管理员授权；本轮没有进行抓包，
  也没有换代理、修改 Provider URL 或插入新 hook 来补这个观测缺口。
- **Bootstrap：配置与绑定保持。** 冷恢复新 Host 的生产 Rule/observer 摘要一致，目标 Session 的
  B 为 3,740 bytes，SHA-256 `7bd7d75a1896a384a7567c19f3aac05f224561469f19c61cca0c1595eb1c99a5`，
  包含正确 `MEMBER_IDENTITY` 和叮叮身份，Binding compatibility/charter 摘要保持。
  这属于绑定及文件证据，**不是本轮逐请求 System 内容抓取**。原生持久 `system_prompt` 仅含
  Cline 基础 System，不能据其不含动态 B 判定 Rule 缺失。此前真实出站 System B 恰好一次的
  [独立验收](../runtime-monitoring/command-cline-native-system-2026-10-06.md)仍单独保留，没有冒充本轮观测。
- **身份与早期标记：** 起始轮回答正确；overflow 后和 cold 的查询没有成功生成，无法再次验证答案。
  没有发生 compaction，故“压缩后下一轮 System/身份保持”与“压缩后的连续性”为 **不适用/未验证**。
- **Cold：精确 Session 加载保持，继续生成失败。** 正常退出旧 App PID 58102 后，旧 Cline
  所属进程存活数为 0；新 App PID 2327、新 Host 按同一 SID 运行。Binding、generation 13、
  effective config digest 均不变，没有新建 Session。新 Run
  `7856a403-0e22-4711-bb74-66d493037245` 在 UTC `17:15:17.711944–17:16:58.810928`
  再次 overflow，无 compaction，无成功响应；消息 210→212。不能把这项记为“冷恢复后可继续工作”。

## 结论与证据

| 分类 | 结论 |
| --- | --- |
| A `threshold_auto_compaction_verified` | **未通过**；接近配置窗口并继续到更高真实水位，未观察到 auto compaction |
| B `overflow_recovery_compaction_verified` | **未通过**；真实 overflow 后未观察到 compact + retry 成功链路 |
| C `native_compaction_not_observed` | **本轮采用**；高水位、真实 overflow、原生事件/持久状态及冷恢复结果一致 |

本次只增加研究记录，不修改生产接线，不启用另一种压缩机制，也不提升 Runtime 准入等级。
后续若要证明底层 HTTP retry 的精确次数，需要单独补充请求级只读观察；不能由当前 Run 终态代推。

- [完整脱敏证据 JSON](native-compaction-2026-10-07.evidence.json)：固定版本与摘要、每轮 Run/Session、
  所有成功 usage、前后原生文件摘要/消息数、错误、Bootstrap 与 cold 结果。
- [生产 observer 原始数值事件 JSONL](native-compaction-2026-10-07.observer.jsonl)：保留原始字段，
  仅增加来源 `hostId`，不含凭据、headers、完整 Prompt/history。
- [生产 observer](../../../crates/rovai-core/src/cline/observer.js) 与
  [生产 System Rule](../../../crates/rovai-core/src/cline/bootstrap.js)：本轮未改动。

交付检查：43 组原生序列完整性、逐轮水位、Session/Binding/config 摘要、原生文件清单及公开
消息归属断言通过；4 个公开变更文件与实际凭据值的匹配为零。`pnpm docs:test` 10 项通过，
`pnpm docs:check`、以 `9faf819d5e130295c37de70374568a740504d2f0` 为 base 的
`pnpm docs:check:ci` 及 `git diff --check` 通过。本轮没有生产代码改动，未重复运行无关 Runtime 的全量测试。

## 追加满长输入复测（User 消息 68）

消息 `840d3b4e-9cad-4d00-a251-cf2699a48baf` 请求继续把上限用满。本轮 checkout 为
`2cb46da949fa007fed4a787f00a9b62e50474426`，App/CLI 二进制、模型/Provider/MCP 配置、生产
Rule/observer 与前轮摘要完全一致。没有调整 context window 或输出上限，没有换模型、回滚原生
历史、创建替代 Session，也没有添加压缩或 retry。

先重新读取同一 Provider 的模型目录：普通 `/models` 返回 17 项，不含精确模型；带
`client_version=0.157.1` 的元数据入口仍报告 `gpt-6-sol` 的 `context_window=272000`、
`max_context_window=872000`。前轮成功 usage 已高于这两个目录值，故没有把任何一个值当作
已证明的硬上限，或据此修改配置以“填满”显示圆环。

通过原开发包正常发送 **32,700 bytes** 的新增合成数据，接近单条输入长度上限；内容要求只回 ACK，
没有要求压缩。原 Session 的既有长历史完整保留。真实结果：

| 项目 | 结果 |
| --- | --- |
| Run | `f7fb243f-6ec8-4997-b176-03d995840acb` |
| 起止 UTC | `2026-10-07T04:04:05.184176+00:00` → `04:07:38.437350+00:00`，约 213 秒 |
| 终态 | `failed`；再次返回 `Your input exceeds the context window of this model` |
| Session / Binding | 仍为 `1791217949748_FrXN__cli` / `301e9573-3a00-4ee3-b84e-7150067f5128`，generation 13 |
| Host | 本轮新 Host `9bca9301-08c6-40c3-b5ea-f98bbcf0f3b9` 加载原 Session，没有替换 Session |
| 原生消息数 | **212 → 214**，没有缩短，没有 compaction sidecar |
| observer | 完整 seq 1→2→3：started、空 metrics/null requestId 的错误 completion、finished(failed)；compaction **0** |
| 成功生成与公开回复 | **0**；没有新的成功 usage，最后成功水位仍为 **918,618** |
| 自动恢复 | 未观察到 compact + retry 成功；Core retry 0；底层 HTTP 尝试次数仍未知 |

这次追加再次确认：当前会话继续增加输入后，Provider 拒绝生成；不能将一个失败请求补成更高
usage 或声称成功使用了 1M tokens。**原生 compaction 分类仍为 C。** 原生配置未显式填写
输出 token 上限；由于没有抓取逐请求参数，具体输出预留量及其是否决定拒绝点仍未知，不用猜测
替代证据。独立的[追加复测证据](native-compaction-full-limit-2026-10-07.evidence.json)保留目录数值、
Run、原始 observer 字段、原生错误、前后消息/文件摘要和配置完整性检查。
