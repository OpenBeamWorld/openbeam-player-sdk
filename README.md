# OpenBeam Player SDK

Put the [OpenBeam Cloud](https://cloud.openbeam.world) player in your own web
app: start a session from your server, mount the player in your page, and
follow what it is doing.

- **Server side** (`OpenBeamClient`): sign a user in, start, list and end
  sessions. Runs anywhere with `fetch`: Node 18+, Deno, Bun, Workers.
- **Browser side** (`OpenBeamPlayer`): mounts the player in an iframe and
  reports its state (`connecting`, `playing`, `ended`, ...). 4 kB, no
  dependencies, works with any framework.

No dependencies, TypeScript types included, Apache-2.0.

## Download

| File | Use |
| --- | --- |
| [`openbeam-player-sdk-0.1.0.tgz`](https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player-sdk-0.1.0.tgz) | The npm package (server and browser modules, types) |
| [`openbeam-player.min.js`](https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player.min.js) | The browser player alone, for a `<script>` tag (global `OpenBeam`) |
| [`openbeam-player-sdk-0.1.0-examples.zip`](https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player-sdk-0.1.0-examples.zip) | The quickstart app below |

Install the package straight from the release:

```sh
npm install https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player-sdk-0.1.0.tgz
```

## How it fits together

```
your page ──"start"──▶ your server ──POST /v1/sessions (user token)──▶ OpenBeam Cloud
    ▲                       │
    └────── playerUrl ──────┘
your page: OpenBeamPlayer.mount(element, { playerUrl })   ← video, sound and input go
                                                            straight to OpenBeam Cloud
```

Two credentials are involved, and they go to different places:

- A **user token** stands for an OpenBeam account. It stays on your server.
  OpenBeam Cloud's API does not answer browser calls from other sites, so the
  token could not be used from your page anyway.
- A **player link** (`playerUrl`) carries a credential for one session only.
  Your server gives it to the page that will show that session. Anyone who
  has the link can watch and control that session until it ends, so send it
  only to the user it is for, and do not log it.

## 1. Sign in (once per account)

The user approves a short code in OpenBeam Cloud, the way a TV app signs in.

```js
import { OpenBeamClient } from "openbeam-player-sdk"

const client = new OpenBeamClient()
const { userId, token } = await client.signInWithDevice({
    onCode: code => console.log(`Open ${code.verificationUriComplete} and approve ${code.userCode}`),
})
// Store `token` on your server, encrypted like any other account credential.
```

To drive the steps yourself (for example from a web request), use
`startDeviceSignIn()` and `pollDeviceSignIn(deviceCode)`.

## 2. Start a session (your server)

```js
import { OpenBeamClient, OpenBeamApiError } from "openbeam-player-sdk"

const client = new OpenBeamClient({ token })

try {
    const session = await client.createSession({ width: 1280, height: 720, fps: 60 })
    // Send session.playerUrl to this user's page. Keep session.sessionId to end it later.
} catch (error) {
    if (error instanceof OpenBeamApiError && error.code == "session_limit") {
        // The account already has a session: error.body.sessionId. End it, or keep using it.
    } else {
        throw error
    }
}
```

Open the player within 2 minutes of starting the session, or the session ends.

End the session when the user is done, so no play time is used for nothing:

```js
await client.endSession(session.sessionId)
```

## 3. Show the player (your page)

With a bundler:

```js
import { OpenBeamPlayer } from "openbeam-player-sdk/player"

const player = OpenBeamPlayer.mount(document.getElementById("stage"), { playerUrl })

player.on("state", ({ state, detail }) => {
    if (state == "playing") hideSpinner()
    if (state == "ended" || state == "error") showMessage(detail)
})
```

Or with a script tag:

```html
<div id="stage" style="width: 100%; aspect-ratio: 16 / 9"></div>
<script src="openbeam-player.min.js"></script>
<script>
  const player = OpenBeam.OpenBeamPlayer.mount(document.getElementById("stage"), { playerUrl })
</script>
```

The iframe fills its container; give the container a size.

### Player states

| State | Meaning |
| --- | --- |
| `loading` | The iframe has not reported yet |
| `connecting` | Connecting to the session |
| `starting` | Connected; the game is loading |
| `click-to-start` | Ready; waiting for the user's click (browsers need one for sound and mouse capture) |
| `playing` | Streaming |
| `reconnecting` | The connection dropped; the session keeps running |
| `retrying` | Moving to another machine |
| `ended` | Over. `detail` says why |
| `error` | Could not connect. `detail` says why |

### Player API

| Member | |
| --- | --- |
| `OpenBeamPlayer.mount(container, options)` | Options: `playerUrl` (required), `showcase`, `keyboardLock` (default `true`), `title`, `className`, `playerOrigin` |
| `player.state`, `player.detail` | The last reported state and its text |
| `player.on("state" \| "relaunch" \| "latency", handler)` | Subscribes; returns a function that unsubscribes |
| `player.whenState(state, timeoutMs?)` | Resolves at that state; rejects if the session ends or fails first |
| `player.focus()` | Sends keyboard input to the player |
| `player.requestFullscreen()` | Call from a click handler |
| `player.destroy()` | Removes the iframe. It does **not** end the session |
| `player.iframe` | The element, for styling |

## Client API

| Method | |
| --- | --- |
| `new OpenBeamClient({ token, baseUrl, fetch })` | All optional; sign-in needs no token |
| `signInWithDevice({ onCode, signal })` | Whole sign-in; resolves to `{ userId, token }` |
| `startDeviceSignIn()`, `pollDeviceSignIn(deviceCode)` | The same in two steps |
| `createSession(options)` | `width`, `height`, `fps`, `bitrateKbps`, `codecs`, `mouse`, `showcase`, `contentIds`, `app`, `kind`. Resolves to `{ sessionId, playerUrl, descriptor, expiresAt, ... }` |
| `listSessions()`, `getSession(id)` | The account's sessions and their state |
| `endSession(id)` | Ends it; already ended is not an error |
| `me()`, `playTime()`, `listSimulators()` | The account, its remaining time, what it may launch |
| `listShowcases()` | Ready-made scenes; pass an `id` as `showcase` to both `createSession` and `mount` |
| `withToken(token)` | The same client for another account |

Failures throw `OpenBeamApiError` with `status`, `code` and `body`. Common codes:

| Code | Status | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | The token is missing, wrong or revoked |
| `session_limit` | 409 | The account already has a session (`body.sessionId`) |
| `trial_exhausted`, `free_tier_exhausted` | 403 | No play time left on the account's plan (`body.message` says when more arrives) |
| `play_time_in_use` | 403 | The account's remaining time is in use by its running session |
| `invite_exhausted` | 403 | The account's invite has no sessions left |
| `not_entitled` | 403 | The account has no access to OpenBeam Cloud |
| `no_capacity` | 503 | No GPU is free; another server is starting. Try again after `body.retryAfterSeconds` |
| `rate_limited` | 429 | Too many requests |

## Quickstart app

A complete example with a sign-in script, a 60-line server and a page:

```sh
npm install && npm run build
node examples/quickstart/signin.mjs     # approve the code it prints
node examples/quickstart/server.mjs     # then open http://localhost:5173
```

Starting a session uses the signed-in account's play time. Press **End
session** when you are done.

## What to know before you build on it

- **Sessions run on the signed-in OpenBeam account.** Each session uses that
  account's play time and counts against its limit of one session at a time
  ([limits](https://openbeam.world/session-and-usage-limits/)). To give each
  of your users their own session, each signs in with their own OpenBeam
  account (step 1).
- **Browser support** is the player's: WebTransport and WebCodecs, on an https
  page (or `localhost`). See
  [browser and network requirements](https://openbeam.world/browser-and-network-requirements/).
- **Content-Security-Policy.** If your site sets one, allow the player:
  `frame-src https://cloud.openbeam.world`.
- **Fullscreen and key capture.** The iframe is created with the permissions
  the player needs (`autoplay; fullscreen; gamepad; pointer-lock;
  keyboard-lock; ...`). Capturing keys such as Escape only works in fullscreen.
- The player shows its own toolbar and messages inside the iframe.

## Development

```sh
npm install
npm test          # unit tests (Node 22.6+)
npm run typecheck
npm run build     # dist/
```
