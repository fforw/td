import {
    CanvasTexture,
    Color,
    DirectionalLight,
    Group,
    HemisphereLight,
    type Mesh,
    type Object3D,
    PCFShadowMap,
    PerspectiveCamera,
    Raycaster,
    Scene,
    Spherical,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { createCastle, tavernHeight } from "../castle/castle3d"
import type { CastlePlan } from "../castle/castlePlan"
import { PATCH_SIZE } from "../map/HexagonPatch"
import PatchWorld from "../map/PatchWorld"
import { createGround, createModels } from "../render/patchMeshes"
import { FACE_SIZE, loadModels, pixelRatio, SCALE } from "../render/scene3d"
import type { GeneratedPatch } from "../map/patchGenerators"
import MeepleCrowd, { type Meeple, type MeepleLook } from "../meeple/Meeple3D"
import MapWorkerClient from "../worker/MapWorkerClient"
import type { PatchNode } from "./campaign"
import { Walk } from "./journey"

/*
 * 3D view of the castle and all known patches around it, the home screen of the game
 */

/**
 * Camera offset from the castle center, in world units
 */
const CAMERA_OFFSET = new Vector3(0, 9, 11)

const SUN_DISTANCE = 40
const SHADOW_RADIUS = 20

/**
 * Size of the sign floating over the tavern, in world units, and how much it grows under the pointer
 */
const SIGN_SIZE = 0.7
const SIGN_HOVER = 1.25

/**
 * Cardinal directions with their angle clockwise from north. North is -z in the world and up on the patch map, east
 * is +x.
 */
const DIRECTIONS: [string, number][] = [["N", 0], ["E", Math.PI / 2], ["S", Math.PI], ["W", Math.PI * 1.5]]

/**
 * Distance of the compass letters from its center, in percent of its size
 */
const COMPASS_RADIUS = 36

/**
 * How far the point the camera looks at can get from the castle or a followed meeple in world units, and how far the
 * camera can get from that point
 */
const HOME_VIEW = { radius: 14, distance: 45 }
const FOLLOW_VIEW = { radius: 3, distance: 7 }

/**
 * How fast the view gets to where it should be, in shares of the rest per second
 */
const VIEW_RATE = 3

/**
 * Size of the steps the sun moves in with the view, in world units. Moving in steps keeps shadow edges from crawling.
 */
const SUN_STEP = 4

/**
 * Speed of someone on a journey with a speed of 1 in world units per second, and how fast they turn in radians per second
 */
const JOURNEY_SPEED = 1.65
const TURN_RATE = 8

/**
 * Seconds of running view between someone being sent off and them leaving, to go after them before they do
 */
const DEPARTURE_DELAY = 1.5

/**
 * How far from the castle in world units someone can be seen leaving, without being followed
 */
const LEAVE_RADIUS = 11

/**
 * Most meeples walking around at once
 */
const MAX_WALKERS = 64

/**
 * Longest time between frames that counts in seconds, the view may have been hidden for much longer
 */
const MAX_FRAME_TIME = 0.1

const TAU = Math.PI * 2

/**
 * Pointer movement in pixels up to which a press counts as a click, not as dragging the camera
 */
const CLICK_DISTANCE = 4


function createSign(icon: string): Sprite
{
    const size = 128
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#e8e0d4"
    ctx.strokeStyle = "#2a1d14"
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.font = (size * 0.55) + "px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(icon, size / 2, size / 2 + size * 0.04)

    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    const sign = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }))
    sign.scale.setScalar(SIGN_SIZE)
    // drawn over the roofs
    sign.renderOrder = 1
    return sign
}


/**
 * Someone on a journey
 */
export interface Walker
{
    /** id of the explorer or hero */
    id: number
    look: MeepleLook
    /** walking style, see Meeple */
    gait: number
    /** x and y in map units for each point of the way */
    way: readonly number[]
    /** walking speed, 1 for normal */
    speed: number
    /** share of the way that has to be reached by now */
    reached: number
    /** share of the way to wait at until the next day */
    next: number
    /** on the way back to the castle, where only the last day of it can be seen */
    homeward: boolean
}

