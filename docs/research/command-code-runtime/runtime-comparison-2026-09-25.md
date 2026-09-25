---
document_type: runtime-research
runtime: command-code
authority: research-evidence-only
admission: research
last_updated: 2026-09-25
---

# Command Code 与现有 Runtime：运行与 Camp 差异

比较基于[Command Code 1.65.2 真实 BYOK Smoke](real-byok-smoke-2026-09-25.md)、当前 Core 实现，以及[Runtime 兼容性记录](../../runtime-compatibility.md)。`已实测`仅指表内写明的版本与路径；不同 Runtime 的产品资格和跨平台结论仍分别由各自 Admission 证据拥有。

| 能力 | Command Code 1.65.2：原生/当前 Rovai | 已接入 Runtime 的对应路径 | 差距或产品影响 |
| --- | --- | --- | --- |
| Warm / Session | 原生每次 `--print` 进程退出，`--resume <完整 UUID>` 新进程恢复同一 Session，真实 BYOK 连续性已验证；Core 只有未调度的内部传输 | Claude Code 同属 one-shot，正式 Adapter 用精确 `--resume`；Codex app-server `thread/resume` 重带 developer instructions；OpenCode 用 ACP Session；Pi 常驻 Host 可在 A→B→A 精确切换 | Command Code 的“warm”是**会话热续、进程重启**，不是 Pi/OpenCode 的 warm Host；尚无 Rovai Binding、Core 重启和 Camp 连续性证据 |
| Bootstrap | 候选 `first_payload` 把 v5 Bootstrap 与本 Run v31 Context 拼为一条**普通 user Prompt**；研究提案 revision 4 待确认 | Claude 的 `--append-system-prompt-file`、Codex 的 `developerInstructions` 属较高指令层；Pi 通过受管 extension 追加 system prompt；ACP Runtime 由各自 Context 策略管理 | Command Code 不具备同等级的指令权威；Core 权限必须独立执行，正式产品差异仍需版本 Decision |
| Compact | 原生交互 `/compact` 已真实发生并可从新进程按同 UUID 恢复旧合成标记；无 Rovai detector 或补发 | Claude/Codex 的 Bootstrap 在普通压缩不触及的指令层；Pi system prompt 独立于历史；OpenCode 的 native Plugin `session.compacted` 已接入 Core redelivery detector | Command Code 首次引导在普通历史中；手动复述成功不能证明 Charter 未被摘要改写。阈值/溢出加重试、压缩后 Core 冷恢复和补发均待证据 |
| Command | 原生 `shell_command` 给稳定 `toolCallId`、`tool_update.partial` 和终态文本；非零退出仍是 `tool_completed` 且顶层 `result.success`。成功 stdout 也能以 `Exit code: 7` 开头；内部 normalizer 已用 live output 排除该实测反例，但未进 App | Claude `Bash` 以 tool-use ID/结果形成 Action，明确 stdout/stderr；OpenCode ACP terminal 从公开 Content Text、必要时白名单 rawOutput 取输出；Pi 原生 Tool 事件已覆盖 stdout/stderr/empty/exit 7 的 Core Smoke | Command Code 缺结构化退出码，文本歧义尚存；需真实 Camp 核对 Action ID、stdout/stderr、空输出、非零、超大输出、取消与终态 |
| Edit | 显式 `--yolo` 下原生 `edit_file` 在私有工作区确实修改文件，固定 `dont-ask` 下被拒；内部只映射 `kind=edit`，结果正文不公开，尚无 Diff Evidence | Claude 原生 `Edit/Write` 进既有 Canonical Activity；Pi 成功 `edit` 的路径绑定 patch 可形成 Diff；部分 ACP Runtime 可给标准 Diff 或仅可靠 path | Command Code App 文件变化卡片当前不存在，不能由工作区扫描、最终回复或原生结果文本补造行级 Diff |
| Read | 原生 `read_file` 完成且模型用到文件中的合成标记；内部映射 `kind=read` 并隐藏结果正文 | Claude `Read` 记录 Activity，但不公开文件内容；ACP/Pi 各自从原生 Tool 事件归一 | Command Code 尚未产生 Camp Action；read 内容保持私有，需验收路径/标题与权限边界 |
| Auth / model | 官方 `providers.json`、`config.json` 的 `sub2api/gpt-6-sol` 能真实生成；当次 `/v1/models` 不列该模型 | 既有 Adapter 有各自 native default/显式模型、Ready/Probe 与配置变化 fence | 不能把“模型目录缺项”直接解释为不可用；需要 Command Code 专属 Probe、配置更新与 Session fence |
| Skills / MCP / permission | `--skill` 与原生 MCP 已有研究，但本次真实 BYOK Smoke 禁用 Skills；内部传输固定 `dont-ask`。1.65.2 实测它允许 `read_file`，却拒绝 `edit_file` 与 `shell_command` 的写入/命令；没有 Rovai Assignment、Approval UI 或 Built-in lease | Claude 有 Run-local `--mcp-config`；OpenCode ACP 可投影 `mcpServers`；Pi 的原生资源加载与无 External MCP 差异已有产品决定 | 直接把当前内部传输接入 Camp 会让 edit/command Golden Flow 失败；需先确定唯一权限权威与原生审批/最高权限映射，再验证拒绝、取消和隔离 |
| Usage / final | `result.success` 是本次原生最终边界；四个 Usage 字段已见，但未归到 AgentRun | 已接入 Adapter 将原生终态与 Usage 映射到 Execution Evidence/Monitoring，未知字段保持未知 | Command Code 的 Action 成败与顶层 Run 成败必须分开；需验证 accepted、Missing-Send、cache 计数 scope 和成本 |

## App Camp 验收状态

当前 `AdapterKind::ALL` 没有 Command Code，App 无法创建该 Runtime 的 AgentRun。因此没有可保留的 Command Code Camp 界面；原生 CLI 输出和隔离文件均不应冒充 App 截图。[接入 Checklist](../../development/runtime-integration-checklist.md)的 First Run、Warm、Cold Resume、Context/Compact、Skills/MCP、Safety/Output、Monitoring、Failure/Cleanup 仍需在正式 Adapter 接线后逐项运行并保留 App Camp。研究数据可辅助设计这些 Case，不能提升平台资格。
