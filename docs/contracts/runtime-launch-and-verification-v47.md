---
document_type: contract
name: Runtime Launch and Verification
version: v47
status: accepted
source_version: v1.72
last_updated: 2026-10-04
---

# Runtime Launch and Verification v47

继承 [v46](runtime-launch-and-verification-v46.md) 的启动、审批、平台准入、资格和恢复边界。
本版扩展 [v40](runtime-launch-and-verification-v40.md) 的启动设置，仅为 Claude Code 与 Codex 提供
原生连接配置的读取、编辑和执行接入，不认证中转或模型能力。证据见[本期验收](../versions/v1.72/runtime-custom-api-verification.md)。

## 配置权威与输入

原生设置及其实际凭据来源是连接权威。打开页面、重新进入或失败重试只读取，不导入、迁移或复制 Key。
已存在的原生连接不以点击保存为使用前提；原生可使用的凭据引用不以 Host 能取得明文为前提。
普通 SQLite 启动记录仍拥有程序路径、非凭据环境和独立 `_connectionMode`，不保存 API 地址、模型或 Key 副本。
`customApi` 是读取投影；内部冻结连接只保存来源、配置身份和摘要，不含密钥。

| kind | 投影字段 |
| --- | --- |
| `claude-code-cli` | `mode`、`baseUrl`、`models: {model, reasoningModel, haikuModel, sonnetModel, opusModel}` |
| `codex-cli` | `mode`、`baseUrl`、`models: Array<{rowId,id,displayName}>`、`defaultRowId`、`defaultModel` |

`mode` 为 `official_login | custom_api | null`；已保存的选择优先，首次才依据原生接口及认证状态初始化。
没有发现 Key 不代表官方已登录。`rowId` 只作编辑身份，不写入原生模型目录；编辑 ID 时不改变当前行或默认选择。
模型 ID 非空、唯一，启用 API 的 Codex 至少一项且恰有一个默认项。删除默认模型先选另一项；不可用的成员显式模型
保留原选择，提示“当前接口未配置此模型”，执行不悄悄换模型。

`runtime.startup.get/save` 返回 `credential`（状态、来源标签、版本摘要、可替换／可清除能力和具体限制）、
`connectionObservation`（首次方式、独立登录状态、冲突）、`nativeRevision`、`connectionReadError`，以及本次保存的
`nativeWritten/reconnectRequired`。不回传原 Key 或可编辑的私有凭据对象；密码框用状态生成掩码，眼睛只显示本次输入。

`runtime.startup.save` 接受 `runtimeKind`、`edits: Array<{path,before,after,label}>` 与写入专用 `apiKey`：

- 缺省或 `{action:"keep"}` 保留当前来源；清空尚未保存的输入恢复 keep。
- `{action:"replace",value:"…"}` 替换当前连接的原生 Key；拒绝空白、控制字符和掩码。
- `{action:"clear"}` 为明确清除，不等于退出官方登录；只操作该 API 凭据。不可写的来源说明具体处理办法。
- 替换／清除须带 `credentialVersion` 字段补丁，以摘要处理并发，不把 Key 放入补丁的 before/after。

保留旧的程序路径／普通环境保存形状作为有修订校验的兼容入口；它不能写原生连接或 Key。
新表单只提交修改字段。保存重读当前来源，比较原值、草稿和最新值：不相关修改合并；相同结果幂等；真正冲突返回
`{status:"conflict",latest,conflicts}`。界面保留全部草稿和本次 Key 输入，按字段选择我的／外部值，然后再次校验。
原生读取失败不阻塞独立的程序路径或普通环境保存。写入前再次核对原生字节；原子替换失败不破坏旧文件。
TOML 保留未知字段和注释，JSON 保留无关字段；不替换整套 Home、不清除 OAuth 或登录状态。

地址为有主机的 HTTP/HTTPS URL，拒绝内嵌账号密码和 fragment，保留路径前缀，不自动补 `/v1`。
HTTP 有传输风险提示。保存只做本地校验、目录构造和解析，不触发探活、模型列表请求或测试提示词。
既有 Runtime 检查／认证／协议初始化继续沿用，没有新增测试 API、后台轮询或同步面板。

