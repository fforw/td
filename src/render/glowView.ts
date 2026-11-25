import {
    AlwaysDepth,
    type BufferGeometry,
    Color,
    DepthTexture,
    HalfFloatType,
    type Mesh,
    type Object3D,
    type PerspectiveCamera,
    type Scene,
    ShaderMaterial,
    SRGBColorSpace,
    Vector2,
    type WebGLRenderer,
    WebGLRenderTarget
} from "three"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"

/*
 * Bloom for effects alone. A bloom over the whole picture can't tell a glowing effect from a floor right under a light, as
 * both go well above 1. Instead the scene is drawn as it would be on the canvas, effects and all. Then the effects that
 * glow are drawn once more without the rest, behind what hides them by the depth of the scene, and only the bloom of that
 * is added to the picture. Effect parts that shouldn't be washed out by it keep it off where they are.
 *
 * The depth is the one the scene was drawn with, so what it leaves out doesn't hide the glow, like the walls cut for the
 * view.
 */

/**
 * Layer of the parts of effects that glow
 */
const GLOW_LAYER = 1

/**
 * Layer of the parts of effects that keep the bloom off
 */
const OVERLAY_LAYER = 2

/**
 * Strength and radius of the bloom
 */
export const GLOW_STRENGTH = 0.6
export const GLOW_RADIUS = 0.3

const BLACK = new Color(0, 0, 0)

const VERTEX = /* glsl */ `
varying vec2 vUv;

void main()
{
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const DEPTH = /* glsl */ `
uniform sampler2D depth;
varying vec2 vUv;

void main()
{
    gl_FragDepth = texture2D(depth, vUv).r;
    gl_FragColor = vec4(0.0);
}
`

// the picture has the colors of the canvas, the bloom adds up as light
const COMBINE = /* glsl */ `
uniform sampler2D picture;
uniform sampler2D bloom;
uniform sampler2D overlay;
uniform float strength;
varying vec2 vUv;

