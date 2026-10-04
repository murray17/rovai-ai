---
document_type: interface-contract
contract: interface-language
version: 1
status: accepted
authority: interface-language-preference-and-presentation
source_version: v1.71
last_updated: 2026-09-30
---

# Interface Language v1

`GeneralPreferencesSnapshot` schema 5 adds `interfaceLanguage: 'zh-CN' | 'en'` to the exact schema 4 field set. A new profile and valid schema 1–4 preferences resolve to `zh-CN`; migration retains every other recognized preference. An invalid language or unexpected schema 5 field follows the existing invalid-preference degradation path and preserves the original file. Electron Main owns the serialized private write; Desktop Preload and the Web presentation adapter expose the same typed `get` and `setInterfaceLanguage` API. Web stores only its local presentation preference.

Selecting a language updates App-owned copy immediately and persists the choice through that API. Earlier save responses cannot replace a newer selection. If the latest save fails, the display returns to the most recently saved language and shows a local error. The language change does not reload or remount the App, change navigation, save a draft, or cancel a task or Run. The document language follows the displayed choice.

Desktop Main exposes a local-only language read through `DesktopSessionApi` after the persisted preference store loads. The Renderer root restores this preference independently of Core availability, so Startup and blocked/crashed Bootstrap surfaces use the saved language even when the business workspace never mounts. The ordinary General Preferences `get` continues to merge Core-owned new-conversation choices and is not used for Bootstrap restoration.

The catalog contains only App-owned navigation, controls, explanatory copy, status and error shells, and accessible names. User-written text, saved member profiles, draft content, messages, memories, Runtime output, paths, commands, model names and IDs retain their original bytes. The four built-in member candidates use language-specific initial text. During configured English onboarding, all four Core factory profiles receive the English preset identity if they remain unconfigured and unedited; only the selected member receives Runtime configuration and joins the first Camp. Edited, configured or removed profiles are preserved. After onboarding, identity fields are ordinary member data and are never rewritten by a language change. The durable first-run Camp title follows the existing [First-run Onboarding v5](first-run-onboarding-v5.md) contract.

Shared AgentRun presentation retains its existing Chinese copy for non-Renderer callers. Camp execution status labels and recovery/approval instructions enter the interface catalog only at the Renderer display boundary; this does not translate Agent output or Feishu cards.

Desktop may localize the App-owned first-run Camp default title at the display boundary, using the completed onboarding snapshot's `quickChatCampId` as provenance. Only that Camp while its saved title remains `初次集结` displays `First Chat` in English. The saved title and command payloads retain their original bytes; renamed Camps and other Camps with the same text remain user data. Navigation search accepts both the display title and the saved title.

## References

- [First-run presentation](../ui/components/first-run-onboarding.md)
- [App Shell and General Settings](../ui/components/app-shell-navigation.md)
- [First-run Onboarding v5](first-run-onboarding-v5.md)
