---
document_type: runtime-research
runtime: codex-cli
authority: research-evidence-only
status: verified-with-model-limitations
observed_version: Codex CLI 0.162.1
observed_platform: macos-arm64
last_updated: 2026-10-10
---

# Send 文件输入：真实 Core 与原生 Session 专项

本次使用真实 Core、bundled `rovai` CLI、Codex CLI 0.162.1 和原生 Session 存储。
模型端为脚本驱动的 loopback Provider，不访问真实模型或账号。夹具复用已有原生记忆验收的
Provider/RPC 工具；不增加生产测试接口，也不改变正文解析或教学。

基线产品源码为 `70c9214bf47a677d018a7f2448583d6ec3422d22`，候选为
`486fa11673b2fa7e6c4a2d6a9b53fd3b2cc229a3`。两者分别构建匹配的 Core 与 CLI。
程序摘要、原生 Session/Binding ID、冻结 Charter 摘要及发布回执见[证据](evidence.json)。

| 连续场景 | 观察 |
| --- | --- |
| 基线新建 Session，用旧 JSON 文件发送 | Run 成功；Thread 读回正文一致；累计 1 条 Agent 消息 |
| 正常停止基线 Core，候选 Core 恢复同一 Session；旧 JSON 发送后读取新 Send help | Run 成功；累计 2 条消息；Provider 后续请求同时包含旧 Charter 和新帮助 |
| 同一 Session 使用新正文文件发送 | Run 成功；累计 3 条消息；中文、emoji、Markdown、引号、反斜杠、CRLF、真实换行、字面 `\n` 与边缘空白逐字读回一致 |

三个阶段的 Native Session、Binding ID/generation 和冻结 Bootstrap 证据均相同。
每个 Run 仅发布一条消息，回执没有 Agent 收件人或 Delivery。输入文件位于夹具普通目录，
不是 Run tmp；没有新增目录限制。

这证明实际发布、读取和升级恢复的执行链。工具选择由脚本指定，因此不证明真实模型能自行
化解旧指令与新帮助的差异，也不证明它不会重复调用或陷入帮助查询循环。通用模型 Gate、
真实模型连续发送、回滚、其他 Runtime 和 Windows 真机专项仍待验证。

## 重放

分别在基线和候选 checkout 运行 `cargo build -p rovai-core --bins`，确保每份 Core 的同级
`rovai` 来自相同源码。输出目录必须尚不存在；脚本为 Core data-dir、Skill Library、MCP、
原生 HOME/CODEX_HOME 和 Runtime Files Root 创建隔离目录，结束时正常关闭 Core 并保留证据。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 docs/research/send-input-file/verify.py \
  --baseline-core /absolute/baseline/target/debug/rovai-core \
  --candidate-core /absolute/candidate/target/debug/rovai-core \
  --codex /absolute/codex \
  --out /new/private/send-file-acceptance
```

本机使用 `/private/tmp/rovai-send-file-acceptance-20261010-a1`；未安装或重启日常 App。
初次夹具在 Core 启动前遇到系统 Python 3.9 缺少 `hashlib.file_digest`，改为分块摘要；随后一次
在已成功发布后误读快照字段，改为按正式 `sourceAgentRunId` 计数。两个夹具问题修正后，完整连续场景通过。

进程拒绝路径仍由 `pnpm test:send-input-file` 拥有，接入手动 `Full check / Rust full`。
本专项手动执行，不替代该回归或真实模型 Gate。
