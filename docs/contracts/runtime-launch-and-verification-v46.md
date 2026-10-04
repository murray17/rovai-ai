---
document_type: contract
name: Runtime Launch and Verification
version: v46
status: accepted
source_version: v1.72
last_updated: 2026-09-30
---

# Runtime Launch and Verification v46

继承 [v45](runtime-launch-and-verification-v45.md) 的启动、控制通道、ID、Run fence、结果结算和关闭边界。
本版替换 Claude 权限选项限制，增加用户显式选择的原生规则记忆；Action/Approval 数据结构不变。

## Claude Code 原生权限选项

stdio `can_use_tool` 提供原 input 与可选 `permission_suggestions`，不提供按钮标签数组。
Adapter 使用已核实的 Claude Code 2.1.280 原生英文文案：一次允许为 `Yes`，拒绝为 `No`，
规则记忆沿用 `Yes, and don’t ask again for: …`；无 pattern 的完整工具规则使用原生 any-command 模板。
界面语言切换不翻译 Claude 或其他 Runtime 的原生选项。历史 Claude Approval 的两个旧中文 host 标签
在展示时映射为 `Yes` / `No`，冻结 ID、响应 digest、数据和决定身份保持不变。

一次允许继续返回 `{behavior: allow, updatedInput: 原 input}`，不携带 `updatedPermissions`。
仅当请求未设置 `suppress_always_allow_rule`，或明确为 false 时，才从原生建议产生记忆选项；
true 或不识别的 suppression 值不得提供该选项。缺少建议、无效或未支持的建议不会自动生成规则。

当前支持的建议为 `type: addRules`、`behavior: allow`，destination 必须明确为 `userSettings`、
`projectSettings`、`localSettings` 或 `session`。rules 必须非空，每项有非空 toolName；ruleContent
可以缺省，若存在则必须为非空字符串。其他更新（包括 setMode）不产生记忆选项，不自动切换权限模式。
每条有效建议分别形成冻结选项，ID 使用建议的 canonical digest；相同建议仅显示一次，不合并不同建议。

用户选择记忆后，通过原 request_id 返回 allow，updatedInput 保持原 input，updatedPermissions 仅含
所选原生建议，所有字段和 destination 原样回填。规则保存、优先级、未来匹配和持久期限由 Claude 原生实现
拥有；Rovai 不另存权限规则，不扩张 pattern，不改写成员配置，不自行写用户 settings。

记忆选项的 consequence 保留逐条原生 `toolName(ruleContent)` 范围和 destination 元数据，供冻结响应与审计使用。
Dock 只显示原生按钮标签及其规则范围，不额外展示保存 destination 或配置文件说明；内部 consequence 不展示。
所有选项使用内容宽度按钮，空间足够时同行排列，不足时自然换行；不为记忆选项强制预留整行。

记忆选项使用既有 other kind，allows_action 为 true，仍由冻结 nativeResponseDigest 约束和既有 Delivery
串行投递。用户记住规则不证明工具执行成功；实际工具结果仍使用原 tool_use_id 结算。取消、断线、迟到决定、
epoch 失效及 unknown/reconciliation 边界继承 v45，不增加审批入口、表或整轮工具输入缓存。
控制 writer 只为未决请求保留有效记忆响应的 digest；允许一次仍核对原 input，带 updatedPermissions 的
允许还须精确命中本请求建议响应的 digest。更改范围、destination、原 input、借用其他请求建议或违反
suppression 均拒绝。请求完成、取消和断线时随既有 pending 状态清理，不扩大为整轮工具缓存。

## 验证

确定性输入矩阵扩展既有 claude_permission owner，验证建议透传、目的地、suppression、无效建议、重复建议
和独立响应 digest。
控制写入与取消扩展既有 claude_control writer/reader seam owner，验证精确记忆响应、范围/目的地篡改、
跨请求借用及取消/断线后的迟到记忆响应不会写入。
生产 ApprovalDock 夹具覆盖中英文界面下原生英文不变、旧标签兼容、决定身份、完整原生标签可访问、
配置文件说明不展示、空间足够时一排及不足时两排、桌面/手机长规则换行。实际 Desktop 验收先保留允许一次和拒绝，再点击记忆并核对隔离项目 settings
仅保存选中规则；后续 Run 无新增 Approval、真实 Core send receipt 和 exact message 均存在。

原生语义参考[官方 Approve and remember 文档](https://code.claude.com/docs/en/agent-sdk/user-input#respond-to-tool-requests)。
版本、验收结果和边界记录在当前版本实施计划；此前仅允许/拒绝或旧 Hook 的 Smoke 不证明本版记忆流程通过。
