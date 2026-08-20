# Notifications polish v1 (10.1 remainder)

**Status:** shipped  
**Migration:** none  
**Client schema:** 43 (unchanged)

Desktop/browser notifications as a channel next to email. The preference lives in the existing `user.notification_prefs` JSON bag — no new replica type.

## Scope

- Settings → Notifications → **Browser notifications**. Checking it asks for permission first; denied leaves the switch off.
- `desktop` on the prefs bag (absent = off). The pin test keeps Go and TypeScript in agreement.
- After the first inbox snapshot, newly unread rows fire a system notification (`notify()` on web, Electron bridge on desktop). Hydrate does not pop banners for mail that was already waiting.

## Deferred

- Slack DMs (blocked on Slack v1)
- Mobile push
- Per-type channel matrix (desktop vs email vs Slack independently)
- Product communications (changelog, DPA)
