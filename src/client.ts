// OpenBeam Cloud's Session API, for the server side of your app.
//
// A user token is an account credential: keep it on your server. Browsers on
// other sites cannot call this API anyway (it answers cross-origin requests
// from OpenBeam's own sites only). Your server starts the session and hands
// the page a player link, which carries a credential for that one session.

export const DEFAULT_BASE_URL = "https://cloud.openbeam.world"

export type FetchLike = (input: string, init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
}) => Promise<{ status: number, ok: boolean, text(): Promise<string> }>

export type ClientOptions = {
    /** A user token from device sign-in. Not needed for the sign-in calls themselves. */
    token?: string
    /** The Session API's origin. Default: https://cloud.openbeam.world */
    baseUrl?: string
    /** Defaults to the global `fetch` (Node 18+, browsers, Deno, Bun, Workers). */
    fetch?: FetchLike
}

/** What the player needs to attach to one session. Treat it as a secret. */
export type SessionDescriptor = {
    sessionId: string
    /** Bearer credential for this session only: attach, read state, end. */
    token: string
    webTransport?: { url: string, certificateHashes: string[] }
    endUrl: string
    video: { width: number, height: number, fps: number, bitrateKbps: number, codec: string }
    mouse: "absolute" | "relative"
    expiresAt: string
    simulator?: string
}

export type CreateSessionOptions = {
    width?: number
    height?: number
    fps?: number
    bitrateKbps?: number
    /** e.g. ["h264"], or ["h264", "hevc", "av1"] to let the player pick. */
    codecs?: string[]
    adaptiveBitrate?: boolean
    /** "relative" (pointer lock, the default for games) or "absolute". */
    mouse?: "absolute" | "relative"
    /** A scene id from `listShowcases()`; pass the same id to the player. */
    showcase?: string
    /** Up to 4 library item ids for the showcase. */
    contentIds?: string[]
    /** Another simulator the account may launch (`listSimulators()`). */
    app?: string
    /** "play" (default) or "training" (runs without a player attached). */
    kind?: "play" | "training"
    signal?: AbortSignal
}

export type CreatedSession = {
    sessionId: string
    state: string
    node: string
    expiresAt: string
    descriptor: SessionDescriptor
    /** Open this in the player (`OpenBeamPlayer.mount`). Carries the session credential in its fragment. */
    playerUrl: string
}

export type Session = {
    sessionId: string
    userId: string
    node: string | null
    /** "creating", "ready", "streaming", "ended", ... */
    state: string
    createdAt: string
    startedAt: string | null
    endedAt: string | null
    endReason: string | null
    expiresAt: string
    billedSeconds: number | null
    attachedSeconds: number
    bridge: Record<string, unknown> | null
}

export type PlayTime = {
    /** How long a session started now may last, in seconds. */
    sessionSeconds: number
    availableSessions: number | null
    pendingSessions: number
    activeSessionSeconds: number[]
    plan?: Record<string, unknown> | null
}

export type Account = { userId: string, email: string | null, access: Record<string, unknown>, ghostMember?: boolean }

export type DeviceCode = {
    /** Secret: poll with it, never show it. */
    deviceCode: string
    /** Show this to the user. */
    userCode: string
    verificationUri: string
    /** Opens the approval page with the code filled in. */
    verificationUriComplete: string
    /** Seconds until the code expires. */
    expiresIn: number
    /** Seconds to wait between polls. */
    interval: number
}

export type DevicePoll =
    | { status: "approved", userId: string, token: string }
    | { status: "pending" }
    | { status: "slow_down" }

/** A non-2xx answer. `code` is the API's `error` value, e.g. "session_limit". */
export class OpenBeamApiError extends Error {
    readonly status: number
    readonly code: string
    readonly body: Record<string, unknown>

    constructor(status: number, code: string, body: Record<string, unknown>) {
        const detail = typeof body.message == "string" ? `: ${body.message}` : ""
        super(`OpenBeam API ${status} ${code}${detail}`)
        this.name = "OpenBeamApiError"
        this.status = status
        this.code = code
        this.body = body
    }
}

