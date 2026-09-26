---
document_type: contract
name: Runtime Launch and Verification
version: v44
status: accepted
source_version: v1.70
last_updated: 2026-09-25
---

# Runtime Launch and Verification v44

继承 [v43](runtime-launch-and-verification-v43.md) 的 Runtime 启动、检查、恢复、权限、证据和失败边界。
本版更新官方 ZCode App 的 Provider Registry 协议适配；其他 Runtime 的语义不变。

## 官方 ZCode 新旧协议选择

官方 bundle 的 `resources/config/provider/zcode-builtin.json` 存在时使用新版 Provider Registry 协议；
macOS 对应 `Contents/Resources/config/provider/zcode-builtin.json`。文件须解析为 bundle 资源目录内的普通文件，
并与定位程序、`glm/zcode.cjs`、独立 Node 一起进入安装指纹。缺少该文件的旧版继续使用
[v37](runtime-launch-and-verification-v37.md) 的 `runtimeModel` 与内存 registry RPC 路径；
不得向新版调用已移除的 `workspace/updateProviderRegistry` 或 `workspace/readState`。

新版 Host 向官方子进程注入 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 和
`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`。后者为 `ZCODE_DATA_BASE_DIR`（缺省为原生 Home）下的
`.zcode/v2/provider_config.json`，只读加载供选择与兼容摘要使用，不复制或改写用户凭据。
bundled/personal 配置内容与绝对路径变化均 fence Host 和 Native Binding。

初始化使用 `workspace/readPresentation`，并核对返回的 workspace identity。普通 Probe 只创建无消息
deferred Session、订阅和设置模式，不发送模型请求。正式创建 Session 使用原生 `ModelSelection`
`{providerId, modelId, options?}`；若个人配置有有效 `defaultModelSelection`，用它作为默认选择，
并把其中的 `options.reasoningLevel` 同时传为独立的 `thoughtLevel`，因为新版创建路径会把
`ModelSelection` 转为不含 options 的 provider/model 字符串。否则由官方内核选择。
恢复 Session 保留精确原生 Session ID，不传旧版 `runtimeModel`。
显式切换使用 `session/setModel` 的 `model` 字段，并核对返回的 provider/model；
在模型目录给出 `reasoning.defaultLevel` 时把它传给原生选择。被原生标为 disabled 的模型不得进入公开目录。

原生错误不得原样公开，以免配置、URL 或凭据进入诊断。方法不存在明确归为协议能力不匹配；
Provider Registry 无可用模型时给出配置个人 BYOK 的指引。Session Probe 的 ready 只证明当前原生目录与
无消息 Session 可用，不证明模型生成、余额或账号权益。
已接受输入在创建 Model 阶段失败时可能没有 `turn.started`；只有 `turn.failed` 的 `inputId`
精确匹配当前输入，才允许从该终态收口，其他 Turn 不得抢占或悬挂当前输入。

新版 app-server 不自动取得桌面 App 的账号 Provider snapshot。Start Plan 的账号同步与临时人机验证、
账号刷新、Team Plan 动态凭据仍未接入；旧版账号路径的历史证据不得外推为新版账号生成通过。
各平台仍按本机实测证据分别判定资格，资源路径与代码构建检查不等于 Windows 真机验收。
