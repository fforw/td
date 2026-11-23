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
const SEGMENTS = 12

/**
 * How bright the core and the halo are at full strength. Above 1 they bloom.
 */
const CORE_INTENSITY = 2.5
const HALO_INTENSITY = 2.1

/**
 * How far the core goes towards white
 */
const CORE_WHITE = 0.4

/**
 * Size of the flares in units of the beam width, at the staff and where the beam hits
 */
const TIP_FLARE = 1.2
const HIT_FLARE = 3

/**
 * Width of the fringe in units of the beam width, and how much its pixels cover what is behind them. It is blended
 * normally in the color of the beam, so the beam keeps its color on bright floors, where adding light only makes them
 * white. Its pixels have hard edges, which the bloom doesn't wash out like a soft fringe.
 */
const FRINGE_SPREAD = 1.6
const FRINGE_OPACITY = 0.75

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
 * Shells around the core, hollow tubes with a pattern of spots on them in the colors of the beam, from the inside out:
 * their diameter in beam widths, how many of them the spots cover, from 0 to 1, how fast they spin in turns per second,
 * how far the hue of the whole shell turns around the circle from that of the beam, one of them at random each time the
 * beam fires, and how much of the opacity of the shells they have. They spin against each other.
 */
const SHELLS = [
    { spread: 0.5, cover: 0.45, spin: 0.45, hues: [1 / 3, -1 / 3, 1 / 2], opacity: 0.7 },
    { spread: 0.7, cover: 0.55, spin: -0.25, hues: [0], opacity: 0.9 }
]

/**
 * Size of the spots of the shells in beam widths, and how fast they run from the staff to where it hits in beam widths
 * per second
 */
const SHELL_CELL = 0.5
const SHELL_FLOW = 4

/**
 * How fast the spots change their shape, in sizes of a spot per second
 */
const SHELL_MORPH = 1.6

/**
 * How much the spots cover what is behind them where the shell faces the camera, at most where it is seen edge-on, and
 * how much of that its back keeps
 */
const SHELL_OPACITY = 0.7
const SHELL_OPACITY_EDGE = 0.95
const SHELL_BACK = 0.6

/**
 * How far the hue of the spots varies in radians
 */
const SHELL_HUE = 0.1

/**
 * Looks of the beam around its glow: pixels along both sides of its core, or shells around it
 */
export type BeamLook = "pixels" | "shell"

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
varying float vSlant;

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
    vec3 position = at + side * vAcross;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);

    // how far along the beam a point moves for each step towards the camera, seen through this one, as the camera looks at
    // the beam at a slant
    vec3 dir = axis / len;
    vec3 view = normalize(position - cameraPosition);
    vec3 toCamera = normalize(cross(side, dir));
    toCamera *= sign(dot(cameraPosition - at, toCamera));
    vSlant = dot(view, dir) / min(dot(view, toCamera), -0.05);
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
${NOISE} ` +
    // language=glsl
    `

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

/**
 * One side of a hollow tube around the core, which the ribbon stands in for. Each point of the ribbon sees the tube at
 * one point in front of the axis and one behind it. Where that is around the tube is measured from the camera, so where
 * the pattern doesn't meet up is straight behind the core.
 */
