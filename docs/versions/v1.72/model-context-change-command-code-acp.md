---
document_type: model-context-change
version: v1.72
change_id: command-code-system-bootstrap
revision: 5
confirmation_status: confirmed
confirmed_by: User (Thread messages 677d610d-e4cf-4ffb-aba2-d4ebb021cbcd and 1bd0ab39-6939-40cd-9653-b472b3b69082)
confirmed_revision: 5
confirmed_at: 2026-10-05
authority: model-input-change-statement
implementation_status: implemented
last_updated: 2026-10-05
---

# Command Code 官方 ACP：System Bootstrap revision 5

User 已明确要求修复 System Bootstrap、warm，并继续完成所有可接能力；本次按此授权实施，不重复询问。
[revision 4](model-context-change-command-code.md)保留旧 headless 的输入快照。本 revision 只改变 Command
Code 新产品 ACP 的 Bootstrap 位置与交付时机，不改 Cline 或其他 Runtime 的模型输入。

## 变更前

此前仅 headless 候选 first_payload；完整字节使用旧方案的冻结 B 与 P。

## 变更后

`B` 是目标 Native Binding 已冻结的完整 Bootstrap 原字节；`P` 是当前 AgentRun 已冻结的完整 Dynamic
Context 原字节。二者使用现行共享 Context formatter，section 顺序、正文、选择、预算和遗漏条件均不修改：
B 含 SESSION_CHARTER、MEMBER_IDENTITY、ROVAI_PLATFORM_SKILLS 及条件成立时的 MEMORY_ENTRYPOINT；
P 使用当前 ContextManifest 的冻结工作项、Run Facts、Workspace、协作状态和 Skills 索引。
既有 Binding 的旧模板必须直接沿用，不用最新模板重写。

| 位置或时机 | revision 4 headless 候选 | revision 5 官方 ACP |
| --- | --- | --- |
| 原生 System | 原生 Runtime 生成 | 原生 Runtime 生成，并由官方 appendSystemPrompt hook 追加完整 B |
| 新 Session 普通 user prompt | `B + "\n\n" + P` | `P` |
| warm / exact cold 普通 user prompt | `P` | `P` |
| System 中的 B | 无 | 每次根模型请求按 `state.sessionId` 读取该 Session 的同一冻结 B |
| 压缩后 | 有合格信号才在下一输入补发 envelope | System hook 每次重新追加 B；不向 user history 重复补发 |
| B 缺失、损坏、超预算 | 组合输入前拒绝 | 模型请求前结束 Host，不允许无 B 请求继续 |

Native hook 返回值严格等于 B，不增加包装或额外指令；Native System 与 hook 返回值的拼接由官方 Runtime
拥有。Core 复用 `managed_system_prompt`，`runtime_payload` 与摘要只绑定 P；Bootstrap evidence 单独绑定 B。
没有新增 Context/Manifest 字段、提示词内容、Section、Schema 或 formatter version；数据库 schema 135
只因 Runtime closed identity 迁移而增加。

## 明确不变

Bootstrap 和 Dynamic Context 的正文、原生历史与其他 Runtime 输入保持共享合同；仅新增 Command ACP 的交付位置和必需门禁。

## 必需门禁与恢复

Core 为每个 Host 创建私有设置覆盖，将必需 Mod 放入官方 `mods.paths`，保留原生其他设置与 Mod；
不改全局 settings、AGENTS.md 或原生历史。Mod 工厂最后写 `{revision,nonce,pid}`，Core 必须在 initialize
之后、首个 session prompt 之前验证它属于当前 Host。文件缺失、加载失败或版本漂移均关闭进程。

Core 在共享 Context 冻结和 Native Binding generation 校验后写入按完整 Native Session ID 命名的绑定。
内容包括完整 B、Session ID、schemaVersion 与 SHA-256；再次绑定只能完全相同。每次 hook 校验文件、ID、
摘要、32 KiB Bootstrap 预算与 64 KiB 外层文件预算。上游会捕获普通异常，所以绑定错误以退出码 78 结束
Host，不使用普通 throw 作为门禁。A/B/A 各次均使用自身 state.sessionId，没有进程级 active B 指针。

cold resume 在新的 Host 私有目录重新绑定原始 B；原生 Session storage 保持在 Runtime 自己的目录，
Host 清理不能删除历史。配置或 Bootstrap profile 不兼容沿共享 fence/continuity 路径处理。
Command Code 尚无已部署产品 Binding，因此不把内部旧 headless UUID 自动迁移成 ACP 产品 Binding。

## 验证边界

Node 子进程验证 A/B/A、缺失、非法 ID、错摘要、空值和超预算；真实官方 Runtime 验证 Mod 在 initialize 前
注册、共享 Host 的 A/B/A 控制面、不可变绑定与缺失 B 后进程停止。原生默认 BYOK 的真实模型 A/B/A、
exact cold、实际手动压缩和自动 summarized 后均保留各自 System 身份与早期记忆；隔离 App 经过共享 Core
首次/warm/重启与 CLI 发送亦通过。短会话的 Nothing to compact 不算压缩成功；overflow/retry 未据此冒领。
该输入交付变更已实现，不代表完整 First-Class。依据与剩余矩阵见
[最新 Checklist](../../research/runtime-monitoring/command-cline-checklist-2026-10-05.md)。

## 二次确认

User 消息 `677d610d-e4cf-4ffb-aba2-d4ebb021cbcd` 要求修复上文已讨论的两个问题，随后消息 `1bd0ab39-6939-40cd-9653-b472b3b69082` 要求完整推进。该授权覆盖 System 交付和常驻接入；本轮依此实施，不将额度或原生缺陷解释为等待再次确认。
