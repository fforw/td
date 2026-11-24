import {
    AddEquation,
    BufferAttribute,
    CustomBlending,
    DoubleSide,
    DynamicDrawUsage,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    OneFactor,
    OneMinusSrcAlphaFactor,
    ShaderMaterial
} from "three"
import type { FireDrop } from "../monster/fireRain"
import { FIRE_ACTIVE, FIRE_FADE, FIRE_FALL, FIRE_WARN } from "./fireTiming"

/*
 * Fire coming down, in three instanced draws with an instance per strike: what is on the floor, the flames, and the embers
 * they scatter. All that moves is a function of the age in the shaders. The output is premultiplied as for the sigil.
 */

/**
 * Most strikes shown at a time, those beyond are left out
 */
const CAPACITY = 512

/**
 * Embers of a strike
 */
const EMBERS = 7

/**
 * Height over the floor in world units, above the sills of doors
 */
const HEIGHT = 0.025

/**
 * Half the size of the quad on the floor in units of the radius, with room for the glow
 */
const EXTENT = 1.5

/**
 * How far the disc must have grown for its outline to show, as a share of the radius
 */
const MIN_FILL = 0.05

/**
 * Size of scorch marks as a share of the radius
 */
const SCORCH = 0.66

/**
 * Height flames come down from, in world units
 */
const FALL_HEIGHT = 2.2

/**
 * Half the width and the height of the quad of flames in units of the radius
 */
const FLAME_WIDTH = 1.9
const FLAME_HEIGHT = 4

/**
 * Circles a flame consists of, and those cut out of it
 */
const PUFFS = 6
const HOLES = 4

/**
 * How often per second the next circle rises, while the flame falls and while it burns on the floor
 */
const FALL_RATE = 8
const BURN_RATE = 5

/**
 * Seconds flames burn on the floor
 */
const BURN = FIRE_FADE * 0.8

const COMMON_VERTEX = `
attribute vec4 drop;
attribute float seed;
flat varying float vAge;
flat varying float vRandom;

void setVaryings()
{
    vAge = drop.w;
    vRandom = seed;
}

vec4 project(vec3 world)
{
    return projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`

const COMMON_FRAGMENT = `
flat varying float vAge;
flat varying float vRandom;

vec3 outputColor(vec3 c)
{
    return linearToOutputTexel(vec4(c, 1.0)).rgb;
}

// from dark red over orange to a pale yellow
vec3 fireColor(float heat)
{
    vec3 c = mix(vec3(0.35, 0.02, 0.0), vec3(1.0, 0.2, 0.01), smoothstep(0.0, 0.5, heat));
    c = mix(c, vec3(1.0, 0.62, 0.12), smoothstep(0.4, 0.75, heat));
    return mix(c, vec3(1.0, 0.95, 0.75), smoothstep(0.75, 1.0, heat));
}

float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p)
{
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
`

const FLOOR_VERTEX = `
varying vec2 vPoint;

void main()
{
    setVaryings();
    vPoint = position.xy * EXTENT;
    gl_Position = project(vec3(drop.x + vPoint.x * drop.z, HEIGHT, drop.y + vPoint.y * drop.z));
}
`

// the disc grows to the outline until it strikes, which tells when
const FLOOR_FRAGMENT = `
varying vec2 vPoint;

void main()
{
    float r = length(vPoint);
    float pixel = fwidth(r);
    if (vAge < 0.0)
    {
        float near = clamp(1.0 + vAge / WARN, 0.0, 1.0);
        float width = max(0.06, pixel * 0.8);
        float line = 1.0 - smoothstep(width - pixel * 0.7, width + pixel * 0.7, abs(r - 1.0 + width));
        float disc = 1.0 - smoothstep(near - pixel, near + pixel, r);
        float halo = exp(-abs(r - 1.0) * 9.0) * 0.35;
        float appear = smoothstep(MIN_FILL, MIN_FILL + 0.1, near) * (1.0 - smoothstep(1.3, EXTENT, r));
        vec3 edge = outputColor(mix(vec3(0.8, 0.06, 0.005), vec3(1.0, 0.3, 0.02), near));
        float fill = disc * mix(0.2, 0.65, near) * (1.0 - line);
        gl_FragColor = vec4(edge * (line * 0.9 + fill + halo * (1.0 - line)), line * 0.9 + fill) * appear;
        return;
    }
    float fade = clamp(1.0 - vAge / FADE, 0.0, 1.0);
    float hot = clamp(1.0 - vAge / ACTIVE, 0.0, 1.0);
    // a blob of a few waves around, with a whole number of each so there is no seam
    float angle = atan(vPoint.y, vPoint.x);
    float turn = vRandom * 6.2831853;
    float edge = SCORCH * (0.82 + 0.09 * sin(angle * 3.0 + turn) + 0.06 * sin(angle * 5.0 - turn * 3.0));
    float disc = 1.0 - smoothstep(edge - 0.03 - pixel, edge + 0.03 + pixel, r);
    float glow = exp(-r * r * 1.6) * (1.0 - smoothstep(1.1, EXTENT, r));
    // what strikes reaches as far as it hurts
    float flash = (1.0 - smoothstep(1.0 - pixel, 1.0 + pixel, r)) * hot;
    vec3 light = outputColor(fireColor(0.3 + 0.7 * hot)) * max(flash * 0.8, glow * fade * fade * 0.5);
    gl_FragColor = vec4(light, disc * 0.6 * sqrt(fade));
}
`

