---
document_type: version-decisions
version: v1.34
lifecycle: historical
last_updated: 2026-08-31
---

# v1.34 决策记录

<a id="v1-34-d01"></a>
## V1.34-D01：Camp 覆盖绑定保存代次，原生设置限定单次执行

### 背景

相同成员可在多个 Camp 工作；认证重测经常刷新 Runtime 健康快照。把用户选择写入全局或 Thread 默认
会越过 Camp 作用域，把选择绑定到 Probe identity 则会在普通重测后丢失。

### 决定

Camp 只保存三态覆盖，使用持久 Runtime 绑定代次使旧选择失效。新 Run 冻结该值，通过 Claude 单次
inline settings 或 Codex 单 Turn 字段下发，不修改原生默认。当前规范由
[Camp Member Fast v1](../../contracts/camp-member-fast-v1.md) 和
[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#camp-队员-fast-边界) 拥有。

### 后果

增加一次可迁移的 Profile 代次与小型 Camp preference 表；重测保留选择，换绑定清除选择。
Native Host/Session 可以复用；旧 Codex 缺少单 Turn 字段时宁可隐藏入口，不改变其持久默认。

### 被拒绝方案

- 写用户全局配置或 Thread `serviceTier`：不能保证只影响当前 Camp 后续执行。
- 使用内容 hash 作为绑定 revision：切走再切回会复活已失效的覆盖。
- 用 Probe generation 作为 revision：认证/健康刷新会丢失用户意图。
- 实现 Claude 完整 settings 优先级解析：为首次按钮状态引入第二份原生配置真源；MVP 接受初始未知。
