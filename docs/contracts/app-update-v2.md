---
document_type: interface-contract
contract: app-update-v2
version: 2
status: accepted
authority: desktop-app-update-state-actions-and-prepared-controlled-exit
last_updated: 2026-09-05
---

# App Update v2 Contract

v2 inherits [v1](app-update-v1.md)'s snapshot and API wire, release normalization, checks, prompt generations, explicit
download/install actions, updater-first staging and platform release verification. It only refines the accepted install
quit sequence.

After `quitAndInstall` has synchronously accepted the installer handoff, native quit enters the same
`AppQuitCoordinator` as ordinary exit. The coordinator must first complete the active Composer Draft preparation from
[Camp Composer Draft v11](camp-composer-draft-v11.md); only then may it dispose update timers and invoke
[Planned Shutdown v6](planned-shutdown-v6.md).

If Composer preparation fails, the installer handoff is not reclassified or claimed to have rolled back, but Rovai
does not start service drain, Core shutdown or `app.exit`. The current Camp and Lexical content remain available with
the existing Draft save failure, and a later native quit retries preparation. Installer staging must still precede this
fence: Rovai cannot shut down Core merely to discover that the platform updater rejected installation synchronously.

## References

- [App Update v1 (historical)](app-update-v1.md)
- [Desktop App Updates architecture](../architecture/desktop-app-updates.md)
- [Camp Composer Draft v11](camp-composer-draft-v11.md)
- [Planned Shutdown v6](planned-shutdown-v6.md)
