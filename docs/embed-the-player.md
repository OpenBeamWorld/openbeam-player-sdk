<!--
  Public docs article for openbeam.world (Ghost, tag "docs").
  Title:   Embed the OpenBeam player in your app
  Slug:    embed-the-player
  Excerpt: Use the OpenBeam Player SDK to start OpenBeam Cloud sessions from your server and show the player inside your own web app.
-->

The OpenBeam Player SDK puts the OpenBeam Cloud player inside your own web app. Your server starts a session, your page shows it, and your code hears when it is playing or has ended.

## Download

| File | Use |
| --- | --- |
| [openbeam-player-sdk-0.1.0.tgz](https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player-sdk-0.1.0.tgz) | The npm package: server and browser modules, with TypeScript types |
| [openbeam-player.min.js](https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player.min.js) | The browser player alone, for a `<script>` tag |
| [openbeam-player-sdk-0.1.0-examples.zip](https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player-sdk-0.1.0-examples.zip) | A complete example app |

Install the package:

```
npm install https://github.com/OpenBeamWorld/openbeam-player-sdk/releases/download/v0.1.0/openbeam-player-sdk-0.1.0.tgz
```

The source, the full reference and the changelog are on [GitHub](https://github.com/OpenBeamWorld/openbeam-player-sdk). The SDK is open source (Apache-2.0) and has no dependencies.

## How it works

1. Your page asks **your server** to start a session.
2. Your server calls OpenBeam Cloud with an account's token and gets back a **player link**.
3. Your page hands the link to the SDK, which shows the player. Video, sound and input go straight between the browser and OpenBeam Cloud.

Two things to keep apart:

| | What it is | Where it lives |
| --- | --- | --- |
| User token | Stands for an OpenBeam account | On your server only. OpenBeam Cloud does not answer browser calls from other sites |
| Player link | Opens one session | Sent to the page that shows that session. Anyone with the link can watch and control the session, so keep it private |

## 1. Sign in

Sign in once per OpenBeam account. The SDK prints a short code, and you approve it in OpenBeam Cloud:

```js
import { OpenBeamClient } from "openbeam-player-sdk"

const client = new OpenBeamClient()
const { token } = await client.signInWithDevice({
    onCode: code => console.log(`Open ${code.verificationUriComplete} and approve ${code.userCode}`),
})
```

Store the token on your server like any other account credential.

## 2. Start a session on your server

```js
const client = new OpenBeamClient({ token })
const session = await client.createSession({ width: 1280, height: 720, fps: 60 })
// Send session.playerUrl to the user's page.
```

Open the player within 2 minutes, or the session ends. When the user is done, end the session so it stops using play time:

```js
await client.endSession(session.sessionId)
```

## 3. Show the player in your page

```html
<div id="stage" style="width: 100%; aspect-ratio: 16 / 9"></div>
<script src="openbeam-player.min.js"></script>
<script>
  const player = OpenBeam.OpenBeamPlayer.mount(document.getElementById("stage"), { playerUrl })
  player.on("state", ({ state, detail }) => console.log(state, detail))
</script>
```

With a bundler, import it instead: `import { OpenBeamPlayer } from "openbeam-player-sdk/player"`.

The player reports these states:

| State | Meaning |
| --- | --- |
| `connecting` | Connecting to the session |
| `starting` | Connected; the game is loading |
| `click-to-start` | Ready; waiting for a click (browsers need one for sound and mouse capture) |
| `playing` | Streaming |
| `reconnecting` | The connection dropped; the session keeps running |
| `retrying` | Moving to another machine |
| `ended` | Over; `detail` says why |
| `error` | Could not connect; `detail` says why |

`player.requestFullscreen()` goes fullscreen (call it from a click), and `player.destroy()` removes the player. Removing the player does not end the session: end it from your server.

## Try the example

```
npm install && npm run build
node examples/quickstart/signin.mjs
node examples/quickstart/server.mjs
```

Approve the code the first command prints, then open `http://localhost:5173` and choose **Start session**. This uses the signed-in account's play time; choose **End session** when you are done.

## Limits

- Sessions run on the signed-in OpenBeam account: they use its play time and follow its limits, including one session at a time. See [Session, usage and storage limits](https://openbeam.world/session-and-usage-limits/). To give each of your users their own session, each signs in with their own OpenBeam account.
- The player needs a supported browser and an `https` page (or `localhost`). See [Browser and network requirements](https://openbeam.world/browser-and-network-requirements/).
- If your site sets a Content-Security-Policy, allow the player with `frame-src https://cloud.openbeam.world`.

## When a session does not start

`createSession` fails with a code:

| Code | Meaning |
| --- | --- |
| `unauthorized` | The token is wrong or was revoked. Sign in again |
| `session_limit` | The account already has a session running. End it first |
| `trial_exhausted`, `free_tier_exhausted` | The account has no play time left. See [Plans, hours and billing](https://openbeam.world/plans-and-billing/) |
| `no_capacity` | No GPU is free and another server is starting. Try again in a few seconds |

For messages shown inside the player, see [Troubleshooting sessions](https://openbeam.world/troubleshooting/).
