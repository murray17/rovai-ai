# Deployment documentation delivery notes

## Desktop and Server 0.4.6 unified publication

The current Desktop and Server downloads share [`v0.4.6`](https://github.com/murray17/rovai-ai/releases/tag/v0.4.6), built from the frozen main commit `4f909c82b910596d436bb5f999f7031bea67bbdd`. All 16 release assets matched their full local SHA-256 values and GitHub asset digests. Anonymous public download access was verified before promoting `scripts/server-release-tag.txt` to `v0.4.6`: small files were checked in full and large-file opening bytes were compared with the verified local artifacts. The legacy `scripts/server-channel.txt` remains `0.4.1` for the bridge path.

The [macOS](https://github.com/murray17/rovai-ai/actions/runs/37610262179), [Windows](https://github.com/murray17/rovai-ai/actions/runs/37610259209), [four-target Server](https://github.com/murray17/rovai-ai/actions/runs/37610258639), [native Windows Desktop](https://github.com/murray17/rovai-ai/actions/runs/37610259567), and [native Windows Runtime](https://github.com/murray17/rovai-ai/actions/runs/37610258732) release checks passed on that exact source commit. Ubuntu 22.04, Ubuntu 24.04, and Debian 12 checked the same Linux archive, bound to manifest SHA-256 `c86d0686f8779fa4243e7707a0e46ccf5c514281f4a5df5136d014fc4c17e681`; all three reports retain `runtimeQualification: false`.

The release-time Mac update manifest was regenerated with the repository's architecture-complete merger after refreshing the sizes and SHA-512 values of the final stapled DMGs. All four Mac ZIP/DMG entries then matched the shipped files. The ZIP entries, package binaries, shared release notes, date, and source commit were unchanged; the original CI manifest was retained with the comparison evidence.

On macOS arm64, the native updater installation engine upgraded an isolated copy of the actual published Desktop 0.4.5 App to 0.4.6. The upgraded App passed About & Updates checks for its version, complete bundled bilingual source, visible Chinese notes, release date, light and dark themes, compact layout, and 200% layout. Separate real Electron fixtures passed release-note language switching, Settings workspace, and member Runtime application checks. These checks did not modify or restart the daily App and do not claim a production network download through the update button.

An isolated Server 0.4.5 → 0.4.6 upgrade retained its existing conversation message in the authenticated Web workspace. Restoring the complete stopped backup returned to the published 0.4.5 program with that data intact. No real Runtime execution was part of these package acceptance checks.

Local JavaScript regressions, TypeScript checks, production builds, the default Rust workspace, and 111 related extended regressions passed. An additional Runtime picker integration fixture failed because its exact accessible-name selector omits an existing recommendation suffix; the same unmodified fixture failed against both v0.4.5 and the frozen v0.4.6 source. It was not reported as passing, and no production code or test was changed to hide the failure.

Website version labels, downloads, and installer examples use 0.4.6. Historical captures and publication records below retain their actual versions and provenance.

## Desktop and Server 0.4.5 unified publication

The previous Desktop and Server downloads share [`v0.4.5`](https://github.com/murray17/rovai-ai/releases/tag/v0.4.5), built from the frozen main commit `5421fed778fcdd62f3b2c0e7f517a6e3e2b86c51`. All 16 release assets matched their full local SHA-256 values and GitHub asset digests. Anonymous public download access was verified before promoting `scripts/server-release-tag.txt` to `v0.4.5`: small files were checked in full and large-file opening bytes were compared with the verified local artifacts. The legacy `scripts/server-channel.txt` remains `0.4.1` for the bridge path.

The [macOS](https://github.com/murray17/rovai-ai/actions/runs/37469703947), [Windows](https://github.com/murray17/rovai-ai/actions/runs/37469703364), [four-target Server](https://github.com/murray17/rovai-ai/actions/runs/37469704176), and [native Windows Desktop](https://github.com/murray17/rovai-ai/actions/runs/37469703956) release checks passed on that exact source commit. Ubuntu 22.04, Ubuntu 24.04, and Debian 12 checked the same Linux archive, bound to manifest SHA-256 `8b73bcca202117a0a1b984a3f1f78b49cf46fec3e6db9f11520493caa77d512b`; all three reports retain `runtimeQualification: false`.

On macOS arm64, the native updater installation engine upgraded an isolated copy of the actual published Desktop 0.4.4 App to 0.4.5. The upgraded App passed About & Updates checks for its version, complete bundled bilingual source, visible Chinese notes, release date, light and dark themes, compact layout, and 200% layout. A separate real Electron component fixture verified instant Chinese/English switching, version-tab preservation, historical fallback, and safe Markdown. These checks did not modify or restart the daily App and do not claim a production network download through the update button.

An isolated Server 0.4.4 → 0.4.5 upgrade retained its existing conversation message in the authenticated Web workspace. Restoring the complete stopped backup returned to the published 0.4.4 program with that data intact. No real Runtime execution was part of these package acceptance checks.

PR #632 merged during preparation and is included in this frozen source and the bilingual notes. Superseded build attempts were not published. The Host clock fixture was aligned with the existing explicit missing-Runtime outcome in a test-only PR; no production code or timeout was changed to bypass a release gate. Local JavaScript regressions were rerun after one existing supervisor test timed out: its 21-case file and the full 2,603-case suite passed without changes, and the first failure log was retained.

Website version labels, downloads, and installer examples use 0.4.5. Historical captures and publication records below retain their actual versions and provenance.

## Desktop and Server 0.4.4 unified publication

The previous Desktop and Server downloads share [`v0.4.4`](https://github.com/murray17/rovai-ai/releases/tag/v0.4.4), built from the frozen main commit `54600132e6801f5b66b6ce8b9037cfa93f18dd48`. All 16 release assets matched their full local SHA-256 values and GitHub asset digests. Anonymous public download access was also verified before promoting `scripts/server-release-tag.txt` to `v0.4.4`: small files were checked in full and large-file opening bytes were compared with the verified local artifacts. The legacy `scripts/server-channel.txt` remains `0.4.1` for the bridge path.

The [macOS](https://github.com/murray17/rovai-ai/actions/runs/37266074319), [Windows](https://github.com/murray17/rovai-ai/actions/runs/37266074485), [four-target Server](https://github.com/murray17/rovai-ai/actions/runs/37266074355), and [native Windows Desktop](https://github.com/murray17/rovai-ai/actions/runs/37266088702) release checks passed on that exact source commit. Ubuntu 22.04, Ubuntu 24.04, and Debian 12 checked the same Linux archive, bound to manifest SHA-256 `089a69199889fc0df867d6a3d44136061d1a656a13e20f72e84bd756feb20be2`; all three reports retain `runtimeQualification: false`. The first Debian VM attempt lost its SSH connection before application acceptance. Rerunning only failed jobs passed without changing or rebuilding the package.

On macOS arm64, the native updater installation engine upgraded an isolated copy of the actual published Desktop 0.4.3 App to 0.4.4. The upgraded App passed About & Updates checks for its version, complete bundled bilingual source, visible Chinese notes, release date, light and dark themes, compact layout, and 200% layout. A separate real Electron component fixture verified instant Chinese/English switching, version-tab preservation, historical fallback, and safe Markdown. These checks did not modify or restart the daily App and do not claim a production network download through the update button.

An isolated Server 0.4.3 → 0.4.4 upgrade retained its existing conversation message in the authenticated Web workspace. Restoring the complete stopped backup returned to the published 0.4.3 program with that data intact. No real Runtime execution was part of these package acceptance checks.

Website version labels, downloads, and installer examples use 0.4.4. Historical captures and publication records below retain their actual versions and provenance; the later main update to the README WeChat QR image does not change the frozen package source.

## Desktop and Server 0.4.3 unified publication

The previous Desktop and Server downloads share [`v0.4.3`](https://github.com/murray17/rovai-ai/releases/tag/v0.4.3), built from the frozen main commit `085684b5c1f273cfec49f577e0871a3bb32c0a4b`. All 16 release assets were verified against their local SHA-256 values and GitHub digests, and anonymous public downloads were checked before promoting `scripts/server-release-tag.txt` to `v0.4.3`. The legacy `scripts/server-channel.txt` remains `0.4.1` for the bridge path. PR #626 merged after the build source was frozen and is not included in these packages.

The [macOS](https://github.com/murray17/rovai-ai/actions/runs/37110546600), [Windows](https://github.com/murray17/rovai-ai/actions/runs/37110546720), [four-target Server](https://github.com/murray17/rovai-ai/actions/runs/37110546639), and [native Windows Desktop](https://github.com/murray17/rovai-ai/actions/runs/37110546882) release checks passed on that exact source commit. Ubuntu 22.04, Debian 12, and Ubuntu 24.04 passed the same Linux package checks, bound to manifest SHA-256 `2432bc2be18947f4bea40cb32dbd220cff2516b5bbaebc0d25d111b9c0d75f45`; their `runtimeQualification` field remains `false`. The first Debian VM attempt lost its SSH connection before application acceptance; rerunning only failed jobs passed without rebuilding or changing the package.

On macOS arm64, the native updater installation engine upgraded an isolated copy of the actual published Desktop 0.4.2 App to 0.4.3. The upgraded App's About & Updates checks passed in light, dark, compact, and 200% layouts, including the packaged English notes and release date. This did not modify or restart the daily App and does not claim an end-to-end production network download through the update button. An isolated Server 0.4.2 → 0.4.3 upgrade retained its existing conversation message in the authenticated Web workspace; restoring the complete stopped backup returned to 0.4.2 with its data intact. No real Runtime execution was part of these package acceptance checks.

Website version labels, downloads, and installer examples now use 0.4.3. Historical captures and publication records below retain their actual versions and provenance.

## Desktop and Server 0.4.2 unified publication

The previous Desktop and Server downloads share [`v0.4.2`](https://github.com/murray17/rovai-ai/releases/tag/v0.4.2), built from main commit `37877cbd41e47a43c328cbb7021a20c3a5ec8b58`. All 16 release assets were verified against their local SHA-256 values and GitHub digests, and anonymous public downloads were checked before promoting `scripts/server-release-tag.txt` to `v0.4.2`. The legacy `scripts/server-channel.txt` remains `0.4.1` for the bridge path.

The [macOS](https://github.com/murray17/rovai-ai/actions/runs/36716614690), [Windows](https://github.com/murray17/rovai-ai/actions/runs/36716615437), and [four-target Server](https://github.com/murray17/rovai-ai/actions/runs/36716615398) release runs passed on that exact source commit. Ubuntu 22.04, Debian 12, and Ubuntu 24.04 passed the same Linux package checks, bound to manifest SHA-256 `49c4c85d26a647777bd67c34bfae11810b52c521a8f0f13541e1a3d27f61aa00`; their `runtimeQualification` field remains `false`.

On macOS arm64, the native updater installation engine upgraded an isolated copy of the actual published Desktop 0.4.1 App to 0.4.2. The upgraded App's About & Updates acceptance checks passed in light, dark, and compact layouts. This did not modify or restart the daily App and does not claim an end-to-end production network download through the update button. Website version labels, downloads, and installer examples now use 0.4.2; the original captures below retain their actual 0.4.0/0.4.1 provenance.

## Server 0.4.1 bridge publication

The bridge Server download was `server-v0.4.1`, built from main commit `446633fcb15303e28fbceaa3bcb76d28be19b2ba`. Desktop `v0.4.1` retains its original source commit and update assets. The two tags share a version number but have different source SHAs; the bridge does not replace the Desktop release.

This release adds the bundled Skills to each native archive and resolves Web UI resources through the installed command link. An isolated macOS arm64 package test read all five bundled toolbox Skills from an installed archive. An upgrade test used the actual published 0.4.0 macOS arm64 archive, retained an existing camp message in the 0.4.1 Web workspace, and restored the stopped 0.4.0 backup successfully. These checks exercise the package and data boundary; they do not claim a real model request from the final published archive or qualify every Agent.

[The native release run](https://github.com/murray17/rovai-ai/actions/runs/36537915148) passed on macOS arm64/x64, Windows x64 and Linux x64. Ubuntu 22.04 (glibc 2.35), Debian 12 (glibc 2.36) and Ubuntu 24.04 (glibc 2.39) then installed and exercised the **same** Linux archive, including packaged Skill reading, authenticated Web operations, restart and persisted data. All three reports bind the same Linux package manifest SHA-256, `8ea11585f0355e87a4d003a3aa2c9851edd304b9b2b3e0cf3f3126f63c69f45c`; their `runtimeQualification` field is `false`.

The capture record below describes the original 0.4.0 documentation pass. Its failure screenshot remains historical evidence and is not presented as a 0.4.1 result.

## Original 0.4.0 capture: scope and source versions

- Documentation and website assets only; no App, Server, network implementation, domain, DNS, or release workflow changes.
- Desktop: public `v0.4.1`, source `ab6f67fb76c41f1758b04cc728eeb95fb6a17227`.
- Server: public `server-v0.4.0`, source `f4b515e31caebbb37cc643f380173763d11e17d1`.
- Server channel: `scripts/server-channel.txt` = `0.4.0`, checked against actual release assets on 2026-09-29.
- GitHub marks the Server release published and non-prerelease; its body still includes old draft wording. This task did not modify release metadata or infer runtime qualification from publication.

## Pages and navigation

The existing `/docs/remote.html` and `/zh/docs/remote.html` now introduce the group. Six new topics use matching English/Chinese paths: `desktop-web`, `server-install`, `lan-access`, `tailscale`, `public-https`, and `server-maintenance`.

Homepage, downloads, installation, quick start and compatibility link to the group. Downloads distinguish Desktop 0.4.1 from Server 0.4.0. The previous repository guides now acknowledge published packages and route ordinary installation to the website.

## Actual capture process

All work used fresh isolated data, Skill Library and MCP configuration directories. No daily Desktop data, credentials or user projects were copied or modified. Orbit was copied from the existing public tutorial fixture into a separate temporary project.

### Server

- Downloaded the release installer, SHA256SUMS and macOS arm64 archive.
- Ran the released installer with isolated `--prefix`, `--bin-dir`, `--from-dir` and `--no-modify-path`. Its checksum/manifest verification completed.
- Started the actual released executable, logged in through its browser form, configured Codex CLI 0.157.1 with read-only filesystem access, selected the host Orbit project and created `Orbit · Remote review`.
- Sent a real read-only inspection request. It failed **before Agent launch**, with `bundled Skill resources are unavailable`. The screenshot preserves that failure.
- The release has a Chinese Web UI; English documentation reuses the actual Chinese capture and says so. It does not translate or fabricate screenshot text.

### Desktop Web

- Downloaded the public macOS arm64 0.4.1 DMG and launched the App from a separate copied bundle with explicit isolated user data, Skill Library and MCP configuration.
- Enabled its Web service on **18766**, because the normal **8766** belonged to an existing instance. That existing process was left alone.
- Captured Chinese and English native Remote connection settings. Only the toggle, port and loopback address are included in the public crops; private interface addresses and credentials are excluded. Screenshot pixels were not rewritten.
- Logged in through the Desktop-hosted browser form, selected the same separate Orbit project, created `Orbit · Browser follow-up`, and sent a real read-only check.
- Codex CLI read the page and confirmed the actual Apple Silicon, Intel and Windows x64 fixture files. The request specifically prohibited edits, commits and network tools. The response contains both Chinese and English results; member identities were not rewritten for language variants.
- A real follow-up asked for a short bilingual summary of that completed inspection. Phone-width captures show the resulting six-line answer; the native Desktop received the same conversation update. No screenshot output or execution state was edited.
- Phone screenshots are **responsive browser viewport captures on the same Mac**, not evidence of a physical phone or cross-network connection.

## Release limitations found during this work

1. **macOS Server command-link startup:** the installed `.local/bin`-style symlink could report `Matching WebUI is missing`. Running the executable within the installer’s `current` program directory reached Ready and login. The guide gives that release-specific launch path.
2. **Missing bundled Skill resources:** the macOS arm64 Server 0.4.0 archive lacks the resources required for a real Agent execution. The guide, overview/download context and troubleshooting report the limitation. No resource injection, source build, fake response, or implementation fix was used to make the published package appear successful.
3. **Desktop external origin:** Desktop 0.4.1 offers port and Web toggle, with no public-origin field in the settings. The Serve HTTPS and Caddy recipes therefore target independent Server; Desktop’s Tailscale route uses the host interface IP. No undocumented Console/IPC workaround is presented as a normal user flow.

## Diagrams and examples

Five bilingual diagram pairs retain SVG and Mermaid sources: deployment choice, deployment forms, trusted LAN, Tailscale Serve, and public HTTPS. They extend the existing neutral diagram style and the existing repository’s network relationships.

Copyable website commands and editable examples include one Caddyfile, one Linux systemd unit and one macOS LaunchAgent. All use placeholder accounts/domains/paths. The examples were **not installed as live system services**. No public service or DNS record was created for these tutorials.

## Validation boundaries

- macOS arm64 published packages were used for local installation/login/real execution observations.
- Linux and Windows package names and dependencies were checked against release/build contracts; this documentation pass is not execution acceptance on those systems.
- LAN firewall, Tailscale Serve and Caddy are configuration tutorials checked against implementation and official documentation, not claimed end-to-end network deployments.
- No cross-host data migration, multi-owner access model, automatic cloud availability or automatic resumption after host shutdown is promised.

### Stop/restart check

Server exited normally on Ctrl-C. It was restarted with the original data directory on another loopback port to verify a fresh-origin login. The original management Token remained valid, and the Orbit project, teammate configuration and failed-run record remained present. This confirms local retention and authentication; it does not fix the blocked Agent execution.

## Website checks

- `npm run check --prefix website`: 78 pages built; local links, assets, anchors, separate release downloads and corresponding deployment-language routes pass.
- Fixed preformatted line-break preservation in the website generator. Built-page checks now cover the two installer commands and shell continuation; the browser copy action reports success and the rendered command retains its newlines.
- Checked Chinese and English installation pages and the separate Server download area at desktop and phone widths. The document grid now allows tables and code to scroll within the article without widening the phone page.
- `pnpm docs:test`, `pnpm docs:check`, and diff-aware `pnpm docs:check:ci` pass against the task base. The LaunchAgent example passes `plutil -lint`.
- The repository-required `pnpm test:rust:pr` was run: Core reported 392 passed, 1 failed, 1 ignored and stopped the workspace run. The unchanged `database_admission::tests::read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` failed its assumption that a fresh fixture had no macOS provenance attribute (line 1751). A focused rerun passed. Rust sources/manifests/lockfile match the task base; no test was changed or disabled, and the full workspace result is not reported as passing.
- All isolated capture processes were stopped after their runs completed. The existing Desktop/host instance was left running.
