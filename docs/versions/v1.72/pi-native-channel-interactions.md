---
document_type: implementation-record
version: v1.72
status: in-progress
last_updated: 2026-11-06
---

# Pi 原生问答渠道桥接

Work item: 飞书/Lark 与钉钉完整接入现有 NativeInteraction。
Branch: `rovai/pi-native-interactions`。
Base: `12c7babff059c12cc1ea3323137d44ef3a7653d7`。
Worktree: `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-pi-native-interactions`。
Governance: none；沿用现有渠道权威和 Outbox，无模型上下文或审批规则变更。

## 实现与边界

Core 当前 Runtime 问题转换为既有 Outbox 的独立 `native_interaction` carrier；Migration 220/schema 170
只放宽该 kind 的现有约束。数据库不保存问题/答案。可信渠道 Host 通过 source/respond 读取当前问题与回传
原生答案，Owner/App/外部卡片/绑定 Thread/Run epoch 校验和 writer 与 Desktop/Web 共用。
关闭卡片是独立 Outbox 更新，发送/更新重试不重放答案；原生 unknown 只保留状态并反馈，不重绘客户端草稿。

飞书/Lark 直接生成 Card JSON 2.0，不依赖发布模板。confirm/select 直接点击；input/editor form 保留原文、
空字符串和预填。跳过在 form 外，不提交输入值。大内容整题转向既有 Desktop/已登录 Web。
普通聊天、内部私聊与其他 Runtime 的问卷策略保持现有路径。

## 钉钉模板：未完成平台验收

没有创建或发布 Rovai 专用模板。当前候选沿用钉钉官方
[OpenClaw Connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/src/questions/index.ts)
的问答模板 `c2a6355b-9724-4f7e-9653-d33fcb3311bb.schema` 与其
[原生 Form 结构](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/assets/dingtalk-ask-user-card-template.json)。
只复用平台表单/回调，不复制该插件的默认 TTL、问题替换或发新 Prompt 行为。
选项回调使用稳定 value；输入原文不 trim，字段缺失不能当成空文本。独立取消回调映射 skip，不提交 form。

该固定模板的限制必须明确：选择/确认均由原生单选列表 + 提交组成，取消按钮固定写作“取消”，不能动态隐藏；
canSkip=false 的通用请求只能回退 Desktop（Pi 四类均支持 skip）。它尚不能证明目标中的确认题直接按钮体验。
不得将本候选宣称为最终钉钉交互，也不要求普通用户导入或发布模板。

官方[能力对齐说明](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/COMMUNITY_CAPABILITY_ALIGNMENT.md)
也明确区分本地测试与真实客户端验收。固定模板 ID 不是 Rovai 自建模板跨企业开放的证据。
验收必须使用第二家企业自己的 Bot/App 凭据和测试会话完成投递、填写、可信回调；同企业第二个 Bot 不足以证明。
该条件、手机/桌面输入表现及未填写空文本的真实 callback shape 尚未验证。

## 测试归属与最低命令

新增一个 Rust owner `channel::tests::native_question_carriers_fence_owner_scope_and_reconcile_terminal_delivery`，
拥有新出现的 Runtime 请求到 Outbox/Owner 回调持久身份边界，覆盖两 Provider、两独立问题、去重、错误 Host/App/
卡片/会话/操作者/请求、旧 epoch、错误 Thread、解绑，以及答案先于投递回执的关闭更新竞态。
现有执行卡测试不经过原生问答入口，不能证明此 seam；使用已种子化的临时 SQLite，无进程、网络或真实凭据。
同一 fixture 扩展 migration owner，证明已有 delivery/索引保留、marker 失败整笔回滚及 foreign_keys 恢复。
最低命令：
`cargo test -p rovai-core --features extended-tests native_question_carriers_fence_owner_scope_and_reconcile_terminal_delivery`。

Main 的纯卡片/答案 parser owner 覆盖四类、独立 skip、空白/空文本、选项 ID、整题 fallback 和稳定投递标识；
现有 Provider Host、Stream、OpenAPI 与 pump 测试扩展自身的真实代码边界。
这些均为受控 fixture，不等于真实飞书/钉钉桌面/手机或跨企业验收。

## 验证状态

详见[机器可读证据](evidence/pi-native-channel-interactions-2026-11-05.json)。

