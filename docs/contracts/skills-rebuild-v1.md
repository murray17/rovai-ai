---
document_type: protocol-contract
contract: skills-rebuild-v1
authority: skills-source-configuration-selection-and-model-index
status: accepted
version: 1
last_updated: 2026-09-25
---

# Skills Rebuild v1

本合同拥有 v1.70 的 Skill 来源、队员工具箱配置、模型索引与消息局部链接。完整前后模型输入和二次确认见 [模型上下文变更说明 revision 5](../versions/v1.70/model-context-change.md)。Skill 是指南，不增加接收者、工具、权限或协作资格。

## 受管闭合集与配置

- 固定平台项按名称排序为 `cli-operations`、`memory-stewardship`；每个新 Native Binding 的 Bootstrap v5 在 `MEMBER_IDENTITY` 后、可选 `MEMORY_ENTRYPOINT` 前输出 `ROVAI_PLATFORM_SKILLS`。
- 工具箱项按名称排序为 `campfire`、`grill-duo`、`grill-duo-with-docs`、`member-studio`、`review-duo`。`member_toolbox_skill(agent_id,skill_name,updated_at)` 只记录已选择项；升级时对每位现存队员插入 `member-studio`，以后新建队员也如此。显式删除该行后不得因重启恢复。
- 旧 Library `enabled`、Runtime group assignment、导入项、其他 bundled 项及 Harness 原生项不进入平台或动态闭合集。旧 Revision、记录和审计保留。

两个模型索引都在自身 section 内输出一行 JSON：`{"root":"<执行 Host 绝对受管根>","skills":[{"name":"<英文目录名>","desc":"<完整 YAML description>"}]}`。每段 `root` 恰一次，`skills` 按 `name` 确定性排序。`desc` 用标准 YAML 解析 `SKILL.md` frontmatter，完整保留折叠/保留换行、中文、引号与反斜杠；无效或不可读来源不编造说明。动态段即使空集合也输出固定提示与 `skills:[]`：

```text
[ROVAI_ADDITIONAL_SKILLS]
Current for this run; replaces any earlier Rovai Additional Skills.
{"root":"<执行 Host 绝对受管根>","skills":[]}
[/ROVAI_ADDITIONAL_SKILLS]
```

动态集合是接收队员当前配置与本批输入显式选择的工具箱项并集；选用不修改长期配置。Core 在 preparation 中冻结完整 section 文本、SHA-256 digest 和未索引项原因；缺源时 `skills:[]` 只表示本 Run 无可索引项。

## 来源身份与消息

结构化消息保留 `skill_mention {skillId,nameAtSend}` 与可见正文 `/nameAtSend`。`skillId` 为 `rovai:<闭集名称>`、`native:<规范文件路径 SHA-256>` 或历史 UUID；Core 只接受自己发现或历史冻结的实际入口，不能使用客户端任意路径。相同文件的多个入口按 canonical 目标归并；同名不同来源保留独立身份。

Selection v2 与 Resolution v2 的 wire shape 为：

```ts
type SkillSelectionSnapshotV2 = {
  schemaVersion: 2
  entries: Array<{ skillId: string; nameAtSend: string;
    source: 'rovai' | 'native' | 'legacy'; sourcePath: string | null;
    firstMessageIndex: number; firstSegmentIndex: number }>
}
type SkillResolutionV2 = {
  schemaVersion: 2; selectionSnapshotDigest: string
  entries: Array<{ skillId: string; nameAtSend: string;
    source: 'rovai' | 'native' | 'legacy'; sourcePath: string | null;
    outcome: 'available' | 'unavailable';
    reason?: 'source_missing' | 'source_unreadable' | 'legacy_unresolved' }>
}
type ModelSkillLink = { name: string; path: string }
```

Selection 按本批消息与 segment 首次出现的位置对来源 ID 去重；Resolution 不宣称 Runtime 已加载或模型已读取。`RUN_INPUT.messages[].skills` 或 `CURRENT_INPUT.skills` 只在当前消息选用、来源可用时出现，按本消息首次选用顺序去重；`name` 为发送时名称，`path` 为实际 `SKILL.md` 入口。不可用时保留消息、结构化事实与 FIFO，省略局部链接，不改绑同名文件。显式选择的原生 Skill 只进局部链接。

## 读取和恢复

Settings 的 `nativeSkills.list/read` 只读所选 Runtime 的用户级来源；`nativeSkills.read` 在重新验证 Core 登记的原始入口后，只允许读取该 Skill 目录内的普通文件，返回文件清单、当前文件正文或过大／二进制状态。`toolbox.read` 只读固定工具箱闭集的受管 `SKILL.md` 正文。会话 `skills.candidates` 用当前 Camp 全队配置、各 Runtime 用户级及项目级发现。执行 Host 上的原生目录扫描由 Core 实例共享，最多缓存 32 组 Runtime／项目／解析后目录根的元数据，60 秒过期；Runtime 启动环境变更、显式刷新或实例更换会重扫。全队关联与工具箱配置每次按当前 Camp 重算，缓存不替代 Run 冻结。旧 Rovai 项目投递 observation 中的入口在清理前从原生候选排除。

会话中点击已发送的 Skill 引用走现有文件预览分栏：`skill_reference {campId,skillId,rawReference:'SKILL.md'}`。Core 仅对活跃 Camp、固定工具箱 ID 或仍能按登记身份验证的原生 ID 授权；历史 UUID、失效文件、其他相对路径均不授予预览。文件预览继续按现有 handle／相对文件规则控制后续读取，重复打开同一 Camp 的同一 Skill 复用标签。

新 Bootstrap v5/Formatter 5 独立冻结平台 section；Charter revision 13 原字节不改。新非 batch Formatter/Manifest 27 与 Profile 7、新公开 batch 30 与 Profile 10 冻结动态 section、Selection/Resolution、每消息链接和整个 payload。旧 v4 Binding 不热插入平台段；旧非 batch v26/6/5 与公开 v29/9/7 只用历史证据恢复，公开 v28 及更早不派发。新 Run 不再创建项目 SkillProjection；升级和 Core 启动不扫描或清理旧项目入口。旧入口继续凭 observation 从原生候选中排除。

`diagnostics.check` 只按 `skill_projection_observation` 统计旧入口，在受管内容组输出唯一 `legacy-skill-entries` 检查；检查不访问项目文件，也不执行清理。只有用户点击该问题的“清理旧入口”才调用 `skills.cleanupLegacyEntries`。命令按 observation 的精确 `entry_path` 分组，执行前复核路径与组、已登记 Skill 名称、root `active`、可访问性和运行中 Run。Windows 对名称为 `analyze-agent-codebase`、`campfire`、`cli-operations`、`grill-duo`、`grill-duo-with-docs`、`member-studio`、`memory-stewardship`、`review-duo`、`worktree` 的已登记普通目录，以名称代替旧 operation／file identity／digest 证据；入口、Skills 父目录和子树中的 reparse point 不准入。其他入口继续复核 Skill/Revision 与受管目标，未确认、不可访问、在用入口保留。已不存在的入口只移除失效 observation；准入的入口只移除精确文件或 Windows 副本，不调用 `remove_execution_root`，不写 `access_state`，不删除项目根或 Skills 目录。返回移除、失效、三类保留与剩余计数；重复执行不得扩大删除范围。Renderer 随后重新运行完整诊断，并在同一问题和摘要显示新结果。
