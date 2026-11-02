import "./style.css"
import {
    Color,
    DirectionalLight,
    HemisphereLight,
    Mesh,
    MeshStandardMaterial,
    PCFShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    Scene,
    Timer,
    Vector2,
    Vector3,
    WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import MeepleCrowd, { HairStyle, type Meeple, MEEPLE_MODELS, MEEPLE_SCALE, type MeepleLook, randomTraits, walkSpeedMultiplier } from "./Meeple3D"
import { ITEMS, loadItems } from "./itemSprite"
import { loadModels } from "./scene3d"
import { randomSeed, resetRandom, rng, weightedRandom } from "./util"
import { attempts, cityNameGenerator, resetAttempts } from "./name-generator";

const TAU = Math.PI * 2

const DEBUG_NAMES = 0

/**
 * Meeples per row and column of the test grid, like the 2D sprite sheet
 */
const GRID = 10
const SPACING = MEEPLE_SCALE * 1.2

const SKINS = [
    "#f0c8aa",
    "#d9a07e",
    "#a86a48",
    "#6b321b",
    "#301911"]
const HAIR = weightedRandom(
    [
        [1, "#a63a36"],
        [1, "#e1e6e6"],
        [0.5, "#9928b6"],
        [0.5, "#008ee1"],
        [6, "#bfa239"],
        [6, "#754b21"],
        [4, "#141414"]
    ]
)

const HAIR_STYLES = [
    HairStyle.CURLY,
    HairStyle.SHORT,
    HairStyle.BALD,
    HairStyle.LONG,
    HairStyle.SIDE_PART
];

const SHIRTS = ["#a01828", "#1a78b0", "#8c2898", "#187830", "#3a8c8c", "#8c8c8c", "#d0a838"]

function pick<T>(array: T[]): T
{
    return array[rng.nextInt(0, array.length - 1)]
}

function randomLook(): MeepleLook
{
    return {
        skin: new Color(pick(SKINS)),
        shirt: new Color(pick(SHIRTS)),
        hair: new Color(HAIR()),
        hairStyle: pick(HAIR_STYLES),
        height: rng.next()
    }
}


const canvas = document.getElementById("screen") as HTMLCanvasElement

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFShadowMap

const scene = new Scene()
scene.background = new Color("#a9c8e8")

// same field of view and viewing angle as the castle view
const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100)
const radius = GRID * SPACING * 0.75
camera.position.set(0, radius * 1.1, radius * 1.3)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.47

scene.add(new HemisphereLight("#dfefff", "#5c6e3c", 1.6))