const SHELL = /* glsl */ `
${UNIFORMS}
${NOISE}

uniform float spread;
uniform float hueTurn;

varying float vAcross;
varying float vHalfWidth;
varying float vSlant;

vec4 mod289(vec4 x)
{
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 perm(vec4 x)
{
    return mod289(((x * 34.0) + 1.0) * x);
}

/**
 * Noise that changes with z, so going through it over time changes the spots instead of moving them. It hashes with
 * permutations instead of sin, which stays the same on all GPUs.
 */
float noise3(vec3 p)
{
    vec3 a = floor(p);
    vec3 d = p - a;
    d = d * d * (3.0 - 2.0 * d);
    // the pattern repeats every 289 cells anyway, so the hashes stay exact as the time grows
    a -= floor(a * (1.0 / 289.0)) * 289.0;

    vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
    vec4 k1 = perm(b.xyxy);
    vec4 k2 = perm(k1.xyxy + b.zzww);

    vec4 c = k2 + a.zzzz;
    vec4 k3 = perm(c);
    vec4 k4 = perm(c + 1.0);

    vec4 o1 = fract(k3 * (1.0 / 41.0));
    vec4 o2 = fract(k4 * (1.0 / 41.0));

    vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
    vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

    return o4.y * d.y + o4.x * (1.0 - d.y);
}

vec3 hueShift(vec3 c, float angle)
{
    vec3 k = vec3(0.57735);
    float cosA = cos(angle);
    return c * cosA + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - cosA);
}

void main()
{
    // the edge of the ribbon is the edge of the tube, which wobbles with it. z goes towards the camera.
    float x = clamp(vAcross / vHalfWidth, -1.0, 1.0);
    float z = sqrt(1.0 - x * x);
#ifdef BACK
    z = -z;
#endif
    float angle = atan(x, z);

    // the spots on the tube, which stay the same size as it wobbles, run along and spin around it
    float radius = width * spread * 0.5;
    float along = vAlong + vSlant * z * vHalfWidth;
    float size = width * ${SHELL_CELL.toFixed(3)};
    vec2 p = vec2((angle + time * SPIN) * radius, along - time * width * ${SHELL_FLOW.toFixed(2)}) / size;
    float morph = time * ${SHELL_MORPH.toFixed(3)};
    p += SEED;
    float n = noise3(vec3(p, morph)) * 0.65 + noise3(vec3(p * 2.3 + 17.0, morph * 1.7)) * 0.35;
    if (n < 1.0 - COVER || strength < 0.05)
    {
        discard;
    }

    // seen edge-on it covers more
    float hue = noise(p * 0.35 + 5.0) - 0.5;
    vec3 shade = hueShift(color, hue * 2.0 * ${SHELL_HUE.toFixed(3)} + hueTurn);
    shade = mix(shade, core, step(0.85, n) * 0.5);
    float alpha = min(${SHELL_OPACITY.toFixed(3)} / max(abs(z), 0.1), ${SHELL_OPACITY_EDGE.toFixed(3)}) * OPACITY * strength;
#ifdef BACK
    alpha *= ${SHELL_BACK.toFixed(3)} * strength;
#endif
    gl_FragColor = vec4(shade, alpha);
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
    private readonly shellMaterials: ShaderMaterial[]
    private readonly ribbon: Mesh
    private readonly fringe: Mesh
    private readonly shells: Mesh[]
    private currentLook: BeamLook = "shell"
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
    private fired = false

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
        // the backs under the glow, the outer one first, and the fronts over it, the outer one last
        this.shellMaterials = SHELLS.flatMap(({ spread, cover, spin, opacity }, index) => [true, false].map(back => new ShaderMaterial({
            uniforms: { ...uniforms, spread: { value: spread }, hueTurn: { value: 0 } },
            defines: {
                ...back ? { BACK: 1 } : {},
                COVER: cover.toFixed(3),
                SPIN: (spin * 2 * Math.PI).toFixed(3),
                OPACITY: opacity.toFixed(3),
                SEED: (index * 31.7).toFixed(1)
            },
            vertexShader: VERTEX,
            fragmentShader: SHELL,
            blending: NormalBlending,
            depthWrite: false,
            transparent: true,
            side: DoubleSide
        })))
        const ribbon = this.ribbon = new Mesh(geometry, this.material)
        const fringe = this.fringe = new Mesh(geometry, this.fringeMaterial)
        const shells = this.shells = this.shellMaterials.map(material => new Mesh(geometry, material))
        // placed by the shader. Without a GlowPass the pixels go under the light, with one over it.
        ribbon.frustumCulled = fringe.frustumCulled = false
        ribbon.renderOrder = 2
        fringe.renderOrder = 1
        shells.forEach((shell, i) =>
        {
            const index = i >> 1
            const back = i % 2 === 0
            shell.frustumCulled = false
            shell.renderOrder = back ? 1 - index : 3 + index
        })

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
        this.group.add(fringe, ...shells, ribbon, this.tipFlare, this.hitFringe, this.hitFlare, this.sparks, this.hitLight, this.tipLight)
        if (layered)
        {
            // the lights stay where the scene is
            for (const glow of [ribbon, this.tipFlare, this.hitFlare, this.sparks])
            {
                glow.layers.set(GLOW_LAYER)
            }
            fringe.layers.set(OVERLAY_LAYER)
            shells.forEach((shell, i) => shell.layers.set(i % 2 === 0 ? UNDERLAY_LAYER : OVERLAY_LAYER))
            this.hitFringe.layers.set(UNDERLAY_LAYER)
        }
        this.setColor(color)
        this.look = this.currentLook
    }

    get look(): BeamLook
    {
        return this.currentLook
    }

    set look(look: BeamLook)
    {
        this.currentLook = look
        this.fringe.visible = look === "pixels"
        for (const shell of this.shells)
        {
            shell.visible = look === "shell"
        }
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

        // the shells turn their hue anew each time it fires, the back and the front of each the same
        if (strength > 0 && !this.fired)
        {
            SHELLS.forEach(({ hues }, index) =>
            {
                const turn = hues[Math.floor(Math.random() * hues.length)] * 2 * Math.PI
                this.shellMaterials[index * 2].uniforms.hueTurn.value = turn
                this.shellMaterials[index * 2 + 1].uniforms.hueTurn.value = turn
            })
        }
        this.fired = strength > 0
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
        for (const material of this.shellMaterials)
        {
            material.dispose()
        }
        this.hitFringe.material.dispose()
        this.tipFlare.material.dispose()
        this.hitFlare.material.dispose()
        this.sparks.geometry.dispose()
        ;(this.sparks.material as PointsMaterial).dispose()
        this.ribbon.geometry.dispose()
    }
}
