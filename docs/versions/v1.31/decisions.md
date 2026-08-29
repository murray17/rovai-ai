---
document_type: version-decisions
version: v1.31
lifecycle: current
last_updated: 2026-08-29
---

# v1.31 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前规范由链接的 Architecture、Contract、UI 与 Development 说明拥有。

<a id="v1-31-d01"></a>
## V1.31-D01：钉钉控制面使用固定、受审查的 DWS Helper Gateway

### 背景

钉钉队员应用的创建、Robot 配置、权限、版本和审批需要开发者控制面。直接在 Rovai 中复制未公开 HTTP 协议会形成另一个
高漂移控制台 Adapter；任意调用系统 `dws` 又会把 Shell、用户全局 profile、未知命令和 stdout/stderr 暴露到产品边界。
生产账号连接还需要 Rovai 自己的 OAuth Client，不能静默借用上游工具内置身份。

### 决定

Main 只调用随包固定的 DWS 1.0.60 binary，逐平台校验 SHA，并通过无 Shell、隔离 config、固定超时/取消的窄 Gateway
暴露审查过的 operation 与参数。macOS 将原始 binary 封为非可执行资源，运行前物化到按版本与 SHA 分区的私有目录，避免
App signer 重签后破坏固定摘要。OAuth Client pair 只经环境进入 helper，Secret 不进 argv、Core、Renderer 或日志。
创建和 mutation outcome 无法证明时 fail closed。生产包在 public-client/device-flow 或 token broker 明确前保持 NO-GO；
不得复用 DWS 内置 Client ID，也不得回退为人工粘贴 AppSecret。

当前规范见[钉钉渠道架构](../../architecture/dingtalk-channel.md#developer-gateway-与-oauth)和
[DingTalk Channel v1](../../contracts/dingtalk-channel-v1.md#1-actorhelper-与秘密边界)。

### 后果

- helper 升级必须重新审查命令、参数、输出和所有平台 SHA；
- Gateway backend 可被原生公开 API 实现替换，而不改变 Core 渠道合同；
- 缺少显式 Rovai OAuth Client 是可见配置错误，不是假连接或降级路径。

### 被拒绝方案

- **直接调用用户 PATH 中的 `dws`：** 版本、profile 和命令表不可证明；
- **Renderer 执行 CLI 或读取 stdout：** 扩大 Token、Secret 和控制面注入边界；
- **复用 helper 内置 OAuth Client：** 所有权、配额和生产授权对象不属于 Rovai；
- **复制 console 私有 HTTP：** 形成第二个高漂移协议面且没有更强的远端语义证据。

<a id="v1-31-d02"></a>
## V1.31-D02：Provider 专属身份与传输，复用同一个 Core admission/Outbox

### 背景

钉钉的 `corpId/userId/appKey/robotCode`、Stream 与卡片协议不同于飞书，但项目冻结、ExternalPrincipal、根请求 FIFO、
Camp Membership、原子 CampMessage/Turn/Run 创建和可靠输出语义相同。复制一套钉钉 Camp 执行链会让两个渠道在安全与恢复
边界上逐渐分叉。

### 决定

账号、发布、credential、入站规范化、远端 roster、Stream 和 Card 留在 DingTalk Host；Migration 122 只增加钉钉身份表，
再用 provider-neutral directory 把已发布 Bot 和 Owner identity 接入现有渠道聚合、PendingCampBinding、ChannelTurnRequest、
统一原子 admission、Camp Membership 与 ChannelDelivery。所有共享对象都携带 `provider=dingtalk`，但不创建第二套
CampMessage、CampTurn 或 AgentRun 写入路径。

当前规范见[钉钉渠道架构](../../architecture/dingtalk-channel.md#core-复用与入站准入)和
[DingTalk Channel v1](../../contracts/dingtalk-channel-v1.md#5-core-入站与-camp-语义)。

### 后果

- 两个 Provider 可以独立掉线、发布和恢复，但共享项目与执行正确性；
- 钉钉 Host 不能直接写 CampMessage、CampTurn、AgentRun 或 membership 表；
- 共享 Core 语义变更必须同时验证飞书回归和钉钉 provider isolation。

### 被拒绝方案

- **复制 Feishu Core 表和 admission：** 会形成第二套事务、FIFO 和恢复语义；
- **把钉钉 ID 强塞进 Feishu 表：** 混淆不同 identity namespace 与发布状态；
- **Main 收到消息后直接启动 Runtime：** 绕过 Owner、项目、membership 和原子 admission 门禁。

<a id="v1-31-d03"></a>
## V1.31-D03：没有真实协议证据的会话能力默认关闭

### 背景

方案目标包含多 Bot、话题、附件和 AI 卡片，但仓库自动化不能证明钉钉真实客户端会提供完整 canonical mention、话题身份、
app-only 附件投递或 callback 行为。把普通群 fallback 当成话题、把多 observation 猜成完整目标或在附件 API 不明时报告成功，
都会在 Owner 不知情时改变项目与执行范围。

### 决定

当前只准入 Owner 私聊和普通群显式 `@`。topic/thread 字段一律拒绝；同一消息在 3 秒观察窗内到达多个 receiving App 时
整条 fail closed，不启动先到的部分 Agent，其他协作走 Core A2A；出站附件明确失败；卡片能力在真实投递/callback 验收
完成前不提升为生产通过。后续解除任何 gate 必须先取得官方协议与真实租户证据，再更新当前 Contract、测试和版本验收。

当前规范见[钉钉渠道架构](../../architecture/dingtalk-channel.md#当前-feature-gate)和
[DingTalk Channel v1](../../contracts/dingtalk-channel-v1.md#8-feature-gate-与错误)。

### 后果

- 未支持场景不会静默落入错误 Camp 或伪造 delivery success；
- 当前首轮只能有一个钉钉直接目标，但 Agent 仍可通过 Core A2A 使用 Camp 协作者；
- 能力扩张是独立、可验收的合同变化，而不是 parser 的宽松兼容。

### 被拒绝方案

- **topic 缺字段时按普通群处理：** 可能把多个 Topic 合并到一个 Camp；
- **收到几个 App callback 就猜完整多 Bot 集：** 无法证明漏掉的 observation；
- **附件转成路径或 Markdown 链接并标记成功：** 既可能泄露本机路径，也没有远端交付证据；
- **以卡片 create API 代替 callback 验收：** 只证明实例存在，不能证明用户交互闭环。
