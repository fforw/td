import "./style.css"
import { loadLevel } from "./dungeonPage"
import { placeFixtures } from "./game/levelFixtures"
import { findWallSegments } from "./map/dungeonLights"
import { findRoomRoles, type LevelExit, type RoomRoles } from "./map/dungeonRoles"
import type { FixtureSpot } from "./map/fixtures"
import type { DungeonLevel } from "./map/generateDungeon"
import { EdgeType, FaceType } from "./map/geometry"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "./map/PatchWorld"
import { BORDER_FIRST, BORDER_SECOND, BORDER_STRIDE, faceCount, next, type QuadPatch } from "./map/QuadPatch"
import { SCALE } from "./map/scale"

/*
 * Test page for the layout of a dungeon level as a plan, e.g. dungeon.html?seed=1&width=3&height=2&floor=0.5&labyrinth=5
 */

const BACKGROUND_COLOR = "#14141c"
const EMPTY_COLOR = "#23232e"
const REGION_COLOR = "#3c4252"
const WALL_COLOR = "#7c7a82"
const CORRIDOR_COLOR = "#d8d2c0"
const EDGE_WALL_COLOR = "#000"
const DOOR_COLOR = "#ff3030"
const MESH_COLOR = "#00000060"
const OUTLINE_COLOR = "#e0a04060"
const LABEL_COLOR = "#000"
const TREE_COLOR = "#000000c0"
const MAIN_PATH_COLOR = "#ffd040"
const ENTRANCE_COLOR = "#40d060"
const ROOM_MARK_COLOR = "#fff"
const UNREACHABLE_COLOR = "#606068"
const EXIT_COLOR = "#ff3030"
const CHEST_COLOR = "#ffb020"

/**
 * Radius of the disc behind a room number in pixels
 */
const MARK_RADIUS = 10

/**
 * Distance between the level and the edge of the canvas in pixels
 */
const MARGIN = 16

// module scripts are deferred, so the DOM is ready at this point
const canvas = document.getElementById("screen") as HTMLCanvasElement
const ctx = canvas.getContext("2d")!


/**
 * Returns the fill color per face of each patch: empty by default, then regions, then wall faces, then corridors and
 * rooms with a color of their own
 */
function faceColors({ patches, regions, rooms, corridors }: DungeonLevel, { depths }: RoomRoles): string[][]
{
    const colors = patches.map(patch => new Array<string>(faceCount(patch)).fill(EMPTY_COLOR))
    const paint = (faces: number[], color: string) => {
        for (const face of faces)
        {
            colors[face >> (SLOT_SHIFT - 2)][face & (LOCAL_MASK >> 2)] = color
        }
    }

    regions.forEach(faces => paint(faces, REGION_COLOR))
    patches.forEach(({ faceType }, slot) => faceType.forEach((type, face) => {
        if (type === FaceType.WALL.index)
        {
            colors[slot][face] = WALL_COLOR
        }
    }))
    corridors.forEach(({ faces }) => paint(faces, CORRIDOR_COLOR))
    rooms.forEach((faces, i) => paint(faces, depths[i] === Infinity ? UNREACHABLE_COLOR : `hsl(${i * 360 / rooms.length} 70% 60%)`))
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


interface Fixtures
{
    exits: LevelExit[]
    chests: FixtureSpot[]
}


/**
 * Draws the level with the roles of its rooms
 *
 * @return function that returns the index of the room at a point on the page, -1 for none
 */
function draw(level: DungeonLevel, roles: RoomRoles, fixtures: Fixtures): (x: number, y: number) => number
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
    const fromScreen = (x: number, y: number): [number, number] => [
        (x - window.innerWidth / 2) / scale + (minX + maxX) / 2,
        (y - window.innerHeight / 2) / scale + (minY + maxY) / 2
    ]

    const colors = faceColors(level, roles)
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

    // the tree of the rooms, from each room to the one it gets reached through
    const marks = rooms.map(faces => toScreen(...roomCenter(patches, faces)))
    ctx.lineCap = "round"
    ctx.strokeStyle = TREE_COLOR
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    roles.parents.forEach((parent, room) => {
        if (parent >= 0)
        {
            ctx.moveTo(...marks[parent])
            ctx.lineTo(...marks[room])
        }
    })
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = MAIN_PATH_COLOR
    ctx.lineWidth = 3
    ctx.beginPath()
    roles.mainPath.forEach(room => ctx.lineTo(...marks[room]))
    ctx.stroke()

    // exits and chests where they stand
    for (const [spots, color, half] of [[fixtures.exits, EXIT_COLOR, 5], [fixtures.chests, CHEST_COLOR, 3.5]] as const)
    {
        ctx.fillStyle = color
        ctx.strokeStyle = LABEL_COLOR
        ctx.lineWidth = 1
        for (const { x, z } of spots as readonly FixtureSpot[])
        {
            const [sx, sy] = toScreen(x / SCALE, z / SCALE)
            ctx.fillRect(sx - half, sy - half, half * 2, half * 2)
            ctx.strokeRect(sx - half, sy - half, half * 2, half * 2)
        }
    }

    // room numbers on a disc colored by role, room 1 grew out of the largest region and has the main exit, the entrance is
    // at the other end of the main path. Rooms that can't be reached have their floor in the color of the role instead.
    const entrance = roles.mainPath[roles.mainPath.length - 1]
    ctx.font = "bold 12px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    marks.forEach(([x, y], room) => {
        if (roles.depths[room] === Infinity)
        {
            return
        }
        ctx.beginPath()
        ctx.arc(x, y, MARK_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = room === entrance ? ENTRANCE_COLOR : room === 0 ? EXIT_COLOR :
            roles.mainPath.includes(room) ? MAIN_PATH_COLOR : ROOM_MARK_COLOR
        ctx.fill()
        ctx.strokeStyle = LABEL_COLOR
        ctx.lineWidth = 1.5
        if (room === roles.farBranch)
        {
            ctx.setLineDash([3, 2])
            ctx.lineWidth = 2.5
        }
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = LABEL_COLOR
        ctx.fillText(String(room + 1), x, y + 0.5)
    })

    return (px, py) => {
        const [x, y] = fromScreen(px, py)
        return rooms.findIndex(faces => faces.some(face => inFace(patches, face, x, y)))
    }
}


