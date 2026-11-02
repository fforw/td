// Extracts sampled strokes and the component tree of the source characters from the KanjiVG SVGs in kanjivg/ into
// strokes.json:
//
//     node public/examples/glyphs/extract.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

const CONCEPTS = [
    ["心", "heart"], ["金", "money"], ["城", "castle"], ["宝", "treasure"], ["家", "house"], ["怒", "anger"],
    ["恋", "love"], ["王", "king"], ["女", "woman"], ["子", "child"], ["径", "road"], ["山", "mountain"],
    ["水", "water"], ["火", "fire"], ["木", "tree"], ["刃", "sword"], ["死", "death"], ["戸", "door"],
    ["封", "seal"], ["神", "god"], ["仇", "enemy"], ["友", "friend"], ["米", "food"], ["怖", "fear"],
]

function parsePath(d)
{
    const tokens = d.match(/[MmCcSsLlZzHhVv]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g)
    const curves = []
    let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0
    const num = () => parseFloat(tokens[i++])
    while (i < tokens.length)
    {
        if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++]
        const rel = cmd === cmd.toLowerCase()
        const ox = rel ? x : 0, oy = rel ? y : 0
        switch (cmd.toUpperCase())
        {
            case "M": x = sx = num() + ox; y = sy = num() + oy; lcx = x; lcy = y; cmd = rel ? "l" : "L"; break
            case "L": { const nx = num() + ox, ny = num() + oy; curves.push([x, y, x, y, nx, ny, nx, ny]); x = lcx = nx; y = lcy = ny; break }
            case "C": {
                const c = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy]
                curves.push([x, y, ...c]); lcx = c[2]; lcy = c[3]; x = c[4]; y = c[5]; break
            }
            case "S": {
                const c1x = 2 * x - lcx, c1y = 2 * y - lcy
                const c = [num() + ox, num() + oy, num() + ox, num() + oy]
                curves.push([x, y, c1x, c1y, ...c]); lcx = c[0]; lcy = c[1]; x = c[2]; y = c[3]; break
            }
            case "Z": x = sx; y = sy; break
            default: throw new Error("Unsupported path command " + cmd)
        }
    }
    return curves
}

function sample(curves, n)
{
    const dense = []
    for (const [x0, y0, x1, y1, x2, y2, x3, y3] of curves)
    {
        for (let k = dense.length ? 1 : 0; k <= 32; k++)
        {
            const t = k / 32, u = 1 - t
            dense.push([
                u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
            ])
        }
    }
    const acc = [0]
    for (let k = 1; k < dense.length; k++) acc.push(acc[k - 1] + Math.hypot(dense[k][0] - dense[k - 1][0], dense[k][1] - dense[k - 1][1]))
    const total = acc[acc.length - 1]
    const out = []
    let j = 0
    for (let k = 0; k < n; k++)
    {
        const s = total * k / (n - 1)
        while (j < acc.length - 2 && acc[j + 1] < s) j++
        const f = acc[j + 1] > acc[j] ? (s - acc[j]) / (acc[j + 1] - acc[j]) : 0
        out.push([+(dense[j][0] + f * (dense[j + 1][0] - dense[j][0])).toFixed(2), +(dense[j][1] + f * (dense[j + 1][1] - dense[j][1])).toFixed(2)])
    }
    return out
}

const attr = (attrs, name) => new RegExp(`kvg:${name}="([^"]+)"`).exec(attrs)?.[1] ?? null

const dir = join(here, "kanjivg")
const result = CONCEPTS.map(([char, concept]) => {
    const svg = readFileSync(join(dir, char.codePointAt(0).toString(16).padStart(5, "0") + ".svg"), "utf8")

    // component tree: nodes are { el, original, partial, radical, kids }, kids are nodes or stroke indexes. Groups
    // without an element only arrange their kids and are flattened into their parent.
    const root = { el: char, original: null, partial: false, radical: null, kids: [] }
    const stack = [root]
    const opened = []
    const strokes = []
    for (const m of svg.matchAll(/<(\/?)(g|path)\b([^>]*?)(\/?)>/g))
    {
        const [, close, tag, attrs, selfClose] = m
        if (tag === "g")
        {
            if (close)
            {
                if (opened.pop()) stack.pop()
            }
            else if (!selfClose)
            {
                const el = attr(attrs, "element")
                const isRoot = /id="kvg:[0-9a-f]+"/.test(attrs)
                if (el && !isRoot)
                {
                    const node = {
                        el,
                        original: attr(attrs, "original"),
                        partial: attr(attrs, "partial") === "true",
                        radical: attr(attrs, "radical"),
                        kids: []
                    }
                    stack[stack.length - 1].kids.push(node)
                    stack.push(node)
                    opened.push(true)
                }
                else
                {
                    if (isRoot) root.radical = attr(attrs, "radical")
                    opened.push(false)
                }
            }
        }
        else if (!close && /id="kvg:[0-9a-f]+-s\d+"/.test(attrs))
        {
            const d = /\sd="([^"]+)"/.exec(attrs)[1]
            stack[stack.length - 1].kids.push(strokes.length)
            strokes.push({ type: attr(attrs, "type") ?? "", pts: sample(parsePath(d), 24) })
        }
    }

    // the radical the character is listed under, general classification first
    const radicals = []
    const walk = node => {
        if (node.radical) radicals.push(node)
        node.kids.forEach(k => typeof k === "object" && walk(k))
    }
    walk(root)
    const rad = radicals.find(n => n.radical === "general") ?? radicals.find(n => n.radical === "tradit") ?? radicals[0]
    const radical = rad ? (rad.original && !rad.partial ? rad.original : rad.el) : char

    // components each stroke belongs to, for highlighting families
    const comps = strokes.map(() => [])
    const mark = (node, path) => node.kids.forEach(k => {
        if (typeof k === "number") comps[k] = [...path, node.el]
        else mark(k, [...path, node.el])
    })
    mark(root, [])
    strokes.forEach((s, i) => s.comps = [...new Set(comps[i])])

    const strip = node => ({
        el: node.el,
        original: node.original,
        partial: node.partial,
        kids: node.kids.map(k => typeof k === "number" ? k : strip(k))
    })
    return { char, concept, radical, tree: strip(root), strokes }
})
writeFileSync(join(here, "strokes.json"), JSON.stringify(result))
