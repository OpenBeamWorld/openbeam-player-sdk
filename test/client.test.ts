import assert from "node:assert/strict"
import { test } from "node:test"
import { OpenBeamApiError, OpenBeamClient, type FetchLike } from "../src/client.ts"

type Call = { url: string, method?: string, headers?: Record<string, string>, body?: string }

function fakeFetch(answers: Array<{ status: number, body?: unknown }>): { fetch: FetchLike, calls: Call[] } {
    const calls: Call[] = []
    const fetch: FetchLike = async (url, init) => {
        calls.push({ url, ...init })
        const answer = answers.shift()
        if (!answer) throw new Error("unexpected request " + url)
        return {
            status: answer.status,
            ok: answer.status >= 200 && answer.status < 300,
            text: async () => answer.body === undefined ? "" : JSON.stringify(answer.body),
        }
    }
    return { fetch, calls }
}

test("createSession posts the options with the user token", async () => {
    const created = { sessionId: "ses_12345678", state: "ready", node: "n1", expiresAt: "2026-01-01T00:00:00Z", descriptor: {}, playerUrl: "https://cloud.openbeam.world/player/player.html#session=abc" }
    const { fetch, calls } = fakeFetch([{ status: 201, body: created }])
    const client = new OpenBeamClient({ token: "tok", fetch })
    const session = await client.createSession({ width: 1280, height: 720, showcase: "off-road" })
    assert.equal(session.playerUrl, created.playerUrl)
    assert.equal(calls[0]!.url, "https://cloud.openbeam.world/v1/sessions")
    assert.equal(calls[0]!.method, "POST")
    assert.equal(calls[0]!.headers!.authorization, "Bearer tok")
    assert.deepEqual(JSON.parse(calls[0]!.body!), { width: 1280, height: 720, showcase: "off-road" })
})

test("an API error carries the status, the code and the body", async () => {
    const { fetch } = fakeFetch([{ status: 409, body: { error: "session_limit", sessionId: "ses_other" } }])
    const client = new OpenBeamClient({ token: "tok", fetch })
    await assert.rejects(client.createSession(), (error: unknown) => {
        assert.ok(error instanceof OpenBeamApiError)
        assert.equal(error.status, 409)
        assert.equal(error.code, "session_limit")
        assert.equal(error.body.sessionId, "ses_other")
        return true
    })
})

test("a non-JSON error still becomes an OpenBeamApiError", async () => {
    const fetch: FetchLike = async () => ({ status: 502, ok: false, text: async () => "<html>bad gateway</html>" })
    await assert.rejects(new OpenBeamClient({ token: "tok", fetch }).listSessions(), (error: unknown) =>
        error instanceof OpenBeamApiError && error.code == "http_502")
})

test("calls that need a token refuse to run without one, before any request", async () => {
    const { fetch, calls } = fakeFetch([])
    await assert.rejects(new OpenBeamClient({ fetch }).createSession(), TypeError)
    assert.equal(calls.length, 0)
})

test("device sign-in shows the code, waits out pending and slow_down, and returns the token", async () => {
    const code = { deviceCode: "secret", userCode: "ABCD-EFGH", verificationUri: "https://cloud.openbeam.world/app/", verificationUriComplete: "https://cloud.openbeam.world/app/#device=ABCD-EFGH", expiresIn: 600, interval: 5 }
    const { fetch, calls } = fakeFetch([
        { status: 200, body: code },
        { status: 400, body: { error: "authorization_pending" } },
        { status: 400, body: { error: "slow_down" } },
        { status: 200, body: { userId: "usr_1", token: "user-token" } },
    ])
    const waits: number[] = []
    let shown = ""
    const result = await new OpenBeamClient({ fetch }).signInWithDevice({
        onCode: issued => { shown = issued.userCode },
        sleep: async ms => { waits.push(ms) },
    })
    assert.deepEqual(result, { userId: "usr_1", token: "user-token" })
    assert.equal(shown, "ABCD-EFGH")
    assert.deepEqual(waits, [5000, 5000, 10000])
    assert.equal(calls[0]!.headers!.authorization, undefined)
    assert.deepEqual(JSON.parse(calls[1]!.body!), { deviceCode: "secret" })
})

test("device sign-in stops when the user denies it", async () => {
    const { fetch } = fakeFetch([
        { status: 200, body: { deviceCode: "d", userCode: "U", verificationUri: "", verificationUriComplete: "", expiresIn: 600, interval: 5 } },
        { status: 400, body: { error: "access_denied" } },
    ])
    await assert.rejects(new OpenBeamClient({ fetch }).signInWithDevice({ onCode: () => { }, sleep: async () => { } }),
        (error: unknown) => error instanceof OpenBeamApiError && error.code == "access_denied")
})

test("endSession uses the session's own token when given, and treats 404 as done", async () => {
    const { fetch, calls } = fakeFetch([{ status: 204 }, { status: 404, body: { error: "not_found" } }])
    const client = new OpenBeamClient({ token: "user", fetch })
    await client.endSession("ses_a/b", { sessionToken: "session-token" })
    await client.endSession("ses_gone")
    assert.equal(calls[0]!.url, "https://cloud.openbeam.world/v1/sessions/ses_a%2Fb")
    assert.equal(calls[0]!.method, "DELETE")
    assert.equal(calls[0]!.headers!.authorization, "Bearer session-token")
    assert.equal(calls[1]!.headers!.authorization, "Bearer user")
})

test("baseUrl must be https, except on localhost", () => {
    const { fetch } = fakeFetch([])
    assert.throws(() => new OpenBeamClient({ baseUrl: "http://cloud.openbeam.world", fetch }), TypeError)
    assert.equal(new OpenBeamClient({ baseUrl: "http://localhost:8080/x", fetch }).baseUrl, "http://localhost:8080")
})

test("listShowcases reads the public catalog without a token", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { presets: [{ id: "off-road", title: "Off-road" }] } }])
    const scenes = await new OpenBeamClient({ fetch }).listShowcases()
    assert.equal(scenes[0]!.id, "off-road")
    assert.equal(calls[0]!.url, "https://cloud.openbeam.world/player/showcase-presets.json")
    assert.equal(calls[0]!.headers!.authorization, undefined)
})
