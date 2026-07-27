---
document_type: version-overview
version: v0.14
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-27
---

# Rovai-ai v0.14 营地伙伴身份视觉与受管本地头像

> 状态：实现检查点 1–6 完成；packaged-App 主验收通过；公开发布仍受素材审查门槛阻止
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.13 伙伴经验自动沉淀与分级记忆权威](../v0.13/README.md)
>
> 跨版本决策：[ADR-0056](../../adr/0056-controlled-member-avatar-assets.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.14 为长期 `AgentProfile` 增加清晰、可恢复且不改变权限语义的视觉身份：

- 洛可、沐瓦、眠枝、绮露获得随应用发布的昼夜伙伴资产；
- 用户只选择一张本地图片，即可得到详情主图与紧凑头像；
- 成员列表、成员详情、创建/编辑、`@` 提及和 Camp Lead 使用同一头像解析契约；
- 无效引用、文件丢失、解码失败和旧版本值始终安全回退，不阻断成员管理；
- Renderer 不获得文件系统路径或 Node 权限，图片正文不进入 SQLite、审计、日志或诊断。

本版本采用外部 decision pack v1.1 作为设计输入，但已经按当前代码、有效 ADR 和
Meridian 规范重新收敛。设计包版本号不是产品版本号，设计包示例也不构成实现真源。

## 已确认范围

1. **受控引用**：继续使用唯一的 `AgentProfile.avatarRef: string | null`，新写入值
   只允许 `rovai://member-avatar/builtin/...` 与
   `rovai://member-avatar/managed/...` 两类闭集引用。
2. **分层权威**：Core 校验并持久化引用；Electron Main 管理本地图片字节；
   Renderer 只接收有界字节并生成 session Blob URL。绝对路径不跨越 Preload。
3. **四位内置伙伴**：四个既有固定 ID 是内置伙伴，不是需要重复创建的领域类型。
   Migration 只为空头像补内置引用，不覆盖用户头像、字段、状态或 Runtime 配置。
4. **可复用外观预设**：创建成员时可以复用内置外观和建议文案，但新成员必须拥有
   独立唯一 handle；`avatarRef` 只表达外观，不能反向推导角色事实。
5. **单图流程**：用户选择一张 PNG/JPEG，在本地完成方向规范化、缩放和 1:1 裁切；
   应用保存规范化 `source.png`、派生 `icon-192.png` 与 manifest。
6. **保守生命周期**：资产先原子落盘，再提交 Profile；失败资产作为孤儿保留。
   v0.14 不自动删除最终资产，不实施存在竞态的引用扫描 GC。
7. **共享身份组件**：`MemberAvatar` 和 `MemberPortrait` 统一内置、受管、空值、
   未知值、缺文件和 `onError` 回退；昼夜不改变身份或操作。
8. **限定插画例外**：伙伴图像只进入明确的成员身份表面，不扩散到命令、Diff、
   审批、审计、错误、恢复或背景装饰。
9. **安全资源上限**：选择、解码、IPC、规范化输出、manifest 与读取均有独立上限；
   v0.14 只接受静态 PNG/JPEG，不接受 WebP、SVG、GIF、远程 URL 或 data URL。
10. **真实 App 验收**：新库与 v0.13 升级库均须通过打包 App、Day/Night、
    `1440×920`、`1040×700`、键盘、重启恢复、归档引用和损坏回退验收。

## 非目标

- 不新增 `iconRef`、`portraitRef`、裁切列或角色类型字段。
- 不把头像、motto、traits、物种或角色标题变成权限、能力或 Runtime 选择依据。
- 不提供第二张小头像、Day/Night 双图、多尺寸上传、批量导入或自动人脸识别。
- 不支持远程图片、CDN、云同步、跨设备头像同步或通用媒体库。
- 不在 v0.14 自动回收最终头像资产；不因当前 Camp 未引用而删除任何成员头像。
- 不把头像写入 Memory Export、diagnostics、事件、命令结果或 Agent 上下文。
- 不替换 App 图标，不使用风景插画、概念板或身份图像作为工作区背景。
- 不在本版本引入图像编辑库、动画库、新 UI 框架或新的领域状态管理方案。

## 稳定引用

| 类型 | v0.14 新写入格式 | 字节权威 |
|---|---|---|
| 内置伙伴 | `rovai://member-avatar/builtin/{role}/v1` | 打包只读资产 |
| 用户头像 | `rovai://member-avatar/managed/{assetId}` | `userData/member-avatars/` |
| 无头像 | `null` | 首字/中性 fallback |
| 旧版或未知值 | 原值只读兼容，不再新写入 | fallback，直到用户替换或移除 |

内置 `role` 闭集为 `luoke | muwa | mianzhi | qilu`。`assetId` 是 Main 生成的规范
小写 UUID；引用不能直接拼接为路径。

## 升级策略

v0.14 不增加 `agent_profile` 列，但需要一次数据 Migration：

```text
agent-luoke   + avatar_ref IS NULL → builtin/luoke/v1
agent-muwa    + avatar_ref IS NULL → builtin/muwa/v1
agent-mianzhi + avatar_ref IS NULL → builtin/mianzhi/v1
agent-qilu    + avatar_ref IS NULL → builtin/qilu/v1
```

该 Migration：

- 只按固定 `AgentProfile.id` 匹配；
- 不按名称、handle、物种、角色标题或当前排序猜测身份；
- 不覆盖任何非空 `avatarRef`；
- 不改变 active/disabled/archived、Camp 归属、Default Lead 或 Runtime；
- 新数据库的 seed 同时写入相同内置引用，保证新装与升级结果一致。

## 当前版本状态

版本范围、受管资产边界和 UI 例外已经冻结。Core 闭集引用、Migration v25、
Main/Preload 受管资产服务、Renderer 裁切/缓存/共享组件、成员页、预设、`@`
提及和 Lead 身份位均已实现。全量 TypeScript/Rust、Core smoke、macOS 打包、
codesign 与 packaged-App fresh/upgrade/restart/损坏回退主验收已经通过；证据见
[实施与验收清单](implementation-plan.md#2026-07-27-当前证据)。

因此，本版本可作为内部开发和产品验收候选，但还不能标记为公开发布完成：

- 当前生成式 PNG 仅获准用于实现和打包验收。虽然角色一致性、透明边缘、昼夜构图、
  暗色对比与小尺寸识别已经完成技术检查，品牌归属和版权审查仍需由权利负责人确认。