// upright, but stretched so circles are round as the camera sees them
const FLAME_VERTEX = `
varying vec2 vPoint;

void main()
{
    setVaryings();
    if (vAge < -FALL || vAge > BURN)
    {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    float stretch = 1.0 / max(0.3, viewMatrix[1][1]);
    vPoint = vec2(position.x * FLAME_WIDTH, (position.y * 0.5 + 0.5) * FLAME_HEIGHT);
    vec3 world = vec3(drop.x, HEIGHT + max(0.0, -vAge) / FALL * FALL_HEIGHT, drop.y);
    world += right * vPoint.x * drop.z;
    // to the front of where it strikes, so it stands in the middle as the camera sees it
    world.xz += normalize(vec2(viewMatrix[0][2], viewMatrix[2][2]) + 1e-5) * drop.z * 0.7;
    world.y += vPoint.y * drop.z * stretch;
    gl_Position = project(world);
}
`

// circles that rise and go from large and red to small and yellow, with others that rise through them cut out
const FLAME_FRAGMENT = `
varying vec2 vPoint;

// 1 within a circle
float circle(vec2 center, float radius, float pixel)
{
    return 1.0 - smoothstep(-pixel, pixel, length(vPoint - center) - radius);
}

void main()
{
    float pixel = max(fwidth(vPoint.x), fwidth(vPoint.y)) * 0.7;
    bool falling = vAge < 0.0;
    float burnt = max(0.0, vAge) / BURN;
    // dwindles instead of fading, so it stays crisp
    float size = falling ? 0.85 : 1.15 * sqrt(1.0 - burnt);
    float spread = falling ? 0.4 : 0.75 * (1.0 - 0.5 * burnt);
    float rise = falling ? 1.5 : mix(1.3, 0.8, burnt);
    // stretched as it falls, squashed as it lands, bouncing until it only sways, with the circles staying round
    float stretch = falling
        ? 1.25
        : 1.0 - 0.95 * exp(-vAge * 5.0) * cos(vAge * 12.0) + 0.42 * sin(vAge * 7.0 + vRandom * 6.2831853) * min(1.0, vAge * 4.0);

    float clock = vAge * (falling ? FALL_RATE : BURN_RATE) + 1000.0;
    float next = floor(clock);
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    // the youngest first, so small yellow ones are on top
    for (int i = 0; i < PUFFS; i++)
    {
        float id = next - float(i);
        float life = (float(i) + clock - next) / float(PUFFS);
        float side = hash(vec2(id, vRandom * 91.0)) * 2.0 - 1.0;
        float vary = hash(vec2(id + 0.5, vRandom * 57.0));
        float radius = mix(0.68, 0.16, life) * mix(0.8, 1.15, vary) * size * smoothstep(0.0, 0.12, life);
        float x = side * spread / mix(1.0, stretch, 0.6) * (1.0 - 0.6 * life) + sin(life * 5.0 + vary * 6.3) * 0.1;
        // the lowest ones touch the bottom, as high as they are
        float y = 0.8 * size + life * rise * stretch * mix(0.75, 1.1, vary);
        float cover = circle(vec2(x, y), radius, pixel) * 0.75 * (1.0 - smoothstep(0.85, 1.0, life));
        vec3 c = mix(vec3(0.62, 0.005, 0.005), vec3(1.0, 0.2, 0.01), smoothstep(0.08, 0.55, life));
        c = outputColor(mix(c, vec3(1.0, 0.8, 0.12), smoothstep(0.45, 0.85, life)));
        color = mix(color, c, cover);
        alpha = mix(alpha, 1.0, cover);
    }
    for (int i = 0; i < HOLES; i++)
    {
        float seed = float(i) + vRandom * 40.0;
        float wobble = noise(vec2(vAge * 2.0 + 10.0, seed * 7.3));
        float speed = mix(0.35, 0.8, hash(vec2(seed, 3.1)));
        float life = fract(hash(vec2(seed, 5.7)) + vAge * speed + wobble * 0.12);
        float radius = mix(0.12, 0.42, noise(vec2(vAge * 4.0 + 20.0, seed * 3.9))) * sin(life * 3.14159);
        float x = (hash(vec2(seed, 9.2)) * 2.0 - 1.0) * 1.1 + (wobble - 0.5) * 0.3;
        float keep = 1.0 - circle(vec2(x, 0.35 + life * rise * 1.2), radius * max(size, 0.4), pixel);
        color *= keep;
        alpha *= keep;
    }
    gl_FragColor = vec4(color, alpha);
}
`

