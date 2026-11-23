// Step 1: sign in once. Prints a code; approve it in OpenBeam Cloud.
// The token is saved to .openbeam-token (an account credential: keep it private).
import { writeFileSync } from "node:fs"
import { OpenBeamClient } from "../../dist/index.js"

const client = new OpenBeamClient()
const { userId, token } = await client.signInWithDevice({
    onCode: code => {
        console.log(`\nOpen ${code.verificationUriComplete}\nand approve the code ${code.userCode} (valid for ${Math.round(code.expiresIn / 60)} minutes).\n`)
    },
})
writeFileSync(".openbeam-token", token, { mode: 0o600 })
console.log(`Signed in as ${userId}. Token saved to .openbeam-token`)