export type DeviceSignInOptions = {
    /** Called once with the code to show the user. */
    onCode: (code: DeviceCode) => void | Promise<void>
    signal?: AbortSignal
    /** Test hook; defaults to a real timer. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason)
            return
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal!.reason)
        }
        signal?.addEventListener("abort", onAbort, { once: true })
    })
}

export class OpenBeamClient {
    readonly baseUrl: string
    private readonly token: string | undefined
    private readonly fetchImpl: FetchLike

    constructor(options: ClientOptions = {}) {
        const base = new URL(options.baseUrl ?? DEFAULT_BASE_URL)
        const local = base.hostname == "localhost" || base.hostname == "127.0.0.1" || base.hostname == "[::1]"
        if (base.protocol != "https:" && !(base.protocol == "http:" && local)) {
            throw new TypeError("baseUrl must be https (http is accepted for localhost only)")
        }
        this.baseUrl = base.origin
        this.token = options.token
        const found = options.fetch ?? (globalThis as { fetch?: unknown }).fetch
        if (typeof found != "function") {
            throw new TypeError("No fetch available: pass options.fetch")
        }
        this.fetchImpl = options.fetch ?? ((input, init) => (found as FetchLike).call(globalThis, input, init))
    }

    /** The same client acting with another token (e.g. per signed-in user). */
    withToken(token: string): OpenBeamClient {
        return new OpenBeamClient({ token, baseUrl: this.baseUrl, fetch: this.fetchImpl })
    }

    // Sign-in: the user approves a short code in OpenBeam Cloud, like a TV app.

    /** Starts device sign-in. Show `userCode` and `verificationUriComplete` to the user. */
    startDeviceSignIn(signal?: AbortSignal): Promise<DeviceCode> {
        return this.request("POST", "/v1/device/code", { auth: false, signal })
    }

    /** One poll. Throws OpenBeamApiError "access_denied" or "expired_token" when it is over. */
    async pollDeviceSignIn(deviceCode: string, signal?: AbortSignal): Promise<DevicePoll> {
        try {
            const done = await this.request<{ userId: string, token: string }>(
                "POST", "/v1/device/token", { auth: false, body: { deviceCode }, signal })
            return { status: "approved", userId: done.userId, token: done.token }
        } catch (error) {
            if (error instanceof OpenBeamApiError && error.code == "authorization_pending") return { status: "pending" }
            if (error instanceof OpenBeamApiError && (error.code == "slow_down" || error.status == 429)) return { status: "slow_down" }
            throw error
        }
    }

    /** The whole flow: issues a code, hands it to `onCode`, waits for the user's decision. */
    async signInWithDevice(options: DeviceSignInOptions): Promise<{ userId: string, token: string }> {
        const sleep = options.sleep ?? defaultSleep
        const code = await this.startDeviceSignIn(options.signal)
        await options.onCode(code)
        let waitMs = Math.max(1, code.interval) * 1000
        for (;;) {
            await sleep(waitMs, options.signal)
            const poll = await this.pollDeviceSignIn(code.deviceCode, options.signal)
            if (poll.status == "approved") return { userId: poll.userId, token: poll.token }
            if (poll.status == "slow_down") waitMs += 5000
        }
    }

    // Account

    me(signal?: AbortSignal): Promise<Account> {
        return this.request("GET", "/v1/me", { signal })
    }

    playTime(signal?: AbortSignal): Promise<PlayTime> {
        return this.request("GET", "/v1/me/play-time", { signal })
    }

    /** Simulators this account may pass as `app`. */
    listSimulators(signal?: AbortSignal): Promise<string[]> {
        return this.request("GET", "/v1/me/simulators", { signal })
    }

    /** The ready-made scenes (`showcase` ids). Needs no token. */
    async listShowcases(signal?: AbortSignal): Promise<Array<{ id: string, title: string } & Record<string, unknown>>> {
        const catalog = await this.request<{ presets?: Array<{ id: string, title: string }> }>(
            "GET", "/player/showcase-presets.json", { auth: false, signal })
        return catalog.presets ?? []
    }

    // Sessions

    /**
     * Starts a session on the token's account and uses its play time.
     * Throws OpenBeamApiError: "session_limit" (409; `body.sessionId` is the
     * session already running), "trial_exhausted", "free_tier_exhausted",
     * "no_capacity" (503; retry after `body.retryAfterSeconds`), ...
     */
    createSession(options: CreateSessionOptions = {}): Promise<CreatedSession> {
        const { signal, ...body } = options
        return this.request("POST", "/v1/sessions", { body, signal })
    }

    listSessions(signal?: AbortSignal): Promise<Session[]> {
        return this.request("GET", "/v1/sessions", { signal })
    }

    /** `sessionToken`: read with the session's own credential instead of the user token. */
    getSession(sessionId: string, options: { sessionToken?: string, signal?: AbortSignal } = {}): Promise<Session> {
        return this.request("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`, { token: options.sessionToken, signal: options.signal })
    }

    /** Ends the session and stops its play-time use. Ending an ended session is not an error. */
    async endSession(sessionId: string, options: { sessionToken?: string, signal?: AbortSignal } = {}): Promise<void> {
        try {
            await this.request("DELETE", `/v1/sessions/${encodeURIComponent(sessionId)}`, { token: options.sessionToken, signal: options.signal })
        } catch (error) {
            if (error instanceof OpenBeamApiError && error.status == 404) return
            throw error
        }
    }

    private async request<T>(method: string, path: string,
        options: { auth?: boolean, token?: string, body?: unknown, signal?: AbortSignal } = {}): Promise<T> {
        const headers: Record<string, string> = { accept: "application/json" }
        if (options.auth !== false) {
            const token = options.token ?? this.token
            if (!token) throw new TypeError(`${method} ${path} needs a token: pass one to the OpenBeamClient constructor`)
            headers.authorization = `Bearer ${token}`
        }
        let body: string | undefined
        if (options.body !== undefined) {
            headers["content-type"] = "application/json"
            body = JSON.stringify(options.body)
        }
        const response = await this.fetchImpl(this.baseUrl + path, { method, headers, body, signal: options.signal })
        const text = await response.text()
        let parsed: unknown = null
        if (text) {
            try { parsed = JSON.parse(text) } catch { parsed = null }
        }
        if (!response.ok) {
            const record = parsed && typeof parsed == "object" ? parsed as Record<string, unknown> : {}
            const code = typeof record.error == "string" ? record.error : `http_${response.status}`
            throw new OpenBeamApiError(response.status, code, record)
        }
        return parsed as T
    }
}
