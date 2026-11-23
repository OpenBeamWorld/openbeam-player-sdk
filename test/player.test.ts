import assert from "node:assert/strict"
import { test } from "node:test"
import { buildPlayerUrl, embedUrl, OpenBeamPlayer, PLAYER_IFRAME_ALLOW } from "../src/player.ts"

const PLAYER = "https://cloud.openbeam.world/player/player.html?simulator=MuJoCo#session=abc123"

// The few DOM pieces the player touches.
function fakePage(origin = "https://app.example") {
    const listeners = new Set<(event: unknown) => void>()
    const locked: Array<string[] | undefined> = []
    const frameWindow = {}
    const iframe: Record<string, unknown> & { removed?: boolean } = {
        style: { cssText: "" },
        contentWindow: frameWindow,
        remove() { iframe.removed = true },
        focus() { },
    }
    const view = {
        location: { origin },
        navigator: { keyboard: { lock: async (keys?: string[]) => { locked.push(keys) } } },
        addEventListener: (_type: string, listener: (event: unknown) => void) => { listeners.add(listener) },
        removeEventListener: (_type: string, listener: (event: unknown) => void) => { listeners.delete(listener) },
    }
    const appended: unknown[] = []
    const container = {
        ownerDocument: { defaultView: view, createElement: () => iframe },
        appendChild: (child: unknown) => { appended.push(child) },
    }
    const post = (data: unknown, from: { origin?: string, source?: unknown } = {}) => {
        for (const listener of [...listeners]) {
            listener({ data, origin: from.origin ?? "https://cloud.openbeam.world", source: from.source ?? frameWindow })
        }
    }
    return { container: container as unknown as HTMLElement, iframe, appended, post, listeners, locked }
}

test("embedUrl adds the embedding page's origin and keeps the session fragment", () => {
    const url = new URL(embedUrl(PLAYER, "https://app.example"))
    assert.equal(url.searchParams.get("parentOrigin"), "https://app.example")
    assert.equal(url.searchParams.get("simulator"), "MuJoCo")
    assert.equal(url.hash, "#session=abc123")
})

test("embedUrl adds the showcase intent", () => {
    const url = new URL(embedUrl(PLAYER, "https://app.example", { showcase: "off-road", launchId: "x1" }))
    assert.equal(url.searchParams.get("showcase"), "off-road")
    assert.equal(url.searchParams.get("openbeamLaunch"), "x1")
})

test("embedUrl refuses links from elsewhere and links without a session", () => {
    assert.throws(() => embedUrl("https://evil.example/player/player.html#session=abc", "https://app.example"), /must be on https:\/\/cloud\.openbeam\.world/)
    assert.throws(() => embedUrl("https://cloud.openbeam.world/player/player.html", "https://app.example"), /#session/)
    assert.throws(() => embedUrl("not a url", "https://app.example"), /not a URL/)
})

test("buildPlayerUrl round-trips the descriptor through the fragment", () => {
    const descriptor = { sessionId: "ses_12345678", token: "t".repeat(32), simulator: "Isaac Sim", note: "é" }
    const url = new URL(buildPlayerUrl(descriptor))
    assert.equal(url.origin + url.pathname, "https://cloud.openbeam.world/player/player.html")
    assert.equal(url.searchParams.get("simulator"), "Isaac Sim")
    const encoded = new URLSearchParams(url.hash.slice(1)).get("session")!
    assert.match(encoded, /^[A-Za-z0-9_-]+$/)
    assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), descriptor)
})

test("mount creates a permissive, referrer-free iframe", () => {
    const page = fakePage()
    const player = OpenBeamPlayer.mount(page.container, { playerUrl: PLAYER })
    assert.equal(page.appended[0], page.iframe)
    assert.equal(page.iframe.allow, PLAYER_IFRAME_ALLOW)
    assert.equal(page.iframe.referrerPolicy, "no-referrer")
    assert.equal(new URL(page.iframe.src as string).searchParams.get("parentOrigin"), "https://app.example")
    assert.equal(player.state, "loading")
})

test("state, relaunch and latency messages reach listeners", () => {
    const page = fakePage()
    const player = OpenBeamPlayer.mount(page.container, { playerUrl: PLAYER })
    const seen: string[] = []
    player.on("state", event => seen.push(`${event.state}|${event.detail}`))
    player.on("relaunch", event => seen.push("relaunch " + event.from))
    player.on("latency", event => seen.push("p50 " + event.result.p50Ms))
    page.post({ source: "openbeam-player", type: "state", state: "connecting", detail: "" })
    page.post({ source: "openbeam-player", type: "state", state: "playing", detail: "" })
    page.post({ source: "openbeam-player", type: "relaunch", from: "ses_old" })
    page.post({ source: "openbeam-player", type: "latency", result: { p50Ms: 42 } })
    assert.deepEqual(seen, ["connecting|", "playing|", "relaunch ses_old", "p50 42"])
    assert.equal(player.state, "playing")
})

test("messages from another origin, another window or another sender are ignored", () => {
    const page = fakePage()
    const player = OpenBeamPlayer.mount(page.container, { playerUrl: PLAYER })
    const message = { source: "openbeam-player", type: "state", state: "playing", detail: "" }
    page.post(message, { origin: "https://evil.example" })
    page.post(message, { source: {} })
    page.post({ ...message, source: "someone-else" })
    page.post("playing")
    assert.equal(player.state, "loading")
})

test("the player's keyboard-lock request is honoured unless turned off", () => {
    const page = fakePage()
    OpenBeamPlayer.mount(page.container, { playerUrl: PLAYER })
    page.post({ type: "REQUEST_KEYBOARD_LOCK", requestId: "r1", keys: ["Escape"] })
    assert.deepEqual(page.locked, [["Escape"]])

    const quiet = fakePage()
    OpenBeamPlayer.mount(quiet.container, { playerUrl: PLAYER, keyboardLock: false })
    quiet.post({ type: "REQUEST_KEYBOARD_LOCK", requestId: "r2" })
    assert.deepEqual(quiet.locked, [])
})

test("whenState resolves on the state and rejects when the session ends first", async () => {
    const page = fakePage()
    const player = OpenBeamPlayer.mount(page.container, { playerUrl: PLAYER })
    const playing = player.whenState("playing")
    page.post({ source: "openbeam-player", type: "state", state: "playing", detail: "" })
    assert.equal((await playing).state, "playing")

    const again = player.whenState("click-to-start")
    page.post({ source: "openbeam-player", type: "state", state: "ended", detail: "The session ran out of time." })
    await assert.rejects(again, /ended: The session ran out of time\./)
    await assert.rejects(player.whenState("playing", 5), /within 5 ms/)
})

test("destroy removes the iframe and stops listening", () => {
    const page = fakePage()
    const player = OpenBeamPlayer.mount(page.container, { playerUrl: PLAYER })
    let calls = 0
    player.on("state", () => { calls++ })
    player.destroy()
    page.post({ source: "openbeam-player", type: "state", state: "playing", detail: "" })
    assert.equal(page.iframe.removed, true)
    assert.equal(page.listeners.size, 0)
    assert.equal(calls, 0)
})
