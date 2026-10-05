---
document_type: runtime-research
authority: research-evidence-only
status: partial-verification
last_updated: 2026-10-05
---

# Command Code / Cline：异常退出、恢复与 Session 负向验收

User 消息 `372f5220-e237-4740-ad85-ddabbabbb859` 要求继续完成验证。本轮沿用隔离 packaged App、
Command Code 1.74.1、Cline 3.0.65、两者各自的 sub2api/gpt-6-sol BYOK；基线为 `2b7e73c1`。
完整能力比较仍见 [14 轴 Checklist](command-cline-checklist-2026-10-05.md)，本页补充真实故障与修复，
不把 macOS arm64 Preview 升为 First-Class。[脱敏原始结果](command-cline-fault-recovery-2026-10-05.evidence.json)
包含失败候选、最终通过、Run ID、单独的输入交付证据和测试数。

## 实际发现并修复

1. **Runtime leader 已死、stdout 却仍被工具持有。** 旧 reader 等不到 EOF，Command 留在 waiting，
   Cline 的 SDK 后代甚至能继续完成。ACP 现在独立观察 leader，先清理所属后代，再消费有界的末帧、
   收口 pending RPC 并精确通知一次退出。已经写进管道的权威 response 仍被保留。
2. **进程组清理漏掉 setsid 后代。** 第一版退出观察修复仍出现 Command/Cline 75 秒后的写入。
   macOS Managed Process 现在用内核 unique identity、parent identity 和 PID version 捕获所属树，
   经 audit-token signal 避免误杀复用 PID；私有 ledger 让新 Core 在开放执行前回收旧 Core 的后代。
   ledger 只含进程身份、Core owner 和 boot identity，目录 0700、文件 0600，不存 argv、认证或 Prompt。
3. **已交付输入在 Runtime/Core 丢失后永久等待。** 当前公开 batch 按现行
   [Accepted Input Recovery v6](../../contracts/accepted-input-recovery-v6.md)自动失败，保留 accepted/unknown
   证据，禁止重放。业务终态和 cleanup ACK 分离，清理确认前不能放行下一输入。Pi/Codex 的共享终态通知
   也对齐这一路径。Single Chat 的既有独立规则未改动。
4. **公开快照把失败错误显示成取消。** 旧版本取消兼容投影误命中新写入的 Runtime loss cleanup 字段。
   现在保留真正用户取消的历史兼容，Runtime loss 正确显示 failed，不再给出旧恢复操作。
5. **Command 静默恢复不存在的历史。** 官方 `session/load` 和 `session/resume` 对不存在 UUID、截短 ID
   均返回成功，也不返回替代 Session ID；Cline 则返回 `-32002`。Command 冷恢复现在先查询官方
   `session/list`，要求完整 ID 与 cwd 精确命中；缺失时先拒绝原 Session 的恢复。
   Core 沿[共享恢复规则](../../architecture/builtin-tool-runtime.md)记录 continuity lost，停止失败 Host、
   轮换 Binding，再将当前新输入交给新 Session；不能把这条回退算成 exact resume，也不能重放已接受输入。
   固定版本返回完整单页目录；未知或未覆盖的后续分页行为不能认作原 Session 已恢复。没有猜私有历史路径。

