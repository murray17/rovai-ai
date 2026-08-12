---
document_type: version-architecture
version: v0.14
lifecycle: historical
authority: version-design
last_updated: 2026-07-27
---

# Rovai-ai v0.14 架构设计

> 版本范围：[README.md](README.md)
>
> 跨版本约束：[ADR-0056](../../adr/0056-controlled-member-avatar-assets.md)
>
> 当时 UI 约束：Meridian（文件已删除，原文见 Git 历史；当前规范见
> [Arctic Dawn](../../ui/README.md)）

## 1. 权威与进程边界

头像由三个相互独立的权威组成：

```text
Core / SQLite
└── AgentProfile.avatarRef：引用、Profile version、并发与身份写入权威

Application bundle
└── builtin registry：随版本发布的只读角色字节

Electron Main / userData
└── managed asset：用户本地字节、manifest、摘要与原子落盘权威

Sandboxed Renderer
└── 裁切交互、Canvas 规范化、builtin imports、session Blob URL 与视觉 fallback
```

- Core 不接收图片正文，不读取 Electron `userData` 头像目录。
- Main 不直接修改 SQLite，不决定某个成员最终引用哪个头像；打包内置资产由
  Renderer 静态注册表解析，不通过 userData 或任意路径读取。
- Renderer 不获得绝对路径、任意文件读取、Node integration 或目录选择能力。
- Profile 写入成功只证明引用已持久化；图片显示失败必须回退，不得改变 Profile
  状态、权限、Camp membership 或 Runtime readiness。

受管头像是应用本地 UI 媒体，不复用 Core 的 MessageAttachment/ManagedBlob
协议。后者服务于 Core 授权的不可变领域内容及其 SQLite 引用；本版本保持既有
`avatarRef` 契约，并通过 Main 的有界、固定用途 API 管理复合头像资产。

## 2. avatarRef 闭集与兼容

v0.14 新写入引用只有：

```text
rovai://member-avatar/builtin/luoke/v1
rovai://member-avatar/builtin/muwa/v1
rovai://member-avatar/builtin/mianzhi/v1
rovai://member-avatar/builtin/qilu/v1

rovai://member-avatar/managed/{canonical-lowercase-uuid}
```

Core 使用结构化解析器校验 scheme、host、段数、闭集 role、版本和 UUID；禁止用
“允许某个前缀”的正则替代完整解析。`file:`、`http:`、`https:`、`data:`、绝对
路径、编码后的斜杠、额外 query/fragment 和空白全部拒绝。

兼容规则：

| 写入场景 | 规则 |
|---|---|
| 创建 Profile | 只允许 `null` 或 v0.14 闭集引用 |
| 修改头像 | 只允许 `null` 或 v0.14 闭集引用 |
| 修改其他字段且旧引用未知 | 仅允许原样保留该旧值 |
| 读取未知/旧引用 | 原值返回给 Renderer，由共享组件 fallback |

这避免旧安装因历史不透明值而无法编辑成员，同时不继续产生新旧格式。Renderer
不得把未知引用解释为路径或 URL。

## 3. 内置伙伴、预设与 Migration

四个固定 Profile 是长期内置伙伴：

| Profile ID | 保留 handle | 内置外观 |
|---|---|---|
| `agent-luoke` | `luoke` | `builtin/luoke/v1` |
| `agent-muwa` | `muwa` | `builtin/muwa/v1` |
| `agent-mianzhi` | `mianzhi` | `builtin/mianzhi/v1` |
| `agent-qilu` | `qilu` | `builtin/qilu/v1` |

Migration v25 不增加列，只为固定 ID 且 `avatar_ref IS NULL` 的行补值，并推进该
Profile 的 version。它不覆盖已有头像，不恢复归档成员，不还原被用户编辑的
字段，也不依据 handle 猜测。Seed 同时带同一引用，保证新数据库在 Migration
之后创建种子时仍得到相同状态。

创建 Dialog 可以提供四个可复用的“外观与文案预设”，但：

- canonical handle 不随预设复制；handle 保持空白或生成可编辑且无冲突的建议值；
- 预设只填充本次创建草稿，提交后以 Profile 已存字段为真源；
- `avatarRef` 永远只表达外观，不能实时派生 motto、traits、role、persona、
  Capability、Runtime 或 Camp 权限；
- 更换头像不改变任何身份字段；编辑身份字段也不暗中更换头像。

## 4. 受管资产模型

每次保存创建一个不可变资产目录：

```text
userData/member-avatars/{assetId}/
├── source.png
├── icon-192.png
└── manifest.json
```

manifest schema v1 至少包含：

```text
schemaVersion
assetId
createdAt
source: file/mediaType/width/height/byteLength/sha256
icon: file/mediaType/width/height/byteLength/sha256
iconCrop: centerX/centerY/size
```

