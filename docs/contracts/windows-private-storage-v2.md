---
document_type: contract
contract: windows-private-storage-v2
status: accepted
source_version: v1.15
last_updated: 2026-10-29
---

# Windows Private Storage v2

Windows Private Storage v2 replaces [v1](windows-private-storage-v1.md). It preserves the v1 Desktop data-root layout,
local fixed NTFS admission, stable handle identity, protected DACL creation, non-inheritable handles and long-path blockers.
It adds the Instance Runtime Files Root as one protected Core child.

## 1. Runtime Files Root

Windows Desktop explicitly passes:

```text
--runtime-camp-files-root <data_dir>\runtime-files
```

For the default installation this is `%LOCALAPPDATA%\Rovai AI\Core\runtime-files`; explicit isolated Desktop roots use
their own `Core\runtime-files`. No attachment View is placed under user Home, roaming AppData or a shared cross-instance
directory. This exact child is the only allowed Runtime-root/data-dir containment exception and is derived data, not
Authority Attachment storage.

Core creates new directories with protected user/SYSTEM DACLs. Existing root and directly managed containers use
normalized native absolute paths, local fixed NTFS, stable opened identity, no reparse roots and non-inheritable handles.
Their ordinary effective permissions decide access; inherited/broader ACLs and lack of WRITE_DAC do not reject startup.
The marker and coordination lock do not inspect or repair existing ACLs. Final published files retain read-only hardening.
Reparse points, invalid types and identity drift remain errors. Runtime receives only the current Camp's exact `attachments` child, never `<data_dir>`,
`runtime-files`, `camps`, Authority Attachment or another Camp.

### Runtime Fleet owner records

Within an already admitted Core root, the internal `runtime-fleet/owners` ledger uses ordinary Windows directory creation
and file access. Windows decides whether the requested operation is allowed. Fleet does not require an exact ACL template,
current-user ownership or permission to change ACLs, and does not migrate or repair existing directory/file permissions.
New directories and record files inherit normal Windows permissions. Reads request only read access.

Record updates still write and flush a unique sibling before atomically replacing the destination with write-through
publication. A failed write or replacement preserves the previous record. Real filesystem failures still propagate through
the existing error paths; unavailable durable storage is not replaced by an empty or in-memory ledger. Existing Run/epoch,
process ownership, stop receipt and cleanup acknowledgment rules are unchanged.

This replaces the Fleet-only inherited-to-protected ACL migration. Other specialized private storage,
credentials, Named Pipes, Jobs and non-Windows storage behavior remain unchanged.

## 2. Platform qualification

Private storage implementation is necessary but not sufficient for Runtime access. All current `windows-x64` Adapter rows
remain `not_qualified`; each requires its own directory-authorization, read-only behavior, process lifecycle and sandbox
evidence before execution can receive a Camp View root. Windows readonly/DACL hardening is not described as strong
same-SID isolation.

## 3. Desktop Bootstrap composition

[Desktop Runtime Availability v1](desktop-runtime-availability-v1.md#8-windows-pre-ready-bootstrap-assessment) 补充独立
`LocalAppData Known Folder\\Rovai AI Bootstrap\\<instance-key>` 壳层 profile。它只容纳 Electron 本机状态与稳定实例锁，
不承载 Core authority 或 Runtime files；新建使用 creation-time protected DACL，已有对象只检查路径/类型/identity 与实际访问权限。
只有 primary 准备正式布局，失败不向该 profile 传递 Core data path。正式 v2 布局与 Runtime 平台资格不变。

## Windows Web credential exception

For Web credentials, `web-auth.json` inside an already admitted Core data directory accepts ordinary inherited file ACLs.
It does not require a protected flag, exact ACE count/principals/masks or permission to change the existing file's DACL.
Reads leave the file unchanged. New atomic siblings inherit the admitted directory and attempt DACL hardening before
writing credential bytes; failure of that optional hardening does not block real I/O. The native atomic replacement
remains the commit point. Directory admission, file identity/type and reparse checks remain mandatory.
Core/Server retain initial data-directory admission; subsequent credential I/O rechecks native directory path, volume
and stable identity without imposing the exact writable directory ACL template again on read-only Token lookup.

This exception does not relax the general private-file APIs, Named Pipe, Job or Runtime access policy, nor any non-Windows behavior. The complete lifecycle and error contract is
[Host Web v4](host-web-v4.md#windows-web-凭据可用性).

## 启动必需存储

数据库及启动必需目录不要求现有 ACL 等于 Rovai 模板。Core 实例锁、Windows 正式/Bootstrap 布局、Runtime files 根和
协调标记、Server 布局标记及日志使用专用 data-storage 调用点：只申请实际读取、写入、创建或替换所需权限，不要求
WRITE_DAC，不自动修权；继承权限、额外 ACE、非当前 owner 本身不构成拒绝理由。SQLite 主库/日志直接由 SQLite 打开。

新目录与实例锁/布局文件仍在创建时设置用户/SYSTEM 保护；旧对象保持原权限。路径类型、reparse、local NTFS、稳定对象
身份和不覆盖式发布不放宽。原子写入先写 sibling 后提交，实际失败保留旧文件。可写目录不代表任何操作一定成功，错误
按真实操作传播。跨平台统一的数据库行为见 [Desktop Runtime Availability v3](desktop-runtime-availability-v3.md#数据库启动与有界重试)。

不修改通用 `prepare_private_directory` / private-file APIs 的严格语义。凭据、MCP/Skill 等专门边界继续各自合同；
历史 Server token 读取仍核对 token 文件的私有 ACL，但不要求其父目录符合模板。Web token 继续沿用上述已有例外。

## References

- [Windows Private Storage v1](windows-private-storage-v1.md)
- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
