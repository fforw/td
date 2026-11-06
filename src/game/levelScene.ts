import {
    ACESFilmicToneMapping,
    Color,
    HemisphereLight,
    PerspectiveCamera,
    Plane,
    Raycaster,
    Scene,
    Spherical,
    Vector2,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { faceCenter } from "../map/dungeonLights"
import { entranceFace, findFaces, nextFace } from "../map/dungeonWays"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, type DungeonLevel } from "../map/generateDungeon"
import { tautPath } from "../map/route"
import MeepleCrowd, { type Meeple, MEEPLE_MODELS, MEEPLE_SCALE, type MeepleLook, walkSpeedMultiplier } from "../meeple/Meeple3D"
import { createLevelMeshes, type LevelMeshes } from "../render/dungeonLevel"
import { flickerLights, moveHeroLight, updateLightField } from "../render/dungeonLighting"
import { FACE_SIZE, loadModels, pixelRatio, SCALE } from "../render/scene3d"
import MapWorkerClient from "../worker/MapWorkerClient"
import type { Direction } from "./gamepad"
import { Walk } from "./journey"

const TAU = Math.PI * 2

const AMBIENT = 0.2

/**
 * Most heroes in one level
 */
const MAX_HEROES = 16

/**
 * Walking speed in world units per second for a meeple with a walk speed multiplier of 1
 */
const WALK_SPEED = MEEPLE_SCALE * 1.5

/**
 * Fastest a meeple turns while walking, in radians per second
 */
const TURN_RATE = 10

/**
 * Camera offset from the hero, in world units
 */
const CAMERA_OFFSET = new Vector3(0, 3.2, 3.2)

const MIN_DISTANCE = 1.5
const MAX_DISTANCE = 10

/**
 * Most a pointer may move in pixels for a press to count as a click
 */
const CLICK_DISTANCE = 5

/**
 * Longest time in seconds a single frame moves things for
 */
const MAX_FRAME_TIME = 0.1

/**
 * How close to the end of a way in world units someone can already be told where to go next, without stopping there.
 * Has to be further than a held direction gets between its repeats.
 */
const CHAIN_DISTANCE = 0.3

const FLOOR = new Plane(new Vector3(0, 1, 0), 0)

const walkPosition: number[] = []
const hit = new Vector3()

/**
 * Directions on the screen as x and z in the view of a camera looking toward -z
 */
const SCREEN_DIRECTIONS: Record<Direction, [number, number]> = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
}

/**
 * Hero in the level
 */
export interface LevelHero
{
    id: number
    look: MeepleLook
    /** walking style, see Meeple */
    gait: number
    /** dexterity */
    dex: number
    /** global id of the face to stand on, the entrance without it */
    face?: number
}

interface ShownHero
{
    meeple: Meeple
    /** faces of the way being walked, or just the one the hero stands on */
    faces: number[]
    walk: Walk | null
    /** on the way out of the level */
    leaving: boolean
}


/**
 * A dungeon level in 3D with the heroes inside. The view stays with one of them, who carries the hero light and goes where
 * they are told. Like the castle scene it has a canvas of its own, which saves the two from knowing about each other's
 * lights and materials.
 */
export default class LevelScene
{
    readonly element: HTMLCanvasElement

    private readonly renderer: WebGLRenderer
    private readonly scene = new Scene()
    private readonly camera: PerspectiveCamera
    private readonly controls: OrbitControls
    private readonly client = new MapWorkerClient()
    private readonly raycaster = new Raycaster()
    private readonly pointer = new Vector2()
    private readonly lookAngles = new Spherical()

    /** null until the level is there */
    private level: DungeonLevel | null = null
    private meshes: LevelMeshes | null = null
    private crowd: MeepleCrowd | null = null
    private slots: number[] = []
    private entrance = 0

    /** every face that can be walked on */
    private floor: number[] = []

    private heroes: LevelHero[] = []
    private readonly shown = new Map<number, ShownHero>()

