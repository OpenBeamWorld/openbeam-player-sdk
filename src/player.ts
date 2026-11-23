// The browser side: mounts the OpenBeam Cloud player in your page and tells
// you what it is doing. No dependencies; works with any framework.
//
// The player runs in an iframe served by OpenBeam Cloud. It streams over
// WebTransport and decodes with WebCodecs, so it needs a current Chromium
// browser, Firefox or Safari with both, and a secure (https) page.

export const DEFAULT_PLAYER_ORIGIN = "https://cloud.openbeam.world"

/** What the iframe may use: sound, fullscreen, controllers, mouse capture, key capture, VR, clipboard. */
export const PLAYER_IFRAME_ALLOW =
    "autoplay; fullscreen; gamepad; pointer-lock; keyboard-lock; xr-spatial-tracking; clipboard-read; clipboard-write"

export type PlayerState =
    | "loading"         // the iframe has not reported yet
    | "connecting"
    | "starting"
    | "click-to-start"  // waiting for the user's click (browsers need one for sound and mouse capture)
    | "playing"
    | "reconnecting"
    | "retrying"        // moving the session to another machine
    | "ended"
    | "error"

export type StateEvent = { state: PlayerState, detail: string }

export type LatencyResult = {
    samples: number[]
    timeouts: number
    minMs: number
    p50Ms: number
    p95Ms: number
    maxMs: number
    meanMs: number
    estimatedGlassToGlassP50Ms: number
}

export type PlayerEvents = {
    /** Every state change, with the text the player shows under its title. */
    state: StateEvent
    /** The session moved to another machine; `from` is the session id it left. */
    relaunch: { from: string }
    /** A latency probe the user ran in the player finished. */
    latency: { result: LatencyResult }
}

export type MountOptions = {
    /** `playerUrl` from your server's `createSession()`. */
    playerUrl: string
    /** Stage a ready-made scene: the `showcase` id the session was created with. */
    showcase?: string
    /** Where the player is served from. Default: https://cloud.openbeam.world */
    playerOrigin?: string
    /** Let the player capture keys such as Escape while fullscreen. Default: true. */
    keyboardLock?: boolean
    /** Accessible name of the iframe. Default: "OpenBeam player". */
    title?: string
    /** Class for the iframe. Without one it fills its container. */
    className?: string
}

type Handler<T> = (event: T) => void

type SessionDescriptorLike = { sessionId: string, token: string, simulator?: string }

