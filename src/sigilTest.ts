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
import { SIGIL_RADIUS } from "./monster/sigils"
import { createLevelMeshes } from "./render/dungeonLevel"
import { flickerHeroLight, flickerLights, moveHeroLight, updateLightField } from "./render/dungeonLighting"
import { loadModels, pixelRatio } from "./render/scene3d"
import Sigil, { sigilColor } from "./render/sigil"
import { SIGIL_ACTIVE, SIGIL_DRAW, SIGIL_FADE, sigilPhase } from "./render/sigilShape"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * Test page for the sigil of blue wizards, under a hero with a torch in the largest room of a lit dungeon level, at the
 * scale and with the camera angle of the game, e.g.
 * sigil.html?dungeon=1&room=3&radius=0.3&t=1.3
 *
 * With t it stays at that second of its time. C picks another hue, H holds and continues, Space casts it anew.
 */

const params = new URLSearchParams(location.search)

/**
 * Radius in world units
 */
const RADIUS = Number(params.get("radius") ?? SIGIL_RADIUS)

/**
 * Seconds from one cast to the next
 */
const CYCLE = SIGIL_DRAW + SIGIL_ACTIVE + SIGIL_FADE + 0.8

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
let seconds = Number(params.get("t") ?? 0)


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

    // beside the middle, so most of the sigil shows
    const heroX = x + RADIUS * 0.3
    const crowd = new MeepleCrowd(1, LEVEL_MEEPLE_SCALE)
    crowd.setLightField(field)
    const hero: Meeple = { position: new Vector3(heroX, 0, z), facing: 0, look: randomLook(), phase: 0, ...randomTraits() }
    crowd.add(hero)
    scene.add(crowd.group)

    const sigil = new Sigil(sigilColor(0.5))
    sigil.place(x, z, RADIUS)
    scene.add(sigil.group)

    controls.target.set(x, 0, z)
    camera.position.set(x, Math.sin(CAMERA_ELEVATION) * CAMERA_DISTANCE, z + Math.cos(CAMERA_ELEVATION) * CAMERA_DISTANCE)
    controls.update()

    window.addEventListener("keydown", event => {
        if (event.key === "c")
        {
            sigil.setColor(sigilColor(Math.random()))
        }
        else if (event.key === "h")
        {
            held = !held
        }
        else if (event.key === " ")
        {
            seconds = 0
        }
    })

    const lights = level.lighting!.lights
    const timer = new Timer()
    renderer.setAnimationLoop(time => {
        timer.update(time)
        if (!held)
        {
            seconds = (seconds + Math.min(timer.getDelta(), 0.1)) % CYCLE
        }
        sigil.update(seconds)
        const elapsed = timer.getElapsed()
        flickerLights(field, lights, elapsed)
        moveHeroLight(field, segments, heroX, z)
        flickerHeroLight(field, elapsed)
        updateLightField(renderer, field)
        crowd.update(camera, elapsed)
        controls.update()
        renderer.render(scene, camera)
        info.textContent = seconds.toFixed(2) + "s, " + (sigilPhase(seconds).hurts ? "hurts" : "harmless")
            + ", hue (C), " + (held ? "held" : "cycling") + " (H), cast (Space), seed " + seed + ", room " + room
    })
    Object.assign(window, { sigil })
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

void start()
