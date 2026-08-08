---
document_type: implementation-plan
version: v0.49
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-09
---

# v0.49 实施与验收计划

> 当前状态：官方双人追问 Skill 已完成生产源码与定向验收；通用与启动设置已完成生产实现、
> 自动回归、macOS 打包以及主窗口会话实机验收。已安装 App 的真实登录项开关、系统授权态、
> 外接显示器和完整负向人工矩阵仍待验收，因此本计划保持 `in_progress`。Desktop Shell 范围不修改
> Rust Core；Skill 范围只扩展 bundled manifest，不修改 SQLite schema。

## Checkpoint 0：设计与版本切换

- [x] 确认 Main Window Session 每次只解析一次启动位置，覆盖冷启动和 macOS 无窗口再打开；
- [x] 确认 Restorable Location 在稳定页面权威加载成功后立即提交，不依赖正常退出；
- [x] 确认 `requires-approval` 使用 checked Switch + “当前尚未生效” + 系统设置入口；
- [x] 冻结 General 页面、Shell 文件、Preload bridge、窗口 reset、失败分类与负向领域边界；
- [x] 确认 Desktop Shell 范围不改变 Core/Runtime/长期系统结构且无需 ADR，并记录可审阅理由；
- [x] 冻结 v0.48 为 historical，创建 v0.49 概览、生产设计和实施计划，更新 UI 权威文档与
  `CONTEXT.md`；
- [x] 运行 `pnpm docs:check`，证明唯一 current 指针、lifecycle、索引和九项影响表一致。

## Checkpoint S：官方双人追问 Skill

- [x] 用户确认同时提供 `rovai-grill-duo` 与 `rovai-grill-duo-with-docs`，默认启用且默认不分组；
- [x] 普通版内置完整逐题 grilling 与固定搭档公共 A2A 往返，发送成功不冒充搭档完成；
- [x] 文档版随包携带 duo protocol、domain-modeling、词汇表格式与 ADR 判断参考，不依赖其它
  Skill Assignment；
- [x] 两个目录均包含规范 `SKILL.md` 与生成的 `agents/openai.yaml`，Core bundled manifest 嵌入
  完整不可变内容；
- [x] Core installation test、Skill smoke 与设置页 capture 期望值扩展为四个官方 Skill；
- [x] ADR-0144、ADR 索引、`CONTEXT.md`、Arctic Dawn 内置清单与本版本影响记录同步；
- [x] `quick_validate.py` 通过两个 Skill；
- [x] `cargo test -p rovai-core skill::tests` 6/6，通过 `pnpm docs:check`、两个脚本语法检查、
  `cargo fmt --all -- --check` 与 `git diff --check`；
- [x] `pnpm smoke:skills` 通过四个官方默认项断言和 Codex native Skill discovery；
- [ ] 同一 smoke 的 Core restart 收口被既有 Data Contract 漂移阻塞：启动兼容常量仍要求
  `v0.47 / schema 25`，Migration 66 已写入 `v0.48 / schema 26`，第二次启动执行 clean reset 后临时
  Imported Skill 消失。本 Skill 变更不扩大范围修订全局 reset 边界。

## Checkpoint 1：Shell 偏好模型与原子文件

- [x] 在 `apps/desktop/src/main/` 增加纯函数化 `general-preferences` 与
  `restorable-location` 模块；
- [x] `general-preferences.json` schema v1 只保存 `startupLocationMode` 与
  `lastSettingsSection`，默认 `last_location/general`；
- [x] `restorable-location.json` schema v1 只接受 Quick Chat、Camp ID、Member ID/Tab 或
  Memory，拒绝 Settings 和所有临时 surface；
- [x] 缺文件使用安全默认，malformed JSON、未知 schema、非法 enum/ID/shape 均不抛到 App
  启动边界；恢复记录损坏精确回退 Quick Chat；
- [x] 写入使用 `0600` 临时文件、`wx`、完整 JSON、原子 rename 与失败清理；相同目标 no-op；
- [x] 三类文件损坏相互隔离，不重写 `appearance.json`、`navigation.json` 或现有业务数据；
- [x] 单元测试覆盖默认值、每个合法 union、部分/整体损坏、未知字段、并发最后写入、rename
  失败和临时文件清理。

## Checkpoint 2：Preload contracts 与 Main Window Session

- [x] 在 `packages/contracts` 增加 `StartupLocationMode`、`SettingsSection`、
  `RestorableLocation`、`DesktopStartupSnapshot`、`LoginItemSnapshot` 与 window reset result；
- [x] 为 `RovaiApi` 增加 `desktopSession`、`generalPreferences`、`loginItem`、`windowControls`
  窄接口；不增加通用文件、Shell URL 或 BrowserWindow 控制能力；
