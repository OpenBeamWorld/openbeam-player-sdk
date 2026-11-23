// Builds dist/: ES modules with type declarations, and a single script for
// pages that load the player with a <script> tag (global `OpenBeam`).
import { execFileSync } from "node:child_process"
import { rmSync } from "node:fs"
import { build } from "esbuild"

rmSync("dist", { recursive: true, force: true })
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { stdio: "inherit" })
await build({
    entryPoints: ["src/player.ts"],
    outfile: "dist/openbeam-player.min.js",
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "OpenBeam",
    target: "es2020",
    legalComments: "none",
})
