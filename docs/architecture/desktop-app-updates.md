---
document_type: architecture
authority: desktop-application-update-component-boundary
status: accepted
last_updated: 2026-10-03
---

# Desktop App Updates

## Component authority

| Component | Responsibility |
| --- | --- |
| Release packaging pipeline | Owns version-bound Markdown notes and release-date metadata, embeds both into the Desktop Main bundle, writes notes to every platform update manifest, and rejects stale sources or mismatched notes. |
| Electron Main update service | Owns the single snapshot, installed-release version binding, check source coalescing, timers, candidate normalization, prompt generations, download/install mutexes and updater degradation. |
| `electron-updater` adapter | Reads packaged channel configuration, performs provider checks/downloads and synchronously stages the platform installer; it never decides Renderer presentation. |
| Preload bridge | Exposes the closed App Update v7 API (unchanged from v6) to the current Main Window, forwards typed snapshots and carries the private quit-preparation request; no provider object, installer path or credential crosses the bridge. |
| Renderer update controller | Hydrates with `get`, subscribes once, shares the same snapshot across Shell and About, and reports action-call failures without replacing Main facts. |
| App Shell prompt/badges | Projects Main-owned prompt generation and actionable release states without reusing Notification Episode authority. |
| About & Updates | Projects all operation/result states, explicit actions, safe release notes and the narrowly admitted fallback links. |
| Main quit coordinator | Freezes the first native quit reason, waits for already-started Renderer-local input operations, runs one controlled Core drain and completes an updater-accepted or ordinary exit. |

## Release metadata flow

```text
build/release-notes.md
  -> Desktop Main bundle -> version check against running App -> currentRelease
  -> electron-builder releaseInfo.releaseNotesFile
     -> latest.yml / latest-mac.yml releaseNotes
     -> electron-updater UpdateInfo.releaseNotes
     -> Main bounded candidate normalization -> availableRelease
  -> Renderer interface-language selection -> exact-title display cleanup -> SafeMarkdown

build/release-metadata.json
  -> Desktop Main and Desktop-hosted Web bundles
  -> version and date validation against running App -> currentRelease.releaseDate
```

[`build/release-notes.md`](../../build/release-notes.md) is the only repository-owned release-note source. Its first
non-empty heading binds it to the exact package version. macOS arm64, macOS x64 and Windows builds all consume those same
bytes; release verification compares the parsed manifest value with the source and fails on absence, empty content,
version drift or any byte difference. The macOS merge additionally rejects architecture manifests whose stable release
metadata differs.

The running Desktop also projects the build-time source as `currentRelease`. Main keeps its exact content only when the
source heading matches the running App version, the body is non-empty and the size bound holds; otherwise it publishes
an installed release with null notes. This keeps current-version notes available after an install or offline. The
`releaseInfo.releaseNotesFile` setting alone writes manifests and does not guarantee that the source is in the App, so
the Main import explicitly places it in the bundle.

The version-bound metadata holds the installed release date independently of the notes. Main uses it only when its
version matches the running App and its UTC timestamp is canonical. The build gate rejects stale metadata when the
package version changes; the publisher checks its date against the official GitHub Release before distribution. An
invalid or missing bundled date remains an explicit unknown, never a build or update-check timestamp.

The GitHub provider may still use the Releases Atom feed to discover a tag. Manifest `releaseNotes` takes precedence over
the provider's Atom-content fallback, so Rovai does not add a second GitHub REST request or a Renderer network path for
release notes. Provider output remains remote untrusted input after publication; Main and Renderer keep their existing
normalization and safe-rendering boundaries.

The provider's YAML parser may return an unquoted `releaseDate` timestamp as a JavaScript `Date`. Main accepts both
valid date objects and date strings, normalizes them to UTC ISO strings, and keeps invalid values null before crossing
the bridge. The macOS manifest merge emits YAML 1.1-compatible strings so older clients also retain the date; its
regression test parses the merged YAML with the actual `electron-updater` provider parser.

About displays the installed release when no candidate exists. With a candidate, it defaults to the candidate and
offers a local version switch; neither switch performs a request or changes updater actions. A missing candidate note
stays an empty state. A matching first Markdown H1 is removed only from the displayed copy to avoid repeating the
release header; the source and update manifest remain intact.

## 多语言发布与展示

[App Update v7](../contracts/app-update-v7.md)拥有双语发布、精确分段、空段准入、回退和文档级定义规则；
[Interface Language v1](../contracts/interface-language-v1.md)继续拥有未改变的界面语言偏好 API。
发布源保留公共版本首标题，通过顶层独立 `<!-- lang:en -->` 与 `<!-- lang:zh-CN -->` 注释提供正文。
发布检查与 Server draft 组装共用 Renderer 的 CommonMark/GFM 解析和非空判断；新发布要求双语，
读取历史或单语说明则不增加此要求。

GitHub Release、Desktop 更新清单和内嵌日志使用完整原文。Server draft 直接复制同一源为
`RELEASE-NOTES.md`；draft job 安装锁定依赖以使用相同解析规则。Main 保留版本绑定和既有候选归一化，
Preload 仅运输快照；这两层不按语言过滤，不引入第二份翻译或额外 GitHub 请求。