文件名和相对路径是闭集常量。Main 先写
`userData/member-avatars/.tmp-{assetId}/`，使用私有权限完成两个 PNG 和
manifest，校验并同步后再原子 rename。只有 rename 成功后才返回 managed
`avatarRef`。

保存顺序为：

```text
normalize source + derive icon in Renderer
→ Main atomically saves new asset
→ Core agents.create / agents.update(new avatarRef)
   ├── applied：新引用生效
   └── rejected/error：Profile 保持原样，新资产作为 orphan 保留供草稿重试
```

v0.14 不提供 `releaseIfUnreferenced`，也不在 Profile 更新、移除、归档或启动时删除
最终资产。跨 Main 文件系统与 Core SQLite 的“扫描后删除”无法形成同一事务，
因此保留孤儿是本版本明确选择。临时目录不可能成为合法引用；Main 可在确认单实例
且目录名严格匹配后清理超过 24 小时的 `.tmp-{uuid}`。

用户备份必须覆盖完整 Rovai-ai `userData`，单独复制 SQLite 不能保证图片可用。
文件丢失或非原子外部恢复只产生 fallback 和修复入口，不使数据库启动失败。

## 5. 图片输入与资源安全

### 5.1 支持矩阵

| 项目 | v0.14 规则 |
|---|---|
| 输入格式 | 静态 PNG、JPEG/JPG |
| 明确拒绝 | WebP、SVG、GIF、HEIC、PDF、视频、远程/data URL |
| 选择文件上限 | 10 MiB，且必须是普通文件 |
| 解码最小尺寸 | 256×256；任一边低于 512px 显示质量提示 |
| 解码最大边长 | 8192px |
| 解码最大面积 | 32,000,000 pixels |
| 规范化主图 | 不上采样，最长边最多 2048px，PNG 最多 16 MiB |
| 派生头像 | 192×192 PNG，最多 1 MiB |
| 单次保存 IPC | 两个 PNG 合计最多 17 MiB |
| manifest | 最多 16 KiB |

WebP 在本版本延后，避免把动画检测、不同 Chromium 解码差异和首帧语义留成隐含
行为。

### 5.2 解码边界

Main 的 `selectSource`：

1. 使用系统文件选择器得到用户明确选择的一份普通文件；
2. `lstat` 与有界读取验证大小；
3. 通过 magic bytes 和有界 header parser 识别 PNG/JPEG 及声明尺寸；
4. 返回 bytes、受控显示名、media type 和 header 尺寸，不返回路径；
5. 不使用特权 Main 中的通用图片解码器。

Sandboxed Renderer 使用受测 `createImageBitmap`/Canvas 路径解码，并以实际
`width × height` 再次执行边长与像素面积检查。方向规范化后，等比缩小到 2048px
长边并重新编码 PNG，从而移除 EXIF、GPS、comment 和原文件名关联。

Main 的 `save` 不信任 Renderer 声明：

- 在复制或哈希前先检查每个 IPC buffer 和总量；
- 只接受 PNG signature、合法 IHDR、闭集 color/bit-depth 组合和有界 chunk 遍历；
- source 的 IHDR 必须与输入尺寸一致并满足规范化上限；
- icon 必须精确为 192×192；
- crop 必须为有限数并经共享算法 clamp 后仍与输入一致；
- Main 自行计算 byte length 与 SHA-256，不接受 Renderer 提供的摘要。

Main 不把图片字节、摘要前的原路径或完整错误路径写入日志、事件、审计或
diagnostics。读取时 manifest、固定文件名、byte length 和 SHA-256 任一不符即返回
受控失败。

## 6. 裁切模型

裁切真源为：

```ts
type MemberAvatarCrop = {
  centerX: number
  centerY: number
  size: number
}
```

`centerX/centerY` 相对规范化 source 宽高，`size` 相对短边。权威转换：

```text
edge = size × min(width, height)
left = centerX × width - edge / 2
top  = centerY × height - edge / 2
```

纯函数必须拒绝 NaN、Infinity 和非正尺寸，将 `size` 限制在 `0.12..1`，再分别
clamp 中心，保证裁切正方形始终完全位于主图内。保存前 Renderer 与 Main 使用同一
测试向量独立校验；Main 不采用 Renderer 传入的像素矩形。

裁切舞台的交互变换必须使用 `ResizeObserver` 获得的实际像素尺寸，不能让 CSS
缩放后的视觉尺寸与固定 `stageSize` 数学脱节。支持拖动、滑杆/滚轮、方向键 1%
微调、`Shift` 4% 微调、重置和 28/32/34/44px 实际预览。

舞台使用普通可聚焦区域和明确键盘说明；除非完成专门的辅助技术验证，不设置
`role="application"`。焦点、可访问名称、错误文本和低分辨率提示不只依赖颜色。

## 7. 共享头像解析

