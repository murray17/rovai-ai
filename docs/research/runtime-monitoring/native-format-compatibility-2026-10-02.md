---
document_type: research
status: verified_with_limits
last_updated: 2026-10-02
---

# 原生格式兼容与五类 Runtime 补采

## 范围与结论

基线 `0ffafac710d41dde509e3ca1f4801e320251036a`，工作分支 `rovai/runtime-execution-metrics`。
用户要求移除指标专用 CLI 版本限制，保留 Rovai 自身的最低版本／平台资格。本次没有恢复输出测速、
增加数据库迁移或改变 Renderer 布局，也没有改变模型上下文、凭据或日常 App 数据。

所有 reader、ACP 数值解析与字段资格现在按实际格式、来源身份和计量语义判断；版本字符串为空、旧版、
新版不再单独阻断指标。Grok 等产品准入最低版本仍由 Runtime Launch 拥有。表中的版本只表示本机
实际测试对象，不能据此宣称所有历史／未来格式已完成实测。未知格式及缺失字段继续保留未知。

## 实测字段矩阵

本次五类均有健康原生调用。表中“已读回”表示原始来源 → 适配 → Core 归属 → 数据库 →
`monitoring.execution` 已逐项核对。同次真实调用的打包 App 显示未逐一验收，因此新来源不标为
完整 `verified_available`。独立生产 Renderer 回放已通过，不能替代这一缺口。
`raw_absent` 只表示本次指明来源未上报，
不代表 Runtime 在所有接入方式都没有此字段。

| Runtime / 本机版本 | Provider / 实际模型 | Run 原生用量 | 当前 Session Context | 到达时机与未决项 |
| --- | --- | --- | --- | --- |
| OpenCode 1.18.32 | sub2api / gpt-6.1-sol | Input、Output、Read、Write 已读回 | 最新调用 used 已读回；当前有效目录无 window，`raw_absent` | 原生 SQLite 的完成调用；本次 Write 明确为 0，正值仍仅有受控回归；显式有效窗口的既有真实闭环见上一轮 |
| CodeBuddy 2.133.1 | 已授权 sub2api / gpt-6.1-sol | Input、Output、Read 已读回；Write `raw_absent` | 最新调用 used 已读回；当前模型未列在原生窗口目录，window `raw_absent` | journal 逐调用；Read 有正值，也有单调用缺失，缺失保持部分观测；窗口匹配实现已测，当前自定义模型没有真实分母 |
| Kiro CLI 2.21.1 | 原生账号，Provider 未辨明 / auto（实际底层模型未知） | 当前 ACP 没有四项原生用量，`raw_absent`；其他可靠来源 `blocked_unverified` | 原生百分比 已读回；used/window `raw_absent` | `_kiro.dev/metadata`，交付确认前缓冲最新 Gauge；本次 prompt 终态确认后读回。比例不反推 token |
| TRAE CLI CN 0.120.52 | 原生账号，Provider 未辨明 / GLM-5.3 | 本地来源 Input、Output、Read 已读回；Write `raw_absent` | 当前 ACP / session 数值来源未给可靠 Gauge，`raw_absent`；其他来源 `blocked_unverified` | ACP 本身无 Usage；session journal 的完成 assistant 调用补采。不解析 `/context` 的人类可读输出 |
| Antigravity 1.2.14 | 原生账号，Provider 未辨明 / runtime-default（未返回明确模型） | Output、Read 已读回；Input 含缓存总量语义 `blocked_unverified`；Write `raw_absent` | 当前结构化来源无 Gauge，`raw_absent` | `stream-json` 的根 DONE step；终态 Usage 为 Session 累计，不认领为本 Run。只有普通终稿的旧通道不会凭正文估算 |

TRAE 原始 journal 与 Antigravity 结构化 step 以前属于 `present_not_mapped`，本次已接入。
Kiro 原生比例以前被生命周期 metadata 过滤，本次已从该过滤中分离。没有把原始有值但未映射的情况
描述成 Runtime 未上报。

## 原始字段与语义

