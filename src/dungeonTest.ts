import "./style.css"
import { loadLevel } from "./dungeonPage"
import type { DungeonLevel } from "./map/generateDungeon"
import { EdgeType } from "./map/geometry"
import { LOCAL_MASK, SLOT_SHIFT } from "./map/PatchWorld"
import { BORDER_FIRST, BORDER_SECOND, BORDER_STRIDE, faceCount, next, type QuadPatch } from "./map/QuadPatch"

/*
 * Test page for the layout of a dungeon level as a plan, e.g. dungeon.html?seed=1&width=3&height=2&floor=0.5&labyrinth=5
 */

const BACKGROUND_COLOR = "#14141c"
const WALL_COLOR = "#23232e"
const REGION_COLOR = "#3c4252"
const CORRIDOR_COLOR = "#d8d2c0"
const EDGE_WALL_COLOR = "#000"
const DOOR_COLOR = "#ff3030"
const MESH_COLOR = "#00000060"
const OUTLINE_COLOR = "#e0a04060"
const LABEL_COLOR = "#000"

/**
 * Distance between the level and the edge of the canvas in pixels
 */
const MARGIN = 16

// module scripts are deferred, so the DOM is ready at this point
const canvas = document.getElementById("screen") as HTMLCanvasElement
const ctx = canvas.getContext("2d")!


/**
 * Returns the fill color per face of each patch: wall by default, then regions, then corridors and rooms with a color
 * of their own
 */
function faceColors({ patches, regions, rooms, corridors }: DungeonLevel): string[][]
{
    const colors = patches.map(patch => new Array<string>(faceCount(patch)).fill(WALL_COLOR))
    const paint = (faces: number[], color: string) => {
        for (const face of faces)
        {
            colors[face >> (SLOT_SHIFT - 2)][face & (LOCAL_MASK >> 2)] = color
        }
    }

    regions.forEach(faces => paint(faces, REGION_COLOR))
    corridors.forEach(({ faces }) => paint(faces, CORRIDOR_COLOR))
    rooms.forEach((faces, i) => paint(faces, `hsl(${i * 360 / rooms.length} 70% 60%)`))
    return colors
}


/**
 * Starts a new path around the given face
 */
function traceFace({ positions, vertex }: QuadPatch, face: number, toScreen: (x: number, y: number) => [number, number]): void
{
    ctx.beginPath()
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        ctx.lineTo(...toScreen(positions[vertex[h] * 3], positions[vertex[h] * 3 + 1]))
    }
    ctx.closePath()
}


function draw(level: DungeonLevel): void
{
    const { patches, rooms } = level

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { positions } of patches)
    {
        for (let i = 0; i < positions.length; i += 3)
        {
            minX = Math.min(minX, positions[i])
            maxX = Math.max(maxX, positions[i])
            minY = Math.min(minY, positions[i + 1])
            maxY = Math.max(maxY, positions[i + 1])
        }
    }

    const ratio = window.devicePixelRatio
    canvas.width = window.innerWidth * ratio
    canvas.height = window.innerHeight * ratio
    canvas.style.width = window.innerWidth + "px"
    canvas.style.height = window.innerHeight + "px"
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)

    const scale = Math.min(
        (window.innerWidth - MARGIN * 2) / (maxX - minX),
        (window.innerHeight - MARGIN * 2) / (maxY - minY)
    )
    const toScreen = (x: number, y: number): [number, number] => [
        window.innerWidth / 2 + (x - (minX + maxX) / 2) * scale,
        window.innerHeight / 2 + (y - (minY + maxY) / 2) * scale
    ]

    const colors = faceColors(level)
    ctx.lineWidth = 0.5
    ctx.strokeStyle = MESH_COLOR
    patches.forEach((patch, index) => {
        for (let f = 0; f < faceCount(patch); f++)
        {
            traceFace(patch, f, toScreen)
            ctx.fillStyle = colors[index][f]
            ctx.fill()
            ctx.stroke()
        }
    })

    ctx.strokeStyle = OUTLINE_COLOR
    ctx.lineWidth = 1
    for (const { border, positions, vertex } of patches)
    {
        ctx.beginPath()
        for (let off = 0; off < border.length; off += BORDER_STRIDE)
        {
            for (const h of [border[off + BORDER_FIRST], border[off + BORDER_SECOND]])
            {
                ctx.moveTo(...toScreen(positions[vertex[h] * 3], positions[vertex[h] * 3 + 1]))
                ctx.lineTo(...toScreen(positions[vertex[next(h)] * 3], positions[vertex[next(h)] * 3 + 1]))
            }
        }
        ctx.stroke()
    }

    // both half edges of an edge have the same type, drawing it twice doesn't change it
    ctx.lineCap = "round"
    for (const [type, color, lineWidth] of [[EdgeType.WALL, EDGE_WALL_COLOR, 1.5], [EdgeType.DOOR, DOOR_COLOR, 4]] as const)
    {
        ctx.strokeStyle = color
        ctx.lineWidth = lineWidth
        ctx.beginPath()
        for (const { edgeType, positions, vertex } of patches)
        {
            for (let h = 0; h < edgeType.length; h++)
            {
                if (edgeType[h] === type.index)
                {
                    ctx.moveTo(...toScreen(positions[vertex[h] * 3], positions[vertex[h] * 3 + 1]))
                    ctx.lineTo(...toScreen(positions[vertex[next(h)] * 3], positions[vertex[next(h)] * 3 + 1]))
                }
            }
        }
        ctx.stroke()
    }

    // room numbers, room 1 grew out of the largest region
    ctx.fillStyle = LABEL_COLOR
    ctx.font = "bold 13px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    rooms.forEach((faces, i) => {
        let x = 0, y = 0
        for (const face of faces)
        {
            const patch = patches[face >> (SLOT_SHIFT - 2)]
            const local = face & (LOCAL_MASK >> 2)
            for (let h = local * 4; h < local * 4 + 4; h++)
            {
                x += patch.positions[patch.vertex[h] * 3]
                y += patch.positions[patch.vertex[h] * 3 + 1]
            }
        }
        const count = faces.length * 4
        ctx.fillText(String(i + 1), ...toScreen(x / count, y / count))
    })
}


loadLevel().then(level => {
    draw(level)
    window.addEventListener("resize", () => draw(level))
})