Desktop、Desktop 托管 Web 与独立 Server 共用的正文组件订阅 `useInterfaceLanguage()`，
只在展示副本选择语言，再做首 H1 去重与 `SafeMarkdown` 渲染。无标记、全空、重复、歧义或解析失败时
保留全文；隐藏节点及递归空容器不阻挡回退。定义按原文顺序 first-wins，完整脚注和链接依赖进入显示副本，
只有定义节点可序列化，公共前言与正文使用原文切片。语言变化不请求、不重置当前/新版本 tab、不改快照或
更新资格；缺少翻译不自动翻译。精确规则只在 v7 合同维护。

## Check and prompt flow

```text
first Main Window did-finish-load
  -> wait 5 seconds
  -> Main check(startup)
     -> updater unavailable/error: keep last valid release, publish check_failed, log only
     -> up to date: clear release/prompt, publish up_to_date
     -> newer valid stable release:
        -> keep bounded normalized release
        -> publish available
        -> create Main-memory {prompt id, version}
        -> Renderer shows one right-bottom prompt only when attentive and unblocked
  -> after the check settles, wait 6 hours and run check(interval)

manual About check
  -> join an existing check or start check(manual)
  -> update the same snapshot
  -> never create a prompt by itself
```

Check source is round metadata, not an updater event property. A set of participants is accumulated while one check
Promise is in flight; automatic participation wins only for prompt generation. A new automatic round gets a new prompt
ID even for the same version. Dismissal is exact-generation compare-and-clear, so a stale Renderer cannot clear a newer
reminder.

`availableRelease` is a fact axis independent of `status`. This prevents a transient network failure from erasing the
known version, release notes, badge or direct download retry target. A successful no-update result is the sole transition
that clears the axis.

## Download and installation flow

```text
available
  -> explicit download
  -> downloading (one shared Promise, determinate progress)
     -> provider completion -> ready_to_install
     -> reject/error/cancel -> download_failed -> explicit retry download

ready_to_install
  -> explicit install and restart
  -> installing
  -> updater synchronously stages installer
     -> rejected/error -> install_failed; App/Core stay usable
     -> accepted -> native before-quit -> settle in-flight Renderer operations -> one controlled Core drain -> app.exit(0)
```

The updater event stream and command Promise can report the same failure. The Main service settles by current state, so
only the first terminal observation changes the snapshot. Download and install actions cannot infer eligibility from a
button; Main checks the current release/status again.

The install order is deliberately updater-first. On Windows the updater can launch the staged installer before calling
`app.quit`; on macOS the native updater owns replacement. Main then intercepts the resulting `before-quit`, waits only
for already-started local Composer operations, and finishes the same bounded Planned Shutdown used by ordinary quit.
This coordination does not persist or restore public Composer input. Main does not ask Core to shut down before
knowing the installer accepted the request. A local preparation failure keeps the App/Core running and allows a later
quit retry.

## Renderer coordination

The update prompt is a dedicated shell projection, not a Core Notification Episode and not a dialog. Notification
heads-up, modal dialogs, Onboarding and shutdown have presentation priority. The prompt has no timer and does not focus
itself. Dismissal changes only Main's in-memory prompt generation; it does not remove the release or badge.

Settings retains two targets in one footer group: the main Settings button restores the persisted last section, while
the sibling update badge deep-links to About without persisting `about`. Both routes use the existing unsaved member
draft guard. The details route confirms the exact release section after paint, focuses its heading, scrolls it into view
and only then dismisses the matching prompt.

Release notes remain remote untrusted text even though the release pipeline originates them from a reviewed repository
file. Main bounds and normalizes them; Renderer renders with the shared SafeMarkdown boundary. The bridge never provides
a download URL or installer path, and the fallback is a fixed product-owned HTTPS destination admitted only for
updater-unavailable or download-failed states.

## Recovery and verification boundary

- Main updater import failure degrades to `updater_unavailable`; it cannot abort App startup.
- Window recreation recovers through `get()` even if a prior changed event was missed.
- Timer disposal and idempotent quit coordination prevent post-quit checks and duplicate Core shutdown.
- Unit tests own source coalescing, prompt generations, retained release, action mutexes, event/reject settlement and
  synchronous install failure.
- Repository tests bind the release-note heading to `package.json.version`; macOS and Windows release verifiers own exact
  source-to-manifest equality, while the macOS merge owns cross-architecture release-metadata equality.
- Renderer tests own the state/action/fallback matrix and safe Markdown; packaged UI acceptance owns Day/Night, compact,
  reduced-motion, focus and overflow. Signed cross-version release qualification remains platform-specific.

## References

- [App Update v7](../contracts/app-update-v7.md)
- [Planned Shutdown](planned-shutdown.md)
- [App Shell navigation](../ui/components/app-shell-navigation.md)
- [macOS packaging](../development/packaging.md)
- [Windows packaging](../development/packaging-windows.md)
