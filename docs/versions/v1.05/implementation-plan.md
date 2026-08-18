---
document_type: implementation-plan
version: v1.05
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-18
---

# v1.05 Windows x64 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0210～0214](../../adr/CURRENT.md)、[Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
及其五项当前合同。文档闭环完成前不进入产品代码；accepted ADR/Contract 只证明设计成立，不证明 Windows
实现或发布。所有开发、Smoke 与 acceptance 使用隔离 data root，不触碰日常 App。

基线固定为提交 `0e20ea154eb3110f46d3a18f695dc2217b4e801b`，不得只以浮动 `main` 解释初始盘点。

## Checkpoint 0：治理、合同与交互设计

- [x] v1.04 → v1.05 生命周期切换和九项跨版本影响完成；
- [x] ADR-0210～0214 accepted 并进入人工 CURRENT 主题；HISTORY 确定性生成；
- [x] 五项 Contract、Windows Architecture、Runtime compatibility baseline 和顶层路由完成；
- [x] 外部 Windows 技术方案移除 spawn-attach、v13、通用 cmd/bat、两态 journal 等旧结论；
- [x] Windows Interaction Delta 稳定规范与可交互 HTML 完成，并通过 Day/Night、五场景、1040×700、键盘状态与 console 视觉检查；
- [x] `pnpm docs:test`、`pnpm docs:check`、base-aware `docs:check:ci` 与 ADR generate check 通过；
- [ ] HTML mechanical detector 的 full-parser gate 通过：2026-08-18 已按要求执行一次，但本机缺少
  `htmlparser2/css-select/css-tree/domutils` 而降级为 regex；唯一非 advisory 字体问题已修复，安装 parser 后再关闭本项。

## Checkpoint 1：平台 module 与 Windows 编译门禁

- [ ] 建立 local IPC、managed process、runtime environment/executable identity、private FS 等真实双 Adapter seam；
- [ ] Unix direct imports 只保留在 Unix backend 或明确 Unix test；Windows 缺失能力显式 fail closed；
- [ ] target-specific Cargo dependency 和 `x86_64-pc-windows-msvc` 全 targets check/test 通过；
- [ ] CI compile/package 使用固定 `windows-2022` 或仓库固定 image revision，不以 `windows-latest` 冒充稳定证据；
- [ ] macOS/Ubuntu 基线测试保持。

## Checkpoint 2：Desktop、data root 与 Built-in Transport v14

- [ ] target-aware sidecar build/staging、`.exe` 解析、`windowsHide`、native frame 和所有 win32 drag region 清理；
- [ ] `%LOCALAPPDATA%` 五目录与 ready 前 `app.setPath`，隔离参数复现同构布局；
- [ ] Transport v14 LocalIpcEndpoint clean break、Unix Socket/secured Named Pipe、byte framing、listener replenish；
- [ ] Context/digest/capability/Health/Diagnostics/Bootstrap/Charter 全部切到 v14，v13 fail closed；
- [ ] macOS 十个 Product Runtime 的 v14 discovery/read/mutation/replay/fence/negative-path 回归通过。

## Checkpoint 3：Windows 原子 managed process

- [ ] 所有 Probe/Host/one-shot/Fleet 通过唯一 native launcher；
- [ ] JOB_LIST + HANDLE_LIST 创建时关联，绝对 `lpApplicationName`，无 breakaway flag；
- [ ] native EXE argv serializer 与 per-target parser 测试；validated Node shim 直接 node launch；
- [ ] immediate grandchild、normal/Core kill/Main kill、循环压力、nested Job、unrelated handle leak 通过；
- [ ] EOF 不稳定时实现 parent-process handle watcher；不把 Job cleanup 投影为 Runtime terminal。

## Checkpoint 4：Runtime search、身份与平台准入

