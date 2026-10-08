---
document_type: implementation-record
version: v1.72
authority: implementation-evidence
last_updated: 2026-10-08
---

# 续做可靠性修复与验收

## 范围与工作区

- 基线：`52ecf3987b2cb599559b503500417ce26106ce83`；实现提交：`ddf0425b`。
- 分支：`rovai/continuation-reliability`；worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-continuation-reliability`，状态 ready。
- 根据 User 的 A → B/D → C 批复修实现缺陷。保留取消快速受理、既有清理／lane 隔离、旧 Run 终态与按次独立续做。
- **提示词改动：无。** Charter、业务输入文本、动态上下文格式、Tool Schema 均不改。
  Claude / Antigravity 调整原生初始化和输入发送的先后顺序，最终会话使用原 builder 生成一次输入。
  不修改已有 Manifest，不追加来源 ID、继续文案、证据摘要或 CLI 提示。

## 修复

| 问题 | 根因与改动 |
| --- | --- |
| A：清理 ACK 后后台任务仍写入 | macOS 只靠主进程／原进程组不足以覆盖工具的独立进程组。Stop 前捕获受管后代，以生命周期身份和 audit token 定向终止，确认已捕获后代退出后才 ACK。查询失败保持未确认，清理句柄保留。Claude 在关闭 stdin 前停止进程，避免提前断开祖先关系。 |
| B：ACP 启动故障滞留 waiting | 未完成输入交接时，Host exit 与启动 future 同时处理失败，版本漂移使最终失败被拒绝。启动期间的未绑定 route 由现有 launch permit 持有；失败结算读取当前 Run/epoch 的版本，保留取消和终态 fence。 |
| C：连续启动失败丢失旧 Session | 新绑定准备清空引用。仅当替代尚无可能投递、新会话仍为空且 Run/epoch 有效时保留旧引用；旧 credential、binding identity、工具租约不恢复。 |
| D：明确缺失会话没有完成降级 | Claude 在 initialize 前退出，现在立即结束等待并识别精确缺失诊断。Antigravity 支持 stream-json stdin 时先验证 init/session，明确拒绝旧会话时尚未发送业务输入，允许一次新建。两者在原生初始化通过后才冻结 Manifest，替换失败不无限重试。 |
| 恢复后配置失败误换会话 | ACP 仅给 resume/load 阶段错误添加恢复错误身份；后置模型／选项 RPC 错误保留原错误和 Session。 |
| 历史 unknown 判断过严 | 后续同一绑定、generation、epoch、native turn 匹配的可信失败终态也可证明结束；明确会话／协议损坏或缺失结果不能消除 unknown。 |

代码入口：`managed_process/macos.rs`、`claude.rs`、`antigravity.rs`、`acp.rs`、
`application.rs`、`planned_shutdown.rs`、`runtime.rs`、`run_continuation.rs`。

## 真实 Runtime 验收

通道为自动验收：每个 Adapter 独立 Thread、Core data-dir、managed-skill-library、MCP、工作区；
使用本地已安装原生 CLI 和真实模型。故障代理只终止实际进程，不制造协议响应；缺失会话仅在停止 Core 后
修改夹具引用。没有操作日常 App 数据。旧 Run 状态、每次输入 dispatch、清理 ACK、后继创建时间、Session ID
与 checkpoint 文件逐项核对。

“连续失败”通过表示原生恢复／新建均失败后 Run 明确 failed、零业务输入投递，撤除故障后下一次用户续做
能恢复原 Session；不把被注入的 failed 当成产品异常。“—”表示本轮没有独立覆盖该列。

| Adapter | Stop-only 无迟到写入 | 清理后后继 | 缺失／单次恢复失败降级 | 连续启动失败保留旧会话 |
| --- | --- | --- | --- | --- |
| Codex | — | 通过 | — | 通过 |
| Pi | — | 通过 | — | 通过 |
| TRAE | — | — | — | 通过 |
| OpenCode | — | — | — | 通过 |
| Copilot | — | — | — | 通过 |
| Kiro | — | — | — | 通过 |
| Qoder | — | — | — | 通过 |
| CodeBuddy | — | — | 通过 | 通过 |
| Qwen | — | — | — | 通过 |
| Kimi | — | — | — | 配置失败保留，通过 |
| Grok | 后台任务通过 | 通过 | — | — |
| DeepSeek Harness | — | — | — | 通过 |
| ZCode | — | — | 通过 | — |
| Claude Code | 通过 | 通过 | 通过 | 未独立注入 |
| Antigravity | 通过 | 通过 | 通过 | 未独立注入 |

A 的最终 Stop-only 独立实验未启动后继：
Claude `af9955a9`、Antigravity `15f71664`、Grok `54dba127`。
前两者延迟写入时间 12 秒、观察 15 秒；Grok 后台任务延迟 30 秒、观察 35 秒。
清理确认约 31 / 30 / 55 ms，后续未见原 worker 存活或新写入。这是此次工具路径的证据，
不承诺捕获之前已经脱离祖先链的未知后台服务。

缺失会话成功样本：Claude `c5615705`、Antigravity `1be199a5`、ZCode `7383da58`；
CodeBuddy 单次恢复失败后新建 `068280b5`。均只产生一次业务输入投递。
Antigravity 早期一轮替代会话收到模型 503，随后同场景真实复测成功；不把 503 记录抹成成功。
ZCode 使用 Node 24；Node 26 下种子执行未通过，属于这次环境限制，不宣称 Node 26 兼容。

Kimi `c3aca50a` 在 resume 成功后，于 `session/set_config_option` 终止真实 Host：
Run 明确失败、没有业务投递、Session 不变；下一次 `db410f2c` 恢复同一会话成功。
普通恢复后本地准备错误、明确发送拒绝、已接受后的原生失败分类由既有确定性 owner 检查；
没有把所有 Adapter 的这些路径标为真实模型全覆盖。

最终 Stop-only、独立排队及上下文复核使用冻结 Core SHA-256
`c250f05cee98d247b6cb20b54fd75222fe3d54df5856a8a707bcbed2d5879080`；各类故障的早期构建记录保留。
Claude / Antigravity / Pi 排队样本新 Run 分别为 `1910d3bb` / `83cf8338` / `8e6df6ac`，取消响应
10 / 9 / 9 ms，均实际观察到 waiting，后继创建晚于 cleanup ACK；冻结输入包含取消后新建 Task 的标题。
原测试把旧 Run 的整个 version 也当作不可变，因取消后的异步 Git 观察使 version 增加而失败；
保留原报告，按终态、epoch、结束时间和清理事实重新核验，并完成其余输入／文件／上下文断言。
该变化对应原 Run 的 `ending_git_observation_recorded`，不是后继状态传播；没有为 Git 观察延迟清理。

## 取消后的可信终态检查

本次 Codex 实验日志记录 `ignored fenced native Turn completion`；取消后原生回调已被现有 route/turn fence
排除，没有可直接用于续做选择的已持久化匹配原生终态。保持 unknown 规则，未把 cleanup ACK 伪造成原生结束，
也未为此增加新证据系统。带可信原生失败终态的历史 unknown 消除由精确关联的 SQLite 回归覆盖；
真实模型的“早期 unknown → 后续原生失败终态”完整链尚未独立注入。

## 可重复步骤与证据

沿用此前验收脚本 `accept-adapter.mjs`、`probe-fixed.mjs`、`probe-cleanup.mjs`、
`probe-cleanup-background.mjs`，补充初始化／配置故障点与 `probe-queue.mjs`。
原始元数据、私有日志、脚本和隔离 fixture 的定位保存在本 Thread 附件
`continuation-reliability-20261009/`；未将原生凭据、完整输入或 Native Session 文件提交仓库。

1. A：原生模型执行隔离的延迟写文件 worker；收到 started 文件后 Stop；只等待清理并观察整个延迟窗口。
2. B/C：建立可用 Session，投递前停止来源 Run；透明代理分别在 resume/load 和 new 请求处结束真实 CLI。
   两次故障后检查 failed、零 dispatch 和原引用；移除代理故障，重新授权续做并核对同一 Session。
3. D：关闭夹具 Core，换成不存在的会话引用；启动后继续；核对一次新会话、一次投递和不变的 checkpoint。
4. 配置失败：Kimi resume 后在真实配置 RPC 处断开 Host，检查失败归因及下一次恢复。
5. 排队：worker 已启动后 Stop，立即提交继续；后继创建时间不得早于旧 Run 清理 ACK，旧终态和文件保持。

## 自动化验证与限制

扩展 owner：managed process、planned shutdown、Claude、Antigravity、ACP、续做准入、引用保留、原生终态归因。
新测试准入理由见[测试政策记录](../../development/testing.md#续做可靠性回归)。

`cargo test --workspace`：458 通过、1 项既有真实环境测试忽略；`cargo fmt --all -- --check`、
三项通用 docs gate 通过。定向扩展 owner：managed process 5、planned shutdown 11、Antigravity 17、ACP 74、
continuation 5、引用保留与终态归因各 1 项通过；Antigravity 另有 1 项既有真实 Runtime ignore，
本次已用上面的独立真实验收覆盖。Claude 扩展集 33 通过、1 项基线失败：
`public_text_streams_and_success_fallback_create_narration_without_thinking` 的 thinking 空事件断言
在未修改的 `52ecf398` 独立 worktree 同样失败。本次保留测试与生产行为，未改写或跳过以制造全绿。
macOS 为本轮真实验证平台；Linux / Windows 原生执行未复测，不推断通过。
