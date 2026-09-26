---
document_type: architecture
architecture: skills
authority: current-skills-source-configuration-and-delivery-boundaries
status: accepted
last_updated: 2026-09-25
---

# Skills 来源、配置与模型投递

Skills 是模型可按需读取的文件指南，不改变工具、权限、消息路由或协作资格。当前版本的字段和版本轴见 [Skills Rebuild v2](../contracts/skills-rebuild-v2.md) 与 [ContextManifest v30](../contracts/context-manifest-evidence-v30.md)；旧 Library 和项目投递的恢复边界见 [历史 Skill Projection](skill-projection-reconciliation.md)。

## 四种来源

| 来源 | 当前用途 | 权威与生命周期 |
| --- | --- | --- |
| Rovai 平台两项 | 新 Native Session 的固定 `ROVAI_PLATFORM_SKILLS` 索引 | Core 从执行 Host 的受管根读取；`cli-operations`、`memory-stewardship` 固定存在于集合中，缺源或无效 frontmatter 阻止新 Bootstrap 准备。 |
| Rovai 工具箱五项 | 每队员配置和本 Run 显式选用，形成 `ROVAI_ADDITIONAL_SKILLS` | Core 数据库 `member_toolbox_skill` 是长期选择真源；每次 preparation 冻结完整 section，不向项目创建新投影。 |
| Harness 原生用户／项目 Skill | Settings 只读用户来源；当前 Camp `/` 候选读全队相关 Runtime 的用户和项目来源 | 文件在 Harness 原址；Core 只读发现、按规范路径去重、按来源记录身份。候选缓存仅在本 Core 实例内有界有效，不是模型输入或加载证明。 |
| 旧 Skill Library／Revision／项目投影 | 历史数据、审计和旧 Run 恢复 | `skill`、`skill_revision`、受管 Revision 与 observation 保留；不进入新索引或候选。启动和升级不扫描或清理项目文件；项目入口仅在用户显式操作时按所有权、active Run 和 root access 规则处理。 |

受管文件同步仅操作九个 Rovai 发布目录，且不跟随来源或目标的符号链接。受管根来自执行 Host 的 Core data-dir 规则，不能使用 Renderer 前台路径或模型侧 `~`。旧 Library 的启停和 Runtime group assignment 不转为队员配置；迁移及新建队员只默认选择 `member-studio`。用户显式关闭后，Core 重启不重新开启。

诊断读取旧派发 observation 的数量；Windows 另对已登记且 `active` 的项目根，只读检查已知 Skill 组下九个固定名称（`analyze-agent-codebase`、`campfire`、`cli-operations`、`grill-duo`、`grill-duo-with-docs`、`member-studio`、`memory-stewardship`、`review-duo`、`worktree`）的精确路径，补入没有 observation 的现存入口。用户点击唯一清理动作时，Core 逐项重新确认 root `active`、可访问性、运行中 Run、精确 group 路径和普通目录 no-reparse 条件；Windows 固定名称入口不要求旧 operation、NTFS file identity、内容 digest 或 observation 一致。其他入口继续按原有受管归属证据确认；无法确认则保留。清理只移除精确入口及其存在的旧 observation；`access_state` 继续由 Navigation 的项目移除／恢复维护，清理命令不调用 `remove_execution_root`。Core 启动与升级不触发旧入口文件清理。

## 选择到投递的数据流

```text
Renderer / 结构化 SkillMention(skillId, nameAtSend)
  → Core 来源登记与消息提交
  → AgentRun claim 冻结 Selection v2（来源身份、发送时名称、消息/segment 位置）
  → preparation 解析路径并冻结 Resolution v2、每消息链接、动态索引及 digest
  → ContextManifest 保存 exact payload bytes/digest
  → Runtime Input Delivery 记录实际接受
```

`rovai:<name>` 只指向工具箱闭合集；`native:<canonical-path-hash>` 只指向已由 Core 发现登记的原生入口；旧 UUID 按历史来源处理。同名不同文件保持不同身份，同一真实文件的多入口按目标归并。失效引用仍随消息发送，解析为 unavailable 并省略消息局部文件链接；不能改绑同名技能。模型可见的 `skills[{name,path}]` 仅在该条消息实际选择且来源仍可用时出现。原生 Skill 不进入任一 Rovai 索引。

平台索引随新 Binding 的 Bootstrap v5 冻结；旧 Binding 保留原 v4 Bootstrap。动态工具箱索引在每个新 Run 重新计算，普通 Run v27/Profile 7，公开批次 v30/Profile 10。相同 Run 的重试和恢复复用冻结字节，不重新读取随后变化的配置。原生 Runtime 在已接受的单次 Run 内自行 compaction 时，Core 不发送第二条只含 Skills 的任务消息。Core 控制的 Bootstrap redelivery 仍投递该 Binding 已冻结的完整 Bootstrap。

## 旧格式与失败边界

Schema 123 在 v1.68/schema 122 上增加配置与冻结证据，保留旧行、Revision 文件和审计。已持久化的旧 v26/6/5 非 batch、v29/9/7 公开 Manifest 可按完整证据继续派发；历史冻结的旧直接 Delivery 和公开批次可以在精确来源约束下物化旧格式，不补 Skills section。公开 v28 及更早版本仍不派发。新写入使用 v27/v30；缺少受管 frontmatter、原生文件不可读或旧 ID 不可解时记录缺项，不阻塞原消息。真实输入超预算时按 `context_payload_too_large` 处理，不截断固定索引或当前输入。