/**
 * Returns the middle of the corners of all faces of a room, in patch coordinates
 */
function roomCenter(patches: readonly QuadPatch[], faces: readonly number[]): [number, number]
{
    let x = 0, y = 0
    for (const face of faces)
    {
        const { positions, vertex } = patches[face >> (SLOT_SHIFT - 2)]
        const local = face & (LOCAL_MASK >> 2)
        for (let h = local * 4; h < local * 4 + 4; h++)
        {
            x += positions[vertex[h] * 3]
            y += positions[vertex[h] * 3 + 1]
        }
    }
    const count = faces.length * 4
    return [x / count, y / count]
}


/**
 * Returns whether a point in patch coordinates lies in a face, which is convex
 */
function inFace(patches: readonly QuadPatch[], face: number, x: number, y: number): boolean
{
    const { positions, vertex } = patches[face >> (SLOT_SHIFT - 2)]
    const local = face & (LOCAL_MASK >> 2)
    let sign = 0
    for (let h = local * 4; h < local * 4 + 4; h++)
    {
        const h1 = h === local * 4 + 3 ? local * 4 : h + 1
        const x0 = positions[vertex[h] * 3], y0 = positions[vertex[h] * 3 + 1]
        const x1 = positions[vertex[h1] * 3], y1 = positions[vertex[h1] * 3 + 1]
        const cross = Math.sign((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0))
        if (cross !== 0)
        {
            if (sign !== 0 && cross !== sign)
            {
                return false
            }
            sign = cross
        }
    }
    return true
}


/**
 * Returns the lines of text about a room shown while hovering over it
 */
function describeRoom({ rooms, corridors }: DungeonLevel, roles: RoomRoles, { exits, chests }: Fixtures, room: number): string[]
{
    const { depths, parents, mainPath, farBranch } = roles
    const lines = [`room ${room + 1}, ${rooms[room].length} faces`]
    if (depths[room] === Infinity)
    {
        lines.push("can't be reached")
    }
    else
    {
        lines.push(`${depths[room].toFixed(1)} from the main exit` + (room === 0 ? ", largest room" : `, on the way through room ${parents[room] + 1}`))
        const step = mainPath.length - 1 - mainPath.indexOf(room)
        if (step < mainPath.length)
        {
            lines.push(`main path, step ${step + 1} of ${mainPath.length}` + (step === 0 ? ", entrance" : ""))
        }
        else
        {
            let off = 0
            for (let on = room; !mainPath.includes(on); on = parents[on])
            {
                off++
            }
            lines.push(`${off} ${off === 1 ? "room" : "rooms"} off the main path, from room ${roomOnMainPath(roles, room) + 1}`)
        }
        if (room === farBranch)
        {
            lines.push("far branch")
        }
    }

    const neighbours = corridors.flatMap(({ from, to }) => from === room ? [to] : to === room ? [from] : [])
    lines.push("corridors to " + (neighbours.length > 0 ? neighbours.map(other => other + 1).join(", ") : "nowhere"))
    const children = parents.flatMap((parent, child) => parent === room ? [child + 1] : [])
    if (children.length > 0)
    {
        lines.push("further from the exit: " + children.join(", "))
    }

    exits.forEach((exit, i) => {
        if (exit.room === room)
        {
            lines.push(i === 0 ? "main exit" : "side exit")
        }
    })
    const roomFaces = new Set(rooms[room])
    const chestCount = chests.filter(({ face }) => roomFaces.has(face)).length
    if (chestCount > 0)
    {
        lines.push(chestCount === 1 ? "chest" : `${chestCount} chests`)
    }
    return lines
}


/**
 * Returns the room of the main path a room branches off from
 */
function roomOnMainPath({ parents, mainPath }: RoomRoles, room: number): number
{
    let on = room
    while (!mainPath.includes(on))
    {
        on = parents[on]
    }
    return on
}


loadLevel().then(({ level, seed }) => {
    const roles = findRoomRoles(level.rooms, level.corridors)
    // the same exits and chests as in the game, which takes them from the seed of the level
    const world = new PatchWorld()
    const slots = level.patches.map(patch => world.add(patch))
    const fixtures = placeFixtures(level, world, findWallSegments(world, slots), seed)

    let roomAt = draw(level, roles, fixtures)
    window.addEventListener("resize", () => {
        roomAt = draw(level, roles, fixtures)
    })

    const tooltip = document.getElementById("tooltip")!
    canvas.addEventListener("mousemove", ({ clientX, clientY }) => {
        const room = roomAt(clientX, clientY)
        tooltip.hidden = room < 0
        if (room >= 0)
        {
            tooltip.textContent = describeRoom(level, roles, fixtures, room).join("\n")
            // stays on the page, on the side of the pointer with more room
            tooltip.style.left = (clientX < window.innerWidth / 2 ? clientX + 16 : clientX - 16 - tooltip.offsetWidth) + "px"
            tooltip.style.top = Math.min(clientY + 16, window.innerHeight - tooltip.offsetHeight - 8) + "px"
        }
    })
    canvas.addEventListener("mouseleave", () => {
        tooltip.hidden = true
    })
})
