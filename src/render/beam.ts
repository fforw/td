import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DataTexture,
    DoubleSide,
    Group,
    Mesh,
    NormalBlending,
    PlaneGeometry,
    PointLight,
    Points,
    PointsMaterial,
    ShaderMaterial,
    Sprite,
    SpriteMaterial,
    Vector3
} from "three"
import { GLOW_LAYER, OVERLAY_LAYER, UNDERLAY_LAYER } from "./glowPass"

/*
 * An energy beam, as wizards cast it: a ribbon that faces the camera, with a white-hot core, a colored halo and streaks
 * running along it, a flare at both ends, sparks where it hits and a light there. Its colors go well above 1, so a bloom
 * pass makes them glow, but it reads as a beam without one. Hard-edged pixels in its color run along both sides of the
 * core and blink, which keep its color on bright floors. With the layers of a GlowPass, only the glow blooms and the
 * pixels are drawn over it.
 */

/**
 * Number of segments along the ribbon, for its wobble
 */
const SEGMENTS = 48

/**
 * How bright the core and the halo are at full strength. Above 1 they bloom.
 */
const CORE_INTENSITY = 3
const HALO_INTENSITY = 2.8

/**
 * How far the core goes towards white
 */
const CORE_WHITE = 0.6

/**
 * Size of the flares in units of the beam width, at the staff and where the beam hits
 */
const TIP_FLARE = 2.2
const HIT_FLARE = 5

/**
 * Width of the fringe in units of the beam width, and how much its pixels cover what is behind them. It is blended
 * normally in the color of the beam, so the beam keeps its color on bright floors, where adding light only makes them
 * white. Its pixels have hard edges, which the bloom doesn't wash out like a soft fringe.
 */
const FRINGE_SPREAD = 1.8
const FRINGE_OPACITY = 0.9

/**
 * Size of the colored spot under the flare where the beam hits, in units of the flare
 */
const HIT_FRINGE = 1.5

/**
 * Size of the pixels of the fringe in beam widths, how fast they run from the staff to where it hits in beam widths per
 * second, and how often each one turns on or off per second
 */
const PIXEL_SIZE = 0.3
const PIXEL_FLOW = 4
const PIXEL_BLINK = 9

/**
 * Half the width of the white core of the glow in beam widths, which the pixels leave free. They are in rows from its
 * edge outwards: the first one sits half on the core and is always on, so half a pixel of it shows, the ones further out
 * are fewer and fewer.
 */
const PIXEL_CORE = 0.1

/**
 * How many of the pixels are on in the rows after the first one
 */
const PIXEL_ROWS = [0.5, 0.22]

/**
 * Number of sparks there can be at once, and how many fly off per second at full strength
 */
const SPARKS = 96
const SPARK_RATE = 140

/**
 * Seconds a spark lives, and its speed and fall in widths per second
 */
const SPARK_LIFE = 0.45
const SPARK_SPEED = 18
const SPARK_GRAVITY = 60

/**
 * Brightness of the lights where the beam hits and at the staff per square beam width, so they light the same share of a
 * wizard of any size, and how far they reach in beam widths
 */
const HIT_LIGHT = 60
const TIP_LIGHT = 20
const LIGHT_RANGE = 25

const VERTEX = /* glsl */ `
uniform vec3 from;
uniform vec3 to;
uniform float width;
uniform float spread;
uniform float strength;
uniform float time;

varying vec2 vUv;
varying float vAlong;
varying float vAcross;
varying float vHalfWidth;

void main()
{
    vec3 axis = to - from;
    float len = length(axis);
    float t = uv.y;
    vAlong = t * len;
    vUv = uv;

    vec3 at = from + axis * t;
    vec3 side = normalize(cross(axis, cameraPosition - at));

    // it starts narrow at the staff, widens as it fires and wobbles as the energy runs along
    float w = width * spread * sqrt(strength) * mix(0.35, 1.0, smoothstep(0.0, 1.5 * width, vAlong));
    w *= 1.0 + 0.12 * sin(vAlong / width * 1.1 - time * 25.0) + 0.06 * sin(vAlong / width * 2.9 + time * 17.0);

    vAcross = (uv.x - 0.5) * w;
    vHalfWidth = 0.5 * w;
    gl_Position = projectionMatrix * viewMatrix * vec4(at + side * vAcross, 1.0);
}
`

