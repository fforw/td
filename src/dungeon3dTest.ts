import "./style.css"
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
import { loadLevel } from "./dungeonPage"
import { loadItems } from "./items/itemSprite"
import { faceCenter } from "./map/dungeonLights"
import type { DungeonLevel } from "./map/generateDungeon"
import type PatchWorld from "./map/PatchWorld"
import { faceOf } from "./map/QuadPatch"
import { randomLook } from "./meeple/look"
import MeepleCrowd, { type Meeple, MEEPLE_MODELS, MEEPLE_SCALE, randomTraits, walkSpeedMultiplier } from "./meeple/Meeple3D"
import { createLevelMeshes } from "./render/dungeonLevel"
import {
    discoLights,
    flickerHeroLight,
    flickerLights,
    heroBurn,
    hideHeroLight,
    moveHeroLight,
    steadyLights,
    updateLightField
} from "./render/dungeonLighting"
import { loadModels, pixelRatio, SCALE } from "./render/scene3d"

const TAU = Math.PI * 2

/*
 * Test page for a dungeon level in 3D, e.g. dungeon3d.html?seed=1&width=3&height=2&floor=0.5&labyrinth=5
 */

/**
 * Most meeples walking around the level. They only take rooms and corridors that are long enough.
 */
const MEEPLES = 40

/**
 * Walking speed in world units per second for a meeple with a walk speed multiplier of 1
 */
const WALK_AHEAD_SPEED = MEEPLE_SCALE * 1.5

const AMBIENT = 0.2

const level = loadLevel(true)

// module scripts are deferred, so the DOM is ready at this point
const canvas = document.getElementById("screen") as HTMLCanvasElement

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(pixelRatio())
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = ACESFilmicToneMapping

const scene = new Scene()
scene.background = new Color("#050508")
scene.add(new HemisphereLight("#8fa0d0", "#303048", AMBIENT))

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.screenSpacePanning = false


/**
 * Meeple going back and forth along a way through face centers
 */
interface Walker
{
    meeple: Meeple
    way: [number, number][]
    /**
     * Position on the way, in pieces of it
     */
    at: number
    direction: number
}


/**
 * Returns a way through the faces of the room from its first face to the one furthest from there
 */
function wayThroughRoom(world: PatchWorld, room: readonly number[]): number[]
{
    const faces = new Set(room)
    const cameFrom = new Map<number, number>([[room[0], -1]])
    const open = [room[0]]
    let last = room[0]
    for (let i = 0; i < open.length; i++)
    {
        last = open[i]
        for (let h = last * 4; h < last * 4 + 4; h++)
        {
            const other = faceOf(world.twin(h))
            if (faces.has(other) && !cameFrom.has(other))
            {
                cameFrom.set(other, last)
                open.push(other)
            }
        }
    }

    const way: number[] = []
    for (let face = last; face >= 0; face = cameFrom.get(face)!)
    {
        way.push(face)
    }
    return way
}


function createWalkers(world: PatchWorld, { rooms, corridors }: DungeonLevel, crowd: MeepleCrowd): Walker[]
{
    const ways = [...corridors.map(({ faces }) => faces), ...rooms.map(room => wayThroughRoom(world, room))]
        .filter(way => way.length >= 5)
        .slice(0, MEEPLES)

    return ways.map(way => {
        const centers = way.map(face => faceCenter(world, face))
        const meeple: Meeple = {
            position: new Vector3(centers[0][0], 0, centers[0][1]),
            facing: 0,
            look: randomLook(),
            phase: Math.random() * TAU,
            ...randomTraits()
        }
        crowd.add(meeple)
        return { meeple, way: centers, at: Math.random() * (centers.length - 1), direction: 1 }
    })
}


