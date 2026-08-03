---
document_type: benchmark-review
version: v0.32
authority: qualification-evidence-review
status: completed-formal
last_updated: 2026-08-03
---

# v0.32 默认团队 Benchmark Review

## 结论

CAL-001 1.5.0 在密封 Team Pack revision 4、Runner 0.32.6 和 packaged Release Core 上有效
通过，因此本轮 3×4 共 12 个 Trial 全部具有正式 Qualification 资格。严格结果为
**4 pass / 8 fail（33.3%）**：

| Case | 三轮严格结果 | 严格通过 | 功能 Verifier | 变更边界 | 协作协议 |
|---|---|---:|---:|---:|---:|
| TQ001 | fail / fail / fail | 0/3 | 0/3 | 3/3 | 3/3 |
| TQ002 | pass / fail / pass | 2/3 | 3/3 | 2/3 | 3/3 |
| TQ003 | pass / pass / fail | 2/3 | 2/3 | 3/3 | 3/3 |
| TQ004 | fail / fail / fail | 0/3 | 1/3 | 2/3 | 3/3 |

这个 33.3% 是密封规则下的正式 Pass Rate，不做事后调分。为了正确诊断，必须同时保留三个
非互相替代的分轴：功能 Verifier **6/12**、变更边界 **10/12**、协作协议 **12/12**。

## Team 协作能力

本轮第一次真正回答了“默认四角色能否协作”，而不是只观察已配置的 Team：

- 12/12 编排收敛，12/12 无人工介入，12/12 未触发时间、Run 或 Member Call 预算；
- 72 个 AgentRun、60 条真实 Member Call、30 次显式 Return、30 个 completed Task；
- 0 个 Core Outcome、0 个开放交接、0 条重复方向路由、0 个轮询违规 Trial；
- 12/12 满足同一成员单槽，未出现同一 Conversation 的重叠 Run；
- 4 个 Trial 的权威快照直接捕获到接收 Conversation 忙时 Input 保持 pending，前一 Run 结束后
  才物化下一 Resume Run，证明忙时排队分支而不只是空闲快路径；
- 所有指定 Codex、OpenCode 和 Antigravity 成员均真实获得执行机会并通过 `call_member` 返回。

因此，v0.32 的 `call_member → durable ConversationInput → single-slot resume` 已完成正式运输和
调度验证；此前的 `sleep + list_tasks` 等待模式没有在 12 个 Trial 中复现。总 FAIL 不能再被
解释为 Team Tool 或 MCP 没有成功执行。

## 交付质量与失败分类

12/12 公开检查和回归检查通过。八个严格失败分为两组，且本轮没有重叠：

1. 六个 Trial 的功能 requirements 失败；其中一个同时失败 accessibility 和 responsive。
   TQ001 的 0/3 是稳定系统性缺口，复核还发现任务文字与 withheld 边界判定存在可产生两种
   合理解读的语义点。它必须在下一版 prompt 中写明后重新密封，不能静默修改本轮成绩。
2. 两个 Trial 的功能 Verifier 全通过，但 `Cargo.lock` 触发 forbidden-path：一次内容确实变化；
   另一次内容摘要完全相同，仅由私有 fixture 的 0600 mode 变为普通工作区的 0644。后者仍按
   当前 seal 计 fail，但属于 materialization/harness 噪声，应在下一版修复。

TQ002 的功能 3/3 表明后端状态机任务稳定；TQ003 为 2/3，最后一次同时暴露 requirements、
accessibility 和 responsive 波动；TQ004 只有 1/3 功能通过，说明完成多角色返回和 Task 收口
并不保证 Lead 正确完成跨层整合。协议纪律和最终业务质量必须继续分开计分。

前序 Lead-only post-gate 诊断为 6/12；本轮 Team 的功能结果同样为 6/12，但严格结果为 4/12。
两轮使用不同 Pack revision、提示、Runtime 配置和门禁，不能把这个表面相等解释为“协作无
提升”，也不能据此声称 Team 优于 Lead。需要同题、同 seal、随机化顺序的对照实验才能计算
collaboration lift。

## Runtime 观察