const NOISE = /* glsl */ `
float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

/**
 * Streaks that run from the staff to where it hits, at the given distance from the middle
 */
float streaks(float v)
{
    float s = vAlong / width;
    return noise(vec2(s * 0.6 - time * 14.0, v * 4.0)) * 0.6 + noise(vec2(s * 1.7 - time * 31.0, v * 9.0)) * 0.4;
}
`

const UNIFORMS = /* glsl */ `
uniform vec3 color;
uniform vec3 core;
uniform float width;
uniform float strength;
uniform float time;

varying vec2 vUv;
varying float vAlong;
`

/**
 * Light the beam adds
 */
const GLOW = /* glsl */ `
${UNIFORMS}
${NOISE}

void main()
{
    // 0 in the middle, 1 at the edges
    float v = abs(vUv.x - 0.5) * 2.0;
    float streaks = streaks(v);

    float c = exp(-pow(v / 0.14, 2.0));
    float inner = exp(-pow(v / 0.4, 2.0));
    float outer = (1.0 - v) * (1.0 - v);

    vec3 light = core * c * ${CORE_INTENSITY.toFixed(2)} + color * (inner * (0.5 + streaks) + outer * 0.25) * ${HALO_INTENSITY.toFixed(2)};
    gl_FragColor = vec4(light * strength, 1.0);
}
`

/**
 * Pixels in the color of the beam along both sides of its core
 */
const FRINGE = /* glsl */ `
${UNIFORMS}
${NOISE}

uniform float spread;

varying float vAcross;
varying float vHalfWidth;

void main()
{
    // the core of the glow here, which wobbles with it
    float coreHalf = vHalfWidth * 2.0 / spread * ${PIXEL_CORE.toFixed(3)};
    float outside = abs(vAcross) - coreHalf;
    if (outside < 0.0)
    {
        discard;
    }

    // pixels on a grid along the beam, which runs from the staff to where it hits, so they move smoothly, in rows from
    // the edge of the core, the first one half on it
    float size = width * ${PIXEL_SIZE.toFixed(3)};
    float row = floor(outside / size + 0.5);
    vec2 pixel = vec2(floor((vAlong - time * width * ${PIXEL_FLOW.toFixed(2)}) / size), row * sign(vAcross));

    // each one after the first row blinks at its own times
    float density = ${PIXEL_ROWS.map((share, i) => `row < ${(i + 1.5).toFixed(1)} ? ${share.toFixed(3)} : `).join("")}0.0;
    float phase = hash(pixel);
    float blink = floor(time * ${PIXEL_BLINK.toFixed(2)} + phase * 7.0);
    if ((row > 0.5 && hash(pixel + vec2(blink * 13.17, blink * 7.31)) > density * strength) || strength < 0.5)
    {
        discard;
    }
    vec3 shade = mix(color, core, step(0.8, hash(pixel + vec2(3.7, blink))) * 0.5);
    gl_FragColor = vec4(shade, ${FRINGE_OPACITY.toFixed(2)});
}
`

let flareTexture: DataTexture | undefined

/**
 * Returns a soft round spot, white in the middle and falling off to black
 */
function flare(): DataTexture
{
    if (!flareTexture)
    {
        const size = 64
        const data = new Uint8Array(size * size * 4)
        for (let y = 0; y < size; y++)
        {
            for (let x = 0; x < size; x++)
            {
                const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)
                const value = Math.round(255 * Math.max(0, Math.exp(-r * r * 9) * 0.8 + Math.pow(Math.max(0, 1 - r), 3) * 0.2))
                data.set([value, value, value, 255], (y * size + x) * 4)
            }
        }
        flareTexture = new DataTexture(data, size, size)
        flareTexture.needsUpdate = true
    }
    return flareTexture
}

function flareSprite(): Sprite
{
    const sprite = new Sprite(new SpriteMaterial({ map: flare(), blending: AdditiveBlending, depthWrite: false, transparent: true }))
    sprite.renderOrder = 2
    return sprite
}

/**
 * Returns a spot in a color, blended normally under the flare where the beam hits
 */
