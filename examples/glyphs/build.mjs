// Builds the glyph specimen page from template.html, the stroke data and the curated palettes into
// public/examples/glyph/index.html, where it gets published with the site:
//
//     node examples/glyphs/build.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

const template = readFileSync(join(here, "template.html"), "utf8")
const strokes = readFileSync(join(here, "strokes.json"), "utf8")
const palettes = readFileSync(join(here, "../../src/palette/curated.json"), "utf8")

// function replacements, so "$" in the data is taken literally
const page = template
    .replace("/*DATA*/null", () => strokes)
    .replace("/*PALETTES*/null", () => palettes)

writeFileSync(join(here, "../../public/examples/glyph/index.html"), page)
