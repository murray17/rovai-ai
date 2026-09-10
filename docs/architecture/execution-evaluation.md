---
document_type: architecture
architecture: execution-evaluation
authority: dual-track-evaluation-component-boundaries
status: accepted
last_updated: 2026-09-10
---

# 双轨执行评测

当前字段与判断规则由 [Execution Evaluation v2](../contracts/execution-evaluation-v2.md)拥有；操作见[开发指南](../development/evaluation.md)。

```mermaid
flowchart LR
  Plan[现有 Skill 与确认方案] --> Gate[Gate CLI]
  Gate --> Contracts[实际合同测试]
  Contracts --> Runner[Qualification Runner]
  Runner --> Isolated[隔离 Core / Runtime / 工具]
  Isolated --> Evidence[产物与执行证据]
  Evidence --> Rules[规则验收]
  Evidence --> Judge[固定标准的双副本 Judge]
  Rules --> Report[回归报告]
  Judge --> Report
  Stored[持久化 Trace] --> Export[Core 只读导出]
  Export --> Daily[代码统计与曲线]
  Daily --> Files[日报与分析输入]
  Files --> Automation[既有 Automation 分析 Agent]
```

Core 是执行状态与元数据查询的权威，Rust 导出器只读取既有投影和去重事件。普通用户 CLI 经既有 Main IPC 获取受限快照；DailyAnalysisService 在用户显式配置后，用同一读取能力把日报准备到分析工作区。配置保存在 User Automation 受保护目录，不向受管 Runtime 暴露用户 socket 或全局查询工具。

日报逻辑位于共享 TypeScript 模块，供 Node CLI 与 Electron Main 复用；它负责日历边界、冻结、趋势、可比较性和分析输入。Main 准备器与原有 Automation 派发相互独立，准备受阻不能使普通定时任务停摆。分析 Agent 必须验证昨日报告身份再解释，不能把旧文件当成功。

Gate CLI 只编排既有测试与 Qualification 能力，不进入产品执行控制平面。Core、Skill Library、工作区和 MCP 按每个 Trial 隔离；仍使用当前主机的 Runtime 安装／认证，不宣称独立主机 Formal qualification。Runner 保存实际版本、预算、产物、终态、Ledgers 和 Evidence；规则与 Judge 各自保留证据，外层 Gate 不覆盖 HardOutcome。

评分配置与 Case 题目分别冻结。Judge 的显式 generic-task profile 保留 Process／Outcome 证据隔离，代码将逐项判定汇总为通用质量三个维度和协作状态分布。质量先汇总同一 Case 的计划重复，再使用固定 Case 权重；协作以计划 Trial 为统计单位。旧 Judge profile 不改写，评分升级不重新解释历史报告。没有汇总协作分，也不把运行健康次数接入任务质量。

共享 HTML 生成器只投影已保存 JSON，不拥有第二套统计事实。固定交互脚本受 CSP hash 限制，文本转义，证据链接限定报告目录且拒绝 symlink。每日分析完成记录是轻量文件记录：校验报告／输入摘要和引用存在性，保留全部提交，替换最新分析指针与 HTML；分析 Agent 不修改统计。生成、分析与页面分别失败时，已有证据保持可读取。

每周 CLI 与自动触发分开验收。当前 macOS 不接受受管进程再次施加沙箱，Rovai Automation 内启动子 Runner 的路径受阻；本版不扩大 Host 到任意命令执行器。每日 Host 准备统计文件、Automation 读取解释的路径不需要嵌套 Runner。

第一版不增加执行来源／历史 build 数据列。代价是日报覆盖必须显式声明未知；后续若补 provenance，应独立设计所有入口及 A2A 继承，不能只补一列后回填推测。精确记忆计数也不在此阶段提前近似实现。
