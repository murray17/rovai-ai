---
document_type: version-decisions
version: v1.57
lifecycle: historical
authority: decision-rationale
last_updated: 2026-09-11
---

# v1.57 版本决定

<a id="v1-57-d01"></a>

## V1.57-D01：官方 ZCode 内核与既有 Host/Fleet 共享生命周期

### 背景

官方 ZCode App 包含可独立运行的 NDJSON app-server。社区 CLI/ACP 发行物增加了包装或补丁，不能作为
用户明确要求的官方来源。为新协议复制另一套 Host、owner、epoch、取消与 LRU 状态机会增加长期维护和一致性成本。

### 决定

以官方 App bundle 的未修改内核作为唯一生产协议入口，使用独立 Node.js 执行 app-server，在 Core 进程内把原生事件转换为已有 Session transport。
协议翻译负责 ZCode 原生 identity 和回调；Fleet 与 Run 生命周期继续由既有 Core owner 负责。公开 Evidence
保留 `zcode-app-server-v1`，不把内部 transport shape 当作上游支持 ACP 的证明。

启动探测发现 App 主程序即使设置 `ELECTRON_RUN_AS_NODE=1` 仍会注册为 macOS App，因此所有启动目的统一
使用独立 Node，Node identity 纳入 composite fingerprint。Camp 授权范围内允许按进程配置切换成员 Session，
保持跨 Camp 的 attachment 隔离；这不同于 Pi 的 workspace 级范围。

原生 Bash 使用 detached 进程组，真实强杀测试证明只清理 Host 根组会留下延迟写入。Rovai Node prelude
因此持有独立的组 ID 回收 companion，断开时清理已记录的原生子进程组；官方内核文件与工具调用参数保持原样。
Core/原生 Host 强杀和后续 35 秒无副作用在 v3 已分别通过。当前修订要求直接 shell close 后继续持有有后代的组，
只在确认空组后注销，并以有界 owner report 区分清理确认与未知。该 companion 属于 Host 进程所有权，不承担 Session 调度。

v7 在 Windows 复用原子创建、禁止 breakaway 的 ManagedProcess Job，不运行 Unix companion 或负 PID 清理。
Job 的 ActiveProcesses 为零才确认整树退出；两种平台保留相同的请求级 CLI lease 冻结，避免后发命令继承新 Run 授权。

普通 Probe 检查用户实际原生环境，因此与正式执行共用 HOME/USERPROFILE/原生存储，不另造临时 Home 或复制凭据。
保留私有 cwd/socket 和无生成请求边界；正常初始化允许联网/落盘，不能以删除原生数据库实现零残留。
前台答案可以在原生后台任务仍运行时完成；任务保持 Session/Input/Turn/Tool 的原归属，晚到结果通过已有 Evidence
模型的 ZCode 专用已登记身份校验入口持久化。Fleet 暂停该 Host 的跨成员复用及空闲/容量回收，原 Run 的 CLI 授权仍失效。
取消只处理本次 input；明确关闭才清理关闭范围的组。移除每轮 300 秒后台收口门禁，不扩展其他 Runtime 的生命周期。

### 后果

ZCode 可以沿用 FirstPayload、审批、Missing-Send 与持久 Evidence。压缩完成后由已有 observer 触发下一次
eligible input 补发，无法在原生同一轮 compact/retry 内部插入消息。BYOK 继续属于官方配置；不用社区包或外部
provider broker。原生能力缺口和平台资格独立记录，不用共享 transport 推导能力相同。

### 被拒绝方案

- 社区 CLI/ACP：不满足用户的官方来源约束，且补丁与官方发行物可能漂移。
- 为 ZCode 复制独立 Fleet/Run 生命周期：会重复已有并发、取消、恢复与租约边界。
- GUI 自动化驱动官方 App：无法提供可靠的原生 input/turn/tool identity 和可恢复事件通道。

<a id="v1-57-d02"></a>

## V1.57-D02：逐平台发布资格与完整接入能力分离

### 背景

官方 BYOK 的真实产品路径已覆盖执行、文件/输出、权限/取消、Session、压缩补发、Skills/MCP 和 Built-in CLI。
这些功能证据仍不能替代接入 Checklist 中所有组合场景和每个平台的资格冻结。

### 决定

初始交付仅允许 macOS arm64 Preview。v7 在 Windows 真实 Camp 验收后，维护者要求 Windows x64 与
macOS arm64 同时标记 Qualified，并移除运行时管理页的测试、试运行和实验性标签。两行分别绑定自身
冻结证据：Windows 使用本次真实 App CLI 证据，arm64 使用既有目标主机 v3–v6 证据及明确发布批准；
不声称本次在 Mac 重跑，也不把 Windows 成功当作 Mac 实测。

macOS x64 同时开放为可执行 Preview，保留 `runtime_platform.qualification_evidence_missing` 与空 evidence revision，
不谎报 Intel Mac 资格。管理页使用版本和机器状态，检查详情仍可解释资格记录待完善。平台发布资格不代表
完整 First-Class 接入 Checklist 完成，安装、模型、原生配置、权限和 Session 门禁不因呈现调整而放宽。
剩余资格项和逐项产品证据由[实施与验收](implementation-plan.md)与[兼容性清单](../../runtime-compatibility.md)记录。

### 后果

用户已纠正范围：账号登录与 BYOK 都接入，配置仍由官方 ZCode 拥有。user FirstPayload 及下一 eligible input
压缩补发沿用用户接受的策略；同一原生轮次内部重试没有 Host 注入位置。GUI 回调仍未实现；图片沿用既有附件路径和原生 Read，不改变模型上下文合同；不能把没有预上传通道声明为上游不支持。
只有补齐核心轴证据并更新平台准入后，才可以称为 First-Class 完成。

v6 按用户已登录 App 的实际环境增加只读 App 配置 fallback，保留显式终端配置优先级；不迁移或解密凭据。
Start Plan 还要求 App Renderer 的临时人机验证，真实调用返回 3007，因此账号生成不能记为通过。
用户确认免费账号后，接受先按 zcode-acp 的接法交付：个人 Coding Plan 的原生凭据由官方内核签名，
Start Plan 请求级验证回调明确返回未应用并给出可操作的认证错误。该缺口属于当前 Host 实现，不能表述为
app-server 协议永远不支持账号认证。免费账号模型生成、账号刷新和 Team Plan 动态凭据保留未接入边界；
没有订阅凭据时以确定性配置/协议回归交付 Preview，不把缺少真实验收当作通过。无需引入社区包或启动 GUI。
