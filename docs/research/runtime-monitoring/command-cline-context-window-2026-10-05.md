---
document_type: runtime-research
authority: research-evidence-only
status: verified-with-limitations
last_updated: 2026-10-05
---

# Command Code / Cline 上下文窗口补采

User 消息 `4ce38f7b-f00a-4dd5-b3e5-fb2fd29ebf00` 要求再次尝试取得 Context。沿分支
`rovai/mission/052`、基线 `36087342`。此前“当前 BYOK 未提供窗口”的调查不完整：只查询了普通
`/models`，遗漏同一服务的版本化模型元数据入口。旧记录保留为当时证据，本记录更正当前结论。

## 真实 Provider 返回

使用已有隔离验收配置中的同一 sub2api endpoint/key；没有换账号、使用日常 App 配置或修改远端服务。
三个只读请求均为 HTTP 200：

| 入口 | 返回 | 精确 gpt-6-sol |
| --- | --- | --- |
| `/v1/models`（当前 base URL 下的 `/models`） | OpenAI 风格 `data`，17 项 | 不在列表，无窗口字段 |
| `/v1/models?client_version=0.157.1` | `models` 元数据，8 项 | `context_window=272000`、`max_context_window=872000` |
| `/backend-api/codex/models?client_version=0.157.1` | 同形元数据，8 项 | 同上，两入口精确条目一致 |

该差异与 [sub2api 官方路由](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/server/routes/gateway.go)
一致：带 client_version 的模型发现可选择元数据格式。这里的 `0.157.1` 是本次探针的请求参数，
不是 Cline 版本或 Rovai 新增的版本准入门槛。
只保存数字、模型身份和字段名，没有保存模型指令、账号、API Key 或 Provider URL。

272000 是该目录为精确模型报告的默认窗口；872000 是独立的最大可选窗口，不能直接当成当前分母。
本次没有发送超长请求测服务端拒绝阈值，也不宣称以模型回复验证了物理最大容量。

## Cline 实现与原生配置

Cline 3.0.65 的 [ModelInfo](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/shared/src/llms/model-info.ts)
与 [原生模型目录](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/core/src/services/providers/local-provider-registry.ts)
支持 `contextWindow`，但 ACP 模型列表只公开 id/name/description，afterModel 的 messageModelInfo
也不带窗口。本次将已核验的默认值写入**隔离验收** Cline `models.json` 的
`providers.openai-compatible.models.gpt-6-sol.contextWindow`；没有把此值硬编码进 Adapter。

observer v2 在 Host 创建时保存当前目录中显式、有效的 Provider/模型/窗口快照；afterModel 以根调用
真实 `modelInfo.provider/id` 精确匹配，连同 source 标记进入既有私有数字通道。省略、无效、其他模型、
其他 Provider 均不补分母；没有 input 的窗口可独立投影。原生文件变更沿既有配置摘要触发 Host/Binding
隔离，运行中的快照不偷偷读取新配置。不读取 Provider 网络、不估算窗口、不把压缩预算作为总窗口。

**Provider 查询与写入原生目录是本次人工核验配置步骤；产品没有新增自动远端模型发现。**
其他 BYOK 未配置窗口且没有原生字段时仍未知。此改动沿 Execution Metrics v7，不增加 Schema、
Renderer 字段、计费推断、Bootstrap 或 Dynamic Context 变化。

## 三次真实 App Run

保留开发包中的叮叮、芝士均为 Cline ACP / sub2api / gpt-6-sol。本轮均不调用工具，原生最终回答由
既有 Missing-Send 恢复为恰一条公开回复，三个 Run 均 succeeded。

| 用例 | AgentRun | 当前根调用 used | window | 实际界面 |
| --- | --- | ---: | ---: | --- |
| 芝士首次使用更新配置 | `9c31ec12-c07e-4df2-8b16-c1b432b19e98` | 3850 | 272000 | 3.9k / 272k，1.4% |
| 叮叮 | `fc0c3b49-52a3-4614-a613-e1bfd53725d3` | 3847 | 272000 | 3.8k / 272k，1.4% |
| 芝士 warm 续接 | `04125110-a738-459e-9659-2331d409b10f` | 4252 | 272000 | 4.3k / 272k，1.6% |

比率由同一观测的 used/window 计算，原生 nativeRatio 仍为空。原生配置变化后两位 Binding generation
从 1 升至 2，符合既有配置隔离；不把首次新配置运行说成旧绑定原样恢复。芝士前后两轮实际使用同一新
Binding。结束后正常退出并重启完整 App/Core，两行 Context、实际 Session/Binding、generation、
模型、配置摘要与数值完全一致；Renderer 重开仍显示 4.3k / 272k，原 Composer 草稿 `i` 保留。
本轮只证明字段、终态及重开；没有用短请求终态替代“prompt 尚未完成时采样”的独立资格证明。

## Command Code 复核

Command Code 1.66.0 的 [BYOK 配置](https://commandcode.ai/docs/byok)同样支持显式 `contextWindow`。
在独立 Probe Home 同步上述 272000 后，真实调用 `sub2api/gpt-6-sol` 成功，回复
`CONTEXT41_COMMAND_OK`，原生 input 12028 / output 9。NDJSON model_request_start/end 和
官方只读 Mod 观测仍没有窗口。

再以同一 UUID `e52e1a97-11da-4095-915d-da580912649a` 打开原生交互界面执行 `/context`，
实际显示 `12.6k / 272k · 259.4k remaining (estimated)`。与
[官方 Context 文档](https://commandcode.ai/docs/context)一致，恢复后的 used 标为本地估算，不能拿 12.6k
替换 Core 已采集的实际模型 input；272k 则证明此原生配置已用于窗口显示。
本次没有把终端文本抓取接进产品；Command Code 仍缺 Product Adapter，不能称其 Rovai App 圆环已通过。

## 验证与交付

`cargo test -p rovai-core --features extended-tests --lib cline::tests::` 两个既有 owner 通过；
`node --test scripts/lib/cline-observer.test.mjs` 通过。覆盖 Host 快照/配置变化、实际模型与 Provider 匹配、
window-only、无效/未知来源、私有字段及跨 Run 排除。macOS arm64 打包、ad-hoc 验签及文档通用门禁通过。
Rust workspace 455 passed / 2 ignored。未修改 Renderer 代码、未增加独立测试、未退役测试。

逐请求字段、三轮 Context/Usage、绑定与重开读回、原生 Command Code 观察及构建指纹见
[脱敏证据](command-cline-context-window-evidence-2026-10-05.json)。开发包保留此次 Cline 原生窗口配置，
日常 App/原生配置未改，既有编辑 Diff 与历史记录保留；此补采不构成两 Runtime 的 First-Class 准入。