const EMBER_VERTEX = `
varying vec2 vPoint;

float random(float n)
{
    return fract(sin(n * 78.233 + seed * 437.31) * 43758.5453);
}

void main()
{
    setVaryings();
    float index = position.z;
    float life = FADE * mix(0.45, 1.0, random(index + 0.2));
    if (vAge < 0.0 || vAge > life)
    {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vPoint = position.xy;
    float angle = random(index + 0.4) * 6.2831853;
    float out_ = drop.z * mix(0.8, 3.2, random(index + 0.6));
    float rise = drop.z * mix(4.0, 8.0, random(index + 0.8));
    vec3 world = vec3(drop.x + sin(angle) * out_ * vAge, 0.0, drop.y + cos(angle) * out_ * vAge);
    world.y = max(HEIGHT, HEIGHT + (rise * (1.0 - vAge / life)) * vAge);
    float size = drop.z * 0.13 * (1.0 - vAge / life);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    gl_Position = project(world + (right * vPoint.x + up * vPoint.y) * size);
}
`

const EMBER_FRAGMENT = `
varying vec2 vPoint;

void main()
{
    float strength = 1.0 - smoothstep(0.75, 1.0, length(vPoint));
    float heat = 0.75 - 0.4 * vAge / FADE;
    gl_FragColor = vec4(outputColor(fireColor(heat)) * strength, strength * 0.4);
}
`


/**
 * Returns the geometry of the given number of quads with x and y from -1 to 1, and the index of the quad in z
 */
function quads(count: number, drop: InstancedBufferAttribute, seed: InstancedBufferAttribute): InstancedBufferGeometry
{
    const positions: number[] = []
    const index: number[] = []
    for (let i = 0; i < count; i++)
    {
        positions.push(-1, -1, i, 1, -1, i, 1, 1, i, -1, 1, i)
        index.push(...[0, 1, 2, 0, 2, 3].map(corner => i * 4 + corner))
    }
    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute("drop", drop)
    geometry.setAttribute("seed", seed)
    geometry.setIndex(index)
    geometry.instanceCount = 0
    return geometry
}

function createMaterial(vertexShader: string, fragmentShader: string): ShaderMaterial
{
    const defines = {
        EXTENT,
        MIN_FILL,
        SCORCH,
        HEIGHT,
        FALL_HEIGHT,
        FLAME_WIDTH,
        FLAME_HEIGHT,
        FALL_RATE,
        BURN_RATE,
        BURN,
        WARN: FIRE_WARN,
        FALL: FIRE_FALL,
        ACTIVE: FIRE_ACTIVE,
        FADE: FIRE_FADE
    }
    return new ShaderMaterial({
        defines: {
            PUFFS,
            HOLES,
            ...Object.fromEntries(Object.entries(defines).map(([name, value]) => [name, "(" + value.toFixed(3) + ")"]))
        },
        vertexShader: COMMON_VERTEX + vertexShader,
        fragmentShader: COMMON_FRAGMENT + fragmentShader,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        side: DoubleSide
    })
}


/**
 * Shows the fire coming down in a level
 */
export default class FireRainCrowd
{
    readonly group = new Group()

    /** position, radius and age */
    private readonly drop = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
    private readonly seed = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1)
    private readonly meshes: Mesh<InstancedBufferGeometry, ShaderMaterial>[]

    constructor()
    {
        const { drop, seed } = this
        drop.setUsage(DynamicDrawUsage)
        seed.setUsage(DynamicDrawUsage)
        this.meshes = ([
            [1, FLOOR_VERTEX, FLOOR_FRAGMENT],
            [1, FLAME_VERTEX, FLAME_FRAGMENT],
            [EMBERS, EMBER_VERTEX, EMBER_FRAGMENT]
        ] as const).map(([count, vertex, fragment], i) => {
            const mesh = new Mesh(quads(count, drop, seed), createMaterial(vertex, fragment))
            mesh.frustumCulled = false
            // flames over what is on the floor
            mesh.renderOrder = i === 0 ? 0 : 1
            mesh.visible = false
            return mesh
        })
        this.group.add(...this.meshes)
    }

    update(drops: readonly FireDrop[]): void
    {
        const { drop, seed, meshes } = this
        const count = Math.min(drops.length, CAPACITY)
        for (let i = 0; i < count; i++)
        {
            const { x, z, radius, age, random } = drops[i]
            drop.setXYZW(i, x, z, radius, age)
            seed.setX(i, random)
        }
        drop.needsUpdate = true
        seed.needsUpdate = true
        for (const mesh of meshes)
        {
            mesh.geometry.instanceCount = count
            mesh.visible = count > 0
        }
    }
}