function fringeSprite(): Sprite
{
    const sprite = new Sprite(new SpriteMaterial({ alphaMap: flare(), blending: NormalBlending, depthWrite: false, transparent: true }))
    sprite.renderOrder = 1
    return sprite
}

const WHITE = new Color(1, 1, 1)
const tmp = new Vector3()
const direction = new Vector3()


/**
 * A beam in a color. Its group must be in a part of the scene that isn't moved, as the beam goes between points in world
 * space.
 */
export default class Beam
{
    readonly group = new Group()

    private readonly color = new Color()
    private readonly material: ShaderMaterial
    private readonly fringeMaterial: ShaderMaterial
    private readonly ribbon: Mesh
    private readonly tipFlare = flareSprite()
    private readonly hitFlare = flareSprite()
    private readonly hitFringe = fringeSprite()
    private readonly hitLight = new PointLight(0xffffff, 0, 0, 2)
    private readonly tipLight = new PointLight(0xffffff, 0, 0, 2)

    private readonly sparkPositions = new Float32Array(SPARKS * 3)
    private readonly sparkVelocities = new Float32Array(SPARKS * 3)
    private readonly sparkLives = new Float32Array(SPARKS)
    private readonly sparks: Points
    private sparkDue = 0

    /**
     * @param color     color of the halo
     * @param width     width of the halo in world units
     * @param layered   whether its parts go on the layers of a GlowPass, which only blooms the parts that add light
     */
    constructor(color: Color, private readonly width: number, layered = false)
    {
        const uniforms = {
            from: { value: new Vector3() },
            to: { value: new Vector3() },
            width: { value: width },
            strength: { value: 0 },
            time: { value: 0 },
            color: { value: new Color() },
            core: { value: new Color() }
        }
        const geometry = new PlaneGeometry(1, 1, 1, SEGMENTS)
        // both share the uniforms but how wide they are
        this.material = new ShaderMaterial({
            uniforms: { ...uniforms, spread: { value: 1 } },
            vertexShader: VERTEX,
            fragmentShader: GLOW,
            blending: AdditiveBlending,
            depthWrite: false,
            transparent: true,
            side: DoubleSide
        })
        this.fringeMaterial = new ShaderMaterial({
            uniforms: { ...uniforms, spread: { value: FRINGE_SPREAD } },
            vertexShader: VERTEX,
            fragmentShader: FRINGE,
            blending: NormalBlending,
            depthWrite: false,
            transparent: true,
            side: DoubleSide
        })
        const ribbon = this.ribbon = new Mesh(geometry, this.material)
        const fringe = new Mesh(geometry, this.fringeMaterial)
        // placed by the shader. Without a GlowPass the pixels go under the light, with one over it.
        ribbon.frustumCulled = fringe.frustumCulled = false
        ribbon.renderOrder = 2
        fringe.renderOrder = 1

        const sparkGeometry = new BufferGeometry()
        sparkGeometry.setAttribute("position", new BufferAttribute(this.sparkPositions, 3))
        this.sparks = new Points(sparkGeometry, new PointsMaterial({
            size: width * 0.35,
            map: flare(),
            blending: AdditiveBlending,
            depthWrite: false,
            transparent: true
        }))
        this.sparks.frustumCulled = false
        this.sparks.renderOrder = 2

        this.hitLight.distance = this.tipLight.distance = width * LIGHT_RANGE
        this.group.add(fringe, ribbon, this.tipFlare, this.hitFringe, this.hitFlare, this.sparks, this.hitLight, this.tipLight)
        if (layered)
        {
            // the lights stay where the scene is
            for (const glow of [ribbon, this.tipFlare, this.hitFlare, this.sparks])
            {
                glow.layers.set(GLOW_LAYER)
            }
            fringe.layers.set(OVERLAY_LAYER)
            this.hitFringe.layers.set(UNDERLAY_LAYER)
        }
        this.setColor(color)
    }

    setColor(color: Color): void
    {
        const { uniforms } = this.material
        this.color.copy(color)
        uniforms.color.value.copy(color)
        uniforms.core.value.copy(color).lerp(WHITE, CORE_WHITE)
        this.hitLight.color.copy(color)
        this.hitFringe.material.color.copy(color)
        this.tipLight.color.copy(color).lerp(WHITE, 0.3)
    }

