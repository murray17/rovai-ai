---
document_type: research-note
authority: non-normative
last_updated: 2026-10-03
---

# 遗漏字段修复核验

## 修正验收口径

[上一轮](all-runtime-app-verification-2026-10-03.md)将投影中的 null 与期望 null 一致也判为通过，
因此 15 类对照通过不能证明 15 类字段齐全。此次把「已有数字是否正确」和「必要字段是否可用」
分别记录；[脱敏 fixture](fixtures/round10-missing-fields.json) 的 `overallComplete` 为 false。

当前实际可用范围：Run 总量 **13/15**，上下文比例 **12/15**，四项用量均非空 **7/15**。
四项非空只描述本样本，不扩展为该 Runtime 所有 Provider、模型和运行状态均完整支持。
Qoder、Kiro 原生比例有效，即使 used/window 不齐也属于比例可用。

## 已修复的真实漏接

| Runtime / 版本 / 模型 | 原始证据与问题 | 修复后同 Session 新 Run / 实际 App |
| --- | --- | --- |
| DSH 0.1.5-rc.3 / sub2api gpt-6.1-sol | 原生 committed `data.usage.totalTokens` 已有，Rovai bootstrap 白名单遗漏；`@deepseek-ai/dsh-llm` TokenUsage 明确定义其为含缓存输入加输出，pi-ai adapter 保留原生完整 total | 新 6 个调用：Input 92,636，Output 932，Read 75,904，Write 未知；卡片 **93.6k**，气泡 92.6k / 0.9k / 75.9k / — |
| ZCode 0.16.9 / new-provider gpt-6-sol | 原生 `session/read.runtime.contextUsage.used/size` 已有，旧桥接只提取后台任务、丢弃上下文 | 新 Run Input 73,396，Output 732，Read 54,144；Session **18,807 / 200,000，9.4%**；实际圆环与气泡已显示 |

DSH 以发送前最后原生 seq 建 baseline，只对新 committed 调用求和；`totalTokens - outputTokens`
必须通过非负、已知桶下界以及桶齐全时的等式检查。没有把缺失 Cache Write 补零。
独立原生 session.v3 journal 与 Core 落盘/Renderer 对照一致。

ZCode 沿用已有终态 session/read，不新增轮询。仅把当前根 Session 的 used/size 和原生 revision
送进私有 Usage 路径；Session 身份不匹配、缺字段、非法值均排除。只保存当前 Session 投影，
不保存历史 Run 结束上下文。额外用官方 kernel 做无模型调用的 resume/read，原生 snapshot
再次返回 18,807 / 200,000，与 App 读回一致。该证据是终态/冷读取；运行中和真实压缩的即时更新
尚未验收，不能扩大结论。

本次 DSH 原生终态 succeeded，但 2 次 file.read 成功、3 次 shell.execute 失败，公开结果由既有
missing-send 恢复承接。采集已收到用量成功不代表 DSH 工具执行链已经健康。ZCode 的 2 次读取、
1 次 shell 和 1 次其他工具成功。

## 仍缺少的主要字段

| Runtime | 缺口 | 本次确认的来源情况 / 下一步 |
| --- | --- | --- |
| CodeBuddy | 上下文 window/比例；Cache Write | 当前根 journal 有 used=23,953；ACP catalog 只给内置模型窗口，实际自定义 gpt-6.1-sol 无窗口，原生 models.json 未配置。不能借另一模型分母；需原生当前模型窗口或有效配置 |
| Antigravity | Run Input/总量、Context、Cache Write | 成功 step 有 input/output/read/total，total 不含 cache read；输入全部分类语义仍未证实。当前 stream-json 没有 Context。受控本地 LanguageServer 查询返回 401，未绕过鉴权；需受支持的已认证数值接口/完整字段语义 |
| Kiro | Run 四项/总量 | ACP 与确切 Session 的原生 JSON 中只有 Context 百分比、模型窗口和 meteringUsage；没有 token 计数。额度计量不能当 token。原生比例 7.7% 仍有效；需逐调用 token 数值来源 |
| TRAE CLI CN | Context、Cache Write | journal/trace 有逐调用 prompt/completion/cache-read；ACP 没有占用。原生 `models --json` 给当前 GLM-5.3 窗口 168,000，但尚未验证 latest Usage 能代表 Context，不做通用公式；需占用通知或 Runtime 专用语义证据 |

Qwen、ZCode、DSH、Qoder、CodeBuddy、TRAE 的 Cache Write 缺失仍保持未知；CodeBuddy/Qoder
的部分 Cache Read 观测也不能标成完整分类覆盖。上述空值不再被验收脚本解释为完整采集通过。

Antigravity [官方 headless 协议](https://antigravity.google/docs/cli/headless/)确认逐 step 和 Session
终态累计的区别；后者不能充当当前 Run 总量。即使其文档有 status line Context 字段，也不证明
当前 headless 通道已经向 Rovai 提供这些字段。

## 验证与交接

- 扩展既有 parser owner：DSH 完整 total、缺缓存、显式零、缺 output、非法/矛盾 total；原有稀疏字段与 native Gauge 断言保留。
- 扩展既有 ZCode transport owner：同 Session snapshot、旧 Session 排除、非法值、压缩下降的受控输入、内容不扩散、Context 先于 prompt 终态投递。
- DSH bootstrap 既有测试验证 totalTokens 白名单与正文不进入数值文件。
- `monitoring::tests::` 12 项、ZCode transport owner 1 项、DSH bootstrap 2 项通过；文档测试、版本/治理与 diff-aware 门禁通过。
- 通用 App 验收脚本新增 `availability`；只有 used、没有 window/原生比例时不能通过 Context 可用性断言。15 份实际读回与零/缺字段样本核对通过。
- 真实包复用隔离 `RovaiMetricsAcceptance/all-runtimes-3bff06da`，独立 userData/Skill Library，日常 App 保持运行；复跑 DSH/ZCode，同一个 15 成员 Thread。
- Renderer 逐项检查卡片/四项气泡/Context；一致性和字段可用性分开导出。全矩阵仍未完整通过。
- 当前验证 Core SHA-256：`59a36e1e4eeb1d8ec1d416e4dde5ade43e23c0e20274f895e499e080864694a8`。

当前规范见 [Usage v6](../../contracts/runtime-usage-monitoring-v6.md) 与
[Execution Metrics v3](../../contracts/runtime-execution-metrics-v3.md)。不新增数据库迁移、测速或 UI 布局。
