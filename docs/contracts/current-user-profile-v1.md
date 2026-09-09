---
document_type: protocol-contract
authority: desktop-current-user-presentation
status: accepted
last_updated: 2026-09-09
---

# Current User Profile v1

当前用户的名称和头像是 Desktop 展示资料，不是 AgentProfile、Camp Member 或 Runtime 配置。
Desktop Main 在当前实例的 Electron `userData/current-user-profile.json` 保存资料，Core 不读取此文件。
模型可见身份、Bootstrap、历史上下文、消息正文、结构化 identity、摘要、FTS 和已签发证据均不因编辑资料改变。

## API 与持久化

Preload 暴露 `currentUserProfile.get()` 和 `currentUserProfile.save(profile)`，返回完整的
`{ displayName: string, avatarDataUrl: string | null }`。Main 校验主窗口来源并等待本地存储加载完成。
不暴露任意文件路径、Core Command 或用户 identity 写入入口。

- `displayName` 去除首尾空白后最多 32 个 Unicode code points；拒绝换行和控制字符。
  空字符串表示使用默认名称“你”。
- `avatarDataUrl` 为 `null` 时使用固定“你”字圆形头像，改名不改变默认头像。
  自定义值只接受规范 Base64 PNG data URL，沿用头像 PNG 结构与静态图片检查，必须恰为
  192×192 像素且解码后的文件字节不超过 1 MiB。禁止远程 URL、路径和 SVG。
- 文件拥有 `schemaVersion: 1` 和以上两个字段。两个字段通过同一个私有临时文件原子替换，
  写入串行化；保存失败保留旧内存快照和用户草稿，后续允许重试。
- 首次读取缺失文件时只使用内存默认值，不写入文件。损坏或不可读文件产生本地降级提示，
  不自动修复或覆盖；只有用户显式保存才替换资料。
- 重启重新读取已保存资料。Renderer 仅在保存回执成功后更新共享资料状态；编辑中的草稿
  不提前更改历史消息或名册。

## 历史展示与上下文边界

Desktop 历史消息作者栏按现有 `authorType` 识别当前用户。`user` 和现行 Owner-only 渠道的
`external_principal` 使用当前资料；不改写原 `authorId`、Provider 身份或外部引用的发送者快照。

Agent 历史消息中 `{ kind: 'current_user_mention', userId: 'local_user' }` 使用当前显示名称。
普通 text segment、Markdown、代码和外部引用中的字面 `@你` 保持不变；不从文本猜测 identity，
不批量检索或替换历史正文。当前已加载消息随共享资料状态刷新，后续加载的历史页使用同一资料。
本人消息头像和结构化 Current User Mention 可打开只读资料卡，使用同一份当前资料；
此交互不发起 Core 请求，不创建 AgentProfile，也不将个人资料写入历史上下文。

整条消息复制及已解析的历史回复预览按结构投影最新名称，前缀间隔按 segment 边界生成，
不能按固定字符数切分。剪贴板中的 Current User Mention 粘贴回 Composer 时继续降级为普通文本，
不创造可发送的 Current User Atom。Core 的 `@Principal` Agent 投影和既有上下文管线保持不变。

## 验证与入口

存储、输入边界、失败恢复和重启由 `current-user-profile.test.ts` 覆盖；历史展示与正文隔离由
`CampWorkspace.current-user-markdown.test.ts`、剪贴板测试覆盖。真实 Renderer 的编辑、裁剪、保存失败、
草稿保护和双主题布局由现有 `member-editor` 隔离 Electron 夹具覆盖。
会话资料卡的头像、结构化 Mention、键盘焦点、关闭和资料刷新由 `camp-open-projection`
夹具的 `--current-user-profile` 模式覆盖。

入口和构图见[队员身份与图像](../ui/components/member-identity.md#当前用户个人资料)；历史 token 呈现见
[Current User Mention](../ui/components/structured-mentions.md#current-user-mention)。