`MemberAvatar` 尺寸语义：

| size | 视觉用途 | 内置 rendition | managed rendition |
|---|---|---|---|
| `mention` | `@` 提及 | glyph | icon |
| `list` | 成员列表 | glyph | icon |
| `workspace` | Camp Lead | glyph | icon |
| `picker` | 紧凑选择 | glyph | icon |
| `bust` | 内置预设 | bust | icon |

`MemberPortrait` 在详情页使用 Day/Night 内置 portrait，managed 使用同一
`source.png`，不套 icon crop 或主题滤镜。内置昼夜图必须保持同一角色、主体比例和
主要构图，避免切换主题时产生身份跳变。

统一解析顺序：

```text
strict parse avatarRef
→ builtin registry OR Main read(managed ref, rendition)
→ session Promise/Blob URL cache
→ image load
→ null / unknown / missing / corrupt / onError
→ first grapheme + neutral identity surface
```

首字按 Unicode grapheme cluster 取得，不能用 UTF-16 `slice(0, 1)` 截断 emoji。
`bust` 必须实际使用 bust 资产；portrait 失败必须渲染中性 fallback，不能返回空白。
替换或移除头像时撤销对应 Blob URL；App 关闭由浏览器释放其余 session URL。

## 8. UI 表面与数据流

允许显示身份图像：

- 成员列表和成员详情；
- 新建/编辑成员的预设、裁切和预览；
- `@` 提及候选；
- 新对话与 Camp 的 Default Lead/成员选择身份位。

不允许把角色插画扩散到消息正文、执行证据、命令、Diff、Task、审批、审计、
错误、恢复、Memory 正文、设置页背景或 App Shell 装饰。

跨表面均从既有 `AgentProfile` Read Side 取得 `avatarRef`。新对话可以把全局
AgentProfile map 传给提及/Lead 组件；不为纯视觉需要改变 Core preflight 的领域
语义。任何候选缺少 Profile 或头像时使用同一 fallback，Runtime readiness 和键盘
选择逻辑保持独立。

## 9. UI 状态与失败恢复

创建/编辑 Dialog 必须覆盖：

| 状态 | 行为 |
|---|---|
| 未选图 | 当前头像或首字 fallback；提供“选择角色图片” |
| 选择取消 | 草稿与当前头像不变 |
| 读取/解码中 | 保留旧预览并显示中性进度 |
| 无效/超限 | 明确规则与重新选择，不回显完整路径 |
| 低分辨率 | attention 提示，达到硬下限时允许继续 |
| 裁切中 | 主图、取景舞台与四种真实尺寸预览 |
| 保存中 | 冻结重复提交和重新选择，保留预览 |
| 资产已存/Profile 失败 | 保留 managed ref 草稿，可直接重试 |
| 文件丢失/损坏 | fallback + “编辑身份”修复入口 |

移除头像先提交 `agents.update(avatarRef=null)`；成功后只更新 UI，不删除旧目录。
替换头像在 Profile 成功前继续以旧 Profile 为权威。Version conflict 保留完整草稿，
刷新 Profile 后由用户再次确认提交。

## 10. 资产与发布门槛

生产包只导入每位伙伴实际使用的：

```text
glyph-day.svg
glyph-night.svg
bust.png
portrait-day.png
portrait-night.png
preset.json
```

概念板、风景图、重复 PNG glyph、HTML 预览和生成过程文件不进入应用包。所有导入
资产必须有来源说明、摘要和发布状态；生成式初稿不得被文档状态自动视为可公开
发布。

公开发布前人工检查：

- 四位角色跨 glyph/bust/portrait 和 Day/Night 的身份一致；
- 昼夜 portrait 主体位置、比例和主要姿态稳定；
- 透明边缘在 Day/Night 与身份色环上无白边、黑边或脏色；
- 28/32/34/44px glyph 仍可识别；
- Night 对比不依赖滤镜且不遮蔽五官；
- 品牌、版权和生成资产使用权有可追溯记录。

## 11. 验收模型

自动验证覆盖：

- Core 闭集 parser、旧值不变兼容、handle 冲突和 Migration 新/升级路径；
- crop 属性测试与共享向量；
- Main magic/header/byte/pixel/IPC 上限、原子 rename、hash、路径穿越与损坏读取；
- Renderer cache、Blob URL revoke、grapheme、所有 fallback 与异步竞态；
- 创建/编辑/替换/移除/version conflict，不发生 Profile 前置删除；
- archived Profile 重启后仍能读取头像，孤儿资产不自动删除。

打包 App 验收覆盖：

```text
new database + v0.13 upgrade fixture
× Day + Night
× 1440×920 + 1040×700
× mouse + keyboard
× create/edit/restart/missing-file recovery
```

验收脚本必须从真实打包 App 捕获证据；静态 HTML 预览和开发服务器截图不能替代。