interface ShownWalker
{
    walker: Walker
    walk: Walk
    meeple: Meeple
    /** the meeple is in the crowd */
    visible: boolean
    /** the view is bound to the walker */
    followed: boolean
    /** share of the way someone got to while followed, or on the day they were first seen */
    held: number
    /** seconds until leaving the castle */
    wait: number
}

const walkPosition: number[] = []
const anchorGoal = new Vector3()
const shift = new Vector3()


export default class CastleScene
{
    readonly element: HTMLCanvasElement

    /** shows where the cardinal directions are from the camera's point of view */
    readonly compass: HTMLElement
    private readonly compassLetters: HTMLElement[]
    private heading = NaN

    private readonly renderer: WebGLRenderer
    private readonly scene = new Scene()
    private readonly camera: PerspectiveCamera
    private readonly controls: OrbitControls
    private readonly world = new PatchWorld()
    private readonly client = new MapWorkerClient()

    /** objects that open the tavern when clicked: the tavern house and its sign */
    private tavern: Object3D[] = []
    private sign: Sprite | null = null

    private readonly raycaster = new Raycaster()
    private readonly pointer = new Vector2()
    private hovered = false

    private readonly lookOffset = new Vector3()
    private readonly lookAngles = new Spherical()

    private running = false

    /** keys of the patches shown or being built */
    private readonly patches = new Set<string>()

    private readonly models: Promise<void>

    private readonly grounds = new Map<number, Mesh>()

    /** canvas size the renderer was last set to */
    private width = 0
    private height = 0

    private readonly sun: DirectionalLight

    /** null until the meeple models are there */
    private crowd: MeepleCrowd | null = null
    private walkers: Walker[] = []
    private readonly shown = new Map<number, ShownWalker>()

    /** id of the walker the view is bound to, null for the castle */
    private followed: number | null = null

    /** middle of the castle */
    private readonly home = new Vector3()
    /** where the view is bound to right now, on its way to the castle or the followed walker */
    private readonly anchor = new Vector3()
    private viewRadius = HOME_VIEW.radius

    /** distance of the camera to go back to at the castle, null once it is back or while away */
    private homeDistance: number | null = null
    /** distance of the camera when it last left the castle */
    private leftAt = 0

    private lastFrame = 0

    /**
     * @param seed      campaign seed, the same the castle and its surroundings are generated from
     * @param onTavern  called when the tavern is clicked
     * @param onDayMark called when the followed walker got to the point of the way that ends the day
     */
    constructor(
        private readonly seed: number,
        private readonly onTavern: () => void,
        private readonly onDayMark: () => void
    )
    {
        const canvas = document.createElement("canvas")
        canvas.className = "castle-scene"
        this.element = canvas

        this.compass = document.createElement("div")
        this.compass.className = "compass"
        this.compass.title = "Compass"
        this.compassLetters = DIRECTIONS.map(([name]) => {
            const letter = document.createElement("span")
            letter.textContent = name
            letter.className = name === "N" ? "north" : ""
            this.compass.append(letter)
            return letter
        })
        // the needle always points up, the way the camera looks, and the letters turn around it; it marks the view
        // direction like a HUD rather than working like a real compass. Filled half up, outlined half down, in a
        // 100 x 100 box around the compass center.
        const needle = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        needle.setAttribute("viewBox", "0 0 100 100")
        needle.classList.add("needle")
        needle.innerHTML =
            '<polygon class="ahead" points="50,26 58,50 42,50"/>' +
            '<polygon class="behind" points="50,74 58,50 42,50"/>'
        this.compass.prepend(needle)

        const renderer = new WebGLRenderer({ canvas, antialias: true })
        renderer.setPixelRatio(pixelRatio())
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = PCFShadowMap
        this.renderer = renderer

        this.scene.background = new Color("#a9c8e8")

        this.camera = new PerspectiveCamera(40, 1, 0.1, 500)
        this.camera.position.copy(CAMERA_OFFSET)

        const controls = new OrbitControls(this.camera, canvas)
        controls.enableDamping = true
        controls.maxPolarAngle = Math.PI * 0.45
        controls.minDistance = 3
        controls.maxDistance = HOME_VIEW.distance
        controls.screenSpacePanning = false
        this.controls = controls

        this.scene.add(new HemisphereLight("#dfefff", "#5c6e3c", 1.6))

        const sun = new DirectionalLight("#fff4e0", 2.5)
        sun.position.set(-1, 1.5, 0.6).setLength(SUN_DISTANCE)
        sun.castShadow = true
        sun.shadow.mapSize.set(4096, 4096)
        sun.shadow.bias = -0.0005
        sun.shadow.normalBias = 0.02
        const shadowCam = sun.shadow.camera
        shadowCam.left = shadowCam.bottom = -SHADOW_RADIUS
        shadowCam.right = shadowCam.top = SHADOW_RADIUS
        shadowCam.far = SUN_DISTANCE * 2
        shadowCam.updateProjectionMatrix()
        this.scene.add(sun, sun.target)
        this.sun = sun

        this.listen(canvas)

        this.models = loadModels()
        this.models.then(() => {
            this.crowd = new MeepleCrowd(MAX_WALKERS)
            this.scene.add(this.crowd.group)
            this.setWalkers(this.walkers)
        })
    }

