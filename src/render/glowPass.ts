import {
    AddEquation,
    type Camera,
    Color,
    CustomBlending,
    HalfFloatType,
    MeshBasicMaterial,
    OneFactor,
    type Scene,
    ShaderMaterial,
    UniformsUtils,
    Vector2,
    type WebGLRenderer,
    WebGLRenderTarget
} from "three"
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js"
import { CopyShader } from "three/addons/shaders/CopyShader.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"

/*
 * Bloom for the effects alone. A bloom over the whole picture can't tell a glowing effect from a floor right under a
 * light, as both go well above 1. Instead the effects that add light are drawn on a layer of their own, which the scene
 * pass leaves out. This pass draws them into a target of its own, behind what hides them, blooms that and adds it to the
 * picture. Effect parts that are blended normally have layers of their own as well, which hide nothing here: those
 * under the glow are drawn by the scene pass, those over it by this pass after the glow, so the bloom doesn't wash them
 * out. They need the depth of the scene in the picture this pass gets.
 */

/**
 * Layer of the parts of effects that add light, which glow
 */
export const GLOW_LAYER = 1

/**
 * Layer of the parts of effects that are blended over the scene and under the glow
 */
export const UNDERLAY_LAYER = 2

/**
 * Layer of the parts of effects that are blended over the glow and its bloom
 */
export const OVERLAY_LAYER = 3

/**
 * Layer of what hides the glow, all that's left
 */
const SCENE_LAYER = 0

const BLACK = new Color(0, 0, 0)


export default class GlowPass extends Pass
{
    /** blooms the glow, it can be turned off */
    readonly bloom: UnrealBloomPass

    /** the glow and its bloom */
    private readonly target: WebGLRenderTarget
    /** writes only the depth of what hides the glow */
    private readonly hide = new MeshBasicMaterial({ colorWrite: false })
    private readonly add: FullScreenQuad
    private readonly clearColor = new Color()

    /**
     * Sets the layers of the camera for the scene pass: the scene and what is under the glow
     *
     * @param strength  of the bloom
     * @param radius    of the bloom, from 0 to 1
     */
    constructor(private readonly scene: Scene, private readonly camera: Camera, width: number, height: number, strength: number, radius: number)
    {
        super()
        this.needsSwap = false
        camera.layers.set(SCENE_LAYER)
        camera.layers.enable(UNDERLAY_LAYER)

        // as many samples as the scene, so the edges of the glow match
        this.target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 })
        this.bloom = new UnrealBloomPass(new Vector2(width, height), strength, radius, 0)
        this.add = new FullScreenQuad(new ShaderMaterial({
            uniforms: UniformsUtils.clone(CopyShader.uniforms),
            vertexShader: CopyShader.vertexShader,
            fragmentShader: CopyShader.fragmentShader,
            // all of it, as the alpha of the glow says nothing
            blending: CustomBlending,
            blendEquation: AddEquation,
            blendSrc: OneFactor,
            blendDst: OneFactor,
            depthTest: false,
            depthWrite: false,
            transparent: true
        }))
    }

    setSize(width: number, height: number): void
    {
        this.target.setSize(width, height)
        this.bloom.setSize(width, height)
    }

    render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void
    {
        const { scene, camera, target } = this
        const mask = camera.layers.mask
        const background = scene.background
        const autoClear = renderer.autoClear
        renderer.getClearColor(this.clearColor)
        const clearAlpha = renderer.getClearAlpha()

        // the depth of what hides the glow, then the glow behind it
        scene.background = null
        renderer.setClearColor(BLACK, 0)
        renderer.setRenderTarget(target)
        renderer.clear()
        renderer.autoClear = false
        camera.layers.set(SCENE_LAYER)
        scene.overrideMaterial = this.hide
        renderer.render(scene, camera)
        scene.overrideMaterial = null
        camera.layers.set(GLOW_LAYER)
        renderer.render(scene, camera)

        camera.layers.mask = mask
        scene.background = background
        renderer.autoClear = autoClear
        renderer.setClearColor(this.clearColor, clearAlpha)

        if (this.bloom.enabled)
        {
            this.bloom.render(renderer, null!, target, deltaTime, maskActive)
        }

        const material = this.add.material as ShaderMaterial
        material.uniforms.tDiffuse.value = target.texture
        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)
        renderer.autoClear = false
        this.add.render(renderer)

        // over the glow, behind what is in front of it in the scene
        scene.background = null
        camera.layers.set(OVERLAY_LAYER)
        renderer.render(scene, camera)
        camera.layers.mask = mask
        scene.background = background
        renderer.autoClear = autoClear
    }

    dispose(): void
    {
        this.target.dispose()
        this.bloom.dispose()
        this.hide.dispose()
        this.add.dispose()
        ;(this.add.material as ShaderMaterial).dispose()
    }
}
