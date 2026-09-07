---
document_type: contract
contract: skill-content-preview
version: v1
status: accepted
last_updated: 2026-09-07
---

# Skill Content Preview v1

Desktop 的 `skills.content.read` 只读取 Core 已管理的 Skill Revision 或已检查的导入候选。
本接口不增加文件系统根授权、不执行内容，也不改变启停、投递组、Revision 或导入状态。

## 封闭输入

```ts
type SkillContentRequest =
  | { source: 'installed'; skillId: string; revisionId: string; path?: string }
  | { source: 'import'; stagingToken: string; candidateName: string; expectedDigest: string; path?: string }
```

未知字段拒绝。`installed` 必须是 active Skill 的当前 Revision；ID 必须是 UUID。
`import` 复用 staging token 的存在性和过期校验，候选名和 digest 必须匹配该检查清单。
Core 从这些身份推导受管目录，调用者不能传入任意绝对根目录。
`path` 默认为 `SKILL.md`，只允许受管包内的相对普通文件，拒绝绝对路径、父目录、反斜线与空值。

## 完整性和有界输出

每次读取复用 Skill 树检查：拒绝符号链接和非普通文件，沿用递归深度、文件数、总字节上限，
比较整个包的 digest。正文捕获来自同一轮哈希所读取的字节，不在校验后第二次打开文件。
已安装内容以当前 Revision digest 为权威；待导入内容以检查清单 digest 为权威。

```ts
interface SkillContentView {
  path: string
  content: string | null
  status: 'text' | 'binary' | 'too_large'
  files: { path: string; bytes: number }[]
}
```

正文上限 128 KiB；超限返回 `too_large`，NUL 或非 UTF-8 返回 `binary`，两者正文均为 null。
文件列表仅含包内相对文件路径与大小，按路径排序。目标不存在、身份过期、内容改变或不安全时
返回简短的重新读取/重新检查提示，不回显本机绝对路径或文件内容。

Renderer 只接受当前目标、文件与最近读取请求的响应。Markdown 使用现有安全渲染器；预览
不加载包内脚本、原始 HTML 或远程图片。原文视图把内容当纯文本。切换文件或来源不写入
Skill Library，不向 Agent/Runtime 发送内容。

## 关联权威

- [Skill Library 不变量](../architecture/foundational-invariants.md#skills-library-projection)
- [Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
- [Capability settings](../ui/components/capability-settings.md)
