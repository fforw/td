import { DEFAULT_DUNGEON_STYLE, DUNGEON_HEIGHT, DUNGEON_WIDTH, type DungeonLevel } from "./map/generateDungeon"
import { faceCount } from "./map/QuadPatch"
import { FACE_SIZE } from "./map/scale"
import { randomSeed } from "./math/random"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * What the test pages of dungeon levels have in common. They take the same parameters, e.g.
 * ?seed=1&width=3&height=2&floor=0.5&labyrinth=5
 */

function sizeParam(params: URLSearchParams, name: string, fallback: number): number
{
    return Math.max(1, Math.floor(Number(params.get(name) ?? fallback)) || fallback)
}


/**
 * Generates the level the page parameters ask for and sets up the parts of the page around it: the numbers of the level,
 * the button for a new seed and the link to the same level on the other page.
 *
 * @param lit   whether to also place and bake the lights of the level
 *
 * @return generated level with its seed, which is random without a parameter for it
 */
export function loadLevel(lit = false): Promise<{ level: DungeonLevel, seed: number }>
{
    const params = new URLSearchParams(location.search)
    const seed = randomSeed(params.has("seed") ? Number(params.get("seed")) : null)
    const width = sizeParam(params, "width", DUNGEON_WIDTH)
    const height = sizeParam(params, "height", DUNGEON_HEIGHT)
    const floorShare = Number(params.get("floor") ?? DEFAULT_DUNGEON_STYLE.floorShare)
    const labyrinth = Number(params.get("labyrinth") ?? DEFAULT_DUNGEON_STYLE.labyrinth)

    params.set("seed", String(seed))
    document.querySelector<HTMLAnchorElement>("#footer .same-level")!.search = params.toString()

    document.getElementById("new-seed")!.addEventListener("click", () => {
        params.set("seed", String(randomSeed()))
        location.search = params.toString()
    })

    return new MapWorkerClient().buildDungeon(seed, FACE_SIZE, width, height, { floorShare, labyrinth }, lit).then(level => {
        const { patches, regions, rooms, corridors, lighting } = level
        const faces = patches.reduce((sum, patch) => sum + faceCount(patch), 0)
        const roomFaces = rooms.reduce((sum, room) => sum + room.length, 0)
        const corridorFaces = corridors.reduce((sum, corridor) => sum + corridor.faces.length, 0)
        const percent = (count: number) => Math.round(count * 100 / faces) + "%"
        document.getElementById("info")!.textContent =
            `seed ${seed}, ${width} x ${height} patches, ${faces} faces, ${regions.length} regions, ` +
            `${rooms.length} rooms ${percent(roomFaces)}, ${corridors.length} corridors ${percent(corridorFaces)}` +
            (lighting ? `, ${lighting.lights.length} lights` : "")
        return { level, seed }
    })
}