- [x] Preload 只映射固定 IPC channel；Main 对 enum、ID 长度、shape 与 fullscreen 竞态再次校验；
- [x] `createWindow()` 为每个新窗口冻结一个 startup snapshot；同一窗口的重复读取返回相同值；
- [x] 冷启动和 macOS `activate` 在无窗口时各创建新 Session；第二实例、已有窗口 Dock 激活与
  minimize restore 只聚焦/恢复，不生成 snapshot 或路由；
- [x] 当前窗口修改 Startup Location Preference 不重跑路由，只影响下一窗口；
- [x] Main Window Session 单元/集成测试使用两个连续 BrowserWindow lifetime，证明每窗恰好解析一次。

## Checkpoint 3：启动恢复 Gate 与权威验证

- [x] App 初始状态从固定 Quick Chat 改为 Startup Gate，未解析前不闪现 Quick Chat/Camp/Member；
- [x] `quick_chat` 模式直接打开 Quick Chat；缺失或损坏目标按设计安全回退；
- [x] Camp 恢复用精确 Core Read Side 查询验证 `campId`，成功显示后才提交；明确删除回退 Quick
  Chat；
- [x] Member 恢复用权威 Member 查询验证 `agentId` 与 removed 状态；失效时按 Member Order
  先 present 后 away 选择首个可管理队员，保留 `identity/runtime` 页签，无队员显示空状态；
- [x] Memory 与 Quick Chat 在合法页面/空状态可见后提交；Settings、Notification Center、Command
  Palette、New Conversation Dialog、Approval、Toast 和 Error Dialog 永不提交；
- [x] Core starting/restarting/unreachable/timeout 进入 `waiting_for_core`，保留冻结目标和恢复 Gate；
  重试只验证原目标，不重读偏好、不清除文件、不转 Quick Chat；
- [x] 只使用结构化 `not_found/removed` 结果执行失效回退，禁止按错误文案或旧 Navigation Snapshot
  猜测；
- [x] 打开设置后关闭窗口的集成测试证明下次恢复设置前页面；从临时 surface 关闭也保持同一目标；
- [x] 页面已显示但 Shell 提交失败时保留页面，显示非阻塞错误并允许后续稳定导航重试。

## Checkpoint 4：General 页面与设置导航

- [x] `NavigationSettingsSection`/共享 contracts 增加 `general`，设置侧栏严格渲染
  “通用 / Skill / MCP / Agent 运行时 / 外观 / 通知 / 诊断”；
- [x] 全新安装设置默认 General；普通设置入口读取 `lastSettingsSection`，选择分类立即原子保存；
- [x] 明确深链到 Agent 运行时等分类时同步保存；非法/损坏分类回退 General；
- [x] SettingsView 增加单一 `Settings / General` 页头、启动区与窗口区，不增加嵌套导航或 Hero 卡；
- [x] Radio 使用原生 `fieldset/legend` 语义，默认“上次使用的位置”，保存中防重入，失败恢复系统值；
- [x] 固定显示“只决定启动后显示的位置”的恢复语义说明；
- [x] “返回 App”继续恢复当前会话进入设置前的页面、Camp、Member 与 Tab，设置本身不提交
  Restorable Location；
- [x] Renderer tests 断言七项顺序、General 默认、最后分类恢复、页面文案、Radio 语义、错误保留
  与设置前页面返回。

## Checkpoint 5：macOS Login Item Registration

- [x] Main 只在 `process.platform === "darwin" && app.isPackaged` 时读取/修改
  `mainAppService`；Development 返回 `development` 且不调用系统注册；
- [x] 安装和首次启动不主动注册或注销登录项；全新系统状态默认关闭，重装后存在的系统注册按
  真实状态呈现；
- [x] 集中纯函数把 `enabled/not-registered/requires-approval/not-found` 映射为 checked、effective、
  warning 与修复动作；
- [x] 写入只调用 `setLoginItemSettings({ type: "mainAppService", openAtLogin })`，随后立即
  `getLoginItemSettings` 读回；
- [x] 不设置 `openAsHidden`、args、agentService、daemonService 或登录时后台路径；
- [x] `requires-approval` 显示 checked 和“等待系统授权，当前尚未生效”，允许关闭以注销，并提供
  Main-owned 系统设置入口；
- [x] `not-found` 显示 unchecked 与安装修复提示；读取/设置失败保留最近系统值和可重试 inline error；
- [x] General 页 mount、App 重新获得焦点、系统设置返回及 mutation 后刷新状态；
- [x] Mocked Electron tests 覆盖四系统态、Development no-call、read-after-write、失败和关闭 pending
  registration。

## Checkpoint 6：窗口可见性与 Reset

- [x] 扩展 `sanitizeWindowState`：拒绝非 finite/低于最小值状态，选择最大相交 display，尺寸和位置
  clamp 到 work area；无交集时使用 primary display 并居中；
- [x] 没有有效状态时使用 `1440×920` 默认尺寸（受 work area 约束）并明确居中；
- [x] move/resize 继续 debounce 保存 normal bounds，窗口关闭前 best-effort flush；fullscreen bounds
  不覆盖 normal bounds；