    /** id of the hero the view stays with */
    private focus: number | null = null
    /** where the view last saw that hero */
    private readonly focusAt = new Vector3()
    /** the camera has to get to the hero first */
    private unplaced = true

    private running = false
    private lastFrame = 0

    /** canvas size the renderer was last set to */
    private width = 0
    private height = 0

    /**
     * @param seed      seed of the level
     * @param onMoved   called when a hero got to a face
     * @param onLeft    called when a hero told to leave has got out
     */
    constructor(
        seed: number,
        private readonly onMoved: (id: number, face: number) => void,
        private readonly onLeft: (id: number) => void
    )
    {
        const canvas = document.createElement("canvas")
        canvas.className = "level-scene"
        this.element = canvas

        const renderer = new WebGLRenderer({ canvas, antialias: true })
        renderer.setPixelRatio(pixelRatio())
        renderer.toneMapping = ACESFilmicToneMapping
        this.renderer = renderer

        this.scene.background = new Color("#050508")
        this.scene.add(new HemisphereLight("#8fa0d0", "#303048", AMBIENT))

        this.camera = new PerspectiveCamera(40, 1, 0.1, 500)

        const controls = new OrbitControls(this.camera, canvas)
        controls.enableDamping = true
        controls.enablePan = false
        controls.maxPolarAngle = Math.PI * 0.45
        controls.minDistance = MIN_DISTANCE
        controls.maxDistance = MAX_DISTANCE
        this.controls = controls

        this.listen(canvas)

        Promise.all([
            this.client.buildDungeon(seed, FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT, {}, true),
            loadModels(MEEPLE_MODELS)
        ]).then(
            ([level]) => this.addLevel(level),
            err => console.error("Building level " + seed + " failed", err)
        )
    }

    private addLevel(level: DungeonLevel): void
    {
        const meshes = createLevelMeshes(level)
        this.level = level
        this.meshes = meshes
        this.scene.add(...meshes.meshes)
        this.slots = level.patches.map((_, slot) => slot)
        this.entrance = entranceFace(meshes.world, level)
        this.floor = [...level.rooms.flat(), ...level.corridors.flatMap(({ faces }) => faces)]

        const crowd = new MeepleCrowd(MAX_HEROES)
        crowd.setLightField(meshes.field)
        this.scene.add(crowd.group)
        this.crowd = crowd

        this.setHeroes(this.heroes)
        this.client.terminate()
    }

    /**
     * Sets who is in the level. Someone already there goes on from where they are.
     */
    setHeroes(heroes: LevelHero[]): void
    {
        this.heroes = heroes
        const { crowd, shown, meshes } = this
        if (!crowd || !meshes)
        {
            return
        }
        for (const [id, { meeple }] of shown)
        {
            if (!heroes.some(hero => hero.id === id))
            {
                crowd.remove(meeple)
                shown.delete(id)
            }
        }
        for (const { id, look, gait, dex, face = this.entrance } of heroes)
        {
            if (!shown.has(id))
            {
                const [x, z] = faceCenter(meshes.world, face)
                const meeple: Meeple = {
                    position: new Vector3(x, 0, z),
                    facing: 0,
                    look,
                    phase: id,
                    name: "",
                    gait,
                    dex,
                    walking: false
                }
                crowd.add(meeple)
                shown.set(id, { meeple, faces: [face], walk: null, leaving: false })
            }
        }
    }

    /**
     * Binds the view to the hero with the given id
     */
    setFocus(id: number): void
    {
        if (id !== this.focus)
        {
            this.focus = id
            this.unplaced = true
        }
    }

    /**
     * Has a hero walk back to the entrance and out of the level. Without a level to walk in, they are just out.
     */
    leave(id: number): void
    {
        const hero = this.shown.get(id)
        if (!hero)
        {
            this.onLeft(id)
        }
        else if (!hero.leaving)
        {
            this.walkTo(hero, this.entrance)
            hero.leaving = true
            if (!hero.walk)
            {
                this.onLeft(id)
            }
        }
    }

