---
document_type: contract
name: Runtime Launch and Verification
version: v25
status: accepted
source_version: v1.28
last_updated: 2026-08-24
---

# Runtime Launch and Verification v25

v25 replaces [v24](runtime-launch-and-verification-v24.md). v24 的用户原生 Runtime Home、Probe 隔离、
continuation、External MCP 与逐平台准入保持不变；本版拥有 Cursor 普通入口隐藏边界，以及 v1.28 新增的
第十三种 Grok Build Runtime 启动、认证、provider 与公开输出合同。

## Grok Build

- identity 为 `grok-build`，命令为 `grok`；ACP argv 为
  `--permission-mode <effective> --no-auto-update agent --no-leader [--plugin-dir <private-root>] stdio`；
  initialize 后只能选择已广告的非交互 `xai.api_key` 或 `cached_token`，不得自动启动 browser/device auth；
- 模型/provider 使用官方 `$GROK_HOME/config.toml` 的 `[models]`、`[model.<id>]` 与
  `[model_providers.<id>]`；Core 不再定义或翻译 `GROK_MODEL_*` 三字段，也不修改官方配置；
- `$GROK_HOME/.env` 是 mode `0600` 的本机密钥环境源。Core 只向 Grok 子进程注入官方 TOML 的
  `env_key` / `env_http_headers` 明确引用项与官方全局 API-key 变量；未引用项不得注入。官方 TOML
  `api_key` 仍兼容；
- 正式 Host 不覆盖 `GROK_HOME`。BYOK Probe 把官方配置层复制到临时 Home，但不复制 `.env`；无 BYOK 的
  account-auth Probe 保留原生 Home 读取既有 cached token。配置摘要进入 Host 与 HistoryRestore compatibility；
- Host permission `default|acceptEdits|auto|dontAsk|bypassPermissions|plan` 通过
  `--permission-mode` 投影；新 draft default 为 `bypassPermissions`，Core read-only 强制 `plan`；
- 模型 catalog 来自真实 Session；显式模型只调用已验证的 `session/set_model`，不声明或调用
  `session/set_config_option`；
- Kimi/Grok 不对 `<think>` 或其他 provider agent text 做专用清洗、重分类或抑制；标准
  `agent_message_chunk` 原样进入执行台 Evidence、final 与 Missing-Send candidate，只有通用 trim；
  `_x.ai/*` notification 不生成公开输出；
- warm Host 进入 Runtime Fleet LRU。当前版本 load-only，cold exact continuation 使用
  `session/load` HistoryRestore 与 replay quarantine；没有 `session.resume` 能力时不得使用 Resume 文案；
- Native Session Bootstrap 内容与 Formatter 3 不变。新 Grok Session 必须把完整 Bootstrap 原样追加到
  `session/new._meta.rules`，首轮与后继 `session/prompt` 只含 Dynamic Context；不得出现
  `systemPromptOverride`，same-host/load 不得重复注入，replacement new 必须按新 Binding/generation 注入一次；
- compaction detector release default 为 `best_effort`，只接受 exact Session-scoped、无 request ID 的
  `_x.ai/session_notification` `auto_compact_completed`，并要求非空 `_meta.eventId` 与非负 `tokens_after`。
  completion 只推进既有 Bootstrap Redelivery revision，下一次尚未 prepared 的 Core 输入用 Envelope v2；
  replay、started/failed/cancelled、文本与 token heuristic 不得准入；
- External MCP 为 `AdditivePerRun / NativeWinsSkip`：当前真实 Runtime 忽略 ACP Session `mcpServers`，Core 改用
  私有临时 Plugin 的 process `--plugin-dir`，保留 inspect 发现的全部 native 名称并随 Host 清理，不写
  project/user config；Skill group 为 `grok` / `.grok/skills`，原生发现已实测；Usage/Cost disabled。

## Cursor 普通产品入口

`cursor-agent` 继续作为 closed `AdapterKind` 保留在 Product Runtime Catalog，用于稳定 identity、Migration、
历史读取与后续实现。三个目标平台仍为 `not_qualified`，普通 discovery、检查、成员新配置和 AgentRun 均不准入。

在后续合同以真实产品证据明确开放前，Renderer 必须同时满足：

- Settings 的 Agent Runtime 目录不渲染 Cursor row；
- 未配置 Runtime 或配置为其他 Runtime 的成员，其普通 Runtime selector 不渲染 Cursor option；
- Renderer 使用同一受审查的可见 Product Runtime 集合驱动以上两个入口，不得因复制全量 `AdapterKind` 清单
  重新暴露 Cursor；
- 历史上已经保存的 Cursor 配置仍可按 closed reader 投影，Runtime 子对象保持只读；保存姓名、角色等无关字段
  时必须原样保留，不得制造 `execution_mode`、`approval_policy` 或替换配置；
- 隐藏 Cursor 不删除其 logo、label、Migration、Adapter、平台 Admission 或历史数据 reader。

## Acceptance

- 无 Runtime 的新成员配置页不包含 `Cursor Agent` option；
- 已配置其他 Runtime 的成员配置页同样不包含 `Cursor Agent` option；
- Settings Agent Runtime 目录继续不包含 Cursor row；
- 历史 Cursor 配置保持可读取、不可修改，其他成员字段更新不改变 Runtime 子对象；
- v24 的十二种 Product permission defaults 不发生变化，Kimi 新 draft 仍为 `permission_mode=yolo`；Grok
  新 draft 为 `permission_mode=bypassPermissions`；
- Grok 新 Session wire 只出现一次 `_meta.rules` 且不含 `systemPromptOverride`；真实 structured completion
  推进一次 revision，下一轮 accepted ACK 后 requested/acknowledged 收敛且不重复。

## References

- [Runtime Launch and Verification v24](runtime-launch-and-verification-v24.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Member workspace surface brief](../../apps/desktop/.impeccable/surfaces/member-workspace.md)
- [v1.28 model-context change revision 2](../versions/v1.28/model-context-change-grok-native-rules.md)
