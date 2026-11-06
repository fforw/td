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
import { createFloorWalls, entranceFace, findFaces, type FloorSpot, type FloorWalls, moveOnFloor } from "../map/dungeonWays"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, type DungeonLevel } from "../map/generateDungeon"
import { tautPath } from "../map/route"
import { actionDuration, itemAnimation } from "../items/itemAnimation"
import { loadItems } from "../items/itemSprite"
import MeepleCrowd, { type Meeple, MEEPLE_MODELS, MEEPLE_SCALE, type MeepleLook, walkSpeedMultiplier } from "../meeple/Meeple3D"
import { createLevelMeshes, type LevelMeshes } from "../render/dungeonLevel"
import HeroMarks from "../render/heroMarks"
import { flickerLights, moveHeroLight, updateLightField } from "../render/dungeonLighting"
import { FACE_SIZE, loadModels, pixelRatio, SCALE } from "../render/scene3d"
import MapWorkerClient from "../worker/MapWorkerClient"
import type { PadInput } from "./gamepad"
import HeroControl, { type HeroOrders, NO_ORDERS } from "./heroControl"
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
 * Fastest a meeple turns when told where to look, in radians per second
 */
const AIM_TURN_RATE = 30

/**
 * Room a meeple needs around it on the floor, in world units
 */
const ROOM_AROUND = MEEPLE_SCALE * 0.3

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

const FLOOR = new Plane(new Vector3(0, 1, 0), 0)

const walkPosition: number[] = []
const hit = new Vector3()

/**
 * What heroes can carry into a level
 */
const HERO_ITEMS = ["sword_silver", "shield_silver"] as const

const spot: FloorSpot = { face: 0, x: 0, z: 0 }

const orders: HeroOrders = { ...NO_ORDERS }

/**
 * Hero in the level
 */
export interface LevelHero extends Pick<Meeple, "item" | "leftItem">
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
    /** what the hero does on orders, which goes over walking a way */
    control: HeroControl
    /** moved on orders in the last frame */
    steered: boolean
}


/**
 * Turns a meeple the short way toward a facing, by the given radians at most
 */
function turnToward(meeple: Meeple, facing: number, most: number): void
{
    const turn = ((facing - meeple.facing) % TAU + TAU * 1.5) % TAU - Math.PI
    meeple.facing += Math.max(-most, Math.min(most, turn))
}


/**
 * A dungeon level in 3D with the heroes inside. The view stays with one of them, who carries the hero light and goes where
 * they are told or steered. Like the castle scene it has a canvas of its own, which saves the two from knowing about each other's
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
    private floorWalls: FloorWalls | null = null
    private crowd: MeepleCrowd | null = null
    private readonly marks = new HeroMarks()
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
    /** what a controller does in the current frame, if it is in charge of the hero the view is with */
    private steering: PadInput | null = null

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
            loadModels(MEEPLE_MODELS),
            loadItems(HERO_ITEMS)
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
        this.floorWalls = createFloorWalls(meshes.segments, ROOM_AROUND)
        this.scene.add(...meshes.meshes)
        this.slots = level.patches.map((_, slot) => slot)
        this.entrance = entranceFace(meshes.world, level)
        this.floor = [...level.rooms.flat(), ...level.corridors.flatMap(({ faces }) => faces)]

        const crowd = new MeepleCrowd(MAX_HEROES)
        crowd.setLightField(meshes.field)
        this.scene.add(crowd.group, this.marks.group)
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
        for (const { id, look, gait, dex, face = this.entrance, ...held } of heroes)
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
                    walking: false,
                    // the shield only comes up to block
                    ready: !!held.item,
                    leftReady: false,
                    ...held
                }
                crowd.add(meeple)
                shown.set(id, {
                    meeple,
                    faces: [face],
                    walk: null,
                    leaving: false,
                    control: new HeroControl(held.item ? actionDuration(itemAnimation(held.item).action) : null, !!held.leftItem),
                    steered: false
                })
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
     * Tells what a controller does in this frame to the hero the view is with. Nothing happens to them in frames without
     * this, whatever the reason for it is.
     */
    steer(input: PadInput): void
    {
        this.steering = input
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

    /**
     * Has a hero do what they are told by the controller, or else finish what they got told before
     */
    private steerHero(id: number, hero: ShownHero, input: PadInput | null, time: number, delta: number): void
    {
        const { meeple, control } = hero
        const attacks = control.update(input ? this.ordersOf(input) : NO_ORDERS, delta, meeple.facing)
        if (attacks)
        {
            this.crowd!.act(meeple, 0)
            // comes with the blade, after it has been drawn back
            this.marks.slash(time + itemAnimation(meeple.item!).action.steps[0].transition.duration)
        }
        meeple.leftReady = control.blocking
        if (control.turnTo !== null)
        {
            turnToward(meeple, control.turnTo, AIM_TURN_RATE * delta)
        }

        if (control.moving && !hero.leaving)
        {
            if (hero.walk)
            {
                hero.faces = [this.closestOnWay(hero)]
                hero.walk = null
            }
            const speed = WALK_SPEED * walkSpeedMultiplier(meeple) * delta
            spot.face = hero.faces[0]
            spot.x = meeple.position.x
            spot.z = meeple.position.z
            moveOnFloor(this.meshes!.world, this.floorWalls!, spot, control.velocityX * speed, control.velocityZ * speed)
            hero.faces[0] = spot.face
            meeple.position.set(spot.x, 0, spot.z)
            meeple.walking = true
            hero.steered = true
        }
        else if (hero.steered)
        {
            hero.steered = false
            meeple.walking = false
            this.onMoved(id, hero.faces[0])
        }
    }

    /**
     * Returns what a controller's input tells a hero to do, with the directions turned from the screen into the world
     */
    private ordersOf({ moveX, moveY, aimX, aimY, dash, attack, block }: PadInput): HeroOrders
    {
        const heading = this.controls.getAzimuthalAngle()
        const cos = Math.cos(heading), sin = Math.sin(heading)
        orders.moveX = moveX * cos + moveY * sin
        orders.moveZ = -moveX * sin + moveY * cos
        orders.aimX = aimX * cos + aimY * sin
        orders.aimZ = -aimX * sin + aimY * cos
        orders.dash = dash
        orders.attack = attack
        orders.block = block
        return orders
    }

    private updateHeroes(time: number, delta: number): void
    {
        const { steering } = this
        this.steering = null
        for (const [id, hero] of this.shown)
        {
            const steered = id === this.focus && !hero.leaving ? steering : null
            this.steerHero(id, hero, steered, time, delta)

            const { meeple, walk, faces } = hero
            if (!walk)
            {
                continue
            }
            walk.advance(WALK_SPEED * walkSpeedMultiplier(meeple) * delta / SCALE, 1)
            walk.position(walkPosition)
            meeple.position.set(walkPosition[0] * SCALE, 0, walkPosition[1] * SCALE)
            turnToward(meeple, Math.atan2(walkPosition[2], walkPosition[3]), TURN_RATE * delta)
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

        const focused = this.focus !== null ? this.shown.get(this.focus) : undefined
        if (focused)
        {
            const { position, facing } = focused.meeple
            this.marks.update(position.x, position.z, facing, !!steering, time)
        }
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
