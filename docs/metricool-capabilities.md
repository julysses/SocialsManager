# Metricool capabilities (Phase 2 probe — NOT YET RUN)

To be filled in at the start of Phase 2. Record, for the owner's current plan:
- [ ] REST API available with a user token?
- [ ] Schedule Instagram posts and Stories
- [ ] Schedule Facebook posts and Stories
- [ ] Draft / "for review" state
- [ ] Analytics endpoints (per-post, daily)

If the REST API is unavailable, fall back to Metricool's draft/review state and report the limitation. Never scrape or automate a login.

## Decision (2026-10-28): the owner is on Metricool's FREE plan
No API access, so the worker cannot publish. Publishing is **hand-off**: after Approve and Schedule, the item page shows a
"Post by hand" panel (Instagram post, Facebook post, Instagram Story, Facebook Story, X post). The owner copies the approved text,
downloads the image, posts in Metricool (or natively), pastes the post URL and clicks Mark posted
(`mark_posted_handoff`, migration 0007). When every row is recorded the item becomes Live. The approval gate still applies:
only approved/scheduled items can be recorded, and approved text is locked.
Revisit direct publishing if the owner upgrades Metricool or sets up the Meta/Threads/Bluesky APIs.
