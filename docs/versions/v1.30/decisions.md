---
document_type: version-decisions
version: v1.30
lifecycle: current
authority: decision-rationale
status: accepted
last_updated: 2026-08-30
---

# v1.30 版本决定

<a id="v1-30-d01"></a>
## V1.30-D01：文件预览是会话与 Sidecar 平级的独立阅读面

### 背景

把多个文件塞进 Inspector 会争夺任务/队员职责，也无法在窄窗口中建立明确的返回语义。

### 决定

文件预览使用独立 Pane 和多文件 Tabs。会话、预览、Sidecar 共用一行顶栏；布局按容器实测在宽、中、紧凑模式间切换，紧凑模式以显式返回入口替换会话阅读面但不销毁其状态。

### 后果

阅读状态与当前 Camp 一起管理；关闭最后一个 Tab 才移除 Pane。Sidecar 折叠按钮始终保留恢复入口。

### 被拒绝方案

- 把文件作为 Sidecar Tab：职责冲突且宽度不足；
- 用独立窗口：破坏当前 Camp 上下文和焦点返回；
- 只按屏幕媒体查询：无法覆盖导航、缩放和真实列宽。

<a id="v1-30-d02"></a>
## V1.30-D02：来源使用封闭联合，路径不成为 Renderer Authority

### 背景

开放式 `readFile(path)` 会把 Renderer 看见的字符串升级为磁盘权限，并绕过消息、附件和 Evidence 的领域身份。

### 决定

公开打开请求只有消息引用、Camp workspace、Attachment、Run Evidence、父句柄子引用和用户授权 root 六类。Core 验证领域对象；Main 解析宿主路径并执行 containment；Renderer 只持有安全显示路径与不透明 ID。

### 后果

新增入口必须先映射到联合成员；错误和日志不得泄漏受管路径。额外目录只能由原生选择器签发短期 Grant。

### 被拒绝方案

- Renderer 提交绝对路径：缺少领域来源证明；
- Main 查询数据库重建附件/Evidence Authority：复制 Core 真源；
- 全局允许本地 Markdown 链接：扩大所有 Markdown 调用方权限。

<a id="v1-30-d03"></a>
## V1.30-D03：Main 拥有窗口级句柄与独立重开能力

### 背景

长期向 Renderer 暴露路径，或让子 Tab 依赖父 Tab 的存活，都会造成资源与授权漂移。

### 决定

Main 持有 canonical path、只读句柄、generation、30 分钟 TTL、每窗口 64 项上限和 `reopenToken`。子文件成功打开后获得独立重开记录；过期自动按原来源重新验证并最多重试一次。

### 后果

底层过期不是 UI 状态；Tab、Camp、窗口和应用生命周期都有幂等释放点。

### 被拒绝方案

- Renderer heartbeat 续租：引入轮询与后台噪声；
- 父句柄关闭级联子 Tab：破坏已经完成的独立打开；
- 静默淘汰 Tab：用户可见状态与能力事实分离。

<a id="v1-30-d04"></a>
## V1.30-D04：HTML 只在最小沙箱与短期资源协议中执行

### 背景

完全禁用脚本无法满足 HTML 原型阅读；直接放入宿主 DOM 或 WebView 则会把本地资源、导航和 Rovai API 暴露给文件内容。

### 决定

HTML 使用无 `allow-same-origin` 的 sandbox iframe，CSP 在正文前注入。本地资源只经 `rovai-preview://` 短期 token、窗口 gate 和逐次 containment 读取；导航、新窗口、表单和下载全部阻断，消息桥保持封闭。

### 后果

交互 HTML 可以运行内联和授权根内本地脚本，但不能访问 Preload、网络、文件系统或任意 IPC。

### 被拒绝方案

- 把 HTML 注入宿主 DOM：同权限执行；
- 只靠 CSP：不能证明调用窗口与短期能力；
- 建设完整浏览器平台：超出只读文件预览的产品边界。

<a id="v1-30-d05"></a>
## V1.30-D05：历史 Evidence 与当前磁盘文件保持双入口

### 背景

Files Changed Review 证明 Run 当时的事实；当前文件可能已经变化、删除或被其他进程重写。

### 决定

主点击继续读取 immutable Evidence；“打开当前文件”使用稳定 `evidenceFileId` 重新映射当前 Camp workspace 并创建普通预览句柄。普通 `.diff/.patch` 永远是通用 Patch Viewer。

### 后果

当前内容不能补写历史统计；旧 schema 通过稳定 ordinal ID dual-read，不按显示路径猜身份。

### 被拒绝方案

- Review 自动读当前文件补齐：污染历史真源；
- 从 `selectedPath` 构造打开请求：显示字段成为 Authority；
- 所有 patch 复用 Evidence Review：赋予普通文件虚假历史语义。

<a id="v1-30-d06"></a>
## V1.30-D06：外部变化是事件信号，不是同步状态机

### 背景

自动刷新会覆盖用户正在阅读的内容；逐文件 watcher 和轮询会扩大资源与磁盘活动。

### 决定

Main 以 canonical root 复用一个原生 watcher。事件只给打开 Tab 设置 `hasExternalUpdate`；只有用户主动刷新才重读，并在刷新期间继续显示旧内容。

### 后果

刷新失败保留旧内容；watcher 失败只进入安全诊断，不建立用户可见“监听失败”状态，也不退化为轮询。

### 被拒绝方案

- 文件事件后自动刷新：可能覆盖阅读与选区；
- 每 Tab 一个 watcher：资源随 Tab 线性增长；
- 周期 `stat`：违反事件驱动边界并扫描磁盘。

<a id="v1-30-d07"></a>
## V1.30-D07：会话选区持久化为冻结快照而不是读取能力

### 背景

用户需要把当前看到的代码交给队员，但持久化句柄会把短期窗口权限扩展为未来磁盘读取权。

### 决定

Core 持久化显示路径、范围、选中文本、内容版本和验证语义；`handleId`、generation 与 reopen token 不进入 Draft/Message。版本变化时用户明确选择刷新或附加当前可见快照。

### 后果

发送后的 Agent 获得确定内容且无需源文件继续存在；选区不会变成附件、Mention 或路由信息。

### 被拒绝方案

- 发送时重新读取：用户看到的文本与发送内容可能不同；
- 持久化句柄：权限生命周期失控；
- 把选区拼进普通正文：丢失路径、范围、版本和验证语义。
