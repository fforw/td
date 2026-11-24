import {
    ACESFilmicToneMapping,
    Color,
    HemisphereLight,
    PerspectiveCamera,
    Scene,
    Timer,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { loadItems } from "./items/itemSprite"
import { faceCenter } from "./map/dungeonLights"
import { DEFAULT_DUNGEON_STYLE, DUNGEON_HEIGHT, DUNGEON_WIDTH } from "./map/generateDungeon"
import { FACE_SIZE } from "./map/scale"
import { randomLook } from "./meeple/look"
import MeepleCrowd, { LEVEL_MEEPLE_SCALE, type Meeple, MEEPLE_MODELS, randomTraits } from "./meeple/Meeple3D"
import { FIRE_PATTERN_NAMES, FIRE_PATTERNS, type FirePatternName } from "./monster/firePatterns"
import FireRain from "./monster/fireRain"
import { createFloorWalls, seesAcross, wallDistance } from "./map/dungeonWays"
import { SIGIL_RADIUS } from "./monster/sigils"
import { WIZARD } from "./monster/wizards"
import { createLevelMeshes } from "./render/dungeonLevel"
import { flickerHeroLight, flickerLights, moveHeroLight, updateLightField } from "./render/dungeonLighting"
import { loadModels, pixelRatio } from "./render/scene3d"
import FireRainCrowd from "./render/FireRainCrowd"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * Test page for the rain of fire of red wizards, on a hero with a torch in the largest room of a lit dungeon level, at the
 * scale and with the camera angle of the game, e.g.
 * fireRain.html?dungeon=1&room=3&pattern=rings&t=1.3
 *
 * With t it stays at that second after the staff hits the floor. P goes to the next pattern, H holds and continues, Space casts
 * it anew.
 */

const params = new URLSearchParams(location.search)

/**
 * Seconds from the end of a rain to the next one
 */
const PAUSE = 0.6

/**
 * Seconds per step when moving on to a given time
 */
const STEP = 1 / 60

/**
 * Light of the sky, as the game has it
 */
const AMBIENT = 0.2

/**
 * Angle of the camera over the floor and its distance, as the game has them
 */
const CAMERA_ELEVATION = 56 * Math.PI / 180
const CAMERA_DISTANCE = 3

const canvas = document.getElementById("screen") as HTMLCanvasElement
const info = document.getElementById("info")!

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(pixelRatio())
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = ACESFilmicToneMapping

const scene = new Scene()
scene.background = new Color("#050508")
const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

let held = params.has("t")
let pattern = Math.max(0, FIRE_PATTERN_NAMES.indexOf(params.get("pattern") as FirePatternName))
let seconds = 0
let pause = 0


async function start(): Promise<void>
{
    const seed = Number(params.get("dungeon") ?? 1)
    await Promise.all([loadModels(MEEPLE_MODELS), loadItems()])
    const level = await new MapWorkerClient().buildDungeon(seed, FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT, DEFAULT_DUNGEON_STYLE, true)
    const { world, meshes, field, segments } = createLevelMeshes(level)
    scene.add(...meshes)
    scene.add(new HemisphereLight("#8fa0d0", "#303048", AMBIENT))

    const { rooms } = level
    const room = params.has("room")
        ? Number(params.get("room"))
        : rooms.reduce((best, faces, i) => faces.length > rooms[best].length ? i : best, 0)
    // the face of the room closest to its middle
    const centers = rooms[room].map(face => faceCenter(world, face))
    const midX = centers.reduce((sum, [x]) => sum + x, 0) / centers.length
    const midZ = centers.reduce((sum, [, z]) => sum + z, 0) / centers.length
    const [x, z] = centers.reduce((a, b) => Math.hypot(b[0] - midX, b[1] - midZ) < Math.hypot(a[0] - midX, a[1] - midZ) ? b : a)

    const crowd = new MeepleCrowd(1, LEVEL_MEEPLE_SCALE)
    crowd.setLightField(field)
    const hero: Meeple = { position: new Vector3(x, 0, z), facing: 0, look: randomLook(), phase: 0, ...randomTraits() }
    crowd.add(hero)
    scene.add(crowd.group)

    const seeing = createFloorWalls(segments, SIGIL_RADIUS)
    const rain = new FireRain({
        sees: (x0, z0, x1, z1) => seesAcross(seeing, x0, z0, x1, z1),
        wallDistance: (px, pz) => wallDistance(seeing, px, pz)
    })
    const fireCrowd = new FireRainCrowd()
    scene.add(fireCrowd.group)

    function cast(): void
    {
        rain.drops.length = 0
        seconds = 0
        pause = 0
        // as a wizard off to the side has it
        const spots = FIRE_PATTERNS[FIRE_PATTERN_NAMES[pattern]]({ x, z, fromX: x - WIZARD.keepAway, fromZ: z })
        rain.cast(spots, x, z, WIZARD.fireDamage)
    }

    function advance(delta: number): void
    {
        seconds += delta
        rain.update(delta)
    }

    cast()
    while (seconds < Number(params.get("t") ?? 0))
    {
        advance(STEP)
    }

    controls.target.set(x, 0, z)
    camera.position.set(x, Math.sin(CAMERA_ELEVATION) * CAMERA_DISTANCE, z + Math.cos(CAMERA_ELEVATION) * CAMERA_DISTANCE)
    controls.update()

    window.addEventListener("keydown", event => {
        if (event.key === "p")
        {
            pattern = (pattern + 1) % FIRE_PATTERN_NAMES.length
            cast()
        }
        else if (event.key === "h")
        {
            held = !held
        }
        else if (event.key === " ")
        {
            cast()
        }
    })

    const lights = level.lighting!.lights
    const timer = new Timer()
    renderer.setAnimationLoop(time => {
        timer.update(time)
        if (!held)
        {
            const delta = Math.min(timer.getDelta(), 0.1)
            advance(delta)
            pause += rain.drops.length === 0 ? delta : 0
            if (pause > PAUSE)
            {
                cast()
            }
        }
        fireCrowd.update(rain.drops)
        const elapsed = timer.getElapsed()
        flickerLights(field, lights, elapsed)
        moveHeroLight(field, segments, x, z)
        flickerHeroLight(field, elapsed)
        updateLightField(renderer, field)
        crowd.update(camera, elapsed)
        controls.update()
        renderer.render(scene, camera)
        info.textContent = seconds.toFixed(2) + "s, " + FIRE_PATTERN_NAMES[pattern] + " (P), " + rain.drops.length + " strikes, "
            + (rain.damageAt(x, z) > 0 ? "hurts" : "harmless") + ", " + (held ? "held" : "cycling")
            + " (H), cast (Space), seed " + seed + ", room " + room
    })
    Object.assign(window, { rain })
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

void start()
