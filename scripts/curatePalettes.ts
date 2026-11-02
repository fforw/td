/**
 * Curates the raw palettes into palettes with roles. Colors are sorted by luminance, darkest first. The ends are
 * background and main color, depending on prefers-color-scheme: a dark scheme uses the darkest color as background and
 * the lightest as main color, a light scheme the other way round. If the lightest color is no usable background, a
 * pale tint of one of the brighter colors is added as new lightest color. Pure black is dropped; if the darkest color
 * left is no usable background, a darkened shade of one of the darker colors is added as new darkest color. From the colors in between, the one that
 * keeps the most contrast to both ends becomes the secondary color, used less often, and the one that stands out the
 * most from all three becomes the accent. Palettes that are too grey or brown or have no clear choice for a role are
 * dropped.
 *
 * The result has a table per color scheme, one palette per row: background, main, secondary, accent.
 *
 *     node scripts/curatePalettes.ts [in.json] [out.json]
 */
import { readFileSync, writeFileSync } from "node:fs"

const input = process.argv[2] ?? "src/palette/palettes.json"
const output = process.argv[3] ?? "src/palette/curated.json"

/**
 * Minimum contrast ratio of the main color on the background
 */
const MIN_MAIN_CONTRAST = 7

/**
 * Minimum contrast ratio of the secondary color against both ends
 */
const MIN_SECONDARY_CONTRAST = 1.8

/**
 * Minimum OKLab distance of the accent to the other three roles
 */
const MIN_ACCENT_DISTANCE = 0.13

/**
 * Minimum OKLCH chroma of the accent
 */
const MIN_ACCENT_CHROMA = 0.08

/**
 * Minimum contrast ratio of the accent against both backgrounds, so it never disappears into one of them
 */
const MIN_ACCENT_CONTRAST = 1.6

/**
 * OKLab lightness the backgrounds need: dark enough for the dark scheme, light enough for the light scheme. Both have
 * to be calm, a saturated yellow is no background.
 */
const MAX_DARK_BACKGROUND = 0.3
const MIN_LIGHT_BACKGROUND = 0.82
const MAX_BACKGROUND_CHROMA = 0.12

/**
 * OKLCH lightness and chroma limit of the tint added as light background
 */
const TINT_LIGHTNESS = 0.96
const TINT_CHROMA = 0.035

/**
 * OKLCH lightness and chroma limit of the shade added as dark background, and the step it is darkened by further if
 * the main color still doesn't read on it
 */
const SHADE_LIGHTNESS = 0.2
const SHADE_CHROMA = 0.05
const SHADE_STEP = 0.01

interface Color
{
    hex: string
    luminance: number
    L: number
    a: number
    b: number
    chroma: number
    hue: number
}

interface Curated
{
    colors: string[]
    light: string[]
    dark: string[]
}

