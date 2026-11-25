import {
    ACESFilmicToneMapping,
    AnimationClip,
    AnimationMixer,
    BoxGeometry,
    Color,
    CylinderGeometry,
    HemisphereLight,
    LoopOnce,
    Mesh,
    MeshStandardMaterial,
    type Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
    Timer,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { loadItems } from "./items/itemSprite"
import { faceCenter } from "./map/dungeonLights"
import { DEFAULT_DUNGEON_STYLE, DUNGEON_HEIGHT, DUNGEON_WIDTH } from "./map/generateDungeon"
import type PatchWorld from "./map/PatchWorld"
import { FACE_SIZE } from "./map/scale"
import { randomLook } from "./meeple/look"
import MeepleCrowd, { LEVEL_MEEPLE_SCALE, type Meeple, MEEPLE_MODELS, randomTraits } from "./meeple/Meeple3D"
import { type Robe, WIZARD } from "./monster/wizards"
import { ROBE_COLORS, STAFF_LENGTH } from "./monster/WizardCrowd"
import { skinnedFigure } from "./monster/skinnedFigure"
import Beam, { type BeamLook } from "./render/beam"
import { BEAM_FIRE, beamCastTime, beamPhase } from "./render/beamTiming"
import GlowView, { GLOW_RADIUS, GLOW_STRENGTH } from "./render/glowView"
import { createLevelMeshes } from "./render/dungeonLevel"
import { flickerHeroLight, flickerLights, moveHeroLight, updateLightField } from "./render/dungeonLighting"
import { animations, loadModels, model, pixelRatio } from "./render/scene3d"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * Test page for the wizard's beam, with and without bloom. By default the wizard stands in an empty room at scale 1, with
 * dungeon=SEED it stands in a room of a lit dungeon level at the scale of the game and fires at a hero with a torch, e.g.
 * beam.html?robe=red&width=0.35&bloom=off&hold=1
 * beam.html?dungeon=1&strength=0.6&radius=0.3
 * beam.html?dungeon=1&room=3&hold=1&look=pixels
 *
 * B turns the bloom on and off, C goes through the robe colors, H holds the beam, L switches between the looks around the glow.
 */

const params = new URLSearchParams(location.search)
const ROBES = Object.keys(ROBE_COLORS) as Robe[]
let robe = ROBES.find(robe => robe === params.get("robe")) ?? "purple"
let hold = params.get("hold") === "1"
const LOOKS: BeamLook[] = ["shell", "pixels"]

/**
 * Width of the beam in world units, with the wizard at scale 1
 */
const BEAM_WIDTH = Number(params.get("width") ?? 0.35)

/**
 * Seconds of the cast: the staff swings down, stays there while the beam lasts until FADE, swings back up and the
 * wizard rests until CYCLE
 */
const FADE = 2.2
const CYCLE = 3.6

/**
 * Light of the sky in the empty room, and in a dungeon level as the game has it
 */
const ROOM_AMBIENT = 0.5
const LEVEL_AMBIENT = 0.2

/**
 * Where the beam hits a hero, in meeple units: the height of the chest, and how far in front of the middle
 */
const HIT_HEIGHT = 0.55
const HIT_FRONT = 0.15

/**
 * Angle of the camera over the floor in a dungeon level, and how far it is from the middle of the beam in world units
 */
const CAMERA_ELEVATION = 60 * Math.PI / 180
const CAMERA_DISTANCE = 2

const canvas = document.getElementById("screen") as HTMLCanvasElement
const info = document.getElementById("info")!

const renderer = new WebGLRenderer({ canvas })
renderer.setPixelRatio(pixelRatio())
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = ACESFilmicToneMapping

const scene = new Scene()
scene.background = new Color("#050508")

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

const view = new GlowView(
    renderer,
    scene,
    camera,
    Number(params.get("strength") ?? GLOW_STRENGTH),
    Number(params.get("radius") ?? GLOW_RADIUS)
)
view.enabled = params.get("bloom") !== "off"


/**
 * Where the wizard stands and what is around it
 */
interface Stage
{
    /** the wizard's model, placed */
    wizard: Object3D
    /** where the beam hits */
    target: Vector3
    /** scale of the wizard */
    scale: number
    /** what else there is to say about it */
    info: string
    setRobe(color: Color): void
    /** moves the lights and figures around */
    update(time: number): void
}


/**
 * An empty room at scale 1 with a pillar to fire at
 */
function roomStage(): Stage
{
    const target = new Vector3(-0.3, 0.55, 3.5)
    scene.add(new HemisphereLight("#8fa0d0", "#303048", ROOM_AMBIENT))
    const stone = new MeshStandardMaterial({ color: "#4a4540", roughness: 0.9 })
    const floor = new Mesh(new PlaneGeometry(12, 12), stone)
    floor.rotation.x = -Math.PI / 2
    floor.position.z = 2
    const pillar = new Mesh(new CylinderGeometry(0.22, 0.25, 1.6, 24), stone)
    pillar.position.set(target.x, 0.8, target.z + 0.22)
    const wall = new Mesh(new BoxGeometry(6, 2, 0.3), stone)
    wall.position.set(0, 1, target.z + 1.2)
    scene.add(floor, pillar, wall)

    camera.position.set(2.6, 1.3, -1)
    controls.target.set(-0.2, 0.6, 1.5)

    const wizard = model("wizard")
    const robes: MeshStandardMaterial[] = []
    wizard.traverse(obj => {
        const mesh = obj as Mesh
        if (mesh.isMesh && (mesh.material as MeshStandardMaterial).name === "Robe")
        {
            mesh.material = (mesh.material as MeshStandardMaterial).clone()
            robes.push(mesh.material as MeshStandardMaterial)
        }
    })
    return {
        wizard,
        target,
        scale: 1,
        info: "",
        setRobe: color => robes.forEach(robe => robe.color.copy(color)),
        update: () => {}
    }
}


/**
 * Returns the room to fire in, with the faces where the wizard stands and where it fires to. It's the given room, or the
 * smallest one where the wizard can stand as far off as it keeps away from heroes.
 */
function pickRoom(world: PatchWorld, rooms: readonly number[][], wanted: number | null): { room: number, from: [number, number], to: [number, number] }
{
    let best: { room: number, from: [number, number], to: [number, number] } | undefined
    let bestLength = Infinity
    rooms.forEach((faces, room) => {
        if (wanted !== null && room !== wanted)
        {
            return
        }
        const centers = faces.map(face => faceCenter(world, face))
        let length = -1
        let from = centers[0], to = centers[0]
        for (const a of centers)
        {
            for (const b of centers)
            {
                const d = Math.hypot(b[0] - a[0], b[1] - a[1])
                if (d > length)
                {
                    length = d
                    from = a
                    to = b
                }
            }
        }
        if (wanted !== null || length >= WIZARD.keepAway && length < bestLength)
        {
            bestLength = length
            best = { room, from, to }
        }
    })
    if (!best)
    {
        throw new Error("no room for the wizard")
    }
    return best
}


/**
 * A room of a lit dungeon level at the scale of the game, with a hero to fire at
 */
async function dungeonStage(seed: number): Promise<Stage>
{
    const level = await new MapWorkerClient().buildDungeon(seed, FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT, DEFAULT_DUNGEON_STYLE, true)
    const { world, meshes, field, segments } = createLevelMeshes(level)
    scene.add(...meshes)
    scene.add(new HemisphereLight("#8fa0d0", "#303048", LEVEL_AMBIENT))

    const { room, from, to } = pickRoom(world, level.rooms, params.has("room") ? Number(params.get("room")) : null)
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const dx = (to[0] - from[0]) / length, dz = (to[1] - from[1]) / length
    const distance = Math.min(length, WIZARD.keepAway)
    const heroX = from[0] + dx * distance, heroZ = from[1] + dz * distance

    const crowd = new MeepleCrowd(1, LEVEL_MEEPLE_SCALE)
    crowd.setLightField(field)
    const hero: Meeple = {
        position: new Vector3(heroX, 0, heroZ),
        facing: Math.atan2(-dx, -dz),
        look: randomLook(),
        phase: 0,
        ...randomTraits()
    }
    crowd.add(hero)
    scene.add(crowd.group)

    const scale = WIZARD.scale * LEVEL_MEEPLE_SCALE
    const figure = skinnedFigure("wizard", field)
    // nothing draws the silhouettes in front of them here
    figure.rim.visible = figure.fill.visible = false
    const wizard = figure.root
    wizard.position.set(from[0], 0, from[1])
    wizard.rotation.y = Math.atan2(dx, dz)
    wizard.scale.setScalar(scale)

    // steeply from the side, over the walls, as there is nothing to make them see-through
    const midX = (from[0] + heroX) / 2, midZ = (from[1] + heroZ) / 2
    controls.target.set(midX, 0.1, midZ)
    const away = Math.cos(CAMERA_ELEVATION) * CAMERA_DISTANCE
    camera.position.set(midX + dz * away, Math.sin(CAMERA_ELEVATION) * CAMERA_DISTANCE, midZ - dx * away)

    const target = new Vector3(heroX - dx * HIT_FRONT * LEVEL_MEEPLE_SCALE, HIT_HEIGHT * LEVEL_MEEPLE_SCALE, heroZ - dz * HIT_FRONT * LEVEL_MEEPLE_SCALE)
    const lights = level.lighting!.lights
    return {
        wizard,
        target,
        scale,
        info: ", seed " + seed + ", room " + room,
        setRobe: color => {
            for (const body of figure.bodies)
            {
                if (body.material.name === "Robe")
                {
                    body.color.copy(color)
                    body.material.color.copy(color)
                }
            }
        },
        update: time => {
            flickerLights(field, lights, time)
            moveHeroLight(field, segments, heroX, heroZ)
            flickerHeroLight(field, time)
            updateLightField(renderer, field)
            crowd.update(camera, time)
        }
    }
}


async function start(): Promise<void>
{
    const dungeon = params.get("dungeon")
    await Promise.all([loadModels(dungeon ? ["wizard", ...MEEPLE_MODELS] : ["wizard"]), dungeon && loadItems()])
    const stage = dungeon ? await dungeonStage(Number(dungeon)) : roomStage()
    const { wizard, target } = stage
    stage.setRobe(new Color(ROBE_COLORS[robe]))
    scene.add(wizard)
    controls.update()

    const beam = new Beam(new Color(ROBE_COLORS[robe]), BEAM_WIDTH * stage.scale)
    beam.look = LOOKS.find(look => look === params.get("look")) ?? "shell"
    scene.add(beam.group)

    const staff = wizard.getObjectByName("Staff") as Object3D
    const mixer = new AnimationMixer(wizard)
    const clip = AnimationClip.findByName([...animations("wizard")], "cast-2")
    const cast = clip && mixer.clipAction(clip)
    if (cast)
    {
        cast.setLoop(LoopOnce, 1)
        cast.clampWhenFinished = true
        cast.timeScale = 0
        cast.play()
    }
    else
    {
        console.warn("the wizard model has no cast-2, so the staff stays up")
    }

    function showInfo(): void
    {
        info.textContent = "bloom " + (view.enabled ? "on" : "off") + " (B), robe " + robe + " (C), " + (hold ? "held" : "cycling") + " (H), " + beam.look + " (L)" + stage.info
    }

    window.addEventListener("keydown", event => {
        if (event.key === "b")
        {
            view.enabled = !view.enabled
        }
        else if (event.key === "c")
        {
            robe = ROBES[(ROBES.indexOf(robe) + 1) % ROBES.length]
            beam.setColor(new Color(ROBE_COLORS[robe]))
            stage.setRobe(new Color(ROBE_COLORS[robe]))
        }
        else if (event.key === "h")
        {
            hold = !hold
        }
        else if (event.key === "l")
        {
            beam.look = LOOKS[(LOOKS.indexOf(beam.look) + 1) % LOOKS.length]
        }
        showInfo()
    })

    const timer = new Timer()
    const tip = new Vector3()
    renderer.setAnimationLoop(time => {
        timer.update(time)
        const delta = Math.min(timer.getDelta(), 0.1)
        const seconds = timer.getElapsed()
        const t = seconds % CYCLE
        if (cast)
        {
            cast.time = beamCastTime(hold ? BEAM_FIRE * 2 : t, hold ? Infinity : FADE)
            mixer.update(0)
        }
        wizard.updateMatrixWorld(true)
        staff.localToWorld(tip.set(0, STAFF_LENGTH, 0))
        const { charge, strength } = beamPhase(hold ? BEAM_FIRE * 2 : t, hold ? Infinity : FADE)
        beam.update(tip, target, charge, strength, seconds, delta)
        stage.update(seconds)
        controls.update()
        view.render(true)
    })
    showInfo()
    Object.assign(window, { beam, stage })
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

void start()
