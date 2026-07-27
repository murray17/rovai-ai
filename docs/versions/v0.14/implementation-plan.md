---
document_type: implementation-plan
version: v0.14
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-27
---

# Rovai-ai v0.14 实施计划与验收清单

> 状态：协议检查点 1/1；编码检查点 6/7；检查点 7 技术验收通过，
> 仅公开发布素材审查待完成
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：[ADR-0056](../../adr/0056-controlled-member-avatar-assets.md)

检查点按依赖顺序排列。`[x]` 只表示已有代码、Migration、测试或可复现 App
证据；设计包、参考实现和 ADR `accepted` 不能作为实现完成证据。

## 检查点 0：协议切换

- [x] v0.13 三份版本文档冻结为 `historical`，v0.14 成为唯一 `current`。
- [x] 接受 ADR-0056，冻结 Core/Main/Renderer 权威、URI、生命周期与兼容规则。
- [x] Meridian 增加受限的成员身份图像例外，不放宽证据优先规则。
- [x] 确认四位固定种子是内置伙伴；预设不得复用保留 handle。
- [x] 明确 v0.14 无自动最终资产 GC、无 WebP、无头像驱动领域事实。
- [x] 外部 decision pack 降为设计输入，当前版本文档成为版本规范真源。

## 编码检查点

### 1. 资产筛选、闭集引用与 Migration v25

- [x] 从设计输入只导入四位伙伴实际使用的 glyph/bust/portrait/preset，记录来源、
  SHA-256 和发布状态；不导入概念板、风景图、HTML 或重复位图。
- [x] contracts 与 Rust 增加共享测试向量对应的 `avatarRef` 闭集 parser。
- [x] `agents.create/update`：新值严格校验；旧未知值仅允许原样保留。
- [x] Migration v25 只为四个固定 ID 且空头像的 Profile 补内置引用并推进 version。
- [x] Seed 为新数据库写相同引用，不覆盖既有 Profile 用户字段。
- [x] 预设创建不复制 `luoke/muwa/mianzhi/qilu` 保留 handle；重复外观仍需独立 handle。

必须测试：

- 新库与 v0.13 fixture 升级后四个 canonical ID 一致；
- 非空自定义/未知头像、修改过的字段、disabled/archived、Runtime 和 Camp 关系保持；
- exact builtin/managed、大小写、UUID、额外段、query/fragment、编码斜杠、
  `file/http/data` 和绝对路径；
- 编辑含未知旧值的其他字段可成功，改变为另一个未知值被拒绝；
- 默认预设提交不会触发 `agent_profile.handle_conflict`。

### 2. 裁切纯函数与规范化 Renderer 管线

- [x] 实现 crop validate/clamp/pixel rect/preview transform 纯函数。
- [x] 用同一 fixture 覆盖 TypeScript 与 Main 校验边界。
- [x] Renderer 仅解码静态 PNG/JPEG，验证实际尺寸、边长与 32MP 面积。
- [x] 方向规范化后生成最长边 ≤2048px 的 source PNG 和 192px icon PNG。
- [x] 实现 measured-stage 响应式变换，不使用与 CSS 脱节的固定 stage 数学。
- [x] 低尺寸提示、安全区、重置、拖动、滚轮、滑杆和键盘微调完整。

必须测试：

- 正方形、横图、竖图、极端比例与 100,000 组属性样本；
- NaN/Infinity/负数、最小/最大 size、边界中心和 resize 中交互；
- EXIF 方向 fixture、透明 PNG、JPEG、伪造扩展名、解码炸弹声明尺寸；
- icon 始终为源图内正方形，不烘焙圆角、身份环或状态。

### 3. Main / Preload 受管头像服务

- [x] 增加闭集 `memberAvatars.selectSource/save/read` API 与 Preload 类型。
- [x] Main 使用系统选择器、普通文件与有界读取；不返回路径，不在特权进程通用解码。
- [x] save 独立验证 IPC 大小、PNG signature/IHDR/chunks、尺寸、crop、摘要。
- [x] 使用私有目录/文件权限、临时目录、manifest-last、sync 和原子 rename。
- [x] read 只按 parser 结果和固定 rendition 文件名读取，校验 manifest/length/hash。
- [x] 启动只清理超过 24 小时且严格匹配的 `.tmp-{uuid}`；不删除最终目录。

必须测试：

- 取消、目录/symlink/非普通文件、超 10MiB、格式伪造和截断 header；
- source/icon/合计 IPC 上限、错误声明尺寸、非 192 icon、非法 crop；
- 路径穿越、编码分隔符、manifest 超限、缺文件、hash 不符；
- 每个原子写入失败点及重启读取；
- API、日志、diagnostics 与错误文本均无绝对路径或图片正文。

### 4. 共享头像组件、注册表与缓存

- [x] 实现 builtin registry、`MemberAvatar`、`MemberPortrait` 和 managed session cache。
- [x] `bust` 使用真实 bust，portrait 按主题解析且 managed 不使用主题滤镜。
- [x] null/unknown/missing/corrupt/onError 使用同一首 grapheme fallback。
- [x] 异步旧请求不能覆盖更新后的 `avatarRef`；替换/移除可 invalidate/revoke。
- [x] 图片 alt、decorative 空 alt、身份环、焦点和高对比模式符合规范。