    /**
     * Has the hero the view is with go to the next face in a direction on the screen, once they are about done with the
     * way they are on.
     */
    step(direction: Direction): void
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        const { meshes } = this
        if (!hero || hero.leaving || !meshes)
        {
            return
        }
        const { walk, faces, meeple } = hero
        if (walk && (walk.length - walk.share * walk.length) * SCALE > CHAIN_DISTANCE)
        {
            return
        }
        const [sx, sz] = SCREEN_DIRECTIONS[direction]
        const heading = this.controls.getAzimuthalAngle()
        const face = nextFace(
            meshes.world,
            faces[faces.length - 1],
            sx * Math.cos(heading) + sz * Math.sin(heading),
            -sx * Math.sin(heading) + sz * Math.cos(heading)
        )
        if (face !== null)
        {
            const [x, z] = faceCenter(meshes.world, face)
            hero.faces = [faces[faces.length - 1], face]
            hero.walk = new Walk([meeple.position.x / SCALE, meeple.position.z / SCALE, x / SCALE, z / SCALE], 0)
        }
    }

    /**
     * Sends a hero to a face over the shortest way, from wherever on their way they are right now
     */
    private walkTo(hero: ShownHero, goal: number): void
    {
        const { meshes } = this
        const faces = findFaces(meshes!.world, this.slots, this.closestOnWay(hero), goal)
        if (!faces)
        {
            return
        }
        if (faces.length === 1 && !hero.walk)
        {
            hero.faces = faces
            return
        }
        const way = tautPath(meshes!.world, faces)
        way[0] = hero.meeple.position.x / SCALE
        way[1] = hero.meeple.position.z / SCALE
        hero.faces = faces
        hero.walk = new Walk(way, 0)
    }

    /**
     * Returns the face of the hero's way they are closest to, which they are on or about to get to. It only looks at the
     * way, the closest of all faces can be behind a wall.
     */
    private closestOnWay({ faces, meeple }: ShownHero): number
    {
        let closest = faces[0]
        let shortest = Infinity
        for (const face of faces)
        {
            const [x, z] = faceCenter(this.meshes!.world, face)
            const distance = Math.hypot(x - meeple.position.x, z - meeple.position.z)
            if (distance < shortest)
            {
                closest = face
                shortest = distance
            }
        }
        return closest
    }

    private updateHeroes(time: number, delta: number): void
    {
        for (const [id, hero] of this.shown)
        {
            const { meeple, walk, faces } = hero
            if (!walk)
            {
                continue
            }
            walk.advance(WALK_SPEED * walkSpeedMultiplier(meeple) * delta / SCALE, 1)
            walk.position(walkPosition)
            meeple.position.set(walkPosition[0] * SCALE, 0, walkPosition[1] * SCALE)
            // shortest turn in the direction walked in
            const turn = ((Math.atan2(walkPosition[2], walkPosition[3]) - meeple.facing) % TAU + TAU * 1.5) % TAU - Math.PI
            meeple.facing += Math.max(-TURN_RATE * delta, Math.min(TURN_RATE * delta, turn))
            meeple.walking = true

            if (walk.isAt(1))
            {
                const face = faces[faces.length - 1]
                hero.walk = null
                hero.faces = [face]
                meeple.walking = false
                this.onMoved(id, face)
                if (hero.leaving)
                {
                    this.onLeft(id)
                }
            }
        }
        this.crowd?.update(this.camera, time)
    }

    /**
     * Moves the view along with the hero
     */
    private updateView(): void
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (!hero)
        {
            return
        }
        const { position } = hero.meeple
        const { camera, controls, focusAt, meshes } = this
        if (this.unplaced)
        {
            this.unplaced = false
            controls.target.copy(position)
            camera.position.copy(position).add(CAMERA_OFFSET)
        }
        else
        {
            camera.position.add(hit.subVectors(position, focusAt))
            controls.target.add(hit)
        }
        focusAt.copy(position)
        moveHeroLight(meshes!.field, meshes!.segments, position.x, position.z)
    }

    private listen(canvas: HTMLCanvasElement): void
    {
        let downX = 0, downY = 0
        canvas.addEventListener("pointerdown", ev => {
            downX = ev.clientX
            downY = ev.clientY
        })
        canvas.addEventListener("pointerup", ev => {
            const dx = ev.clientX - downX
            const dy = ev.clientY - downY
            if (ev.button === 0 && dx * dx + dy * dy <= CLICK_DISTANCE * CLICK_DISTANCE)
            {
                this.walkToPointer(ev)
            }
        })
    }

    /**
     * Sends the hero the view is with to the floor under the pointer
     */
    private walkToPointer(ev: PointerEvent): void
    {
        const hero = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (!hero || hero.leaving)
        {
            return
        }
        const rect = this.element.getBoundingClientRect()
        this.pointer.set(
            (ev.clientX - rect.left) / rect.width * 2 - 1,
            -(ev.clientY - rect.top) / rect.height * 2 + 1
        )
        this.raycaster.setFromCamera(this.pointer, this.camera)
        if (this.raycaster.ray.intersectPlane(FLOOR, hit))
        {
            const face = this.floorAt(hit.x, hit.z)
            if (face !== null)
            {
                this.walkTo(hero, face)
            }
        }
    }

    /**
     * Returns the floor face with its center closest to the given point in world units, null with none close by
     */
    private floorAt(x: number, z: number): number | null
    {
        let closest: number | null = null
        // faces are about one world unit across
        let shortest = 1
        for (const face of this.floor)
        {
            const [fx, fz] = faceCenter(this.meshes!.world, face)
            const distance = Math.hypot(fx - x, fz - z)
            if (distance < shortest)
            {
                closest = face
                shortest = distance
            }
        }
        return closest
    }

    private resize(): void
    {
        const { clientWidth, clientHeight } = this.element
        if (clientWidth && clientHeight && (clientWidth !== this.width || clientHeight !== this.height))
        {
            this.width = clientWidth
            this.height = clientHeight
            this.renderer.setSize(clientWidth, clientHeight, false)
            this.camera.aspect = clientWidth / clientHeight
            this.camera.updateProjectionMatrix()
        }
    }

    /**
     * Moves the camera around what it looks at, the same as dragging with the mouse, see CastleScene.look()
     */
    look(yaw: number, pitch: number, zoom: number): void
    {
        const { camera, controls, lookAngles } = this
        lookAngles.setFromVector3(hit.copy(camera.position).sub(controls.target))
        lookAngles.theta += yaw
        lookAngles.phi += pitch
        lookAngles.radius *= zoom
        lookAngles.makeSafe()
        camera.position.setFromSpherical(lookAngles).add(controls.target)
    }

    /**
     * Starts or stops rendering, e.g. while the view is hidden
     */
    setRunning(running: boolean): void
    {
        if (running === this.running)
        {
            return
        }
        this.running = running
        this.lastFrame = performance.now() / 1000
        this.renderer.setAnimationLoop(running ? () => {
            const time = performance.now() / 1000
            const delta = Math.min(MAX_FRAME_TIME, time - this.lastFrame)
            this.lastFrame = time
            this.resize()
            const { level, meshes } = this
            if (level && meshes)
            {
                this.updateHeroes(time, delta)
                this.updateView()
                flickerLights(meshes.field, level.lighting!.lights, time)
                updateLightField(this.renderer, meshes.field)
            }
            this.controls.update()
            this.renderer.render(this.scene, this.camera)
        } : null)
    }

    /**
     * Stops rendering and frees the renderer and the map worker
     */
    dispose(): void
    {
        this.setRunning(false)
        this.controls.dispose()
        this.client.terminate()
        this.renderer.dispose()
        this.renderer.forceContextLoss()
        this.element.remove()
    }
}
