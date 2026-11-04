---
document_type: protocol-contract
contract: skills-rebuild-v2
authority: skills-source-configuration-selection-and-model-index
status: accepted
version: 2
last_updated: 2026-11-03
---

# Skills Rebuild v2

本版继承 [Skills Rebuild v1](skills-rebuild-v1.md) 的来源、队员配置、Skill 选择、模型索引、冻结输入和历史恢复合同；扩展 Windows 旧项目入口的显式清理，并以目录级发现缓存替代 v1 的 32 组上下文缓存。模型输入 revision、Migration 和数据库 schema 均不变化。

## 原生目录发现缓存

每个 Core 实例在现有发现模块内按规范化 Skills 目录路径共享原始元数据和来源中立的扫描诊断；存在的目录解析到实际路径，不存在的目录使用规范化绝对路径。缓存不保存 Camp、队员、Runtime 过滤结果或 Skill 正文。容量上限为 128 个目录，LRU 淘汰，扫描完成后 300 秒过期；空目录和部分失败也保存结果。过期只在下一次读取时重扫，请求等待结果，同目录在途扫描只执行一次。不增加 Harness／解析策略维度或新的缓存层。

Runtime 来源目录顺序、用户／项目范围和禁用配置每次重新计算；Skill 的原始入口路径用于展示和执行，规范文件路径用于来源身份与目录复用。一次 Camp 手动刷新在请求内记住已扫描目录，每个目录至多强制扫描一次；并发请求复用在途扫描。Settings 和 Camp 选择器仍按需请求，普通启动、项目切换和 Camp 打开不触发原生发现；来源登记与执行前重新验证继续按 v1 合同执行。

## 原生文档接受与诊断

所有 Harness 共用宽松原生解析；受管 Skill 仍使用独立严格校验。名称优先使用元数据中的非空
字符串，否则取 canonical 文件所属目录名；描述缺省取可确定正文的首个非空行，没有则为空。
单个字段类型错误只回退该字段，其他有效字段保持。有效多行描述保留 YAML 的折叠和换行语义。

| 文档 | 正文与诊断 |
| --- | --- |
| 无 frontmatter | 全文为正文，不报警 |
| 合法头，字段缺失、空字符串或 null | 正常缺省，不报警 |
| 字段类型错误 | 正文在闭合分隔符后；记录字段名及原因，保留条目 |
| 有闭合分隔符但 YAML 无效 | 闭合分隔符后为正文；记录解析原因，保留条目 |
| 未闭合头 | 保留原文供阅读和源码查看，描述为空；记录未闭合原因 |

文件开头 UTF-8 BOM 不妨碍识别；源码保持原始字节解码后的字符串。含 NUL、非 UTF-8、
非普通文件或真实读取失败不视为普通文本 Skill。预览的完整文本与大文件降级策略不限制发现或选择。
普通目录没有 `SKILL.md` 时跳过；入口、`SKILL.md` 或约定目录是符号链接且目标返回 NotFound 时，
同样视为无有效候选并跳过，不产生诊断。扫描前的权限、循环链接、其他路径解析和文件类型错误
仍必须报告；有效链接正常发现。
原生入口和子资源继续使用已有链接与访问边界。原生发现完整枚举现有约定目录及既有 `.system`
分类范围，不再以 512 个目录条目截断；不扩展为任意子目录递归。缓存、按需请求和单项失败收集不变。

`nativeSkills.list` 返回 `{skills, diagnostics}`；`skills.candidates` 返回
`{skills, errors, diagnostics}`，其中 `errors` 继续承载受管来源或整次 Runtime 发现失败。
原生诊断结构为：

```typescript
{ kind: 'metadata' | 'file_read' | 'directory_read' | 'scan_truncated';
  path: string; message: string; skillId?: string }
```

字段名放在 `message`；已知来源 ID 时提供 `skillId`。正常缺省没有诊断，元数据异常不等于来源
不可读；原生配置读取或解析问题也按对应读取／元数据类型报告。刷新重新生成诊断，修复后的旧问题
自然消失。不新增数据库、历史、自动修复、后台扫描或状态流转。
诊断字段保持原结构；原生发现不再因目录条目数量产生 `scan_truncated`。

诊断显示范围复用现有 `kind` 与 `skillId`，不新增字段或分级：带 `skillId` 的 `metadata`
表示可读文档已使用回退值，只在该 Skill 详情说明，不进入设置页来源摘要和输入框 `/` 选择器错误区；
不带 `skillId` 的 `metadata` 表示原生禁用配置无法解析，按此准确提示当前列表可能未应用部分禁用设置。
被原生禁用配置明确排除的条目不再报告其元数据诊断；读取失败等真实问题照常报告。缓存仍保存原始
扫描结果。复制路径等界面操作失败只在该操作旁提示，不改变正文读取状态。

