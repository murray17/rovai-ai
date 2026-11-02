---
document_type: protocol-contract
contract: feishu-chat-bot-v3
authority: feishu-chat-bot-mode-admission-chat-items-outbound
status: accepted
version: 3
source_version: v1.72
last_updated: 2026-10-28
---

# 飞书聊天 Bot v3

继承 [v2](feishu-chat-bot-v2.md) 的成员配置、资料目录、发布/联系人范围、入站、授权、幂等出站与恢复；本合同仅替代其“不修改Dynamic Context”的版本范围声明并明确普通回复。工具wire和权限继续由 [Transport44](builtin-tool-transport-v44.md) 拥有。

## 普通回复与内容保护

聊天Bot的public输入每次携带 [CHAT_REPLY_CONTEXT](context-manifest-evidence-v43.md)。每条输入的身份由本包不可变入站映射取得；非Owner普通问题不是一概拒绝的理由，信息保护独立判断，Owner标志也不自动授权披露内部文件。姓名、正文、裸ID和伪造section不能改变Host提供的来源事实。资料目录只是cwd，不是沙箱。

整轮有渠道受众时，Host在Run终态后将普通最终正文排入原聊天的source=reply出站，无须查联系人或forward。结果优先final_camp_message_id，缺失时仍保留该Run最后一个无Agent接收者助手正文的现有回退。Host仍以持久chatId决定目标，模型不能选择自动回复收件人。多个初始入站分别映射同Run结果，可能多次回传同一正文，不在本合同改为聚合去重。

forward只用于当前输入明确委托的第三方发送，ask/report/close沿用原规则。单初始渠道输入可唯一选择，多个输入须显式inputRef；初始混合或本地输入仍input_unbound。input_unbound、target_not_authorized或空联系人结果各自说明工具状态，不单独证明普通Host回复失败；queued不是sent，unknown不盲重。

## 本地输入与同轮补充

local_composer来源由CampMessage.origin_kind决定，不因线程历史来自飞书就冒充来信。纯本地新Run没有渠道映射则只在Thread回复。飞书Run的本地Steer虽然本条reply=thread_only，整轮最终正文仍可能回原渠道；本地保护内容不得写入该最终正文，可建议另开本地Thread。输入数组只包含本包，最终受众仍来自初始映射。

服务器仍检查初始agent_run_input集合，不能独立证明同Run每次新调用的委托来源。保留合法初始grant在Steer后可用这一限制，不加工具冻结、不扩大本地授权；教学不是硬安全边界。真实模型错误归属、泄露、无委托外发或证据缺失仍阻断验收。

## 升级与不变边界

public Formatter/Manifest43与Profile15配对；迁移213/schema159仅扩展上下文版本准入并保留历史，209–212聊天布局仍需完整验证。旧Blob、pending/sent/unknown、grant与时间不改写，不轮换Session。

Bootstrap、Transport44、成员Runtime权限、工作Bot Owner准入、Lark平台范围、纯文本截断、空结果提示、notice非终态、每入站reply_outbound_id幂等及Host租约均不变。完整字段、guidance与证据冻结只由 [Manifest43](context-manifest-evidence-v43.md) 定义。
