---
document_type: protocol-contract
contract: windows-window-close-v1
authority: windows-main-window-close-and-tray
status: accepted
version: 1
source_version: v1.72
last_updated: 2026-10-02
---

# Windows Window Close v1

仅 Windows Desktop 主窗口拥有 `windowClose` capability。macOS/Web 不展示设置、弹窗或 Tray，macOS 现有 close-only
Draft fence 保持不变。普通最小化不触发该能力。用户明确退出及更新安装/重启继续 [Planned Shutdown v8](planned-shutdown-v8.md)。

## 本机偏好

Main 在 Electron 私有 userData 下保存 `window-close.json`：`{ schemaVersion: 1, behavior: 'ask' | 'tray' | 'exit' }`。
缺失默认为 `ask`；无效/不可读文件保留原件，使用内存 `ask` 并投影 `load_failed`。写入通过同目录私有临时文件原子替换，
完成后才变更有效值；失败保留旧值。无同步、Core command、Host/Web preference 或跨机器传播。

## Desktop bridge

- `get()` 返回 `{ revision, behavior, promptId, busy, error }`。revision 在 Main owner 内单调增加；Renderer 不以旧读取覆盖新事件。
- `setBehavior(behavior)` 立即提交未来关窗行为并返回最新 snapshot；不直接退出应用。只接收闭合集。
- `respond({ promptId, action, remember })`：action 是 `tray | exit | cancel`，remember 为 boolean。
  promptId 为当前 Main 签发的正整数。旧/重复回复以及 busy/quit 中回复不产生效果；格式非法拒绝。
- `onChanged(listener)` 推送同一 snapshot，取消订阅移除 listener。
- IPC 只允许当前 Windows 主窗口的主 frame；其他窗口、嵌入 frame、非 Windows 平台拒绝。
- error 为 `load_failed | tray_unavailable | save_failed | quit_failed | null`，不运输本机路径或原始异常。

## 状态与顺序

1. 原生 ×/Alt+F4 进入 Main owner。`ask` 只打开一个带身份的选择弹窗；重复关闭不叠加弹窗。取消无副作用。
2. 选择 Tray 前先创建并保有原生图标，验证句柄有效；创建失败保持窗口可见，保留原偏好并允许重试/退出。
3. remember=false 仅执行本次动作；remember=true 在动作前写入所选偏好。写入失败保留弹窗和勾选，允许取消记住后执行一次。
4. Tray 动作只 hide 同一 BrowserWindow，不销毁、不重新初始化会话、不请求 Renderer teardown 或 Core shutdown。
   单击 Tray、“打开 Rovai”和第二次启动显示并聚焦同一窗口，必要时先 restore 普通最小化。
5. 原生右键菜单仅“打开 Rovai / 退出 Rovai”。后者始终显式退出，忽略 ask/tray 偏好。
6. 设置改为 ask/exit 时先显示主窗口，保存成功后移除 Tray；保存失败保持原偏好和旧 Tray。选择 exit 本身不会退出。
7. 显式 quit/update 使未完成的 hide 和弹窗回复失效；等待已提交偏好写入后，执行既有 Renderer preparation 与 Core drain。
   preparation 失败恢复窗口可见并允许重试。最终退出清理 Tray。系统 session-end 不受选择/隐藏拦截；不新增 OS shutdown 延迟保证。

## 验证边界

Unit tests 覆盖持久化、取消/重复/迟到回复、并发保存、退出覆盖、创建失败和恢复顺序。
`pnpm test:windows-close` 使用生产 owner、preload capability、GeneralSettings 和 AppDialog；自动验收实例使用隔离
userData/Skill Library，不连接 Core 或 Runtime。非 Windows 运行只证明控制流，Windows runner 才创建原生 Tray。
真实任务继续执行、Explorer/任务栏交互、Win10/11 多屏 DPI、NVDA 与安装重启仍以平台实际验收为准。