- **OpenCode**：只读 `opencode.db` 当前根 Session、同 workspace 的完成 assistant message。
  `tokens.input + tokens.cache.read + tokens.cache.write` 三桶齐全才形成含缓存 Input；
  `tokens.output + tokens.reasoning` 只加一次。最新调用的输入三桶作为 used；有效窗口仍取原生 ACP size。
  真实失败样本留下 `error: UnknownError` 与初始化全零 tokens：该失败记录不作为数值观测，也不能把
  先前有效 Context 清成 0；同 Run 之前的完成调用继续保留。错误调用自身的非零用量语义未另行验证。
- **CodeBuddy**：`providerData.agent=cli`、Session、cwd、messageId 与记录类型共同准入；
  `rawUsage.prompt_tokens` 是含缓存输入，`completion_tokens` 已包含 reasoning，Read 只取明确
  `prompt_tokens_details.cached_tokens`。本地原生状态实现用最近根调用 inputTokens 表示占用；
  window 只取当前模型在 ACP `availableModels` 中的 `_meta.maxInputTokens`。不使用原生 cache
  creation helper 的默认 0，也不借用其他内置模型的窗口。pending 旧调用同样进入 resume baseline。
- **Kiro**：根 `_kiro.dev/metadata.params.contextUsagePercentage` 的有限 0–100 数字除以 100，
  写入独立 `nativeRatio`。负数、超过 100、字符串、子 Agent、失效 Session 均不能更新当前 Context。
  数字不变的新活动通知仍有接收序号；metadata 在公开 Evidence 之前丢弃。
- **TRAE**：平台 cache 下 `trae-cli/sessions/<nativeSessionId>/session.json` 校验 id/cwd，
  `events.jsonl` 校验 `branch=Trae CLI`、`agent_name=Trae CLI`、非空 agent_id、空 parent_tool_call_id
  及 assistant role。使用 `message.message.response_meta.usage` 的 `prompt_tokens`、
  `completion_tokens`、`prompt_token_details.cached_tokens`。正文与 reasoning 不进入数值 DTO。
  首次 prompt 可等待原生文件创建；一旦 journal 存在，必须有匹配元数据。拒绝符号链接、超大文件、
  文件替换／截断；已有调用只建立基线，400ms 有限尾读承接终态写入竞争。
- **Antigravity**：当前 input step 之后、同 conversation 的根 `DONE agent_response/checkpoint`，
  按 step index 去重。只通过私有 `runtime.antigravity.usage` 数值事件进入 Monitoring，公开 Evidence
  和 Renderer 不接收它。Output 取 output_tokens，thinking 是其分项；Read 取 cache_read_tokens。
  输入分类未确认齐全，不把缺失 Write 补 0 后合成 Input。原生 total_tokens 也不代表含缓存输入。