    /**
     * Shows the beam
     *
     * @param from      where it starts, at the staff
     * @param to        where it hits
     * @param charge    how far the staff has charged, from 0 to 1, which shows as a flare at its tip
     * @param strength  how far the beam has fired, from 0 to 1
     * @param time      seconds, for the streaks and the wobble
     * @param delta     seconds since the last call, for the sparks
     */
    update(from: Vector3, to: Vector3, charge: number, strength: number, time: number, delta: number): void
    {
        const { uniforms } = this.material
        const { width, color } = this
        uniforms.from.value.copy(from)
        uniforms.to.value.copy(to)
        uniforms.strength.value = strength
        uniforms.time.value = time

        // the flares flicker a little, the one where it hits more
        const glow = Math.max(charge, strength)
        const flicker = 0.85 + 0.15 * Math.sin(time * 41) * Math.sin(time * 23)
        this.tipFlare.position.copy(from)
        this.tipFlare.scale.setScalar(width * TIP_FLARE * glow * (0.9 + 0.1 * flicker))
        this.tipFlare.material.color.copy(color).lerp(WHITE, 0.5).multiplyScalar(4 * glow)
        this.hitFlare.position.copy(to)
        this.hitFlare.scale.setScalar(width * HIT_FLARE * Math.sqrt(strength) * flicker)
        this.hitFlare.material.color.copy(color).lerp(WHITE, 0.4).multiplyScalar(3 * strength)
        this.hitFringe.position.copy(to)
        this.hitFringe.scale.copy(this.hitFlare.scale).multiplyScalar(HIT_FRINGE)
        this.hitFringe.material.opacity = FRINGE_OPACITY * strength

        // lights up what it hits, from a little off the surface
        direction.subVectors(to, from).normalize()
        this.hitLight.position.copy(to).addScaledVector(direction, -width * 2)
        this.hitLight.intensity = HIT_LIGHT * width * width * strength * flicker
        this.tipLight.position.copy(from).addScaledVector(direction, width)
        this.tipLight.intensity = TIP_LIGHT * width * width * glow * flicker

        this.updateSparks(to, strength, delta)
        ;(this.sparks.material as PointsMaterial).color.copy(color).lerp(WHITE, 0.6).multiplyScalar(3)
    }

    /**
     * Lets the sparks fly back from where the beam hits, and fall
     */
    private updateSparks(to: Vector3, strength: number, delta: number): void
    {
        const { sparkPositions: positions, sparkVelocities: velocities, sparkLives: lives, width } = this
        this.sparkDue += delta * SPARK_RATE * (strength > 0.5 ? strength : 0)
        for (let i = 0; i < SPARKS; i++)
        {
            if (lives[i] > 0)
            {
                lives[i] -= delta
                velocities[i * 3 + 1] -= SPARK_GRAVITY * width * delta
                for (let a = 0; a < 3; a++)
                {
                    positions[i * 3 + a] += velocities[i * 3 + a] * delta
                }
            }
            if (lives[i] <= 0)
            {
                if (this.sparkDue >= 1)
                {
                    this.sparkDue--
                    lives[i] = SPARK_LIFE * (0.4 + Math.random() * 0.6)
                    // back towards the staff, spread out and up
                    tmp.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(2)
                        .addScaledVector(direction, -1).normalize().multiplyScalar(SPARK_SPEED * width * (0.5 + Math.random()))
                    velocities.set([tmp.x, tmp.y, tmp.z], i * 3)
                    positions.set([to.x, to.y, to.z], i * 3)
                }
                else
                {
                    // out of sight
                    positions.set([0, -1e4, 0], i * 3)
                }
            }
        }
        this.sparkDue = Math.min(this.sparkDue, 1)
        this.sparks.geometry.attributes.position.needsUpdate = true
    }

    dispose(): void
    {
        this.material.dispose()
        this.fringeMaterial.dispose()
        this.hitFringe.material.dispose()
        this.tipFlare.material.dispose()
        this.hitFlare.material.dispose()
        this.sparks.geometry.dispose()
        ;(this.sparks.material as PointsMaterial).dispose()
        this.ribbon.geometry.dispose()
    }
}
