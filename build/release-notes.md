# Rovai AI v0.4.3

This release makes teammates easier to create and configure, improves conversation navigation and long execution records, and adds a system tray on Windows.

### What's changed

- [Feature] **Create teammates through a conversation.** The Add action opens a conversation with an available teammate and an editable starter request. Three prompts help you explore a character, a work partner, or an original companion. Nothing is sent automatically, and manual creation remains available.
- [Feature] **Apply a saved runtime configuration to other teammates.** Copy the agent, model, parameters, and permissions to selected teammates. Review replacements before applying them, preserve unsaved runtime drafts, and retry only failed items.
- [Feature] **See the model and reasoning effort beside replies.** Conversation message headers and teammate details show model information directly. Historical replies use the configuration recorded for that execution, not the teammate's current settings.
- [Feature] **Keep Rovai running in the Windows system tray.** Choose whether closing the window minimizes to the tray or quits the app, and optionally remember the choice. Tray mode preserves the window and background work; change the behavior in Settings → General → Window.
- [Interaction] **Jump back to your questions.** Wider conversation views show a compact rail of user-message anchors. Hover to preview a question and its first reply, then click or use the keyboard to return to that message.
- [Interaction] **Use context menus and unread reminders in the sidebar.** Open project and conversation actions with a right-click, keyboard shortcut, or long press. Mark conversations read or unread, copy project paths, and reveal project folders in the desktop file manager.
- [Interaction] **Reorder teammates directly.** Drag teammate rows on desktop or their avatars in the mobile layout. Keyboard reordering remains available.
- [Performance] **Load long execution records in complete content blocks.** Folded command groups count as one block and load their operations separately. Short initial views fill automatically, while paging and live updates preserve reading position, expanded results, and focus. Streaming text and older execution records remain visible through updates.
- [Interface] **Give the first execution preview a narrower starting width.** A new conversation's first automatic execution preview leaves more room for the conversation. Existing file tabs and manually chosen widths are preserved.
- [Interaction] **Clarify permission and sandbox choices.** Menus identify recommended options and include brief guidance. Permission switches use consistent sizing without changing existing selections.
- [Fix] **Keep newly created teammate cards with their creating execution.** Cards appear below that execution's last reply, align with file-change cards, and link directly to agent configuration.
- [Interaction] **Show when you stopped an execution.** A subtle "Stopped by you" marker appears after a manually interrupted execution, including one with no public reply. Activate it to inspect that exact execution.
- [Fix] **Restore navigation from execution notifications.** Clicking a notification can now locate its execution even when the target is not in the current cache, rather than failing with an incompatible-contract error.
- [Feature] **Let teammates inspect execution and queued work.** The built-in `rovai thread runs` command lists a conversation's execution states and queued messages, with filtering and pagination. Message reads also expose their recipients and structured mentions. Long-history queries now bound the returned candidate set in SQL.
- [Improvement] **Standardize built-in collaboration terminology.** Built-in commands and agent guidance use Thread and User, while preserving compatibility aliases, historical records, and frozen session recovery.
- [Documentation] **Add a collaboration demo video.** Both READMEs include a workflow demonstration, and the website homepage uses a clearer workspace overview.

### Upgrading

Mac users on v0.4.1 or later can update in the app. Users on v0.4.0 or earlier need to download the DMG and replace the installed app once. Keep your existing user data.

Server users on v0.4.1 or later can update through "About & Updates" in the web interface. For earlier versions, back up your data, stop Server, and run the updated official installer while keeping the same data directory.

Desktop and Server share this release and are built from the same source commit.

Windows x64 remains an unsigned preview. SmartScreen may show "Unknown publisher" during installation; download installers only from this official GitHub Release.