    /**
     * Sets who is on a journey right now. Someone already walking goes on from where they are.
     */
    setWalkers(walkers: Walker[]): void
    {
        this.walkers = walkers
        const { crowd, shown } = this
        if (!crowd)
        {
            return
        }
        for (const [id, { walker, meeple }] of shown)
        {
            // the same explorer can be off again on another way
            if (!walkers.some(w => w.id === id && w.way === walker.way))
            {
                crowd.remove(meeple)
                shown.delete(id)
            }
        }
        for (const walker of walkers)
        {
            const entry = shown.get(walker.id)
            if (entry)
            {
                entry.walker = walker
            }
            else
            {
                const walk = new Walk(walker.way, walker.reached)
                walk.position(walkPosition)
                const meeple: Meeple = {
                    position: new Vector3(walkPosition[0] * SCALE, 0, walkPosition[1] * SCALE),
                    facing: Math.atan2(walkPosition[2], walkPosition[3]),
                    look: walker.look,
                    phase: walker.id,
                    name: "",
                    gait: walker.gait,
                    walking: false
                }
                shown.set(walker.id, {
                    walker,
                    walk,
                    meeple,
                    visible: false,
                    followed: false,
                    held: walker.reached,
                    wait: walker.reached > 0 || walker.homeward ? 0 : DEPARTURE_DELAY
                })
            }
        }
    }

    /**
     * Binds the view to the walker with the given id, or to the castle
     */
    follow(id: number | null): void
    {
        if (this.followed === null && id !== null)
        {
            this.leftAt = this.camera.position.distanceTo(this.controls.target)
            this.homeDistance = null
        }
        else if (this.followed !== null && id === null)
        {
            this.homeDistance = this.leftAt
        }
        this.followed = id
    }

