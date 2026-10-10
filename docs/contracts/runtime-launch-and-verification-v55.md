---
document_type: contract
name: Runtime Launch and Verification
version: v55
status: accepted
source_version: v1.72
last_updated: 2026-10-10
---

# Runtime Launch and Verification v55

继承 [v54](runtime-launch-and-verification-v54.md)，仅收紧 Pi 目录观察、思考强度与同模型续接。
其他 Runtime、Fleet、任务准入、认证、Session 恢复与进程回收合同保持。

## Pi 目录观察

Pi Picker 请求复用 Check Manager 的容量、同环境请求合并与临时探测 Host，始终执行目录专用探测。
准入依据当前静态安装、选中程序及生效启动环境，不要求 Ready/authenticated 快照，也不自动升级完整检查。
进程和文件验证在数据库与配置提交锁外执行；写回仍核对安装、程序指纹、环境 generation 及请求归属。

整目录沿用 `adapter_capability_snapshot.model_catalog_json` 和 `model_catalog_succeeded_at`。
默认模型 sentinel 的 `runtimeMetadata.piCatalogIdentity` 保存 installationGeneration、executableFingerprint、
searchGeneration；读取以这些独立归属和观察时间判断缓存可用性，沿用 60 秒/24 小时边界。
无健康行时仅初始化 unknown/installed_unverified 的存储行；有行时只更新目录及其时间。
不推进完整检查成功时间，不清除健康失败或共享 stale_at，不改变任务/队员状态。没有新目录表或健康状态机。
旧目录缺少独立归属时只按既有历史展示规则保留，下次打开 Picker 进行一次目录专用观察。
已解析但能力未知的模型标记 unknown，不因 unknown 重复刷新。页面打开、Runtime 或模型切换均不逐项探测。
Pi 打开请求等待共用观察的最终结果，Renderer 等待时保留缓存列表，失败反馈不借用健康诊断。

合法响应且身份匹配、没有收到可归属本轮的目录错误时，可以替换当前展示列表。
fresh 仅表示观察近期取得，不证明 Provider 完整加载或任何模型能生成。
原生 `extension_error` 的 `register_provider` 错误可归属专用探测 Host：即使 RPC 返回合法条目，也按刷新失败
保留旧目录/成功时间。RPC 失败、超时或非法数据同样保留；身份变化丢弃结果。任意 stderr 不构成目录失败。
Pi 内部 `ModelRuntime.getError()` 不在 `get_available_models` 响应里；未暴露的错误不能凭空变成完整性字段。
没有逐 Provider 缓存、合并历史列表、生成请求、额外凭据验证或完整性证明机制。

## Pi 思考强度与执行

Core 用单一纯解析器将原生 model 映射为 `ModelDescriptor.options` 的 `thinking_level` enum，scope=session，
不提供推算的 defaultValue。metadata 的 piThinkingSchemaVersion=1、piThinkingState=known/unknown 标明解析状态。
reasoning=false 只有 off；reasoning=true 时 off/minimal/low/medium/high 默认可用，thinkingLevelMap 的 null
排除对应档位，xhigh/max 仅在显式非 null 映射时出现。字段缺失或类型错误保持 unknown，不猜模型名称。
选项值保留 Pi 原生 token，不保存 Provider 映射值，不改存为 reasoning_effort。

保存只校验显式模型 ID、options 对象、thinking_level 键与字符串类型，原样保留未知枚举值。
目录刷新及 Pi 模型切换都不能清空已填强度；缺席模型不等于删除或永久失效。
已选旧值继续显示“当前目录未提供”或“尚未核对”，用户可重新选择或清除。
无显式值且已知只有 off/空档位、或能力未知时隐藏强度控件；可调时提供“跟随 Pi 原生设置”。
runtime_default 形状不变；切回默认不携带 override。历史只读取对应 Run 冻结的 thinking_level。

领取任务 Host 后，先创建或精确恢复目标 Session 并验证 ID/file/cwd/managed binding，再 get_state 比较
Provider + 原生模型 ID。相同则跳过有副作用的重复 set_model；不同才调用原生 set_model。
未指定强度时不发送强度设置：同模型续接保留激活后的值，真正切模接受 Pi 原生默认行为。
指定强度时，在必要选模之后 set_thinking_level，并 get_state 严格核验模型、Session 与实际强度。
原生收窄不是成功，错误带请求值及已观察到的实际值；配置失败不创建替代 Session，不增加 Host 重启条件。
清除 override 只表示今后不额外指定，不回滚旧档位，不解析全局设置推算默认值，不建立恢复栈。