会话原生候选按现有来源 ID 去重后，将同一份保留结果用于显示和引用登记。原生名称不套用受管
目录命名格式；选择、预览及发送前重验使用相同接受规则。名称发生变化仍沿用现有失效和刷新，
保留 `nameAtSend`，不自动改名、不换绑同名文件，也不阻塞消息。只有显式选择且重验可用的文档
经现有 `skills[{name,path}]` 进入新输入；诊断不入模型，冻结证据与历史恢复不重新解释。

## Hermes 固定目录候选

Hermes 文件发现使用与官方 ACP 启动相同的 Host 用户 Home。设置页只扫描 `~/.hermes/skills` 与
`~/.agents/skills`；会话 `/` 在已有当前项目根下追加 `.hermes/skills` 与 `.agents/skills`，没有项目
则只扫描用户级。非 Git 项目同样适用，不枚举历史项目或向上寻找根目录。

这条来源不解释原生配置、禁用、平台或信任状态，也不追踪任意 `external_dirs` / `create_dir`。
公共扫描器继续处理分类目录、不可读/异常文件、真实文件去重和同名不同来源身份。文件候选不代表
Hermes 已启用或加载；用户可以显式引用某个原生未启用的文档，输入仍只携带其选择的精确文件。
不新增来源状态、表、缓存或配置开关；其他 Runtime 的目录及过滤语义保持。具体运行边界见
[Hermes 合同](hermes-managed-runtime-v1.md#模型权限skills-与-mcp)。

## Windows 无 observation 的旧入口

旧投影 observation 可能已经为空，但登记过的项目根目录里仍留有 `.dsh/skills` 等旧目录副本。Windows 的 `diagnostics.check` 在只读模式下，对 `skill_projection_root_state` 中 `active` 且当前可规范化访问的根，检查每个已知 `SkillDeliveryGroupKey` 项目 Skills 路径下九个固定 Rovai Skill 名称。`legacy-skill-entries.entryCount` 计算不同的已记录入口与这些现存无记录入口之和；没有记录的目录也可使该项为 `attention`。不枚举任意项目文件名，不写项目、数据库或 root access 状态。

用户点击该问题的“清理旧入口”后，`skills.cleanupLegacyEntries` 除处理 v1 的 observation 外，也处理上述 Windows 无记录候选。每个候选在删除前重新检查 root `active`、可访问性、运行中 Run、精确 group 路径和普通目录树；不跟随 reparse point。准入后只删除该 Skill 目录，没有 observation 就不补造或删除数据库记录。其他名称、未登记项目、macOS 链接和普通投影 reconcile 继续遵守 v1。

这九个名称的目录内容可能已被用户修改；用户显式清理仍以名称和路径为准。失败或无法确认的候选保留，并在原有 `LegacySkillCleanupReport` 计数中反映；重复操作不得扩大到未知名称或路径。

## 设置页原生 Skill 正文读取

`nativeSkills.read` 对用户选定的普通文件独立校验并读取，不以整个资源目录可枚举或目标先出现在
菜单清单为前提。相对路径组件、目标路径链不跟随子链接及 canonical 根内约束保持；
目标自身缺失、不可读或类型不支持仍报告错误。

不超过 4 MiB 的常规 UTF-8 文本完整读取，仍支持阅读／源码切换。更大的文本返回
`status: "too_large"` 与 `content` 中最多前 256 KiB 的有效 UTF-8 前缀，Renderer 明确提示内容不完整，
直接显示纯文本，并保留 Skill 入口路径与当前文件的相对路径供定位完整文件；
不把截断片段当作完整 Markdown 渲染。
读取本身有界，文件在检查后增大也不能导致无限读取；切在 UTF-8 字符中间时退回到完整字符边界。
读取到的内容含 NUL 或非法 UTF-8 时返回 `binary`，不作普通文本展示。无前缀的旧 `too_large`
响应仍显示无法预览。以上策略仅限原生预览，不改写文件、不影响原生来源重验或原始文件引用，
受管 Skill 预览规则保持原样。

资源菜单最多 512 个文件、8 层目录，单次最多访问 2048 个目录项（含目录及失败条目）；
达到边界即停止实际遍历，无关目录或条目不可读时跳过。正文入口和当前选中项保留在有界菜单中。
这是设置页只读展示边界，不改变会话 Skill 选择、模型投递或原生智能体读取行为，不新增缓存或后台扫描。