void main()
{
    vec4 color = texture2D(picture, vUv);
    if (strength > 0.0)
    {
        vec3 light = texture2D(bloom, vUv).rgb * (1.0 - clamp(texture2D(overlay, vUv).a, 0.0, 1.0));
        // the more there is already, the less it adds, so it doesn't clip
        vec3 linear = sRGBTransferEOTF(color).rgb;
        linear += light * (1.0 - clamp(linear, 0.0, 1.0));
        color.rgb = sRGBTransferOETF(vec4(linear, 1.0)).rgb;
    }
    gl_FragColor = vec4(color.rgb, 1.0);
}
`


/**
 * Has the bloom be made from a part of an effect, which is drawn in the scene as well
 */
export function setGlowing(part: Object3D): void
{
    part.layers.enable(GLOW_LAYER)
}

/**
 * As setGlowing(), for a part that would be too bright for the bloom. Its material needs a uniform glowShare, a float its
 * shader multiplies the light with.
 *
 * @param share     how much of its light goes into the bloom
 */
export function setGlowingLess(part: Mesh<BufferGeometry, ShaderMaterial>, share: number): void
{
    setGlowing(part)
    const { material } = part
    material.uniforms.glowShare = { value: 1 }
    part.onBeforeRender = (_renderer, _scene, camera) =>
    {
        material.uniforms.glowShare.value = camera.layers.mask === 1 << GLOW_LAYER ? share : 1
        material.uniformsNeedUpdate = true
    }
}

/**
 * Has a part of an effect keep off the bloom where it covers what is behind it
 */
export function setOverGlow(part: Object3D): void
{
    part.layers.enable(OVERLAY_LAYER)
}


function screenMaterial(fragmentShader: string, uniforms: ShaderMaterial["uniforms"]): ShaderMaterial
{
    return new ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false })
}


/**
 * Draws a scene with the bloom of what glows in it
 */
export default class GlowView
{
    /** whether there is any bloom */
    enabled = true

    private readonly picture: WebGLRenderTarget
    private readonly glow: WebGLRenderTarget
    private readonly bloom: UnrealBloomPass
    private readonly depth: FullScreenQuad
    private readonly combine: FullScreenQuad
    private readonly uniforms: ShaderMaterial["uniforms"]
    private readonly size = new Vector2()
    private readonly clearColor = new Color()

    constructor(
        private readonly renderer: WebGLRenderer,
        private readonly scene: Scene,
        private readonly camera: PerspectiveCamera,
        strength = GLOW_STRENGTH,
        radius = GLOW_RADIUS
    )
    {
        this.picture = new WebGLRenderTarget(1, 1, { samples: 4, depthTexture: new DepthTexture(1, 1), colorSpace: SRGBColorSpace })
        // three only does the tone mapping and color space of the canvas on the canvas and such targets. So the picture is
        // the same, and what isn't tone mapped or blends in the colors of the canvas needs no care.
        Object.assign(this.picture, { isXRRenderTarget: true })
        // as three has the multisampled buffer of such targets, which an SRGB8 texture couldn't be resolved from
        this.picture.texture.internalFormat = "RGBA8"
        this.glow = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
        this.bloom = new UnrealBloomPass(new Vector2(1, 1), strength, radius, 0)

        const depth = screenMaterial(DEPTH, { depth: { value: this.picture.depthTexture } })
        depth.depthTest = true
        depth.depthWrite = true
        depth.depthFunc = AlwaysDepth
        depth.colorWrite = false
        this.depth = new FullScreenQuad(depth)
        this.uniforms = {
            picture: { value: this.picture.texture },
            bloom: { value: this.bloom.renderTargetsHorizontal[0].texture },
            overlay: { value: this.glow.texture },
            strength: { value: 0 }
        }
        this.combine = new FullScreenQuad(screenMaterial(COMBINE, this.uniforms))
    }

    /**
     * Draws to the canvas
     *
     * @param glowing   whether anything glows right now, which costs extra
     */
    render(glowing: boolean): void
    {
        const { renderer, scene, camera, picture, size } = this
        renderer.getDrawingBufferSize(size)
        if (picture.width !== size.x || picture.height !== size.y)
        {
            picture.setSize(size.x, size.y)
            this.glow.setSize(size.x, size.y)
            this.bloom.setSize(size.x, size.y)
        }
        renderer.setRenderTarget(picture)
        renderer.render(scene, camera)

        const bloomed = glowing && this.enabled
        if (bloomed)
        {
            this.renderBloom()
        }
        this.uniforms.strength.value = bloomed ? 1 : 0
        renderer.setRenderTarget(null)
        this.combine.render(renderer)
    }

    private renderBloom(): void
    {
        const { renderer, scene, camera, glow } = this
        const { background, matrixWorldAutoUpdate } = scene
        const { mask } = camera.layers
        const { autoClear } = renderer
        renderer.getClearColor(this.clearColor)
        const clearAlpha = renderer.getClearAlpha()

        scene.background = null
        scene.matrixWorldAutoUpdate = false
        renderer.autoClear = false
        renderer.setClearColor(BLACK, 0)

        renderer.setRenderTarget(glow)
        renderer.clear()
        this.depth.render(renderer)
        camera.layers.set(GLOW_LAYER)
        renderer.render(scene, camera)
        this.bloom.render(renderer, glow, glow, 0, false)

        // now only the alpha of what keeps off the bloom, with the depth still there
        renderer.setRenderTarget(glow)
        renderer.clear(true, false, false)
        camera.layers.set(OVERLAY_LAYER)
        renderer.render(scene, camera)

        camera.layers.mask = mask
        scene.background = background
        scene.matrixWorldAutoUpdate = matrixWorldAutoUpdate
        renderer.autoClear = autoClear
        renderer.setClearColor(this.clearColor, clearAlpha)
    }

    dispose(): void
    {
        this.picture.dispose()
        this.glow.dispose()
        this.bloom.dispose()
        for (const quad of [this.depth, this.combine])
        {
            ;(quad.material as ShaderMaterial).dispose()
            quad.dispose()
        }
    }
}