| 检查 | 实际结果 |
|---|---|
| `cargo test --workspace` | 484 通过，1 ignored |
| 扩展 channel owner | 39 通过；新增 unknown 保留表单 case 后，authority owner 再次单独通过 |
| Main 渠道定向 | 飞书/Lark 回调、钉钉投递/关闭、Stream、OpenAPI、pump 和卡片 parser 通过 |
| TypeScript 全量 | 271 个 Vitest 文件，3145 通过、2 skipped；Node 尾段仅旧 schema golden 失败，更新 169→170 后该 owner 单独通过。未将两次结果表述成一次全绿命令 |
| 类型/构建/桥接 | typecheck、Desktop build、Core bins 与真实 contextBridge 通过 |
| 文档 | generic docs:check:ci、docs:test 通过 |
| 真实 Pi 回归 | Pi 1.1.0、rpiv 2.15.0、隔离 Core/本地 Provider 六组通过，外部模型调用为零；此项验证原生回路，不是平台卡片验收 |

扩展 `db::tests::` 首跑 85 通过、8 失败。其中当前数据准入与旧飞书 marker 两条在修复 schema 170
识别/最新 receipt fixture 后定向通过。余下六条不能记为通过：v103/v104/v105/v107 的旧 Runtime 分组
CHECK 失败已在干净基线 `12c7babff` 的独立 checkout/target 复现，验证后该临时 worktree 已删除；
v95/v98 仍断言 formatter SQL 只到 42，与现有 formatter 43 不符，相关源断言本次未改变。
没有禁用、删除或放宽这六条历史迁移测试，本项不冒充扩展数据库全绿。

本项保持进行中；最终完成条件仍是两种渠道内作答准确回到原请求并继续同一 Run，且钉钉模板可被其他企业使用。

## 真实平台卡片推送（2026-11-05）

User 授权向三个渠道测试推送。使用各 Provider 已发布的爱丽丝 Bot，投递到该 App 已验证 Owner 的私聊，
每边 confirm/select/input/editor 四张，共 12 张。直接执行上述提交版本的卡片 renderer 与钉钉 OpenAPI client；
消息使用展示测试题，不创建 NativeInteraction/Run，不连接新的 Stream/WebSocket，不写日常 SQLite。
本轮没有创建或发布模板。

[推送证据](evidence/pi-native-channel-card-push-2026-11-05.json)记录原始投递身份和 renderer SHA256。
飞书/Lark 各四张均被平台接受，并回读确认 interactive 消息存在、未删除、发送者为当前 App；
钉钉官方问答模板四张均返回投递成功及 carrierId，证明该模板在当前企业/当前 App 可使用。
该结果未证明跨企业通用、手机/桌面客户端的实际呈现或原生答案回调闭环；上述未完成边界继续保留。

## 同卡接续（2026-11-06）

Pi 唯一活动原生工具内的顺序对话共享一个不透明展示标识；题目及原生 ID 仍各自独立。Core Outbox 复用已知
平台消息，初次发送未取得回执前不再创建第二张；后继请求出现后，旧关闭更新失效。Main 以 App/消息串行更新，
成功回调不内联返回旧终态卡，避免迟到回包覆盖正在填写的新表单。不同工具、并发请求和不同运行仍隔离。

飞书/Lark 的真实 input 在原卡保留前一 select 的只读选项，输入框以原选项作为原生左侧 label；
不匹配英文文案、不预造 input、不合并或改写答案。钉钉官方
[表单变量协议](https://open.dingtalk.com/document/development/form-variables)的 `CHECKBOX_GROUP` 是单选列表，
`MULTI_CHECKBOX_GROUP` 才是多选列表，因此可沿用既有模板把下拉改为平铺单选；接续输入同卡保留只读选择。
不引入 DWS、新模板发布、专属网页、选项状态管理或答案自动重放。

回归扩展现有 Pi dialog、channel authority、Main parser/Host owners，不新增 Rust 测试函数。
[本轮证据](evidence/pi-native-single-card-2026-11-06.json)记录 Rust workspace 484 通过/1 ignored、两个扩展
owner、四个 Main 文件 176 项、类型、Desktop/Core 构建、通用文档门禁与真实 Pi 六组回归通过。

飞书真实客户端已验证精简版：两个不同原生请求使用相同 presentation 和消息 ID，选择后原地展开输入，
中文与前后空格的摘要完全一致，原来的 Run 成功结束。原生输入题已逐行包含选项时，仅避免重复绘制相同上下文，
原生题目正文不改写。测试经真实平台回调、生产 renderer/parser 与隔离 Core writer；正式渠道 Outbox/Owner
边界由上述 Rust owner 独立验证，不将这个测试 relay 冒充已运行生产 Main Host 全链路。

Lark、钉钉新版卡已由平台接受，仍待真实客户端点击、原卡填写与回调；钉钉当前企业的单选列表投递不等于
手机/桌面呈现和跨企业通用已经验收。飞书客户端空表单回包亦未在本轮验证，不从 Pi 层的空文本通过推定。