    /**
     * Lets everyone on a journey walk on. Someone followed walks as far as the days allow and ends the day at the next
     * mark. Anyone else just gets seen leaving the castle, days don't matter until someone goes after them. Someone
     * coming back can't show up before their last day, so they keep to the days out of sight, too.
     */
    private updateWalkers(time: number, delta: number): void
    {
        let dayOver = false
        for (const entry of this.shown.values())
        {
            const { walker, walk, meeple } = entry
            const { reached, next, speed, homeward } = walker
            const followed = walker.id === this.followed
            if (followed !== entry.followed)
            {
                entry.followed = followed
                if (followed)
                {
                    // someone still in sight just goes on, if the days allow it
                    const start = Math.max(reached, entry.held)
                    if (!entry.visible || walk.share < start || walk.share >= next)
                    {
                        walk.jumpTo(start)
                    }
                }
                else
                {
                    entry.held = walk.share
                }
            }

            // ending the day is no reason to stand around any longer
            entry.wait = reached > 0 ? 0 : Math.max(0, entry.wait - delta)
            const step = entry.wait > 0 ? 0 : JOURNEY_SPEED * speed * delta / SCALE
            meeple.walking = followed ? walk.advance(step, reached, next) : walk.advance(step, 0, homeward ? next : 1)
            walk.position(walkPosition)
            meeple.position.set(walkPosition[0] * SCALE, 0, walkPosition[1] * SCALE)
            if (meeple.walking)
            {
                // shortest turn in the direction walked in
                const turn = ((Math.atan2(walkPosition[2], walkPosition[3]) - meeple.facing) % TAU + TAU * 1.5) % TAU - Math.PI
                meeple.facing += Math.max(-TURN_RATE * delta, Math.min(TURN_RATE * delta, turn))
            }
            dayOver ||= followed && next > reached && walk.length > 0 && walk.isAt(next)

            const visible = followed ||
                (!walk.isAt(1) && meeple.position.distanceTo(this.home) <= LEAVE_RADIUS && (!homeward || next >= 1))
            if (visible !== entry.visible)
            {
                entry.visible = visible
                if (visible)
                {
                    this.crowd!.add(meeple)
                }
                else
                {
                    this.crowd!.remove(meeple)
                }
            }
        }
        this.crowd?.update(this.camera, time)
        if (dayOver)
        {
            this.onDayMark()
        }
    }

    /**
     * Moves the view along with what it is bound to and keeps it in the area around that
     */
    private updateView(delta: number): void
    {
        const { anchor, camera, controls, sun } = this
        const followed = this.followed !== null ? this.shown.get(this.followed) : undefined
        const view = this.followed !== null ? FOLLOW_VIEW : HOME_VIEW
        anchorGoal.copy(followed ? followed.meeple.position : this.home)

        const share = 1 - Math.exp(-VIEW_RATE * delta)
        shift.subVectors(anchorGoal, anchor).multiplyScalar(share)
        anchor.add(shift)
        this.viewRadius += (view.radius - this.viewRadius) * share
        controls.maxDistance += (view.distance - controls.maxDistance) * share

        // whatever panning did, the point looked at stays in the area
        const dx = controls.target.x + shift.x - anchor.x
        const dz = controls.target.z + shift.z - anchor.z
        const off = Math.hypot(dx, dz)
        if (off > this.viewRadius)
        {
            shift.x -= dx * (1 - this.viewRadius / off)
            shift.z -= dz * (1 - this.viewRadius / off)
        }
        camera.position.add(shift)
        controls.target.add(shift)

        if (this.homeDistance !== null)
        {
            const distance = camera.position.distanceTo(controls.target)
            const zoomed = distance + (this.homeDistance - distance) * share
            camera.position.sub(controls.target).setLength(zoomed).add(controls.target)
            if (Math.abs(this.homeDistance - zoomed) < 0.01)
            {
                this.homeDistance = null
            }
        }

        const sunX = Math.round(anchor.x / SUN_STEP) * SUN_STEP
        const sunZ = Math.round(anchor.z / SUN_STEP) * SUN_STEP
        sun.position.x += sunX - sun.target.position.x
        sun.position.z += sunZ - sun.target.position.z
        sun.target.position.set(sunX, 0, sunZ)
    }