正式 Team 使用以下冻结配置：

| 成员 | Runtime / 模型 | 正式 Run 数 | 累计 Run 时间 | 平均 Run 时间 |
|---|---|---:|---:|---:|
| 小狐狸 | Codex `gpt-5.6-sol` medium | 36 | 1876.3s | 52.1s |
| 小河狸 | Codex `gpt-5.6-sol` medium | 12 | 1008.8s | 84.1s |
| 咕咕 | OpenCode `opencode/big-pickle` | 12 | 2916.6s | 243.1s |
| 小兔 | Antigravity `gemini-3.6-flash-high` | 6 | 507.2s | 84.5s |

不同成员承担的任务不同，不能把该表当作模型横向排行榜；但关键路径多次由咕咕结束，说明
OpenCode tester 是当前 wall-clock 优化的首要观察点。此前 `north-mini-code-free` 在真实 Smoke
中漏掉 Task、测试和显式返回并错误宣称完成；`big-pickle` 在本轮 12/12 协作审计中履行了返回
责任，可靠性更高，但速度明显较慢。后续应使用对称 micro-case 比较可用 OpenCode 模型，而不是
退回已经证伪的 North Mini。

## 下一版评测集

优先级从高到低：

1. **固定三轴成绩。** 严格总分继续由功能、边界和协作共同决定；报告必须同时展示三个分轴，
   防止把业务失败误诊为 MCP 失败。
2. **修复 fixture mode 污染。** 在建立 baseline 前把物化工作区普通文件规范化为 0644、可执行
   文件规范化为 0755，私有 Pack 的 0600 存储权限不能进入被测变更语义。内容变化仍严格失败。
3. **重新密封含歧义的 Case。** prompt 应明确每个边界的预期处理；Withheld Verifier 输出稳定、
   安全的失败码。任何语义修正都创建新 Case version 和 seal。
4. **增加调度专用 Case。** 确定性制造 B 先返回、C 后返回且 A 正在 Resume 的忙时 FIFO；另测
   callee 无显式返回生成 exactly-once Core Outcome、pre-materialization failure、Core restart
   和 Turn cancellation。本轮只正式覆盖了显式返回路径。
5. **提高可诊断性。** 正式模式继续隐藏 verifier；受控诊断模式短期保留 0700 工作区或导出
   脱敏 patch、命令类别和失败码，区分成员实现、Lead 整合与 harness 缺陷。
6. **建立对照实验。** 同一 seal 随机执行 Lead-only 与 Team-required，比较功能率、wall time、
   token/费用和稳定性；当前 3 次重复不足以比较 Runtime 或角色价值。
7. **Judge 继续后置。** 本轮按已确认决策不纳入 Judge。未来若增加，应作为独立盲评维度，先用
   硬 Verifier 校准，不能替代可执行断言或追溯改写本轮成绩。

## 本地投影与证据身份

脱敏结果已通过公共 Core RPC 投影到本地 `benchmark` Project：12 个正式结果 Camp 加 1 个
Review Camp；消息使用 `execution=null`，新导入部分为 0 AgentRun。原 13 个 Lead-only 诊断
Camp 继续保留，因此 Project 当前共 26 个 Camp。旧文件报告归档在 `benchmark/reports/`。

- Suite：`v032-team-collaboration-20260802-formal4`
- Benchmark：`v032-team-collaboration-20260802-formal4-formal-review`
- Runner：`0.32.6`
- Selection SHA-256：`f5889fef3944e015c1d53ee6b740bc4c69a5e1c37f8726330681be0650ebc80f`
- Suite Summary SHA-256：`f5a2b46010515744a292d5608e8a1d966dbbe516e2ce06af063a3c1829c358fe`
- Team Runtime Compatibility：`c61f98d84a7fba5de9b919a3947c71092cb5e0e9ef1d69ad0726a8c2ffb31dd7`
- Release Core SHA-256：`267a25ca0a4792ba43fc07c3935707d6d373eaa391ef2e8f3ccf3375c639be53`

没有 Judge 模型，也没有严格 ambient MCP 隔离；这两个限制已保留在结构化结果中。
