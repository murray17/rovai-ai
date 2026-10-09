---
document_type: runtime-research
runtime: command-code
authority: research-evidence-only
status: candidate-verified-with-adoption-blocker
observed_version: 1.66.0, 1.79.1
observed_platform: macos-arm64
last_updated: 2026-10-09
---

# Command Code headless：同 Session 换模型与权限验证

**同一原生 Session 的 A→B→A 已成立；普通审批模式尚不能等价替换 ACP。**
本轮保持现有 ACP 生产入口，只提交可重复实验与证据。没有按模型分叉后端、修改用户安装、
迁移 Session、重放旧输入、修改原生历史或新增账户／审批服务。Cline 继续隐藏。

## 实际安装与实验范围

主验证使用正常发现的 `/opt/homebrew/bin/command-code`，官方 npm **1.66.0**；Rovai 日常设置没有
额外程序路径，数据库中的 Command installation 也为空。选中的是这份实际程序，不是另一份 SDK。
另复用上一轮已安装的官方 npm **1.79.1** 做模型恢复对照；它不是日常替换安装。
两份发布包的摘要见 [脱敏证据](headless-resume-2026-10-09.evidence.json)。

所有调用均使用 argv 数组、stdin 新输入、完整 UUID 和新进程，参数为
`--print --output-format json [--model <完整 ID>] [--resume <完整 ID>] --mod <本次只读 Mod>`。
没有 `acp` 子命令、`--continue`、截短 ID、原生历史文件读取或客户端历史回填。

本地控制实验使用新 Home／工作区、两个 loopback Provider 和合成 Key；原生 `auth.json` 只引用
已有登录源，没有伪造登录。真实请求直接引用用户已有 `sub2api/gpt-6-sol` Provider 和认证文件，
由同一 CLI 解析凭据，不经过代理或 SDK。源 `auth.json`、`providers.json` 前后摘要不变。
真实测试只有一个已配置模型，不冒领付费端点间 A/B 切换。

## 同 Session 模型与历史

| 输入序列 | 1.66.0 | 1.79.1 对照 |
| --- | --- | --- |
| `--list-models` | 列出四个完整自定义 ID | 同左 |
| A 首轮 | 创建 S，实际到 A/model-a | 同左 |
| `--resume S --model rovai-b/vendor/shared` | 原 S，到 B/vendor/shared，认证对应 B | 同左 |
| `--resume S --model rovai-a/model-a` | 原 S，切回 A | 同左 |
| 不存在的完整模型 ID | 明确 Unknown model，退出 1，Provider 零请求 | 同左 |
| 错误选择后显式 A | 原 S、原记忆仍在 | 同左 |
| 再切 B 后，仅 `--resume S` | **使用全局默认 A，没有保持 B** | **同样使用 A** |

每次实际请求都核对了 Provider 路径、认证匹配和原始模型 ID；`vendor/shared` 未被截短。
控制服务观察到第一次随机记忆仍在历史中，每轮新输入各出现一次，Rovai 没有重放旧 Prompt。
错误模型在外层参数检查就退出，没有最终 JSON result 或 Session ID；接入时必须保留这种早期失败。
它不能被解释为“成功结束”或自动重试。

