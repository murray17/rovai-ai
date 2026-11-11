---
document_type: contract
name: Runtime Launch and Verification
version: v78
status: accepted
source_version: v1.72
last_updated: 2026-11-08
---

# Runtime Launch and Verification v78

继承 [v77](runtime-launch-and-verification-v77.md) 的现有 Runtime 行为；
本版增加独立的 Kilo 官方 ACP 接入。输入位置按[已确认 R1](../versions/v1.72/model-context-change-kilo-acp.md)。

## Kilo 身份、原生来源与启动

稳定 identity 为 `kilo-cli`，正常发现 `kilo`，显式入口变量为 `ROVAI_KILO_BIN`。
正式进程只使用所选官方 CLI 的 `acp`，不借用 OpenCode 的版本判断、认证、Provider 或配置目录。
Kilo 自身版本与 ACP initialize 结果作为观察，不建立固定版本或二进制 checksum 白名单。

进程创建前设置 `KILO_CLIENT=acp`、关闭原生自动升级并禁用未承接的 question 工具。
Rovai 保留用户原生 HOME、XDG、项目配置与认证；不创建配置镜像或写全局配置。
模型默认值来自该 CLI；显式模型保留原 ID，交由真实 Session 选择结果决定是否接受。

权限字段 `permission` 使用原生 `allow / ask / deny`，新队员默认 allow；
保存的较窄选择保留。只覆盖原生 wildcard，保留工具及自定义 Agent 的原生规则，
不宣称 deny 是 Core 路径沙箱。剩余原生审批原样进入现有审批 owner，不能因 wildcard allow 自动放行。
取消与迟到请求复用既有 Run/Prompt/epoch 生命周期；不叠加文件授权或路径 containment。

## Host、Session 与 Bootstrap

Kilo 使用共享 RuntimeFleet，一个成员的一个 Native Binding 对应一台 resident Host。
健康空闲且进程兼容时 warm 复用；不同 Binding 不共享同一 Host。
MCP 由共享 projection 通过 ACP `mcpServers` 交付，原生配置继续按原生规则合并。
真实分配变化复用既有 invalidation，在正常 Run 边界退役旧 Host，再携带保存的完整 nativeSessionId 恢复；
不在共享 cwd 中用空 MCP 列表假装撤销，也不另建 Kilo 进程池或锁。

恢复优先使用原生广告的 exact resume；仅在广告 load 时使用共享 replay quarantine。
未知错误不解释为“历史不存在”，accepted/unknown 输入不自动重放。
升级程序、Host 退役或 Bootstrap 更新不能单独使合法原生 ID 失效。

Core 在 Host 私有目录保持一个 instructions 文件 F，通过进程级 `KILO_CONFIG_CONTENT.instructions`
追加路径，保留用户其他配置和原生 instructions。每 Run 在普通 P 发送前写入该 Run 已冻结的完整 B。
原生普通生成会读取 F；采用 `managed_system_prompt` 与 `native_system_prompt_preserved`。
不加压缩插件、正文 hash、nonce、装载握手或第二份输入账本。
写入失败按现有准备失败处理；原生 `session/prompt` 的 user 正文只有 P。
冻结、预算、版本与证据均服从 R1 和共享 Context owner；其他 Adapter 保持。

## 活动与数值观察

公开工具生命周期、输出 snapshot、原生终态和 Missing-Send 复用共享 ACP owner。
空 end_turn 合法；thinking 不成为公开正文。工具名未有精确字段时，title 仅为展示提示，
不得据此推导工具身份或私有内容。

Kilo ACP PromptResult 只有最后一步 usage；不把它当整 Run 统计。
复用现有 SQLite numeric reader，从 Kilo 自己的 `XDG_DATA_HOME/kilo/kilo.db`
（缺省使用其原生 data 根）读取当前根 Session 的已完成新消息。
Prompt 前建立 baseline，以原生消息 ID 去重；只选择数值、模型和消息身份，不读取正文/parts。
input/cache/output/reasoning 保持原生互斥桶，output 加入独立 reasoning 一次；
逐消息 USD cost 作为原生 reported cost，不能把 Session 累计费用全额重复归入新 Run。
context occupancy 是 Session gauge，不作为消费量。历史、重发和 cold baseline 不重复累计。

## 平台与验证边界

macOS arm64 以既有 Preview 准入开放主动使用；其余平台为 NotQualified。
Preview 不等同完整 qualification，不生成虚构的 evidence revision 或 SHA256 资格材料。
准入理由见 [D77](../versions/v1.72/decisions.md#v1-72-d77)；
实际版本、矩阵与缺失范围见[Kilo 研究/验证](../research/kilo-runtime/README.md)。