- [ ] Windows PATH/PATHEXT/known directories 和 opened-handle file identity；不启动 PowerShell/login shell；
- [ ] resolver 只接受 qualified native EXE 或 Adapter-owned ValidatedNodeShim；无通用 cmd/bat/ps1；
- [ ] Rust Registry 投影完整 `AdapterKind × HostPlatformKey`，closed reason/evidence；TypeScript 无第二矩阵；
- [ ] not-qualified Adapter 不 discovery/check/install/select/migrate/execute，UI 显示“Windows 尚未验证”；
- [ ] 历史未准入 Runtime 配置可精确保留并允许无关 profile 编辑，但 Runtime 子对象不可修改或执行。

## Checkpoint 5：私有 FS、Attachment、MCP 与 Skill Projection

- [ ] filesystem objects 通过 SECURITY_ATTRIBUTES 私有创建，existing owner/DACL/type/reparse/identity fail closed；
- [ ] local NTFS Core/workspace admission，UNC/network/removable/non-NTFS 稳定 blocker；
- [ ] 三个 EXE longPathAware manifest、host policy 诊断、tested envelope 与 verifier；
- [ ] Attachment handle-relative traversal 和同 handle copy 拒绝 reparse race/escape；
- [ ] Skill copy multi-stage journal、bounded sharing retry、root gate、operationId DB idempotency；
- [ ] 每个 filesystem/journal/DB transition crash injection，ambiguous root 关闭准入且不覆盖 project-owned entry。

## Checkpoint 6：Windows Renderer Interaction Delta 实现

- [ ] 同一组件树按 platform projection 适配 frame、shortcut、copy 和 system theme；
- [ ] Settings/Member/Onboarding 完整呈现 qualified availability 与 not-qualified/unsupported 的正交状态；
- [ ] Explorer、盘符、local NTFS、未准入 UNC、长路径 blocker 和 focus return；
- [ ] Forced Colors/High Contrast、keyboard-only、NVDA、中文 IME composition；
- [ ] Windows 10/11、1040×700、1440×920、100/125/150/200% display scale、200% page zoom、Snap、多屏、
  Day/Night/System/reduced motion acceptance；
- [ ] HTML prototype 与生产实现差异回看，不把原型样例数据写进产品。

## Checkpoint 7：NSIS、unsigned artifact 与升级

- [ ] target-isolated resources、ICO/version resources、x64 NSIS per-user installer；
- [ ] unpacked/installer verifier 校验三个 PE、资源、manifest、hash、Core ready；
- [ ] clean-user install/start/uninstall，默认保留 data；删除 data 需显式二次确认；
- [ ] App 运行中升级先要求关闭并完成 planned shutdown；不得覆盖 locked sidecar 或并行新旧 Core；
- [ ] migration 后旧版本明确阻止 incompatible downgrade；升级失败有可审阅回滚结果。

## Checkpoint 8：逐 Adapter Windows 资格证据

三类 execution-shape infrastructure test 全部通过后，仍逐一验收十个 Adapter。每个 `qualified` 证据覆盖：

```text
discovery → executable identity → authentication → first run → continuation
→ Built-in Tool v14 → approval allow/deny → cancellation → final boundary
→ process cleanup → planned shutdown
```

- [ ] 每个提升行写入 immutable digest-bound evidence revision；
- [ ] 未完成行保持 `not_qualified`、不可选择且不产生 Availability；
- [ ] Windows 10 22H2 与 Windows 11 真实环境分别保留证据；Server CI 不代替 client OS。

## Checkpoint 9：签名与正式发布

- [ ] 分别 Authenticode-sign Electron EXE、`rovai-core.exe`、`rovai.exe` 和 installer；
- [ ] SHA-256 + RFC 3161 timestamp，release verifier 检查该发布 signer allowlist、timestamp 与完整 hash；
- [ ] SmartScreen reputation 与签名有效性分别记录；
- [ ] reproducibility 定义为 pinned source/toolchain/lockfile + manifest/verifier，不承诺 timestamped artifact bit-identical；
- [ ] Windows support matrix、安装/升级/故障排查与剩余限制发布；Root README 只在真实发布后更新。

## References

- [v1.05 版本概览](README.md)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Windows Interaction Delta](../../ui/windows-interaction-delta.md)
- [Windows packaging guide](../../development/packaging-windows.md)