function toBase64Url(text: string): string {
    const bytes = new TextEncoder().encode(text)
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** The player link for a descriptor, for when you stored the descriptor instead of `playerUrl`. */
export function buildPlayerUrl(descriptor: SessionDescriptorLike, playerOrigin: string = DEFAULT_PLAYER_ORIGIN): string {
    const url = new URL("/player/player.html", playerOrigin)
    if (descriptor.simulator) url.searchParams.set("simulator", descriptor.simulator)
    url.hash = "session=" + toBase64Url(JSON.stringify(descriptor))
    return url.href
}

/**
 * The link the iframe loads: the given player link, told which page embeds
 * it (so it reports state to that page only) and which scene to stage.
 */
export function embedUrl(playerUrl: string, parentOrigin: string,
    options: { showcase?: string, playerOrigin?: string, launchId?: string } = {}): string {
    const expected = new URL(options.playerOrigin ?? DEFAULT_PLAYER_ORIGIN).origin
    let url: URL
    try {
        url = new URL(playerUrl)
    } catch {
        throw new TypeError("playerUrl is not a URL")
    }
    if (url.origin != expected) {
        throw new TypeError(`playerUrl must be on ${expected} (got ${url.origin}); set playerOrigin if you use another deployment`)
    }
    if (!new URLSearchParams(url.hash.slice(1)).get("session")) {
        throw new TypeError("playerUrl has no #session=… part; pass the playerUrl from createSession() unchanged")
    }
    url.searchParams.set("parentOrigin", parentOrigin)
    if (options.showcase) {
        url.searchParams.set("showcase", options.showcase)
        url.searchParams.set("openbeamLaunch", options.launchId ?? Date.now().toString(36))
    }
    return url.href
}

export class OpenBeamPlayer {
    /** The iframe, for sizing and styling. */
    readonly iframe: HTMLIFrameElement
    private current: StateEvent = { state: "loading", detail: "" }
    private readonly origin: string
    private readonly keyboardLock: boolean
    private readonly handlers: { [K in keyof PlayerEvents]: Set<Handler<PlayerEvents[K]>> } = {
        state: new Set(), relaunch: new Set(), latency: new Set(),
    }
    private destroyed = false
    private readonly view: Window

    /**
     * Puts the player into `container` and starts connecting.
     * Removing it (`destroy()`) does not end the session: end it from your server.
     */
    static mount(container: HTMLElement, options: MountOptions): OpenBeamPlayer {
        return new OpenBeamPlayer(container, options)
    }

    private constructor(container: HTMLElement, options: MountOptions) {
        const document = container.ownerDocument
        const view = document.defaultView
        if (!view) throw new TypeError("container is not in a window")
        this.view = view
        this.origin = new URL(options.playerOrigin ?? DEFAULT_PLAYER_ORIGIN).origin
        this.keyboardLock = options.keyboardLock ?? true
        const source = embedUrl(options.playerUrl, view.location.origin, { showcase: options.showcase, playerOrigin: this.origin })

        const iframe = document.createElement("iframe")
        iframe.title = options.title ?? "OpenBeam player"
        iframe.allow = PLAYER_IFRAME_ALLOW
        iframe.allowFullscreen = true
        // The link carries the session credential: never send it as a referrer.
        iframe.referrerPolicy = "no-referrer"
        if (options.className) {
            iframe.className = options.className
        } else {
            iframe.style.cssText = "display:block;width:100%;height:100%;border:0;background:#000"
        }
        this.iframe = iframe
        view.addEventListener("message", this.onMessage)
        iframe.src = source
        container.appendChild(iframe)
    }

    /** The last state the player reported. */
    get state(): PlayerState { return this.current.state }

    /** The text that goes with `state` (why it ended, what failed). */
    get detail(): string { return this.current.detail }

    /** Subscribes; returns a function that unsubscribes. */
    on<K extends keyof PlayerEvents>(type: K, handler: Handler<PlayerEvents[K]>): () => void {
        this.handlers[type].add(handler)
        return () => { this.handlers[type].delete(handler) }
    }

    /** Resolves when the player reaches `state`; rejects if it ends or fails first, or after `timeoutMs`. */
    whenState(state: PlayerState, timeoutMs?: number): Promise<StateEvent> {
        if (this.current.state == state) return Promise.resolve(this.current)
        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined
            const stop = this.on("state", event => {
                if (event.state != state && event.state != "ended" && event.state != "error") return
                stop()
                if (timer !== undefined) clearTimeout(timer)
                if (event.state == state) resolve(event)
                else reject(new Error(`OpenBeam player ${event.state}${event.detail ? ": " + event.detail : ""}`))
            })
            if (timeoutMs !== undefined) {
                timer = setTimeout(() => {
                    stop()
                    reject(new Error(`OpenBeam player did not reach "${state}" within ${timeoutMs} ms`))
                }, timeoutMs)
            }
        })
    }

    /** Sends keyboard input to the player. */
    focus(): void {
        this.iframe.focus()
    }

    /** Call from a click or key handler. */
    requestFullscreen(): Promise<void> {
        return this.iframe.requestFullscreen()
    }

    /** Removes the iframe and stops listening. The session keeps running until it is ended or idles out. */
    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.view.removeEventListener("message", this.onMessage)
        this.iframe.remove()
        for (const set of Object.values(this.handlers)) set.clear()
    }

    private emit<K extends keyof PlayerEvents>(type: K, event: PlayerEvents[K]) {
        for (const handler of [...this.handlers[type]]) {
            try {
                handler(event)
            } catch (error) {
                // One listener's failure must not hide the event from the others.
                setTimeout(() => { throw error })
            }
        }
    }

    private readonly onMessage = (event: MessageEvent) => {
        // Only the player's own frame, on the player's own origin, is heard.
        if (event.origin != this.origin || event.source != this.iframe.contentWindow) return
        const data = event.data as Record<string, unknown> | null
        if (!data || typeof data != "object") return

        if (data.type == "REQUEST_KEYBOARD_LOCK") {
            if (!this.keyboardLock) return
            const keyboard = (this.view.navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard
            const keys = Array.isArray(data.keys) && data.keys.every(key => typeof key == "string") ? data.keys as string[] : undefined
            void keyboard?.lock?.(keys)?.catch(() => { })
            return
        }

        if (data.source != "openbeam-player") return
        if (data.type == "state" && typeof data.state == "string") {
            this.current = { state: data.state as PlayerState, detail: typeof data.detail == "string" ? data.detail : "" }
            this.emit("state", this.current)
        } else if (data.type == "relaunch" && typeof data.from == "string") {
            this.emit("relaunch", { from: data.from })
        } else if (data.type == "latency" && data.result && typeof data.result == "object") {
            this.emit("latency", { result: data.result as LatencyResult })
        }
    }
}
