---
document_type: protocol-contract
contract: feishu-chat-bot-v2
authority: feishu-chat-bot-mode-admission-chat-items-outbound
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-10-21
---

# 飞书聊天 Bot v2 合同

本合同拥有聊天 Bot 的成员开关、资料文件夹工作区、聊天准入、会话投递与出站消息语义，并取代
[Feishu Chat Bot v1](feishu-chat-bot-v1.md)。工作 Bot 的
[Feishu Channel v1](feishu-channel-v1.md) 准入、Camp 绑定、Delivery 与 AgentRun 链路不在本合同内。

## 1. 模式与成员

- 聊天 Bot 不再拥有独立的模型/服务商/密钥配置；回复一律由该队员（成员）已配置的 Runtime
  （ACP）与模型产生，agent_profile.chat_bot_enabled 决定该成员是否作为聊天 Bot。
- 凭据不再存在 channel_chat_credential 中；该表停用，只保留历史数据。
- 回复的执行根是 agent_profile.chat_materials_path（资料文件夹）。资料文件夹为 null 时
  聊天 Bot 不受理入站，并在渠道页给出提示。
- 成员的 Runtime 或模型未配置时同理不受理；渠道页不再提供任何聊天模型配置入口。

## 2. 发布与通讯录查询

- 飞书聊天 Bot 创建新发布版本时申请“全员可用”（visibleSuggest.isAll=1、members为空）；普通工作 Bot 维持仅 Owner 可用。此规则不扩大API权限、不修改通讯录数据权限，也不改变Lark当前发布范围。
- 已发布版本的恢复和复用维持原行为，不以恢复成功宣称其适用范围已变更；既有部分成员版本需要显式发布新版本或在飞书后台调整。
- 通讯录查询使用当前 Bot 的 tenant_access_token：先读取 contact/v3/scopes，再读取授权用户、授权部门及其子部门。禁止固定以根部门0代表实际权限范围，禁止使用应用令牌调用仅支持用户令牌的search/v1/user。
- 可用范围和通讯录数据范围分别由平台控制；数据范围配置为跟随可用范围时，发布后以实际返回的授权范围为准。不读取授权之外的用户，不申请额外敏感字段。

聊天 Bot 的本地发布记录删除遵循 [Feishu Channel v17](feishu-channel-v17.md#4-本地删除发布绑定)：
清除旧发布意图和 App 凭据后可重新创建应用，保留队员的聊天开关、资料目录与历史会话，不删除远端 Bot。

## 2.1 会话投递

- 每个外部 (provider, app_id, chat_id) 复用一个聊天线程：create_channel_camp 以
  binding_kind = Directory、canonical_path = 资料文件夹建 Camp，成员为该 Bot 队员。
- 入站正文通过 queue_camp_message_and_runs 以 ExecutionRequest{completion_role:"required"}
  投递，一次入站最多触发一个 AgentRun；结果取 agent_run.final_camp_message_id 的助手文本。
- 出站回执仍走 channel_chat_outbound：sent/failed/unknown 语义与 v1 第 8 节一致；
  回复只发送纯文本，不发送运行卡、控制台入口或本地路径。

聊天线程在导航中归入独立“聊天 Bot”分组，沿用现有 Thread 会话界面及操作。归组来自
线程创建时保存的聊天 Bot 来源标记，已有 `channel_chat_conversation` 绑定在迁移时回填。
关闭 Bot 或更换资料目录后仍保留已标记线程的历史分类，不依赖成员当前开关或资料目录登记。
本入口不改变入站、出站、Runtime 权限或会话执行行为；导航字段见
[Navigation Read v1](navigation-read-v1.md)。

## 3. 复用队员权限

- 聊天 Bot 直接使用该队员已保存的 Runtime 权限，不再生成聊天专属降档配置。用户设置 bypassPermissions、workspace-write 或手动审批时，分别遵循对应 Runtime 的原生行为。
- 旧会话 permission_override_json 不再参与 Runtime 配置解析；再次接收新聊天输入时清除旧覆盖。已开始的执行仍保留其冻结配置，不在线修改运行中权限或批量批准历史请求。
- 资料文件夹是工作目录，不构成目录隔离或访问边界保证。文件访问和审批取决于队员所选 Runtime 的实际权限能力；不得将 cwd 描述为沙箱。

## 4. 对 v1 的变更

- channels.chat.configure 不再携带 model/modelBaseUrl/credential 字段；删除
  channels.chat.credential.set/get，新增 members.chat.set。
- channel_chat_turn 不再存模型轮次；会话上下文由聊天线程自身承载。
- v1 的独立模型 JSON 动作协议停用；联系人查询、受托转发、代问及事项报告通过受认证的 `rovai feishu` CLI 恢复，接口见 [Built-in Tool Transport v44](builtin-tool-transport-v44.md)。不恢复独立模型配置，不修改共享 Bootstrap 或 Dynamic Context。资料操作仍由队员 Runtime 完成。
- 迁移 210 在 agent_profile 新增 chat_bot_enabled 与 chat_materials_path，保留旧聊天表和历史字段，不自动授予成员 Runtime 写权限。

## 5. 飞书工具与恢复

联系人与目标引用必须属于当前 Run/epoch 和入站输入，不能由模型传入任意 Bot 或 open_id。多输入批次需显式选择 inputRef，不能猜请求者。
Host 用已有私有凭据执行查人；查询结果最多20项，不把原始SDK错误或密钥回传模型。受托发送进入幂等出站队列，排队不表示已送达，unknown不可盲目重发。
代问先原子建立事项与出站，回复以引用或唯一等待事项关联；报告只能回到原请求会话，阶段/补充不自动关闭。
入站与内部消息的持久映射支持Host重启恢复；终态回复入队时原子记录reply_outbound_id，等待审批和超时提示不结束该映射。
原生Runtime审批遵循队员保存配置；聊天模式不再单独覆盖权限，也不在后台批准已有请求。

## 6. 升级准入

- 上游 projection schema 158 不代表聊天迁移完成。只有 209、210、211（工具）、212（导航）收据与对应表列布局一致，数据库才可作为当前权威直接打开。
- 已知的上游 208 布局及仅完成 209 或 210 的布局，必须经正式 DatabaseAdmission / AuthorityMigrationRunner 补齐迁移，再开放成员与诊断读取。
- 两个历史分支曾同时使用211：完整工具布局沿用211并补212；完整导航布局且工具完全缺失时，将原211收据及时间原子归到212，再执行工具211。两布局完整但仅211时补212收据，212已存在而211缺失的已归正中间态可恢复。任何部分布局均拒绝，不能以迁移号单独猜测来源。
- 已有迁移收据但表列缺损的数据库应拒绝准入，不得当作旧库静默修补或清空重建。
- 验收覆盖旧库升级、成员与导航读取、诊断导出、数据保留和重复启动；新库 health.check 单独通过不足以证明升级可用。