    /**
     * Shows the given patches, building the ones not shown yet, closest to the castle first. Patches are only ever
     * added; what is known stays known.
     *
     * @param patches   the known patches
     */
    show(patches: Pick<PatchNode, "q" | "r" | "kind">[]): void
    {
        const missing = patches.filter(({ q, r }) => !this.patches.has(q + "/" + r))
        missing.sort((a, b) => Math.hypot(a.q, a.r) - Math.hypot(b.q, b.r))
        for (const { q, r, kind } of missing)
        {
            const key = q + "/" + r
            this.patches.add(key)
            const built = this.client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, this.seed, FACE_SIZE, kind)
            Promise.all([built, this.models]).then(
                ([result]) => this.addPatch(result),
                err => console.error("Building patch " + key + " failed", err)
            )
        }
    }

    private addPatch({ patch, pois }: GeneratedPatch): void
    {
        const { world, scene } = this
        const slot = world.add(patch)

        const group = new Group()
        createModels(patch, pois).forEach(obj => group.add(obj))
        const plan = pois[0]?.plan
        if (plan)
        {
            group.add(this.createCastle(plan))
        }
        scene.add(group)

        // the ground along the seams changes for the new patch and its neighbors
        for (const s of [slot, ...world.neighbors(slot)])
        {
            const old = this.grounds.get(s)
            if (old)
            {
                scene.remove(old)
                old.geometry.dispose()
            }
            const ground = createGround(world, s)
            this.grounds.set(s, ground)
            scene.add(ground)
        }
    }

    private createCastle(plan: CastlePlan): Object3D
    {
        const castle = createCastle(plan)
        const tavern = castle.children.find(obj => obj.userData.tavern)
        if (tavern && plan.tavern)
        {
            const sign = createSign("🍺")
            sign.position.set(tavern.position.x, tavernHeight(plan.tavern) + SIGN_SIZE * 0.7, tavern.position.z)
            castle.add(sign)
            this.sign = sign
            this.tavern = [tavern, sign]
        }

        const [fx, fz] = plan.fountain
        this.home.set(fx, 0, fz)
        this.anchor.copy(this.home)
        this.controls.target.set(fx, 0, fz)
        this.camera.position.set(fx, 0, fz).add(CAMERA_OFFSET)
        return castle
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
            if (ev.button === 0 && dx * dx + dy * dy <= CLICK_DISTANCE * CLICK_DISTANCE && this.hitsTavern(ev))
            {
                this.onTavern()
            }
        })
        canvas.addEventListener("pointermove", ev => {
            const hovered = this.hitsTavern(ev)
            if (hovered !== this.hovered)
            {
                this.hovered = hovered
                canvas.style.cursor = hovered ? "pointer" : ""
                this.sign?.scale.setScalar(SIGN_SIZE * (hovered ? SIGN_HOVER : 1))
            }
        })
    }

    private hitsTavern(ev: PointerEvent): boolean
    {
        if (!this.tavern.length)
        {
            return false
        }
        const rect = this.element.getBoundingClientRect()
        this.pointer.set(
            (ev.clientX - rect.left) / rect.width * 2 - 1,
            -(ev.clientY - rect.top) / rect.height * 2 + 1
        )
        this.raycaster.setFromCamera(this.pointer, this.camera)
        return this.raycaster.intersectObjects(this.tavern, true).length > 0
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
     * Places the compass letters for the current view. Looking north, north is up; with the camera turned by the
     * azimuth angle around its target, north turns by the same angle clockwise on the screen.
     */
    private updateCompass(): void
    {
        const heading = this.controls.getAzimuthalAngle()
        if (heading === this.heading)
        {
            return
        }
        this.heading = heading
        DIRECTIONS.forEach(([, angle], i) => {
            const a = angle + heading
            const { style } = this.compassLetters[i]
            style.left = (50 + Math.sin(a) * COMPASS_RADIUS) + "%"
            style.top = (50 - Math.cos(a) * COMPASS_RADIUS) + "%"
        })
    }

    /**
     * Moves the camera around what it looks at, the same as dragging with the mouse. The limits of the controls apply when
     * they next update.
     *
     * @param yaw       radians to turn around the vertical axis
     * @param pitch     radians to go up or down
     * @param zoom      factor for the distance
     */
    look(yaw: number, pitch: number, zoom: number): void
    {
        const { camera, controls, lookOffset, lookAngles } = this
        lookAngles.setFromVector3(lookOffset.copy(camera.position).sub(controls.target))
        lookAngles.theta += yaw
        lookAngles.phi += pitch
        lookAngles.radius *= zoom
        lookAngles.makeSafe()
        camera.position.setFromSpherical(lookAngles).add(controls.target)
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
            this.updateWalkers(time, delta)
            this.updateView(delta)
            this.controls.update()
            this.updateCompass()
            this.renderer.render(this.scene, this.camera)
        } : null)
    }
}