必须测试：

- 五种尺寸映射、Day/Night 切换、快速 Profile 切换和并发相同 URI 去重；
- emoji/组合字符/空显示名 fallback；
- manifest/file/hash 故障、Blob URL 创建/revoke 和组件 unmount；
- 图片不编码 Runtime、状态、Capability 或权限。

### 5. 成员页、预设与单图编辑

- [x] 成员列表使用 32px 身份头像，详情使用响应式 portrait + 身份字段层级。
- [x] 创建/编辑 Dialog 集成预设、单图选择、裁切、替换、重裁切和移除。
- [x] motto/traits 只在预设选择预览出现；已存 Profile 不从头像实时推导。
- [x] 资产先保存、Profile 后提交；失败保留草稿，旧 Profile/头像继续有效。
- [x] version conflict、保存中、低分辨率、文件损坏和修复入口完整。
- [x] 不隐式配置 Runtime、加入 Camp、改变 Lead、状态、Capability 或成员顺序。

必须测试：

- create/edit/cancel/retry/replace/remove/version conflict；
- 资产成功但 Profile 失败、Profile 成功后重启、旧资源仍保留；
- active/disabled/archived 的详情与操作；
- Dialog 焦点约束、关闭后返回、方向键与屏幕阅读器说明；
- `1440×920` 与 `1040×700` 无操作遮挡或整页横向滚动。

### 6. 跨表面身份与回归

- [x] `@` 提及候选通过 AgentProfile map 获得 avatarRef，保持 readiness 与键盘逻辑。
- [x] 新对话与 Camp Default Lead/成员选择身份位使用共享头像。
- [x] 不向命令、Diff、Task、审批、审计、Memory、错误或恢复扩散插画。
- [x] 新对话 preflight 不因纯视觉数据改变领域行为。
- [x] Day/Night、主题切换、Loading/Empty/Error/Disabled/Recovery 全量回归。

必须测试：

- 提及过滤、上下键、Enter/Escape、光标插入和 Runtime 未就绪；
- Agent 缺失、unknown ref、managed read 慢/失败；
- 同成员跨列表、详情、提及和 Lead 的 identity color/图像一致；
- 主题切换不移动焦点、不丢草稿、不改变裁切。

### 7. 打包 App、升级、发布资产与文档

- [x] 新增 `pnpm accept:member-avatar-ui`，从打包 App 驱动真实验收。
- [x] 覆盖新库和 v0.13 fixture、Day/Night、1440×920/1040×700。
- [x] 创建自定义成员后关闭/重启，验证列表、详情、提及和 Lead。
- [x] 验证 archived Profile 头像保留、孤儿不清理、缺文件受控 fallback。
- [x] 完成四位伙伴的身份一致性、边缘、昼夜构图、Night 对比与小尺寸检查。
- [ ] 完成来源/品牌/版权审查，替换未达发布门槛的生成式初稿。
- [x] 运行全量 Rust、TypeScript、smoke、build、package 与 codesign 验证。
- [x] 更新本文完成证据与版本 README 状态。

最终证据至少包括：

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
pnpm test
pnpm smoke:core
pnpm package:mac
pnpm accept:member-avatar-ui
codesign --verify --deep --strict <packaged-app>
```

## 2026-07-27 当前证据

| 证据 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 18 个文件、85 项测试通过 |
| `cargo fmt --check` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `cargo test --workspace` | lib 171 项、bin 33 项通过；4 项真实外部 Runtime smoke 按定义忽略 |
| `pnpm smoke:core` | 通过；fresh database 读取 4 个 Profile |
| `pnpm package:mac` | 通过；生成 `dist/mac-arm64/Rovai-ai.app` |
| `pnpm accept:member-avatar-ui` | 通过；三次打包 App 启动覆盖 fresh、v24→v25、重启、归档、孤儿与缺 icon fallback |
| `codesign --verify --deep --strict dist/mac-arm64/Rovai-ai.app` | 通过 |
| 人工截图检查 | Day `1440×920`、Night `1040×700` 的成员详情与创建 Dialog 无横向溢出，操作区可见 |

验收脚本还验证了四位 canonical seed 引用、`luoke-2` 预设 handle、打包
Renderer→Preload→Main 的 managed save/read、目录 `0700`、文件 `0600`、重启后
managed 引用、Migration v25 不覆盖修改后的名称/归档状态，以及损坏 icon 时首
grapheme fallback。它还让重启后的 managed 自定义 Profile 使用隔离测试 Runtime
达到 Ready，验证同一 Blob 身份进入 New Conversation 的 `@` 候选和 Default
Lead。脚本每次使用独立临时 `userData`，不会读写日常 App 数据。

当前只剩一个门槛：由可确认素材权利与品牌归属的负责人完成公开发布审查；当前
生成式 PNG 只获准用于实现和打包验收。

只有编码检查点 1–7 全部完成且公开资产门槛通过，v0.14 才能标记“实现与验收完成”。