function parseHex(hex: string): number[]
{
    let h = hex.trim().replace(/^#/, "")
    if (h.length === 3)
    {
        h = h.split("").map(c => c + c).join("")
    }
    if (!/^[0-9a-f]{6}$/i.test(h))
    {
        throw new Error("Invalid color " + hex)
    }
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
}

const linear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

function toColor(hex: string): Color
{
    const [r, g, b] = parseHex(hex).map(linear)
    // WCAG relative luminance
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

    // OKLab
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s

    const rgb = parseHex(hex).map(c => Math.round(c * 255).toString(16).padStart(2, "0"))
    return {
        hex: "#" + rgb.join(""),
        luminance,
        L,
        a: A,
        b: B,
        chroma: Math.hypot(A, B),
        hue: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360
    }
}

const gamma = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

/**
 * sRGB color for the given OKLCH values, with the chroma reduced until it fits into sRGB
 */
function fromOklch(L: number, C: number, hue: number): Color
{
    const h = hue * Math.PI / 180
    const steps = Math.ceil(C / 0.002)
    for (let i = steps; i >= 0; i--)
    {
        const c = C * i / Math.max(steps, 1)
        const A = c * Math.cos(h), B = c * Math.sin(h)
        const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
        const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
        const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
        const rgb = [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
        ]
        // grey always fits, up to rounding
        if (rgb.every(v => v >= -1e-9 && v <= 1 + 1e-9))
        {
            return toColor("#" + rgb.map(v => Math.round(gamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0")).join(""))
        }
    }
    return toColor("#fff")
}

const contrast = (x: Color, y: Color) =>
    (Math.max(x.luminance, y.luminance) + 0.05) / (Math.min(x.luminance, y.luminance) + 0.05)

const distance = (x: Color, y: Color) => Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)

/**
 * Grey or brown: hardly any chroma, or a dull orange-yellow hue that isn't light or saturated enough to read as a
 * color of its own
 */
function isMuddy(c: Color): boolean
{
    if (c.chroma < 0.04)
    {
        return true
    }
    return c.hue > 30 && c.hue < 100 && c.chroma < 0.12 && c.L < 0.65
}

function curate(raw: string[]): Curated | string
{
    // pure black is replaced by a shade of the palette's own colors, see below
    const colors = [...new Map(raw.map(toColor).filter(c => c.hex !== "#000000").map(c => [c.hex, c])).values()]
        .sort((x, y) => x.luminance - y.luminance)

    // without a light end that works as background, add a pale tint of the brightest color that has a color to give
    const top = colors[colors.length - 1]
    if (top.L < MIN_LIGHT_BACKGROUND || top.chroma > MAX_BACKGROUND_CHROMA)
    {
        const brighter = colors.slice(Math.floor(colors.length / 2)).reverse()
        const source = brighter.find(c => !isMuddy(c)) ?? top
        colors.push(fromOklch(TINT_LIGHTNESS, Math.min(source.chroma * 0.3, TINT_CHROMA), source.hue))
    }

    // without a dark end that works as background, add a deep shade of the darkest color that has a color to give,
    // darkened further until the lightest color reads on it
    const bottom = colors[0]
    const light = colors[colors.length - 1]
    if (bottom.L > MAX_DARK_BACKGROUND || bottom.chroma > MAX_BACKGROUND_CHROMA || contrast(bottom, light) < MIN_MAIN_CONTRAST)
    {
        const darker = colors.slice(0, Math.ceil(colors.length / 2))
        const source = darker.find(c => !isMuddy(c)) ?? bottom
        const chroma = Math.min(source.chroma * 0.5, SHADE_CHROMA)
        let shade = fromOklch(Math.min(source.L, SHADE_LIGHTNESS), chroma, source.hue)
        for (let L = shade.L; L > 0 && contrast(shade, light) < MIN_MAIN_CONTRAST; L -= SHADE_STEP)
        {
            shade = fromOklch(L, chroma, source.hue)
        }
        colors.unshift(shade)
    }

    if (colors.length < 4)
    {
        return "fewer than four distinct colors"
    }

    const darkest = colors[0]
    const lightest = colors[colors.length - 1]
    if (contrast(darkest, lightest) < MIN_MAIN_CONTRAST)
    {
        return `ends have too little contrast (below ${MIN_MAIN_CONTRAST}:1)`
    }

    if (darkest.L > MAX_DARK_BACKGROUND || lightest.L < MIN_LIGHT_BACKGROUND ||
        darkest.chroma > MAX_BACKGROUND_CHROMA || lightest.chroma > MAX_BACKGROUND_CHROMA)
    {
        return "ends don't work as backgrounds"
    }

    const middle = colors.slice(1, -1)
    if (middle.filter(isMuddy).length * 2 > middle.length)
    {
        return "too grey or brown"
    }

    const usable = middle.filter(c => !isMuddy(c))
    const secondary = usable
        .map(c => ({ c, score: Math.min(contrast(c, darkest), contrast(c, lightest)) }))
        .sort((x, y) => y.score - x.score)[0]
    if (!secondary || secondary.score < MIN_SECONDARY_CONTRAST)
    {
        return "no middle color with contrast to both ends"
    }

    const accent = usable
        .filter(c => c !== secondary.c && c.chroma >= MIN_ACCENT_CHROMA &&
                     Math.min(contrast(c, darkest), contrast(c, lightest)) >= MIN_ACCENT_CONTRAST)
        .map(c => ({ c, distance: Math.min(distance(c, darkest), distance(c, lightest), distance(c, secondary.c)) }))
        .filter(x => x.distance >= MIN_ACCENT_DISTANCE)
        // the most distinct color wins, saturated colors count a little extra
        .sort((x, y) => y.distance + y.c.chroma - x.distance - x.c.chroma)[0]
    if (!accent)
    {
        return "no accent that stands out from the other colors"
    }

    return {
        colors: colors.map(c => c.hex),
        light: [lightest.hex, darkest.hex, secondary.c.hex, accent.c.hex],
        dark: [darkest.hex, lightest.hex, secondary.c.hex, accent.c.hex]
    }
}

const palettes: string[][] = JSON.parse(readFileSync(input, "utf8"))

const curated: Curated[] = []
const seen = new Set<string>()
const dropped = new Map<string, number>()
for (const raw of palettes)
{
    const result = curate(raw)
    if (typeof result === "string")
    {
        dropped.set(result, (dropped.get(result) ?? 0) + 1)
        continue
    }
    // the raw list repeats some palettes
    const key = result.colors.join()
    if (!seen.has(key))
    {
        seen.add(key)
        curated.push(result)
    }
}

// one palette per line, so editors can show the colors of a palette next to each other
const table = (rows: string[][]) => rows.map(row => "        " + JSON.stringify(row).replace(/,/g, ", ")).join(",\n")
writeFileSync(output, [
    "{",
    '    "roles": ["background", "main", "secondary", "accent"],',
    '    "light": [',
    table(curated.map(c => c.light)),
    "    ],",
    '    "dark": [',
    table(curated.map(c => c.dark)),
    "    ]",
    "}",
    ""
].join("\n"))

console.log(`${palettes.length} palettes, ${curated.length} kept, ${palettes.length - curated.length} dropped:`)
console.log(`    ${palettes.length - curated.length - [...dropped.values()].reduce((a, b) => a + b, 0)} duplicates`)
for (const [reason, count] of dropped)
{
    console.log(`    ${count} ${reason}`)
}