macOS 所用 ABI 与身份校验依据 Apple 的
[libproc 实现](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c)和
[内核 proc_info](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c)。
设计选择与限制由 [V1.72-D16](../../versions/v1.72/decisions.md#v1-72-d16)及
[Managed Runtime Process v2](../../contracts/managed-runtime-process-v2.md#macos-acp-descendants)拥有。

## Packaged App 真实故障矩阵

每组先让两个真实模型分别启动有启动标记的 Node 工具，核对工具 PID 与该隔离 App/Core 的祖先关系后，
才发送 SIGKILL。工具预定 75 秒后写文件；4 秒检查所属进程，再等到超过写入时点。仅终止本次 fixture
捕获的进程；没有重启日常 App 或修改全局 CLI。

| 故障 | Command Code | Cline | 清理与公开结果 |
| --- | --- | --- | --- |
| Runtime leader SIGKILL | 通过 | 通过 | 6 个所属进程均消失；两 Run failed、cleanup ACK、无公开重复回复，无迟到文件 |
| Core SIGKILL | 通过 | 通过 | App 自动替换 Core；6 个所属进程均消失，旧输入失败，无迟到文件；两者随后各显式发送一次成功 |
| App SIGKILL | 通过 | 通过 | 6 个所属进程均消失，无迟到文件；App 重开后旧 Run failed，两者各显式发送一次成功 |
| 新包正常 cold | 通过 | 通过 | Native Session、Binding、generation 前后一致；两者真实 CLI 发送成功 |
| Runtime 强杀前排队新消息 | 通过 | 通过 | 清理前未创建后继 Run；两者均在 cleanup ACK 后自动启动，各显式发送一次并 succeeded |
| Command 原生历史缺失 | 通过 | — | 记录 incompatible/continuity lost；Binding generation 16→17，仅新 Binding 接收一次输入，具有新 managed System Bootstrap |

第一组的两次 Cline 后续发送都已经由内置 CLI 恰好提交一次，但随后模型请求遇到 Provider overload，
Run 正确 failed、retryable=false；未重放原输入，也未把已发送当作整个 Run succeeded。后续 Core/App
恢复发送以及最终包的 Runtime 强杀后排队发送通过，失败尝试独立保留。

缺失历史实验最初错误地要求整个新 Run 失败。实际共享规则允许尚未发送的新输入在审计连续性丢失后
使用新 Session；因此保留初始断言失败记录，改按该合同检查完整 ID、Binding generation、唯一交付、
新 Bootstrap 与 continuity lost 事件。原始历史文件只在隔离 App 停止时临时移走，实验后还原。
最终缺失历史 Run `5a911461-b37d-4765-b511-aefb4c2092e4` 走明确的新 Session 路径，未创建假旧 ID 的 transcript；
还原后两者再次各显式发送一次并 succeeded。实际 Renderer 的两张故障卡均为 `status-failed / tone-danger`，
排队后继卡为 `status-succeeded / tone-success`，与公开快照、数据库一致。

## 回归与证据边界

- Rust 默认 workspace：456 通过、2 ignored；ACP extended：69 通过、2 ignored。
- 当前恢复 owner：25 通过；两项 Action runtime loss slow owner：2 通过；macOS 身份/ledger owner：2 通过
  （其中一项为真实重启 fixture 的子进程入口）。
- Command 真实原生 owner：1 通过，含错误完整/截短 ID 拒绝、A→B→A 控制面及 Bootstrap 缺失时停机。
  此 owner 不调用模型，实际模型证据来自上表 App Runs，二者不混算。
- 恢复错误分类 extended owner：1 通过，区分确知不存在与目录响应无效；默认 feature 不包含此 owner，未将 0 项匹配计为验证。
- 中间一次 ACP 回归在首个退出事件的顺序断言失败；该通道允许非终态 HostDiagnostic 先到。
  最终仍验证唯一 owner exit、pending RPC、缓冲 response 和超过延迟点无写入，仅放宽诊断顺序，完整 69 项重跑通过。
- 最终开发包通过打包和 ad-hoc 签名验证；分别记录故障矩阵包与加入 Session 保护后的包摘要。
  公开 evidence 的 `persistedOutcomeAtEvidenceCollection` 是收集时数据库状态；原始观察保留在各 record 中，
  后续为回收失败实验执行的取消不能倒算成原测试通过。

本方案没有建立 macOS 的 Windows Job 等价物：未及时观测到的中间祖先、跨 UID 后代、Core 长期不重启时
的持续回收不在证明范围内。失败读取/身份校验不能变成 cleanup 成功，重启回收未确认会阻断启动准入。

仍未闭合：Cline 必需 System Plugin 门禁和 ACP compaction 配置；Command 当前自定义 BYOK 的 deferred MCP
实际调用、显式 set_model、结构化非零退出、可归属 reasoning/Run 费用；overflow+retry、完整 20/200 Host
压力、完整认证轮换、Linux/Windows/macOS x64 真机矩阵。Windows 交叉检查还被本机缺失 C SDK `assert.h`
阻断，没有宣称已跨平台编译或验证。以上是明确的剩余范围，不以 fixture、成功握手或单次生成替代。
