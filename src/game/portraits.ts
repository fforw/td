import {
    DirectionalLight,
    HemisphereLight,
    type Material,
    type Mesh,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer
} from "three"
import { patchSeed, rng, withSeed } from "../math/random"
import { randomLook } from "../meeple/look"
import MeepleCrowd, { headHeight, MEEPLE_MODELS, type MeepleLook } from "../meeple/Meeple3D"
import { loadModels } from "../render/scene3d"

/*
 * Head and shoulder portraits of meeples, rendered offscreen into images
 */

/**
 * Size of the portrait images in pixels
 */
const SIZE = 192

/**
 * Head turns a portrait shows: half left, frontal, half right
 */
const FACINGS = [-Math.PI / 4, 0, Math.PI / 4]

const FOV = 24

/**
 * Distance of the camera from the head and how far below the head center it looks, in world units. Frames the head
 * with the hair and the upper part of the body.
 */
const DISTANCE = 0.72
const LOOK_BELOW = 0.035

/**
 * Colors of the background gradient, whose position behind the head shows how tall the meeple is
 */
const GRADIENT_LOW = "#8c8c8c"
const GRADIENT_HIGH = "#e4e4e4"

/**
 * Mixed into the campaign seed for the looks of explorers
 */
const LOOK_SALT = 0x100c


export interface Sitter
{
    look: MeepleLook
    /** rotation of the meeple around the y axis, 0 faces the camera */
    facing: number
}


/**
 * Returns the look and the head turn of an explorer. Both follow from the seed and the explorer's id, so they don't
 * need to be saved.
 */
export function explorerSitter(seed: number, id: number): Sitter
{
    return withSeed(patchSeed(seed ^ LOOK_SALT, id, 0), () => ({
        look: randomLook(),
        facing: FACINGS[rng.nextInt(0, FACINGS.length - 1)]
    }))
}


/**
 * Returns the y pixel of a point at the given height on the meeple's axis
 */
function screenY(camera: PerspectiveCamera, y: number): number
{
    return (1 - new Vector3(0, y, 0).project(camera).y) / 2 * SIZE
}


/**
 * Puts the rendered meeple onto the height gradient, which is as tall as the portrait. The camera follows the head, so
 * the head stays in place and the gradient moves instead: a meeple of height 1 has its head at the light top end of
 * the gradient, smaller ones correspondingly lower, down to the dark bottom end for height 0.
 */
function withBackground(rendered: HTMLCanvasElement, camera: PerspectiveCamera, look: MeepleLook): string
{
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = SIZE
    const ctx = canvas.getContext("2d")!

    const top = screenY(camera, headHeight(look)) - (1 - look.height) * SIZE
    const gradient = ctx.createLinearGradient(0, top, 0, top + SIZE)
    gradient.addColorStop(0, GRADIENT_HIGH)
    gradient.addColorStop(1, GRADIENT_LOW)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, SIZE, SIZE)

    ctx.drawImage(rendered, 0, 0)
    return canvas.toDataURL()
}


/**
 * Renders portraits on demand and keeps them by key. Rendering waits for the meeple models; onReady is called
 * whenever a portrait has been added.
 */
export default class Portraits
{
    private readonly images = new Map<string, string | null>()
    private readonly models = loadModels(MEEPLE_MODELS)
    private renderer: WebGLRenderer | null = null
    private failed = false

    constructor(private readonly onReady: () => void)
    {
    }

    /**
     * Returns the portrait as image url, null while it is being rendered or where there is no WebGL
     */
    get(key: string, sitter: () => Sitter): string | null
    {
        if (!this.images.has(key))
        {
            this.images.set(key, null)
            this.models.then(() => {
                const image = this.render(sitter())
                if (image)
                {
                    this.images.set(key, image)
                    this.onReady()
                }
            })
        }
        return this.images.get(key)!
    }

    private render({ look, facing }: Sitter): string | null
    {
        if (this.failed)
        {
            return null
        }
        if (!this.renderer)
        {
            try
            {
                this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
                this.renderer.setSize(SIZE, SIZE, false)
                this.renderer.setClearColor(0x000000, 0)
            }
            catch (e)
            {
                console.error("No portraits", e)
                this.failed = true
                return null
            }
        }

        const scene = new Scene()
        scene.add(new HemisphereLight("#dfefff", "#5c6e3c", 1.6))
        const light = new DirectionalLight("#fff4e0", 2)
        light.position.set(-1, 1.5, 2)
        scene.add(light)

        const head = headHeight(look)
        const camera = new PerspectiveCamera(FOV, 1, 0.01, 10)
        camera.position.set(0, head, DISTANCE)
        camera.lookAt(new Vector3(0, head - LOOK_BELOW, 0))

        // no items, and the head neither tilted nor leaning, since the camera is at head height
        const crowd = new MeepleCrowd(1)
        crowd.headTilt = 0
        crowd.add({ position: new Vector3(), facing, look, phase: 0, name: "", gait: 0.5 })
        crowd.update(camera, 0)
        scene.add(crowd.group)

        this.renderer.render(scene, camera)
        const image = withBackground(this.renderer.domElement, camera, look)

        crowd.group.traverse(obj => {
            const mesh = obj as Mesh
            if (mesh.isMesh)
            {
                mesh.geometry.dispose()
                ;([] as Material[]).concat(mesh.material).forEach(m => m.dispose())
            }
        })
        return image
    }
}