- [x] `resetBounds()` 使用当前窗口所在 display、默认尺寸与精确居中坐标，立即写回窗口状态；
- [x] fullscreen 时 Renderer 禁用并解释，Main 在竞态调用中仍返回 `performed=false/fullscreen`，
  不登记退出全屏后的延迟 reset；
- [x] reset 不触发 Router/React reload，不改变当前页面、Camp、Member、Tab、Settings、Draft、
  Approval、Run、滚动或焦点；
- [x] 几何测试覆盖负坐标显示器、左右/上下多屏、外接屏移除、超大/损坏 bounds、display work area、
  当前屏居中和 fullscreen no-op。

## Checkpoint 7：自动验证

- [x] `pnpm docs:check`；
- [x] `pnpm typecheck`；
- [x] General preference、Restorable Location、Login Item mapping、window state、preload 与 Renderer
  定向 Vitest；
- [x] `pnpm test`；
- [x] `pnpm build:desktop`；
- [x] `git diff --check`；
- [x] 静态扫描证明 General IPC 不在 `CoreMethod` allowlist，代码没有 `openAsHidden`、登录项本地 Boolean、
  Settings Restorable target 或 Core preference write。

## Checkpoint 8：packaged App 与负向证据

- [x] `pnpm package:mac` 生成已安装形态，Development build 同时验证 Login Item disabled copy；
- [ ] packaged App 开启登录项，退出并重新登录/使用系统测试路径，证明启动普通可见主窗口；
- [ ] packaged App 关闭登录项并从系统状态读回；手动制造或观察 `requires-approval`，验证 checked、
  “尚未生效”、系统设置入口和可取消注册；
- [ ] 在 Camp、队员 identity/runtime、记忆、设置及每类临时 surface 关闭/重开窗口，采集恢复截图；
- [ ] 删除目标 Camp、移除目标 Member、损坏两个 Shell 文件、模拟 Core 暂时失败后恢复，逐项验证
  fallback/retention；
- [ ] 连接外接显示器保存窗口后断开，证明下一窗口完整可见；验证 reset 默认尺寸、当前屏居中和
  fullscreen no-op；
- [ ] 对登录项、启动偏好、最后设置分类与窗口 reset 前后采集 Core 业务表/event/audit 负向证据，
  证明没有新增 Camp、Task、Run、Native Session、Approval 或 audit 事实；
- [ ] 将真实命令、通过状态、macOS 版本、App 路径、登录项系统状态和截图路径回填本计划后，才能将
  `implementation_status` 与本计划 `status` 标记为 complete。

## 2026-08-09 实施证据

### 自动回归与打包

- `pnpm test`：通过；Vitest 36 个文件、209 个测试，以及 Node acceptance 78 个测试全部成功；
- `pnpm typecheck`：通过；
- `pnpm build:desktop`：通过；
- `pnpm package:mac`：通过，产物为
  `dist/mac-arm64/Rovai-ai.app`；bundle identifier 为 `ai.rovai.desktop`，当前本地产物为 ad-hoc 签名，
  未执行 notarization；
- `pnpm docs:check`、`git diff --check`：通过；
- 定向测试覆盖 Shell 文件默认值、损坏与原子写入、两个连续 Main Window Session、Login Item 四态、
  Development no-call、read-after-write、窗口多屏几何与 fullscreen no-op、启动目标验证、Member fallback、
  General 页面语义及七项设置顺序；
- 静态负向扫描确认新 Shell IPC 未进入 `CoreMethod`，Main/Renderer Shell 模块不调用 Core 偏好写入，
  登录项代码只使用 `mainAppService`，且不存在 `openAsHidden`、`agentService`、`daemonService` 或本地
  登录项 Boolean 真源。

### macOS 主窗口会话验收

环境为 macOS 26.3（25D125），使用独立 userData 启动上述打包 App，已验证：

- 设置侧栏按“通用 / Skill / MCP / Agent 运行时 / 外观 / 通知 / 诊断”显示，重新进入设置保持最后分类；
- “重置窗口大小与位置”写入 `1440×920`，并在当前显示器居中；全屏时按钮禁用且显示先退出全屏的提示；
- 切换到“快速对话”后，关闭最后窗口但保留 Electron 进程，再次创建主窗口会进入 Quick Chat；
- 切回“上次使用的位置”后，记忆页可跨主窗口会话恢复；在设置页关闭窗口仍恢复设置前的记忆页；
- 队员页可跨主窗口会话恢复到“咕咕”及“运行配置”页签；
- 直接从 `dist/` 运行以及临时复制到 `/Applications` 的 ad-hoc bundle 均被 macOS 返回为 `not-found`，
  General 页正确禁用开关并显示重新安装或修复提示；它不能替代 Developer ID 签名、notarized 安装包
  的开启、关闭和 `requires-approval` 最终登录项验收。

仍未完成的 Checkpoint 8 项保持未勾选；在真实安装 App、登录项系统状态、外接显示器及完整负向矩阵
均留存证据前，不把本版本标记为 complete。
