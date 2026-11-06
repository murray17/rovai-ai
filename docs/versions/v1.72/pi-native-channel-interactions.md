---
document_type: implementation-record
version: v1.72
status: in-progress
last_updated: 2026-11-05
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

该固定模板的限制必须明确：选择/确认均由 SELECT + 提交组成，取消按钮固定写作“取消”，不能动态隐藏；
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
