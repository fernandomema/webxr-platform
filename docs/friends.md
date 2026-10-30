# Friends

Friend requests, a friend list, blocking, Friends / Friends+ sessions, and friends found through a platform (Meta Quest today).

## What exists

- **Accounts**: a friendship is confirmed by both sides (a request is accepted), found by username or by a friend code (`ABCD-2345`, renewable). Blocking ends a friendship and hides the blocker. Code: `src/lib/server/services/friends.ts`, API under `src/routes/api/friends/`, tables `friendship`, `friendRequest`, `userBlock`, `externalFriendLink` and `user.friendCode` in `prisma/schema.prisma`. Run `npm run db:push` after pulling.
- **Screens**: web `Settings > Friends` and the dash's Friends tab (`packages/engine/src/xr/ui/friendsTab.ts`, `friendsTab: false` in `configureFeatures` turns it off).
- **Presence** is polling: the tab asks `GET /api/friends` every 15 s while open and shows the session a friend hosts, when its visibility lets the viewer in. There is no online/offline status and no push; that needs a user-level socket and is left for later.
- **Visibility**: `friends` is open to the host's friends, `friends-plus` also to friends of friends (`reachableHosts` in `src/lib/server/friends/friendGraph.ts`). Such sessions are listed in `/api/worlds` only to those people. To join, the player asks `POST /api/sessions/[roomCode]/ticket` for a 60-second signed pass; the signaling server (`joinAccess.ts`) refuses a join to these rooms without it. Public and private sessions need no pass.

## Platforms (adapters)

A platform's SDK only exists on the player's device, so a device **reports** and the server **verifies**:

1. The device proves who it is on the platform and lists the platform's friends: `POST /api/friends/providers/[provider]/sync` with `{ proof, friendIds }`.
2. The provider (`src/lib/server/friends/providers/`, interface in `types.ts`) checks the proof with the platform and returns the platform id. The server links it to the account (`externalFriendLink`).
3. Friend ids that belong to linked accounts come back as **suggestions**. Nobody becomes a friend from a platform's word: the person still sends a request and the other accepts.

To add Steam (an Electron app with Steamworks): write `providers/steam.ts` (verify a Steamworks auth session ticket with the Steam Web API, `parseFriendIds` for SteamIDs), add it to `providers/index.ts`, and have the app call the same sync endpoint. The tests already run the service with a second fake platform.

### Meta Quest

The Quest app is a Trusted Web Activity. The page talks to its Android side through Chrome's postMessage channel for TWAs (Chrome 115+, `androidx.browser` 1.6+): the **app starts** the conversation by posting a first message with a `MessagePort` (`requestPostMessageChannel`, origins `https://kithin.app`), then the page (`packages/engine/src/xr/platform/questBridge.ts`) sends `{ id, method }` and the app answers `{ id, result }` or `{ id, error }`:

| method | result |
|---|---|
| `getLoggedInUser` | `{ id }` the Meta user id (app-scoped) |
| `getUserProof` | `{ nonce }` the SDK's user proof, validated by the server with `user_nonce_validate` |
| `getLoggedInUserFriends` | `{ ids }` all pages of `Users.getLoggedInUserFriends` |

The server side (`providers/meta.ts`) uses `META_APP_ID` and `META_APP_SECRET`, like the payments.

**Not done, and not verifiable without a headset:** the Android side. The generated project in `meta-quest-package/` has Horizon Platform SDK 71 (`horizonplatformsdk` 1.1.0), which only knows the user id and age category; `getLoggedInUserFriends` and the user proof need a newer Horizon Platform SDK, so the Java handler cannot be written against what is installed. When it is added: declare a `PostMessageService`, open the channel from `LauncherActivity` after the navigation finishes, answer the three methods above, and add `delegate_permission/common.use_as_origin` for `app.kithin.play` to `assetlinks.json`. Also needed: the "Friends" Data Use Checkup in the Meta developer dashboard (Meta returns nothing for under-13 accounts in mixed-audience apps), and a check that the Quest browser honours the channel. Until then `questBridge.available` stays false and the "Find friends" button never shows.
