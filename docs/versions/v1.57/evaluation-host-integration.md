---
document_type: implementation-plan
version: v1.57
status: in_progress
last_updated: 2026-09-10
---

# 评测宿主接入与失败复核

开发者已明确授权走通 CLI、Rovai 定时执行与实际评测，并复核旧十二项回归的失败。此增量不修改产品上下文、内置 Skill 或评分权重。

## 实施边界

用户终端通过 `rovai app eval` 配置一个本机开发者 Runner，手动提交 Gate／weekly 或将 frozen weekly plan 绑定现有 Automation。复用已有源码、Node、Rust 工具链与 Runner，不把开发工具链随普通 App 全量分发。注册时记录执行器和源码身份，发生变化后要求重新注册；不接收任意 shell、环境变量或 Core method。

Main 观察已由现有 Scheduler 正式接纳的 AutomationRun，以该 runId 去重并启动宿主子进程。Agent 不调用 owner IPC、不启动嵌套 Core，只读取当前 Camp 对应的报告回执并解释。辅助等待命令只读文件且有截止时间，不新增 Agent Built-in 或全局上下文注入。手动关闭、取消、超时或 App 退出终止本次子进程；重启保留 interrupted，不自动重派发。Automation 的一小时合同不变，定时评测预算须留下分析时间。

配置和执行回执使用受 User Automation OS denial 保护的本机文件；报告仍在显式输出目录，普通用户未配置时不启动评测、不创建记录。无需数据库新列、独立服务或新工作台。评测执行完成与 Gate 通过是两个字段；Judge 未配置时仍可验证调度链路，但不能宣称质量验收通过。

## 失败复核

按旧证据区分：评测器未生成结果、运行或预算问题、实际交付失败、Case 规则与公开要求不一致。先重放已有证据和产物，再在相同标准下真实重跑。只有能证明公开要求与检查不一致时修订 Case、重新准入和 seal；原始报告保留，不把新规则重算结果覆盖到旧报告。

## 验证

覆盖 owner CLI 与受管拒绝、正式 AutomationRun 触发、同一运行幂等、陈旧报告拒绝、版本漂移、关闭／恢复、取消子进程及隔离 Runtime。真实运行使用独立 userData、Skill Library、MCP 与任务工作区。保留完整尝试、实际配置、模型和未完成原因；验收状态在实现后补充。