**默认恢复与文档有差异。** [官方会话文档](https://commandcode.ai/docs/sessions)描述冷恢复采用保存模型、
显式 `--model` 可以覆盖；实测这两版 headless 没有保持上一轮选择的 B。发布包的 `loadPrintSession()`
只返回历史与 entrypoint，未向启动配置交付保存模型。实验没有读取原生历史／元数据文件，
不据此断言 B 是否写入了 meta；可以确定的是请求实际到 A。不能把交互路径说明外推给 print 路径。
候选若继续推进，“运行时默认”只能表示省略参数、遵循实际原生行为；本轮不能承诺它保持 Session 模型。

## System 与首轮时序

本次官方 `--mod` 在 factory 阶段尚无绑定的 `cmd.session`；随后 `session_start` 已绑定，
首次 `appendSystemPrompt` 的 `state.sessionId` 已是完整 S，发生在首次 Provider 请求之前。
NDJSON 的 `run_start` 也携带 S，早于 `model_request_start`。

每个模型请求中，冻结的实验 Bootstrap 在 System 恰好一次、user 零次；跨进程换模型后保持相同身份。
Mod 内容按本次进程冻结，没有全局 active Bootstrap，也没有把身份放入第一条 user 消息。
这证明原生入口及时间顺序可用，**没有证明现有 ACP 的绑定文件交付可以原样搬过来**；正式实现仍需
在共享 Binding／Run 归属下完成首轮绑定与失败隔离，旧 `first_payload` 研究传输也不能直接启用。

## 权限：阻止本轮直接切换的具体原因

1.66.0 的实际结果：

| 控制条件 | 观察 |
| --- | --- |
| 普通 headless，Mod 拒绝读取 | 有 `tool_hook_blocked`，无工具执行事件 |
| 显式全权限 `--yolo`，写入测试文件 | 原生 write_file 完成，文件精确匹配 |
| `dont-ask`，且原生 `permissions.allow` 已批准写入，无 `--yolo` | 仍被内置 `print-permission-gate` 拦截，用户 Mod 的 beforeToolCall 尚未执行 |
| 显式全权限，Mod 等待匹配的 Session／toolCall 决定 | 等待期间没有文件；允许后才写入 |
| 显式全权限，Mod 等待后拒绝 | 无文件，无 tool_running；原生反馈阻断 |

[官方 headless 文档](https://commandcode.ai/docs/headless)也说明默认写入／Shell 被阻止，
需要显式 `--yolo`。安装包 `resolvePrintHarnessMods()` 只有在该 bypass 参数存在时才移除内置 gate；
1.79.1 发布包保留相同分支，但本轮未对它重跑工具矩阵。
[Mod 文档](https://commandcode.ai/docs/mods)说明自定义 Mod 排在内置 Mod 后，beforeToolCall 在权限判断之后；
因此普通模式的外部审批即使同意，也不能在后续 Mod 中解除已经发生的内置阻断。

实验里的决定文件只证明 native Hook 可以等待并阻止执行，**不是共享 Approval UI 或生产权限通道**。
`--yolo` 仅出现在明确标为全权限的隔离工具 case，未加入任何普通产品任务。不能为了保留普通审批
而悄悄给所有任务加 bypass，也不能先执行再补审批。Mod 加载/异常的 fail-closed 交付、共享审批响应、
断线与取消窗口尚未接入；不以成功的全权限实验宣称无损替换。

## 真实 BYOK、文件与取消

实际安装 1.66.0 完成同 S 的五次启动：**四个成功终态、一个预期取消**。

- 首轮真实生成，System 固定代号正确；随机早期记忆只出现在首轮新输入。
- 下一进程显式原模型：原生 `write_file` 创建一份隔离测试文件，内容精确匹配，随后正确回忆早期记忆和身份。
- 下一进程执行限定的休眠工具命令；PID 文件证明工具子进程已启动后，才发送取消。CLI 退出 130，
  没有 success result，已观察工具子进程退出。
- 新输入 `--resume S --model A` 成功，明确不重跑取消命令，早期记忆与身份保持。
- 最后省略 `--model` 恢复同 S，真实生成成功；这里只有一个实际模型，不用它证明默认保留 B。

真实工具 case 明确使用全权限，并由实验 Mod 将操作限制为该文件／精确休眠命令。
控制矩阵另验证延迟允许、拒绝和取消后续接。取消证据覆盖 CLI 及 PID 文件记录的工具子进程，
不冒领产品级 ManagedProcess 账本、Core 重启或任意脱离进程树的完整矩阵。

## 耗时、复现与后续边界

最终有效控制矩阵为 1.66.0 的 14 步／19 次本机 Provider 请求，以及 1.79.1 的 7 步／6 次请求。
每一步 PID 不同。文本 case 的整次 CLI 墙钟耗时分别为 594–624 ms（中位 619.5 ms）和
677–791 ms（中位 708.5 ms）；这是本机合成 Provider 的启动＋恢复＋请求总时长，不是纯启动基准。
真实成功 case 为 3.4–7.4 秒，含网络、生成及工具。本方案没有同进程 IdleWarm，不能继续写作 warm 通过。

[可重复控制夹具](fixtures/headless_resume_probe.py)：

```sh
python3 docs/research/command-code-runtime/fixtures/headless_resume_probe.py \
  --program /absolute/command-code \
  --auth-file /authorized/.commandcode/auth.json \
  --out /new/private/headless-probe
```

比较发布包 `.mjs` 时使用同一脚本的 `--routing-only`；脚本会以 Node 执行该安装的真实 CLI。
第一次探索轮尚未等待工具 PID 文件，未计入取消证明；最终矩阵改为确认实际子进程启动后再取消。

**本轮不采用为生产后端。** 模型选择及原生历史连续性可行，但普通审批写入仍要求原生 bypass，
不符合本轮保留权限语义的要求。ACP→headless 跨入口恢复、正式 Binding 模型兼容性、共享审批、
打包 App 新执行链、完整崩溃回收尚未验证；MCP 由 User 自测，本轮没有扩大排查或声称已修复。
自动压缩也未重测。后续若解决这个具体权限差异，再进行单一后端切换，不能把这份报告当作切换完成。
