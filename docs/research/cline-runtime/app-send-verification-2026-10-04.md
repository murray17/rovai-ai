---
document_type: runtime-research
authority: research-evidence-only
runtime: cline-cli
observed_version: 3.0.65
observed_platform: macos-arm64
last_updated: 2026-10-04
---

# Cline 开发包真实发送验收

按 User 消息 `33c5ae08-46e3-40ed-92ae-533dd4353b68` 构建并保留 arm64 ad-hoc App，
在独立 userData 中配置既有测试队员叮叮、芝士。Cline 使用完整官方 npm 3.0.65 安装、
自身的 OpenAI-compatible provider 配置与已授权的 sub2api/gpt-6-sol。全局 CLI 与日常 App 未改动。
平台使用 [V1.72-D17](../../versions/v1.72/decisions.md#v1-72-d17) 的 Preview；本记录不是资格证书。

## 路径与核验

使用 `pnpm package:mac:unsigned`，保留 App 从 `dist` 复制到独立验收目录后启动，明确传入
`ROVAI_ALLOW_ISOLATED_INSTANCE=1`、`ROVAI_DISABLE_AUTO_UPDATE_CHECKS=1` 和独立的
`--user-data-dir`。Skill Library 与 MCP 都由该 userData 独立拥有。启动脚本随保留目录交付，
其中固定了隔离目录；没有安装为日常 App。

通过打包 App 的普通 Host API 保存 Startup Settings、检查 Installation 并配置两名队员。
首次与第二名队员输入经过 App Host 的 `thread.messages.send`；warm 与 cold 两轮直接聚焦
Renderer Composer、输入文字并点击发送按钮。四轮均调用真实 LLM，最终公开回帖来自队员执行
bundled `rovai send --public-only`，不是把 native final 当作公开消息。每 Run 只有一条 Agent 回复，
且均由 Core 记录为 `succeeded`。

| 流程 | 真实结果 | toks | Context used |
| --- | --- | ---: | ---: |
| 芝士首次 | read、write、command、公开回帖，实际文件为一行指定内容 | 42,511 | 6,158 |
| 芝士 warm | 同一原生 Session，读回文件并复述只出现在首轮消息中的口令 | 20,788 | 7,019 |
| 叮叮首次 | 独立 Native Session，read、command、公开回帖 | 14,071 | 5,023 |
| 芝士 cold | App/Core 正常退出后重启，精确恢复原 Session、Binding ID 和 generation，再次公开回帖 | 23,267 | 7,843 |

17 次原生模型调用由只读 Plugin 采集。四轮都在终态前观察到 live 指标；逐 Run 的
Input、未缓存输入、Cache Read、Cache Write、Output、可选 Reasoning 已写入 Core Usage。
Input = 未缓存输入 + Cache Read + Cache Write；toks = Input + Output。Context 是末次根调用输入，
不与累计消费相加。窗口、比例与费用保持 `null`。详细数值、终态与打包二进制摘要见
[脱敏 JSON](app-send-evidence-2026-10-04.json)。

实际 Renderer 冷恢复记录显示 `23.3k` toks，展开后 Input `23k`、Output `0.3k`、Cache Read
`20.1k`、Cache Write `0k`；Context 弹层显示 `7.8k / —`，比例仍未知。自动化中的后台窗口曾显示
空值，按 PID 激活该验收 App 后正常刷新；这符合现有隐藏窗口暂停读取规则，没有修改指标读取器。

正常退出产生 `controlledShutdownCyclePersisted=true`、`status=completed`，没有强制信号或未收敛执行；
记录的 11 个 App/Core/Runtime 进程随后全部退出。该证据只覆盖空闲后的受控关闭，不声称覆盖运行中
取消、崩溃或网络恢复矩阵。

## 实际发现与修复

1. Cline 深检成功附带的连接范围说明被误写为 `lastError`，违反 Ready Snapshot 合同，导致无法保存
   Installation。Application 现在与既有同类 ACP profile 一样，在成功时保留 Ready 并排除这段错误映射。
2. 首次保留 Cline 时只复制了 wrapper 和编译二进制，遗漏官方平台包的 Plugin bootstrap 与依赖。
   那轮已公开回帖，但 observer 无 `run_started`，因此 Run 正确失败、指标保持未知。改用完整官方
   npm 安装目录后重新建立验收 Thread，四轮全部通过；原失败 Thread 和原始本机记录保留。
3. 前端闭集、产品列表、名称/图标、安装指引、原生 `mode` / `auto_approve` 控件及监控筛选遗漏 Cline。
   已接入现有组件；自动批准开关使用原生字符串 `true` / `false`。实际 App 检查了开关草稿往返，
   已保存配置保持不变，Day/Night 都能展示同一配置。Cline 单色图标沿用主题 mask，确保深色下可见。
   安装指引引用[官方 ACP 文档](https://docs.cline.bot/usage/acp)。

最终交付包在真实 LLM 验收后只补了上述主题图标，重新打包并核对 Core/CLI 二进制摘要与验收包完全相同；
JSON 分别保留验收时和最终交付的 asar 摘要。最终包重启后再次核对已保存队员配置及执行历史。

## 验证与边界

`cargo test --workspace`：455 passed、2 ignored；平台矩阵定向测试 5 passed。
前端参数/监控/状态/模型测试 69 passed，App 投影 180 passed，Onboarding 10 passed；
类型检查、文档门禁及 `codesign --verify --deep --strict` 通过。
测试扩展现有平台矩阵和控件 owner，没有新增独立 Rust fixture。

仍未完成：完整压缩连续性、权限失败矩阵、Skills/MCP 分配与相邻 Session 隔离矩阵，以及其他平台。
本轮未切换 Cline 的上下文方案，Plugin Rule 提案仍独立待确认；Command Code 仍未进入 Product
AgentRun/App 路径。因此本次仅证明 Cline 开发预览的真实配置、收发、工具、监控、warm 与 cold 主路径，
不能宣布整个双 Runtime Mission 或 First-Class 接入完成。