function moveWalker(walker: Walker, dt: number): void
{
    const { meeple, way } = walker
    let piece = Math.min(way.length - 2, Math.floor(walker.at))
    const [x0, z0] = way[piece], [x1, z1] = way[piece + 1]
    const length = Math.hypot(x1 - x0, z1 - z0)

    walker.at += walker.direction * WALK_AHEAD_SPEED * walkSpeedMultiplier(meeple) * dt / length
    if (walker.at <= 0 || walker.at >= way.length - 1)
    {
        walker.at = Math.max(0, Math.min(way.length - 1, walker.at))
        walker.direction = -walker.direction
    }

    piece = Math.min(way.length - 2, Math.floor(walker.at))
    const s = walker.at - piece
    const [ax, az] = way[piece], [bx, bz] = way[piece + 1]
    meeple.position.set(ax + (bx - ax) * s, 0, az + (bz - az) * s)
    meeple.facing = Math.atan2((bx - ax) * walker.direction, (bz - az) * walker.direction)
}


function show(level: DungeonLevel): void
{
    const { patches, lighting } = level
    const { world, meshes, field, segments } = createLevelMeshes(level)
    scene.add(...meshes)

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
    const centerX = (minX + maxX) / 2 * SCALE
    const centerZ = (minY + maxY) / 2 * SCALE
    const size = Math.max(maxX - minX, maxY - minY) * SCALE
    controls.target.set(centerX, 0, centerZ)
    camera.position.set(centerX, size * 1.1, centerZ + size * 0.6)

    const crowd = new MeepleCrowd(MEEPLES)
    const walkers = createWalkers(world, level, crowd)
    crowd.walking = true
    crowd.setLightField(field)
    scene.add(crowd.group)

    // follow one meeple after the other from close up, the one we follow carries the hero light
    let followed = -1
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = "next meeple"
    button.addEventListener("click", () => {
        followed = (followed + 1) % walkers.length
        const { position } = walkers[followed].meeple
        controls.target.copy(position)
        camera.position.set(position.x, position.y + 1.6, position.z + 1.6)
    })

    const heroLight = document.createElement("input")
    heroLight.type = "checkbox"
    heroLight.checked = true
    // seconds the hero light has been on since it was lit
    let heroBurnt = 0
    heroLight.addEventListener("change", () => {
        heroBurnt = 0
        if (!heroLight.checked)
        {
            hideHeroLight(field)
        }
    })
    const heroLightLabel = document.createElement("label")
    heroLightLabel.append(heroLight, " hero light")

    const { lights } = lighting!
    let lightMode = "flicker"
    const lightModes = ["off", "flicker", "disco"].flatMap(mode => {
        const radio = document.createElement("input")
        radio.type = "radio"
        radio.name = "light-mode"
        radio.checked = mode === lightMode
        radio.addEventListener("change", () => {
            lightMode = mode
            if (mode === "off")
            {
                steadyLights(field, lights)
            }
        })
        const label = document.createElement("label")
        label.append(radio, ` ${mode}`)
        return [" ", label]
    })
    document.getElementById("ui")!.append(button, " ", heroLightLabel, ...lightModes)

    const timer = new Timer()
    const step = new Vector3()
    renderer.setAnimationLoop(t => {
        timer.update(t)
        // limit the step after the tab was in the background
        const dt = Math.min(0.1, timer.getDelta())
        for (const walker of walkers)
        {
            if (walkers[followed] === walker)
            {
                step.copy(walker.meeple.position)
                moveWalker(walker, dt)
                step.subVectors(walker.meeple.position, step)
                controls.target.add(step)
                camera.position.add(step)
            }
            else
            {
                moveWalker(walker, dt)
            }
        }
        const hero = walkers[Math.max(followed, 0)]?.meeple
        if (hero && heroLight.checked)
        {
            heroBurnt += dt
            const burn = heroBurn(heroBurnt)
            moveHeroLight(field, segments, hero.position.x, hero.position.z)
            flickerHeroLight(field, timer.getElapsed(), burn)
            if (burn === 0)
            {
                heroLight.checked = false
                hideHeroLight(field)
            }
        }
        if (lightMode === "flicker")
        {
            flickerLights(field, lights, timer.getElapsed())
        }
        else if (lightMode === "disco")
        {
            discoLights(field, lights, timer.getElapsed())
        }
        updateLightField(renderer, field)
        controls.update()
        crowd.update(camera, timer.getElapsed())
        renderer.render(scene, camera)
    })
}


window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

Promise.all([level, loadModels(MEEPLE_MODELS), loadItems()]).then(([{ level }]) => show(level))
