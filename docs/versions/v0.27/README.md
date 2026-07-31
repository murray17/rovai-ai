---
document_type: version-overview
version: v0.27
lifecycle: current
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-07-31
---

# Rovai-ai v0.27 Partner Identity Six Fields

> 状态：共同理解与跨版本决策已确认，设计冻结，生产实施与验收完成
>
> 前置版本：[v0.26 Member Runtime Parameters](../v0.26/README.md)
>
> 跨版本决策：[ADR-0085](../../adr/0085-run-frozen-six-field-member-identity-context.md) ·
> [ADR-0086](../../adr/0086-single-current-built-in-member-appearance-set.md)
>
> 生产设计：[production-design.md](production-design.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

把队员身份从语义重叠的“角色标题、身份标签、长期角色描述、队员指令”调整为可区分
长期称呼、团队贡献、专业交付、稳定性格、行为边界与成长方向的六字段模型：

- 名称
- 团队角色
- 专业职责
- 性格底色
- 工作准则
- 成长课题

基础身份默认展示前四项；工作准则和成长课题进入每次打开身份编辑时默认展开的高级
区域。角色图片、
Agent 运行时、原生权限和伙伴记忆能力继续独立管理。

## 已确认边界

- Arctic Dawn V3 继续是生产 UI 权威；外部 HTML 只参考字段命名、分组和排列。
- 旧成员身份配置不做语义迁移，也不从旧长文本推断性格标签或成长方向。
- 本机四个 canonical Profile 上的受管半身图和圆形 icon 是新内置素材的来源；旧名称、
  角色、描述和指令不是新默认配置的来源。
- 升级时四个 canonical Profile 无条件写入新默认身份和新内置外观；其他自建 Profile
  保留稳定 ID、名称、头像、Runtime、Presence、Capability、顺序、Memory、Camp 与
  历史关系，但除名称外的新身份字段全部为空。
- 四个内置队员的新默认身份只预填名称、团队角色、专业职责和性格底色；工作准则与
  成长课题保持空值。
- 身份编辑只影响保存成功后新创建的 AgentRun；已经创建、排队或执行中的 AgentRun
  保留其冻结身份。身份编辑不轮换已有 Native Session，也不重置 Conversation。
- 完整六字段身份只投递给伙伴本人；同 Camp 其他伙伴仅看到名称、团队角色、专业职责
  和既有可用状态。
- 成长课题只作为 AgentRun 动态上下文中的个人信息；它不新增记忆自动化。实际形成的
  可复用经验仍可按既有 `memory.write` 合同沉淀。
- 更换成长课题不能删除或改写已经形成的伙伴记忆。
- 六字段、角色图片、Runtime/模型/权限和长期记忆开关分别保存；一个区域失败不能改变
  其他区域，也不存在跨区域“一键全部保存”。
- 四套内置外观直接替换当前唯一素材与预设，不增加 `v2` 或旧图兼容分支；引用内置
  外观的其他 Profile 同步显示新素材，managed 自定义图片保持原引用。
- 身份编辑的高级设置每次默认展开，并显示“未设置 / 已设置 1/2 项 / 已设置 2/2 项”；
  保存错误保留草稿，明确取消或关闭丢弃草稿。

## 当前设计状态

字段含义、内置角色文案、升级重置范围、性格标签合同、字段长度、AgentRun 生效边界、
团队可见范围、成长课题的 Memory 边界、独立保存边界、单套内置素材替换和高级设置
交互已经确认。完整冻结合同见生产设计与 ADR-0085、ADR-0086。

## 非目标

- 重做 Arctic Dawn 视觉方向。
- 把角色图片、Runtime、权限或伙伴记忆能力合并为身份字段。
- 使用模型或启发式规则解释旧成员描述并生成新身份内容。
- 因更换成长课题而清理已有 Memory。