## 原生读写与运行接入

Claude 使用实际 `CLAUDE_CONFIG_DIR`／原生 Home 下的设置、相关环境和凭据引用。新 Key 写入原生
`env.ANTHROPIC_AUTH_TOKEN`，按 Bearer 发送；已有 `ANTHROPIC_API_KEY`、环境引用或 `apiKeyHelper` 继续按原生方式复用。
五项模型分别映射 `ANTHROPIC_MODEL`、`ANTHROPIC_REASONING_MODEL`、三个
`ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`；清空字段消除对应值，不把所有家族填成主模型。
Thinking 只作兼容字段透传，不改推理强度，不把变量进入进程当成运行时实际识别。
子进程环境和原生 `--settings` 控制连接选择；Key 不进入 argv 或派生 settings 文件。
既有初始化中的 `get_settings/get_status` 核对有效地址、认证来源、值和模型；冲突明确失败，不尝试其他认证。

Codex 使用实际 `CODEX_HOME`、活动 profile、provider、模型目录及引用凭据；来源不局限于 auth.json。
普通 env 引用不可写时仍可换 Key：adapter 在当前原生 provider 中使用该版本支持的 inline bearer，并解除该连接的旧 env 引用，
不改外部环境，不复制旧 Key，不改官方登录文件。原生管理凭据保持由原生运行时消费；受限组合明确报告来源与限制。
正式子进程使用带连接身份的内部 provider，绑定地址、私有环境引用和 Responses；其标识不进入用户表单。
`config/read` 与 thread start/resume 的返回核对实际 provider；旧接口或优先认证字段不能静默生效。

修改 Codex 模型列表时，从实际选择的可执行文件读取经版本核对的完整资源。精确匹配用原生元数据，未知 ID 用目标版本
原生 fallback，不按名称猜能力。保留内部条目，不用 model/list 响应替代完整目录。目录在原生配置目录内按内容修订生成，
不含 Key；生成失败不修改 config.toml 指针。现有合法原生连接的读取和使用不要求先重新生成目录。
不支持的资源／包装程序只对目录编辑报具体兼容错误，不据此建立官方模型白名单。

## 官方登录与兼容性

官方登录与登录状态独立。Claude 复用原生 Claude 账号，Codex 复用 ChatGPT 登录；切换不删除账号，不接管 OAuth、额度或刷新。
执行中的官方路径必须排除自定义地址和凭据，而不是把停止覆盖换个名称。原生配置及 API Key 保留待用。
原生认证文件仅保存 API Key、而版本无法无损选择 OAuth 时明确限制；不得用可能注销原凭据的
`forced_login_method` 强行切换。登录提示用“本机”，由用户在相应 CLI 完成操作。

编辑的是共享原生配置，其他 CLI／应用也可能受影响，页面一次说明作用范围。保存成功不等于热切换成功。
连接、凭据摘要与模型目录进入既有 Host 和 binding compatibility digest；新执行重新读取，不误用旧认证进程。
运行中的进程可以继续使用已捕获值；重建／恢复旧快照前核对实际来源，变化时明确要求重新连接，保留 Rovai 历史。
不通过保留旧 Key 副本重放旧快照，不无条件承诺外部运行会话不受共享文件变化影响。

## 凭据与资格边界

Key 只存在原生凭据位置和必要的运行内存／子进程环境中；原生文件写入沿用受限文件权限和原子替换。
草稿检查只使用内存中的新 Key。写入输入不实现 Debug/Serialize，不进入命令回执；解析错误不嵌入原文。
原生私有配置响应独立消费，输出边界清除已知当前 Key；未知来源不会被冒充已经验证。
模型能力声明、目录解析成功、本地假服务实测和真实中转能力必须分别记录。没有新增真实服务验收不阻止保存。
Kimi/Grok 的既有路径、平台准入、Skills、MCP、协作工具、审批与取消保持原合同。
