// Step 2: a minimal app server. The token stays here; the page only ever
// receives a player link for the one session it asked for.
//
//   node examples/quickstart/server.mjs      then open http://localhost:5173
import { existsSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { OpenBeamApiError, OpenBeamClient } from "../../dist/index.js"

const token = process.env.OPENBEAM_TOKEN ?? (existsSync(".openbeam-token") ? readFileSync(".openbeam-token", "utf8").trim() : "")
if (!token) {
    console.error("No token. Run: node examples/quickstart/signin.mjs")
    process.exit(1)
}
const client = new OpenBeamClient({ token })
const page = new URL("./index.html", import.meta.url)
const sdk = new URL("../../dist/openbeam-player.min.js", import.meta.url)
// The sessions this server started, with their own tokens, so only they can be ended through it.
const started = new Map()

function json(response, status, body) {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
    response.end(JSON.stringify(body))
}

createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://localhost")
        if (request.method == "GET" && url.pathname == "/") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
            response.end(readFileSync(page))
        } else if (request.method == "GET" && url.pathname == "/openbeam-player.min.js") {
            response.writeHead(200, { "content-type": "text/javascript" })
            response.end(readFileSync(sdk))
        } else if (request.method == "POST" && url.pathname == "/api/session") {
            // In a real app: check that your own user is signed in and allowed to start one.
            const session = await client.createSession({ width: 1280, height: 720, fps: 60 })
            started.set(session.sessionId, session.descriptor.token)
            json(response, 201, { sessionId: session.sessionId, playerUrl: session.playerUrl, expiresAt: session.expiresAt })
        } else if (request.method == "DELETE" && url.pathname.startsWith("/api/session/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/session/".length))
            if (!started.has(id)) return json(response, 404, { error: "not_found" })
            await client.endSession(id, { sessionToken: started.get(id) })
            started.delete(id)
            json(response, 200, { ended: id })
        } else {
            json(response, 404, { error: "not_found" })
        }
    } catch (error) {
        if (error instanceof OpenBeamApiError) json(response, error.status, { error: error.code, ...error.body })
        else json(response, 500, { error: "server_error" })
    }
}).listen(5173, "127.0.0.1", () => console.log("Open http://localhost:5173"))
