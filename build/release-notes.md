# Rovai AI v0.5.8

<!-- lang:zh-CN -->

本次更新补齐 CodeBuddy 的推理强度设置，修复 Windows 下部分智能体升级后信息未更新、DeepSeek Harness 加载 MCP 时无法启动的问题，并调整本机 Skills 的异常提示。

感谢 @caoshuisi 在 Issue #997 中反馈智能体升级识别和 CodeBuddy 推理强度问题，以及 @arschlochnop 在 Issue #1007 中反馈 DeepSeek Harness 启动问题。

- 【功能】**CodeBuddy 支持选择推理强度。** 在队员设置中，可根据所选模型提供的档位进行配置，队员摘要和消息中的强度显示同步更新。
- 【修复】**修复 Windows 下部分智能体升级后仍沿用旧信息的问题。** 通过标准 npm、pnpm 入口安装的智能体，重新检测时可以正确识别程序包变化，避免因启动脚本未变而继续使用旧的模型与能力信息。
- 【修复】**修复 DeepSeek Harness 启用原生 MCP 后无法启动的问题。** 适配新版加载接口，解决 DSH 0.2.0-rc.2 的初始化失败，同时保留对旧版接口的支持。
- 【修复】**减少本机 Skills 扫描中的无效报错。** 目标已不存在的符号链接会自动跳过，不再提示文件读取失败；权限不足、循环链接等实际读取问题仍会提示。
- 【交互】**调整 Skill 异常提示的显示位置。** 可正常使用的 Skill，其说明信息异常仅在详情中显示，减少列表和输入框选择器中的干扰；复制路径失败时，在按钮旁提示，已加载的正文仍可继续查看。

---

<!-- lang:en -->

This release adds CodeBuddy reasoning intensity controls, fixes stale information after some Agent upgrades on Windows and DeepSeek Harness startup with native MCP, and refines native Skill diagnostics.

Thanks to @caoshuisi for reporting Agent upgrade detection and CodeBuddy reasoning intensity issues in Issue #997, and @arschlochnop for reporting the DeepSeek Harness startup issue in Issue #1007.

- [Feature] **Choose CodeBuddy reasoning intensity.** Teammate settings now offer the levels provided by the selected model. Teammate summaries and messages display the same configured intensity.
- [Fix] **Detect package changes for some Agent upgrades on Windows.** When checked again, Agents installed through standard npm or pnpm command wrappers can detect package changes even if the wrapper itself is unchanged, preventing reuse of stale model and capability information.
- [Fix] **Restore DeepSeek Harness startup with native MCP enabled.** Support the newer Loader lifecycle interface to fix initialization failures in DSH 0.2.0-rc.2 while retaining support for the older interface.
- [Fix] **Avoid unnecessary native Skill scan errors.** Symbolic links whose targets no longer exist are skipped instead of being reported as file read failures. Permission errors, link loops, and other actual read failures remain visible.
- [UX] **Show Skill diagnostics where they apply.** Recovered metadata warnings for usable Skills appear only in their details, reducing notices in the list and composer picker. A failed path copy is shown beside the button without hiding the loaded document.