Antigravity 的 [官方 headless 协议](https://antigravity.google/docs/cli/headless/) 描述逐 step Usage，
并明确最终结果汇总整个 Session。本次同 Session 两次调用也确认 result.usage 是累计量；第二轮若
使用它，会把第一轮再次认领。实现只收新 step，终态汇总不加入。TRAE 使用的字段形状另与
[Eino schema](https://pkg.go.dev/github.com/cloudwego/eino/schema) 一致；实际字段与缺失语义以本机回包为证，
不从第三方库最新版本推测安装版本的行为。

## 健康执行与冷恢复读回

均由隔离 Core 通过产品 Runtime adapter 启动，不连接日常 Electron userData。任务包含多次工具调用，
原生账号和现有已授权配置被 Runtime 复用；未复制凭据到 fixture。以下为精确 token 数，`null` 保留未知。
每类两轮共用原生 Session，第一轮终态后停止隔离 Core，再冷启动读回并执行第二轮；两次 Run
绑定代次都为 1，第一轮持久投影在 Core 重启后保持不变。

| Runtime | Run | Input | Output | Read | Write | 最新 used / window |
| --- | --- | ---: | ---: | ---: | --- | --- |
| CodeBuddy | 1 | 66142 | 943 | 57344 | null | 22476 / null |
| CodeBuddy | 2 | 72061 | 536 | 46208（部分调用） | null | 24329 / null |
| OpenCode | 1 | 15921 | 625 | 0 | 0 | 8067 / null |
| OpenCode | 2 | 26683 | 495 | 15872 | 0 | 9122 / null |
| TRAE | 1 | 31566 | 494 | 23360 | null | null / null |
| TRAE | 2 | 50544 | 931 | 48768 | null | null / null |
| Antigravity | 1 | null | 698 | 24403 | null | null / null |
| Antigravity | 2 | null | 535 | 20320 | null | null / null |

Antigravity 第二轮原始终态累计 Output=1233、Read=44723，数据库本 Run 为 535 / 20320；
前后差额与第一轮一致，未重复计入。CodeBuddy 第二轮一个调用没有 Read，46208 只代表已观测分类，
没有将缺失调用当作明确零。

Kiro 有两组证据：同 Session 两 Run 冷恢复的比例分别为 `0.01439199924468994` 与
`0.015597000122070312`，第一轮读回恢复一致；独立完整 raw witness 健康调用最终比例为
`0.015921000242233276`，与原始 `1.5921000242233276%` 对应。前一组观察 wrapper 未接管原生启动，
没有独立原始帧，因此不能把它当作同一次完整 raw witness；后一组有 9 条脱敏 metadata 数值帧。
早期 180 秒超时长任务不计为健康验收。

### 可复现证据

[round8 fixture](fixtures/round8-native-format-compatibility.json) 保留真实版本、模型、Core digest、
必要的脱敏原始字段、每 Run 实际读回和 Session 最新投影。Session、Run、workspace、call、root Agent
身份均替换为别名；无正文、思考、工具参数、服务地址、凭据或内容 hash。不同二进制 digest 是调查
逐步接入后的实际产物，不能合并描述成同一候选包。

运行：

```bash
ROVAI_METRICS_CORE=<隔离候选 rovai-core> \
  ROVAI_METRICS_COLD_RESTART=1 \
  node scripts/probe-runtime-execution-metrics.mjs opencode-cli
```

具体可用选项及恢复参数以脚本环境变量定义为准。探针把 wrapper 设为隔离实例的 startup programPath，
避免健康检查回退到未观察的二进制；child stderr 原样转发。只保留数值和协议形状。没有 raw 记录时
明确标记 `not_captured`，不能据投影为空推断原生没有字段。

## 自动化与交付边界

- 默认 `pnpm test:rust:pr`：447 passed、1 ignored，0 failed；该 ignored 是既有 Antigravity 手工 Runtime smoke。
- 扩展 native reader owner：3 passed、0 failed；根/子归属、字段缺失与零、旧 pending、重复、分片、截断、Session/cwd
  错配、symlink、文件晚创建、终态有限尾读；round8 原始字段归一化后对照实际数据库读回。
- Monitoring owner：12 passed、0 failed；Kiro 比例、未知数量、Antigravity 输入未知与 Output/Read 归一化；Copilot、Grok
  旧／未知／未来版本字符串不再成为指标阻断。
- Antigravity adapter owner：1 passed、0 failed；旧 step、ACTIVE、重复 DONE、终态累计、数值通道不含私有文本；真实
  两轮 fixture 经同一 stream handler 得到本 Run Output/Read。
- ACP 路由 owner：8 passed、0 failed；Kiro 活动与迟到 Gauge 资格。
- ACP 真实 initialize mock owner：1 passed、0 failed；各版本只请求 `assistant.usage`，没有 reasoning_delta 订阅。
- `pnpm test:execution-metrics-ui`：1 passed，0 skipped；隔离 Electron 加生产 CampWorkspace，500 Run
  回放验证隐藏暂停、有限尾读、迟到 Usage、稳定引用、当前 Session 失效。未修改 Renderer 实现。

`pnpm docs:test` 10 passed；`pnpm docs:check`、以 PR base `3bf3cce6f758b9055e1dd377f336d3609e8ab1a8` 运行的 `pnpm docs:check:ci`、Rust 格式和 `git diff --check` 均通过。

本轮沿用既有 parser/cursor/database owner 扩展案例。新增 Antigravity adapter owner 是因为当前 input
边界与数值转发不属于图片测试职责；没有新增重复的 Rust 集成测试 target，没有 source-string 测试。

未决：正 Cache Write 真实样本、CodeBuddy 当前自定义模型有效窗口、Kiro/TRAE 的其他原生数字来源、
Antigravity 输入分类与 Context、各类真实取消／异常恢复／压缩、本次同调用打包 App 验收。
已有冷恢复不能替代异常恢复或压缩。未实测其他 CLI 版本；实现不以版本号阻断，真实兼容结论仍需要
对应数据格式证据。Cursor 继续排除；本轮不扩展此前未解决的其他 Runtime 字段结论。
