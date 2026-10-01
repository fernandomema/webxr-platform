# Feedback Center

The built-in world keeps the stable `pulse` identifier and displays **Feedback Center**. Regenerate its scene with `node scripts/generate-pulse.mjs` after editing the screen builders.

Feedback is shared across all worlds and survives session shutdown. The host performs requests and broadcasts screen state to guests. Only the authenticated host can submit through these shared screens; forwarded guest events are ignored so guest feedback is never attributed to the host. Screens poll every ten seconds. Voting preserves the current row positions for two seconds after a vote.

## API

- `GET /api/feedback`: returns `{ items, counts }`. Items contain `id`, `title`, `category`, `votes`, `status`, and `detail`. Mood counts are ordered `loving`, `good`, `meh`, `needs-work`.
- `POST /api/feedback` with `{ action: "suggest", category: "idea" | "bug" | "other", title }`: creates feedback pending review with zero votes. Matching normalized titles in the same category reuse the entry without adding votes. Titles must contain 4–80 characters.
- `POST /api/feedback` with `{ action: "vote", id, delta: 1 | -1 }`: sets the authenticated user’s vote to +1 or -1. Repeating the same vote has no effect; changing direction replaces the existing vote. Unknown entries return 404.
- `POST /api/feedback` with `{ action: "mood", key }`: atomically increments the mood counter.
- `PATCH /api/feedback/:id` with `{ status: "pending" | "planned" | "progress" | "shipped" }` and `Authorization: Bearer <FEEDBACK_ADMIN_TOKEN>`: changes development status. Configure the token on the server; never put it in a world script.

All feedback endpoints require an authenticated session (401 otherwise). The server takes the user ID from the session, never from the request body. Entries retain their original author; every submission (including matching titles), vote, and mood response records its user and timestamp. Each user has one current vote per entry. Repeated mood responses remain allowed. Counts measure interactions, rather than unique people. The suggestion desk prevents duplicate sends while a request is pending and applies a two-second cooldown after success. The roadmap shows the top six reviewed non-bug entries and their team-managed statuses.

## Database setup

Use the repository's `npm run db:push` workflow, then run `npm run db:generate`. Existing anonymous feedback cannot be attributed reliably: if the earlier schema was already applied, reconcile or remove those records before adding the required author relation. This repository did not previously have a migration baseline; do not run `migrate deploy` against an existing unbaselined database.

## Script networking

```js
const data = await ctx.net.fetchJson('/api/feedback');
await ctx.net.postJson('/api/feedback', { action: 'mood', key: 'good' });
```

Both methods return parsed JSON and reject network failures, HTTP errors, invalid JSON, and requests exceeding fifteen seconds. Local routes use same-origin credentials, including local HTTP development servers. External URLs require HTTPS and omit credentials. Shared scripts should guard requests with `ctx.world.isHost()` and handle rejections.

Existing copies of the old world retain their embedded scripts. Open a fresh built-in Feedback Center to use the connected screens.

When upgrading from the earlier counter-only implementation, reconcile existing scores with `feedbackVote` records; anonymous historical increments cannot be treated as verified votes. Changing the default status does not reclassify existing roadmap entries.
