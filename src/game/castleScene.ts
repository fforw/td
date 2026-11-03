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
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { createCastle } from "../castle/castle3d"
import type { CastlePlan } from "../castle/castlePlan"
import { PATCH_SIZE } from "../map/HexagonPatch"
import PatchWorld from "../map/PatchWorld"
import { createGround, createModels } from "../render/patchMeshes"
import { FACE_SIZE, loadModels } from "../render/scene3d"
import MapWorkerClient, { type BuiltPatch } from "../worker/MapWorkerClient"

/*
 * 3D view of the castle patch and its neighbors, the home screen of the game
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
 * Pointer movement in pixels up to which a press counts as a click, not as dragging the camera
 */
const CLICK_DISTANCE = 4


/**
 * Picks the tavern among the houses of the castle: the one closest to the market fountain. Every castle has one
 * (plan 3.6); later the castle planner places it as a fixture.
 *
 * @return index of the house in the plan, -1 for a castle without houses
 */
export function tavernHouse(plan: CastlePlan): number
{
    const [fx, fz] = plan.fountain
    let best = -1
    let bestDistance = Infinity
    plan.houses.forEach(({ x, z }, index) => {
        const distance = Math.hypot(x - fx, z - fz)
        if (distance < bestDistance)
        {
            best = index
            bestDistance = distance
        }
    })
    return best
}


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


export default class CastleScene
{
    readonly element: HTMLCanvasElement

    /** shows where the cardinal directions are from the camera's point of view */
    readonly compass: HTMLElement
    private readonly compassLetters: HTMLElement[]
    private readonly needle: SVGSVGElement
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

    private running = false

    private readonly grounds = new Map<number, Mesh>()

    /** canvas size the renderer was last set to */
    private width = 0
    private height = 0

    /**
     * @param seed      campaign seed, the same the castle and its surroundings are generated from
     * @param onTavern  called when the tavern is clicked
     */
    constructor(seed: number, private readonly onTavern: () => void)
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
        // north half filled, south half as an outline, in a 100 x 100 box around the compass center
        this.needle = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        this.needle.setAttribute("viewBox", "0 0 100 100")
        this.needle.classList.add("needle")
        this.needle.innerHTML =
            '<polygon class="north" points="50,26 62,50 38,50"/>' +
            '<polygon class="south" points="50,74 62,50 38,50"/>'
        this.compass.prepend(this.needle)

        const renderer = new WebGLRenderer({ canvas, antialias: true })
        renderer.setPixelRatio(window.devicePixelRatio)
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
        controls.maxDistance = 30
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

        this.listen(canvas)

        loadModels().then(() => this.build(seed))
    }

    /**
     * Builds the castle patch and its eight neighbors, the castle first.
     */
    private build(seed: number): void
    {
        const patches: [number, number][] = [[0, 0]]
        for (let r = -1; r <= 1; r++)
        {
            for (let q = -1; q <= 1; q++)
            {
                if (q || r)
                {
                    patches.push([q, r])
                }
            }
        }

        for (const [q, r] of patches)
        {
            this.client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, seed, FACE_SIZE, q === 0 && r === 0).then(
                result => this.addPatch(result),
                err => console.error("Building patch " + q + "/" + r + " failed", err)
            )
        }
    }

    private addPatch({ patch, castle }: BuiltPatch): void
    {
        const { world, scene } = this
        const slot = world.add(patch)

        const group = new Group()
        createModels(patch).forEach(obj => group.add(obj))
        if (castle)
        {
            group.add(this.createCastle(castle))
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
        const index = tavernHouse(plan)
        const house = castle.children.find(obj => obj.userData.house === index)
        if (house)
        {
            const { side } = plan.houses[index]
            const sign = createSign("🍺")
            sign.position.set(house.position.x, side * 2 + SIGN_SIZE * 0.7, house.position.z)
            castle.add(sign)
            this.sign = sign
            this.tavern = [house, sign]
        }

        const [fx, fz] = plan.fountain
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
        this.needle.style.transform = "rotate(" + heading + "rad)"
        DIRECTIONS.forEach(([, angle], i) => {
            const a = angle + heading
            const { style } = this.compassLetters[i]
            style.left = (50 + Math.sin(a) * COMPASS_RADIUS) + "%"
            style.top = (50 - Math.cos(a) * COMPASS_RADIUS) + "%"
        })
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
        this.renderer.setAnimationLoop(running ? () => {
            this.resize()
            this.controls.update()
            this.updateCompass()
            this.renderer.render(this.scene, this.camera)
        } : null)
    }
}
