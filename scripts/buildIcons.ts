/**
 * Turns the Inkscape drawings in media-src/icons into small plain SVGs in src/icons, to be imported with ?raw and put
 * inline.
 *
 *     pnpm build-icons
 *
 * Inkscape turns text into paths first, so the icons don't need the fonts they were drawn with. It has to be installed,
 * along with those fonts. svgo then drops what only Inkscape needs and rounds the numbers.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { optimize } from "svgo"

const ROOT = join(import.meta.dirname, "..")
const SOURCE_DIR = join(ROOT, "media-src/icons")
const OUTPUT_DIR = join(ROOT, "src/icons")

const files = readdirSync(SOURCE_DIR).filter(file => file.endsWith(".svg")).sort()
if (files.length === 0)
{
    throw new Error("No icons in " + SOURCE_DIR)
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const temp = mkdtempSync(join(tmpdir(), "icons-"))
try
{
    for (const file of files)
    {
        const plain = join(temp, file)
        try
        {
            execFileSync("inkscape", ["--export-text-to-path", "--export-plain-svg", "--export-filename=" + plain, join(SOURCE_DIR, file)], { stdio: "pipe" })
        }
        catch (e)
        {
            throw new Error("Inkscape couldn't convert " + file + ", is it installed?", { cause: e })
        }
        const { data } = optimize(readFileSync(plain, "utf-8"), {
            multipass: true,
            floatPrecision: 2,
            plugins: [
                // what svgo can't drop from the style becomes attributes, and the rest gets removed below
                "convertStyleToAttrs",
                // keeps the viewBox, which icons sized by their CSS need
                "preset-default",
                // the width and height of the drawing would beat the CSS size
                "removeDimensions",
                // text turned into paths keeps the font and the label, which mean nothing on a path
                {
                    name: "removeAttrs",
                    params: { attrs: ["aria-label", "font-.*", "letter-spacing", "word-spacing", "text-anchor", "style"] }
                }
            ]
        })
        writeFileSync(join(OUTPUT_DIR, file), data + "\n")
        console.log(file + ": " + readFileSync(join(SOURCE_DIR, file)).length + " -> " + data.length + " bytes")
    }
}
finally
{
    rmSync(temp, { recursive: true, force: true })
}
