---
document_type: contract
name: Runtime Launch and Verification
version: v57
status: accepted
source_version: v1.72
last_updated: 2026-10-11
---

# Runtime Launch and Verification v57

继承 [v56](runtime-launch-and-verification-v56.md)。本版将用户环境配置从 Agents 移至 Teammates；
安装、程序路径、原生权限、Warm 复用范围和 Runtime 平台资格不变。

## 队员私有配置

配置作用域是当前 Host、队员实例 ID 和 AdapterKind。同名队员、其他 Host 或其他 Runtime 不共享覆盖。
最终子进程环境为 Host 捕获环境叠加队员 JSON 对象，同名覆盖、不同名追加；删除对象中的变量恢复 Host
继承，空字符串仍是覆盖。没有自动清除整组 Provider 变量、`unset` 列表、Provider 档案或额外模式开关。
变量值是字面量，不展开 Shell 表达式。程序仍由安装发现层选定的绝对路径启动，队员 PATH 不改变该选择。
Rovai 协议和 Adapter 内部保留变量在最后应用；拒绝队员写入保留名、重复名、非字符串、NUL 和超限值。
Windows 同名比较忽略大小写。上限沿用 128 项、名称 256 字节、单值 64 KiB、合计 128 KiB。

`member.runtimeEnvironment.get` 接受 `memberId / adapterKind / reveal?`，默认只返回 revision、普通值和
敏感值的 `<saved>` 标记；Owner 显式查看时才返回原值。`members.runtime.set` 的私有输入可增加
`environment: { expectedRevision, json, confirmTargetChange }`。Host 解析 JSON 并生成私有 HMAC 回执，
领域 Command 仅接收该回执。模型、权限与环境新版本在同一事务提交，沿用成员 expectedVersion 和命令幂等。
未提交 environment 时保留该 Runtime 原配置；空对象明确清除覆盖。`<saved>` 仅保留已有凭据，不能创建密钥。
变更目标地址并沿用原凭据需要明确确认；保存无需网络成功，不提供队员检查连接接口。

环境值位于 Host 私有 SQLite 表，以 AES-256-GCM 加密。Host 私有 key 文件使用现有跨平台私有文件原语；
丢失、损坏或无法访问时明确失败，不重建密钥后继承其他账号。公开资料、命令、事件、导出和 Agent 工具不携带值。
模板、复制和应用到其他队员只携带既有运行选择，不复制环境或密钥。通用变量编辑不是恶意同 UID 进程隔离。

## 冻结、Warm 和恢复

准入事务捕获完整有效环境及队员 revision，保存不可变私有计划；Frozen Runtime 只携带不含明文的 planId、
revision 和 Host 私有 HMAC 身份。执行、辅助启动和重试读取这一计划，不读取最新队员配置。
读取失败阻止执行。显式传递涵盖 fleet 创建的独立异步任务，不能仅依赖不被新任务继承的 task local。

有效进程环境身份进入 Host 与 Native Binding 兼容摘要，不把队员 ID 或 revision 加进 Warm 进程摘要。
相同有效配置继续按原 Pi 工作区、ZCode Camp、其他 Runtime 既有范围复用；不同配置使用其他进程。
保存不终止旧运行。后续运行不使用旧环境的进程，也不自动恢复不兼容的原生 Session 或重放原生历史。
原有 Rovai 公开会话上下文的提供规则不变。

全局安装/模型目录检查仍只代表 Runtime 的本机默认配置，不能证明队员凭据或模型可用；正式运行由其
真实 Host 验证认证和模型。队员保存不修改其他队员或共享目录的检查结果。

## Claude Code 环境优先级

队员显式模型与 `env.ANTHROPIC_MODEL` 不允许同时设置；runtime_default 不发送 `--model`。
队员覆盖合入既有私有 `--settings` 文件，保留原权限、安全规则与自动记忆控制，不改写用户文件。
涉及连接覆盖时由 Adapter 设置内部 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`，避免原生 settings.env
覆盖 Host 路由。实际验收版本为 2.1.287；连接覆盖要求此版本或之后兼容的 2.x，旧版/未知版本明确拒绝。
并存非空 API Key、Auth Token 或 OAuth Token 时拒绝启动，用户可用空字符串覆盖不用的继承字段。
自定义地址必须在有效环境中有凭据；缺少时拒绝启动，不借用原生账号或 helper。
不把不同认证头互相转换，也不自动填充模型家族映射。

该 Host 开关的路由、托管模型和遥测影响以 [Claude 环境变量参考](https://code.claude.com/docs/en/env-vars)
为准；私有 settings 的普通优先级以 [Claude 设置优先级](https://code.claude.com/docs/en/settings) 为准。
此资格不代表所有 Runtime 对原生账号文件的优先级相同，其他 Adapter 继续执行原生合同。

## 旧配置退役和人工处理

Migration 191 在 schema 140 上创建私有环境版本、冻结计划与旧配置归档，发布 v1.72/schema 141。
归档、旧活动配置移除、marker 和 receipt 同事务提交；归档保留旧值，程序路径不变。
`runtime.startup.get` 不返回旧环境；保存、浅检、深检拒绝非空环境或环境字段编辑，启动不读取旧层。

诊断将每个非空旧配置列在“需要处理的问题”。公开诊断仅含 Runtime、数量、确认状态及私有身份，不含值。
`runtime.environmentLegacy.list/get/acknowledge` 仅属于 Owner 管理面；查看默认遮蔽。
acknowledge 必须提交所见身份，只记录用户已处理，不复制、不删除、不验证迁移。
确认跨重启持久化，按环境内容身份绑定，程序路径变化不重新提醒；旧环境内容变化可重新提示。
已处理归档继续可读。提示不阻塞使用，不纳入自动修复，不要求先确认才停用旧层。

## 界面

采用确认的 R4：队员运行设置的紧凑折叠入口、Claude URL/API Key JSON placeholder、自适应短文本框、
无点击高亮，沿用保存/放弃/离页草稿保护。无继承说明或检查连接按钮。所有新文案提供中英文。
诊断明确说明配置从 Agents 移到 Teammates，需要用户手动复制仍需使用的变量并保存。