const sun = new DirectionalLight("#fff4e0", 2.5)
sun.position.set(-radius, radius * 1.5, radius * 0.6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 0.01
const shadowCam = sun.shadow.camera
shadowCam.left = shadowCam.bottom = -radius
shadowCam.right = shadowCam.top = radius
// the bias is relative to the depth range, with the default far plane of 500 it would be as large as a meeple
shadowCam.far = radius * 5
shadowCam.updateProjectionMatrix()
scene.add(sun)

const ground = new Mesh(new PlaneGeometry(radius * 6, radius * 6), new MeshStandardMaterial({ color: "#5c9e3c", roughness: 1 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

resetRandom(randomSeed())

await Promise.all([loadModels(MEEPLE_MODELS), loadItems()])

const crowd = new MeepleCrowd(GRID * GRID)
const offset = (GRID - 1) * SPACING / 2
for (let y = 0; y < GRID; y++)
{
    for (let x = 0; x < GRID; x++)
    {
        crowd.add({
            position: new Vector3(x * SPACING - offset, 0, y * SPACING - offset),
            facing: 0,
            look: randomLook(),
            phase: rng.next() * TAU,
            // about half of the meeples hold something
            item: rng.next() < 0.5 ? pick([...ITEMS]) : undefined,
            ...randomTraits()
        })
    }
}
scene.add(crowd.group)

if (DEBUG_NAMES)
{

    console.log("NAMES", crowd.meeples.map(m => m.name).join(", "), "attempts/name", attempts() / 100)

    resetAttempts()

    let cities = crowd.meeples.map(m => cityNameGenerator(rng.nextInt(5, 8)));

    cities.sort((a, b) => {

        return a.length - b.length
    })

    console.log("CITIES", cities.join(", "), "attempts/name", attempts() / 100)
}

// controls to compare the tricks

const ui = document.getElementById("ui")!
ui.style.cssText = "position:absolute;top:8px;left:8px;padding:8px;background:#000a;font:12px monospace;display:grid;gap:4px"

function slider(label: string, min: number, max: number, get: () => number, set: (v: number) => void): void
{
    const row = document.createElement("label")
    row.textContent = label + " "
    const input = document.createElement("input")
    input.type = "range"
    input.min = String(min)
    input.max = String(max)
    input.step = "0.01"
    input.value = String(get())
    input.addEventListener("input", () => set(+input.value))
    row.append(input)
    ui.append(row)
}

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLInputElement
{
    const row = document.createElement("label")
    const input = document.createElement("input")
    input.type = "checkbox"
    input.checked = get()
    input.addEventListener("change", () => set(input.checked))
    row.append(input, " " + label)
    ui.append(row)
    return input
}

slider("lean", 0, 0.8, () => crowd.lean, v => crowd.lean = v)
slider("head tilt", -0.3, 1, () => crowd.headTilt, v => crowd.headTilt = v)
checkbox("outlines", () => crowd.outlinesVisible, v => crowd.outlinesVisible = v)

const FACING_MODES = ["camera", "random", "spin"]

let facingMode = 0
const facingButton = document.createElement("button")
facingButton.addEventListener("click", () => setFacingMode((facingMode + 1) % FACING_MODES.length))
ui.append(facingButton)

function setFacingMode(mode: number): void
{
    facingMode = mode
    facingButton.textContent = "facing: " + FACING_MODES[mode]
    crowd.meeples.forEach(m => m.facing = mode === 1 ? rng.next() * TAU : 0)
}

// e.g. ?facing=camera&walk&ahead&ready&act&look=24,30
const params = new URLSearchParams(location.search)
const facingParam = FACING_MODES.indexOf(params.get("facing") ?? "")
setFacingMode(facingParam < 0 ? 1 : facingParam)
crowd.walking = params.has("walk")
let walkAhead = params.has("ahead")
checkbox("walk", () => crowd.walking, v => {
    crowd.walking = v
    aheadBox.disabled = !v
})
// moving only makes sense with the walk animation
const aheadBox = checkbox("walk ahead", () => walkAhead, v => walkAhead = v)
aheadBox.disabled = !crowd.walking

// items
function setReady(ready: boolean): void
{
    crowd.meeples.forEach(m => m.ready = ready)
}

let acting = false
function setActing(act: boolean): void
{
    acting = act
    crowd.meeples.forEach(m => act ? crowd.act(m) : crowd.stopActing(m))
}

setReady(params.has("ready"))
setActing(params.has("act"))
checkbox("ready items", () => !!crowd.meeples[0].ready, setReady)
// tools repeat their action while acting, other items act once
checkbox("act", () => acting, setActing)

for (const index of (params.get("look") ?? "").split(",").filter(Boolean))
{
    crowd.meeples[+index].lookAtCamera = true
}

const hint = document.createElement("div")
hint.textContent = "click a meeple to make it look at you"
ui.append(hint)

// the meeple whose looking at the camera was toggled last
const info = document.createElement("div")
info.style.whiteSpace = "pre"
ui.append(document.createElement("hr"))
ui.append(info)

function showInfo(meeple: Meeple): void
{
    const { name, gait, look, lookAtCamera } = meeple
    info.textContent = [
        `${name} (#${crowd.meeples.indexOf(meeple)})`,
        `looking: ${lookAtCamera ? "yes" : "no"}`,
        `gait:    ${gait.toFixed(2)}`,
        `height:  ${look.height.toFixed(2)}`,
        `hair:    ${HairStyle[look.hairStyle].toLowerCase()} ${look.hair.getHexString()}`,
        `skin:    ${look.skin.getHexString()}`,
        `shirt:   ${look.shirt.getHexString()}`,
        `item:    ${meeple.item ?? "-"}`
    ].join("\n")
}

// a click without dragging toggles looking at the camera, like a player interacting with a meeple
const raycaster = new Raycaster()
let downX = 0, downY = 0
canvas.addEventListener("pointerdown", ev => {
    downX = ev.clientX
    downY = ev.clientY
})
canvas.addEventListener("pointerup", ev => {
    const dx = ev.clientX - downX
    const dy = ev.clientY - downY
    if (ev.button === 0 && dx * dx + dy * dy < 16)
    {
        raycaster.setFromCamera(new Vector2(
            ev.clientX / window.innerWidth * 2 - 1,
            -ev.clientY / window.innerHeight * 2 + 1
        ), camera)
        const meeple = crowd.pick(raycaster)
        if (meeple)
        {
            meeple.lookAtCamera = !meeple.lookAtCamera
            showInfo(meeple)
        }
    }
})


window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

/**
 * Walking speed in world units per second for a meeple with a walk speed multiplier of 1
 */
const WALK_AHEAD_SPEED = MEEPLE_SCALE * 0.6

/**
 * Size of the square the meeples walk in, twice the area of the grid they start in. Leaving it on one side brings
 * them back on the other.
 */
const FIELD = GRID * SPACING * Math.SQRT2

function wrap(v: number): number
{
    return ((v + FIELD / 2) % FIELD + FIELD) % FIELD - FIELD / 2
}

const viewDirection = new Vector3()
const timer = new Timer()
renderer.setAnimationLoop(t => {
    timer.update(t)
    const time = timer.getElapsed()
    if (facingMode === 2)
    {
        crowd.meeples.forEach((m, i) => m.facing = time * 0.8 + i * 0.3)
    }
    else if (facingMode === 0)
    {
        // all face against the view direction, like the 2D sprites. Turning each toward the camera position looks
        // like a sideways glance near the screen edges.
        const view = camera.getWorldDirection(viewDirection)
        const facing = Math.atan2(-view.x, -view.z)
        crowd.meeples.forEach(m => m.facing = facing)
    }
    if (crowd.walking && walkAhead)
    {
        // limit the step after the tab was in the background
        const dt = Math.min(0.1, timer.getDelta())
        for (const m of crowd.meeples)
        {
            const step = WALK_AHEAD_SPEED * walkSpeedMultiplier(m) * dt
            m.position.x = wrap(m.position.x + Math.sin(m.facing) * step)
            m.position.z = wrap(m.position.z + Math.cos(m.facing) * step)
        }
    }
    controls.update()
    crowd.update(camera, time)
    renderer.render(scene, camera)
})
