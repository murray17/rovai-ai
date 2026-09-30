# Rovai AI v0.4.2

This release adds native Claude Code permission approvals, improves the English interface and onboarding, and brings Desktop and Server into one release.

### What's changed

- [Feature] **Handle Claude Code permission requests in your conversation.** Approve an operation once, decline it, or remember a rule when Claude Code offers that option.
- [Interaction] **Keep compatible settings when switching models.** Reasoning effort and other supported options carry over between models within the same agent. Background model-list refreshes no longer clear settings you are editing.
- [Interface] **Fill gaps in the English interface.** Execution steps, tool statuses, file previews, context compaction, Mission statuses, and approval prompts follow the selected language. Agent replies and tool output retain their original text.
- [Fix] **Save English starter profiles correctly during onboarding.** Initial members receive their English names and identity descriptions, and the first conversation appears as "First Chat." Edited or configured profiles are preserved.
- [Improvement] **Simplify agent guidance and bundled Skills.** Collaboration instructions now use concise English, with duplicate and outdated rules removed. Reply language continues to follow the user's request.
- [Fix] **Restore missing release dates in the Mac update page.** The date of an available update now appears correctly after checking for updates.
- [Interface] **Correct conversation-header icons and counts.** Restore the team-entry icon and align the execution, task, and team counts.
- [Documentation] **Add bilingual website and Server guides.** New instructions cover installation, deployment, and remote access.
- [Release] **Desktop and Server now share one versioned release.** Both are built from the same source commit. Desktop installers and Server packages for all four targets are available together under `v0.4.2`.

### Upgrading

Mac users on v0.4.1 can update in the app. Users on v0.4.0 or earlier still need to download the DMG and replace the installed app once. Keep your existing user data.

Server users on v0.4.1 can update through "About & Updates" in the web interface. For earlier versions, back up your data, stop Server, and run the updated official installer while keeping the same data directory.

Windows x64 remains an unsigned preview. SmartScreen may show "Unknown publisher" during installation; download installers only from this official GitHub Release.
