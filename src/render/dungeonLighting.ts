import {
    ClampToEdgeWrapping,
    Color,
    DataTexture,
    DataUtils,
    FloatType,
    GLSL3,
    HalfFloatType,
    LinearFilter,
    type Material,
    Mesh,
    type MeshBasicMaterial,
    NearestFilter,
    NoBlending,
    OrthographicCamera,
    type PixelFormat,
    PlaneGeometry,
    RawShaderMaterial,
    RedFormat,
    RepeatWrapping,
    RGBAFormat,
    Scene,
    type Texture,
    Vector2,
    type WebGLRenderer,
    WebGLRenderTarget
} from "three"
import {
    castWallDistances,
    FLICKER_MIN,
    LIGHT_CHANNELS,
    LIGHT_TEXELS,
    type DungeonLight,
    type LevelLighting,
    NO_WALL,
    RIM_FADE_END,
    RIM_FADE_START,
    RIM_GATE_END,
    RIM_GATE_START,
    WALL_CLEARANCE
} from "../map/dungeonLights"

/*
 * Materials lit by the light field of a dungeon level. A pass works out what the lights give per texel of the field from the
 * baked share of them that the walls leave, whenever they change their strength or color. Everything else only looks up the
 * field by its position, so moving things cost the same as walls, no matter how many lights there are. The field has 8 bits per
 * channel, as rendering to anything else isn't possible on all devices.
 */

/**
 * Light of the field for the shaded materials. The shaded materials divide by PI.
 */
const LIGHT_GAIN = 6

/**
 * Height of the lights over the plane for the direction of the light. A flat direction leaves no light on the floor.
 */
const LIGHT_ELEVATION = 1

/**
 * How far surfaces look up their light in front of them in world units, to stay on their own side of a thin wall. A wall
 * looks at the floor in front of it.
 */
const NORMAL_OFFSET = 0.13

/**
 * Share of white in the color of the rim
 */
const RIM_PALE = 0.6

/**
 * Brightness of the rim. It isn't tone mapped, so it stays bright against the dark.
 */
const RIM_BRIGHTNESS = 1

/**
 * How much thicker than the outline the rim gets
 */
const RIM_WIDEN = 0.6

/**
 * Number of directions the hero light knows its walls in
 */
const HERO_DIRECTIONS = 1024

/**
 * How far the hero light reaches in world units
 */
const HERO_REACH = 3.5

/**
 * Radius of the hero light in world units, which sets the size of its soft shadows
 */
const HERO_RADIUS = 0.12

/**
 * Height of the hero light in world units, above a meeple and below the top of the walls
 */
const HERO_HEIGHT = 0.5

const HERO_COLOR = "vec3(1.0, 0.8, 0.55)"
const HERO_GAIN = 3

/**
 * How far behind a wall in world units the shadow of the hero light starts. Faces of walls look up their distance in front
 * of them, so this only has to keep the floor from flickering and stays within the thickness of a thin wall.
 */
const HERO_BIAS = 0.02

/**
 * How far to the sides to look for walls that give a soft shadow, as an angle in radians
 */
const HERO_SEARCH = 0.2

/**
 * Number of directions to look at on each side
 */
const HERO_TAPS = 3

/**
 * Number of halvings to find the edge of a shadow between two directions
 */
const HERO_EDGE_STEPS = 4

/**
 * How fast lights flicker, in radians per second, with how much of the flicker each of the rates has. They have no common
 * multiple, so the flicker doesn't visibly repeat.
 */
const FLICKER_RATES: [number, number][] = [[9.1, 0.5], [14.7, 0.3], [4.3, 0.2]]

/**
 * Golden angle, to give every light its own phase
 */
const FLICKER_PHASE = 2.399963

/**
 * Biggest energy the light field can hold. It keeps square roots, which leaves most of its 8 bits to the dark end.
 */
const FIELD_RANGE = 16

/**
 * Flashes per minute of the disco lights
 */
const DISCO_BPM = 60

/**
 * Where the hero light is while there is none
 */
const NO_HERO = 1e6

/**
 * Looks up the color and energy of all lights at a position and the sum of their directions
 */
const PARS = /* glsl */`
    uniform sampler2D lightColors;
    uniform sampler2D lightDirections;
    uniform vec2 lightOrigin;
    uniform vec2 lightSize;

    void readLights(vec2 position, out vec4 field, out vec2 fieldDirection)
    {
        vec2 uv = (position - lightOrigin) / lightSize;
        field = texture2D(lightColors, uv);
        field *= field * ${FIELD_RANGE.toFixed(1)};
        vec4 direction = texture2D(lightDirections, uv);
        fieldDirection = (direction.xy * 2.0 - 1.0) * direction.z * direction.z * ${FIELD_RANGE.toFixed(1)};
    }
`

/**
 * Adds up the lights of a texel of the light field, the same way lightAt() does it for a light that the walls don't block
 */
const FIELD_PASS = /* glsl */`
    precision highp float;
    precision highp int;
    precision highp sampler2D;

    uniform sampler2D lightVisibility;
    uniform sampler2D lightIds;
    uniform sampler2D lightData;
    uniform vec2 lightOrigin;

    layout(location = 0) out vec4 outColor;
    layout(location = 1) out vec4 outDirection;

    void main()
    {
        ivec2 texel = ivec2(gl_FragCoord.xy);
        vec2 position = lightOrigin + gl_FragCoord.xy / ${LIGHT_TEXELS.toFixed(1)};
        vec4 visibility = texelFetch(lightVisibility, texel, 0);
        vec4 ids = texelFetch(lightIds, texel, 0);

        vec4 field = vec4(0.0);
        vec2 direction = vec2(0.0);
        for (int i = 0; i < ${LIGHT_CHANNELS}; i++)
        {
            if (visibility[i] > 0.0)
            {
                int id = int(ids[i] * 255.0 + 0.5);
                vec4 place = texelFetch(lightData, ivec2(id, 0), 0);
                vec2 toLight = place.xy - position;
                float d = length(toLight);
                float left = 1.0 - d * d / (place.w * place.w);
                if (left > 0.0)
                {
                    vec4 light = texelFetch(lightData, ivec2(id, 1), 0);
                    float radius = place.z;
                    float fade = left * left / (2.0 * radius) * visibility[i];
                    float near = d > radius ? radius / d : d / radius;
                    field += light * (d > radius ? 2.0 * asin(radius / d) : ${Math.PI.toFixed(6)}) * fade;
                    direction += toLight / max(d, 1e-5) * 2.0 * near * fade * light.a;
                }
            }
        }

        float own = length(direction);
        outColor = sqrt(min(field / ${FIELD_RANGE.toFixed(1)}, vec4(1.0)));
        outDirection = vec4(direction / max(own, 1e-5) * 0.5 + 0.5, sqrt(min(own / ${FIELD_RANGE.toFixed(1)}, 1.0)), 1.0);
    }
`

/**
 * Moves a lookup away from the walls around it, on the side it is on. The second round is for corners, where getting away
 * from one wall leads to the other.
 */
const STAY_ON_SIDE = /* glsl */`
    uniform sampler2D lightWalls;

    vec2 stayOnSide(vec2 position)
    {
        for (int i = 0; i < 2; i++)
        {
            vec4 wall = texture2D(lightWalls, (position - lightOrigin) / lightSize);
            if (wall.x >= ${NO_WALL.toFixed(1)})
            {
                break;
            }
            vec2 along = wall.zw - wall.xy;
            vec2 offset = position - wall.xy;
            vec2 away = offset - along * clamp(dot(offset, along) / max(dot(along, along), 1e-6), 0.0, 1.0);
            float distance = length(away);
            position += away / max(distance, 1e-5) * max(0.0, ${WALL_CLEARANCE.toFixed(4)} - distance);
        }
        return position;
    }
`

/**
 * Share of the hero light that reaches a point. The walls next to the direction of the point tell how wide its soft shadow is:
 * nothing right behind a wall, more the further the point is behind it.
 */
const HERO_VISIBILITY = /* glsl */`
    uniform sampler2D heroDistances;
    uniform vec2 heroPosition;

    float heroDistance(float angle)
    {
        return texture2D(heroDistances, vec2(angle / ${(Math.PI * 2).toFixed(6)}, 0.5)).r;
    }

    float heroVisibility(float angle, float distance)
    {
        float limit = distance - ${HERO_BIAS.toFixed(3)};
        float blockers = 0.0, count = 0.0;
        for (int i = -${HERO_TAPS}; i <= ${HERO_TAPS}; i++)
        {
            float blocker = heroDistance(angle + float(i) / ${HERO_TAPS}.0 * ${HERO_SEARCH.toFixed(3)});
            if (blocker < limit)
            {
                blockers += blocker;
                count += 1.0;
            }
        }
        if (count == 0.0)
        {
            return 1.0;
        }

        float blocker = blockers / count;
        float spread = min(${HERO_SEARCH.toFixed(3)}, ${HERO_RADIUS.toFixed(3)} * (distance - blocker) / (distance * blocker));

        // finding the edges between the directions keeps the soft shadow free of bands
        float seen = 0.0;
        float from = angle - spread;
        bool fromSeen = heroDistance(from) >= limit;
        for (int i = 1 - ${HERO_TAPS}; i <= ${HERO_TAPS}; i++)
        {
            float to = angle + float(i) / ${HERO_TAPS}.0 * spread;
            bool toSeen = heroDistance(to) >= limit;
            float share = fromSeen ? 1.0 : 0.0;
            if (toSeen != fromSeen)
            {
                float low = from, high = to;
                for (int j = 0; j < ${HERO_EDGE_STEPS}; j++)
                {
                    float middle = (low + high) / 2.0;
                    if ((heroDistance(middle) >= limit) == fromSeen)
                    {
                        low = middle;
                    }
                    else
                    {
                        high = middle;
                    }
                }
                float at = (low + high) / 2.0;
                share = fromSeen ? (at - from) / (to - from) : (to - at) / (to - from);
            }
            seen += share;
            from = to;
            fromSeen = toSeen;
        }
        return seen / ${(HERO_TAPS * 2).toFixed(1)};
    }
`


/**
 * Textures, uniforms and pass of a light field
 */
export interface LightField
{
    /**
     * Number of lights
     */
    count: number

    /**
     * Whether the lights changed since the last updateLightField()
     */
    stale: boolean

    target: WebGLRenderTarget
    scene: Scene
    camera: OrthographicCamera

    uniforms: {
        lightVisibility: { value: DataTexture }
        lightIds: { value: DataTexture }
        lightData: { value: DataTexture }
        lightColors: { value: Texture }
        lightDirections: { value: Texture }
        lightWalls: { value: DataTexture }
        lightOrigin: { value: Vector2 }
        lightSize: { value: Vector2 }
        heroDistances: { value: DataTexture }
        heroPosition: { value: Vector2 }
    }
}


function createTexture(data: Float32Array, width: number, height: number, format: PixelFormat): DataTexture
{
    const half = new Uint16Array(data.length)
    for (let i = 0; i < data.length; i++)
    {
        half[i] = DataUtils.toHalfFloat(data[i])
    }

    const texture = new DataTexture(half, width, height, format, HalfFloatType)
    texture.magFilter = texture.minFilter = LinearFilter
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
}


/**
 * Creates the light field for a baked level
 */
export function createLightField({ lights, minX, minZ, width, height, visibility, lightIds, walls }: LevelLighting): LightField
{
    // world positions need the full floats, and mixing the ends of different walls makes no sense
    const wallTexture = new DataTexture(walls, width, height, RGBAFormat, FloatType)
    wallTexture.magFilter = wallTexture.minFilter = NearestFilter
    wallTexture.wrapS = wallTexture.wrapT = ClampToEdgeWrapping
    wallTexture.needsUpdate = true

    const heroTexture = createTexture(new Float32Array(HERO_DIRECTIONS), HERO_DIRECTIONS, 1, RedFormat)
    heroTexture.wrapS = RepeatWrapping

    const visibilityTexture = new DataTexture(visibility, width, height, RGBAFormat)
    visibilityTexture.needsUpdate = true

    const idTexture = new DataTexture(lightIds, width, height, RGBAFormat)
    idTexture.needsUpdate = true

    // per light its place and size in one row and its color and strength in the next, with the empty id 0 in front
    const data = new Float32Array((lights.length + 1) * 2 * 4)
    const rowLength = (lights.length + 1) * 4
    lights.forEach(({ x, z, radius, reach, color }, index) => {
        data.set([x, z, radius, reach], (index + 1) * 4)
        data.set([...color, 1], rowLength + (index + 1) * 4)
    })
    const dataTexture = new DataTexture(data, lights.length + 1, 2, RGBAFormat, FloatType)
    dataTexture.magFilter = dataTexture.minFilter = NearestFilter
    dataTexture.needsUpdate = true

    const target = new WebGLRenderTarget(width, height, {
        count: 2,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false
    })

    const uniforms: LightField["uniforms"] = {
        lightVisibility: { value: visibilityTexture },
        lightIds: { value: idTexture },
        lightData: { value: dataTexture },
        lightColors: { value: target.textures[0] },
        lightDirections: { value: target.textures[1] },
        lightWalls: { value: wallTexture },
        lightOrigin: { value: new Vector2(minX, minZ) },
        lightSize: { value: new Vector2(width / LIGHT_TEXELS, height / LIGHT_TEXELS) },
        heroDistances: { value: heroTexture },
        heroPosition: { value: new Vector2(NO_HERO, NO_HERO) }
    }

    const pass = new Mesh(new PlaneGeometry(2, 2), new RawShaderMaterial({
        glslVersion: GLSL3,
        uniforms,
        vertexShader: /* glsl */`
            in vec3 position;

            void main()
            {
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: FIELD_PASS,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false
    }))
    pass.frustumCulled = false
    const scene = new Scene()
    scene.add(pass)

    return { count: lights.length, stale: true, target, scene, camera: new OrthographicCamera(), uniforms }
}


/**
 * Brings the light field up to date with its lights. It has to happen before rendering what is lit by it and costs nothing
 * while the lights stay the same.
 *
 * @param renderer  renderer
 * @param field     light field
 */
export function updateLightField(renderer: WebGLRenderer, field: LightField): void
{
    if (field.stale)
    {
        const previous = renderer.getRenderTarget()
        renderer.setRenderTarget(field.target)
        renderer.render(field.scene, field.camera)
        renderer.setRenderTarget(previous)
        field.stale = false
    }
}


const heroDistances = new Float32Array(HERO_DIRECTIONS)

/**
 * Moves the hero light of the field. There is no hero light before the first move.
 *
 * @param field     light field
 * @param segments  segment array of the level
 * @param x         position of the light
 * @param z         position of the light
 */
export function moveHeroLight({ uniforms }: LightField, segments: Float64Array, x: number, z: number): void
{
    castWallDistances(segments, x, z, HERO_REACH, heroDistances)

    const texture = uniforms.heroDistances.value
    const half = texture.image.data as Uint16Array
    for (let i = 0; i < HERO_DIRECTIONS; i++)
    {
        half[i] = DataUtils.toHalfFloat(heroDistances[i])
    }
    texture.needsUpdate = true
    uniforms.heroPosition.value.set(x, z)
}


/**
 * Turns off the hero light of the field until it moves again
 */
export function hideHeroLight({ uniforms }: LightField): void
{
    uniforms.heroPosition.value.set(NO_HERO, NO_HERO)
}


/**
 * Changes the strength of a light, which also dims its color
 *
 * @param field     light field
 * @param lights    lights of the level
 * @param index     index of the light
 * @param strength  strength of the light, 1 for what it was baked with
 */
function setLightStrength({ uniforms, count }: LightField, lights: readonly DungeonLight[], index: number, strength: number): void
{
    const data = uniforms.lightData.value.image.data as Float32Array
    const [r, g, b] = lights[index].color
    data.set([r * strength, g * strength, b * strength, strength], (count + 1) * 4 + (index + 1) * 4)
}


/**
 * Lets all lights flicker, each in its own way
 *
 * @param field     light field
 * @param lights    lights of the level
 * @param time      time in seconds
 */
export function flickerLights(field: LightField, lights: readonly DungeonLight[], time: number): void
{
    for (let i = 0; i < lights.length; i++)
    {
        let wave = 0, step = 1
        for (const [rate, share] of FLICKER_RATES)
        {
            wave += Math.sin(time * rate + i * FLICKER_PHASE * step++) * share
        }
        setLightStrength(field, lights, i, FLICKER_MIN + (1 - FLICKER_MIN) * (wave + 1) / 2)
    }
    field.uniforms.lightData.value.needsUpdate = true
    field.stale = true
}


const complement = new Color()

/**
 * Lets all lights flash together, every other flash in the color on the opposite side of the color wheel. The color changes
 * between two flashes, where the lights are off.
 *
 * @param field     light field
 * @param lights    lights of the level
 * @param time      time in seconds
 */
export function discoLights(field: LightField, lights: readonly DungeonLight[], time: number): void
{
    const beat = time * DISCO_BPM / 60
    const wave = Math.sin(beat * Math.PI)
    const strength = wave * wave
    const opposite = Math.floor(beat) % 2 === 1

    const data = field.uniforms.lightData.value.image.data as Float32Array
    for (let i = 0; i < lights.length; i++)
    {
        const [r, g, b] = lights[i].color
        if (opposite)
        {
            complement.setRGB(r, g, b).offsetHSL(0.5, 0, 0)
            data.set([complement.r * strength, complement.g * strength, complement.b * strength, strength], (field.count + 1) * 4 + (i + 1) * 4)
        }
        else
        {
            setLightStrength(field, lights, i, strength)
        }
    }
    field.uniforms.lightData.value.needsUpdate = true
    field.stale = true
}


/**
 * Stops the flicker or disco and puts all lights back to their own color at full strength
 *
 * @param field     light field
 * @param lights    lights of the level
 */
export function steadyLights(field: LightField, lights: readonly DungeonLight[]): void
{
    for (let i = 0; i < lights.length; i++)
    {
        setLightStrength(field, lights, i, 1)
    }
    field.uniforms.lightData.value.needsUpdate = true
    field.stale = true
}


/**
 * Makes the given lit material add the light of the field to its other lights, through its own way of shading. That keeps
 * the bands of toon materials.
 *
 * @param material      lit material
 * @param field         light field
 * @param flatTops      whether faces looking straight up stay out of the field, for the tops of walls. The field only knows
 *                      the light on the floor, which has the hard edges of the walls right where their tops are.
 */
export function applyLightField(material: Material, { uniforms }: LightField, flatTops = false): void
{
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\nvarying vec2 vLightPosition;\nvarying float vLightHeight;`)
            .replace("#include <project_vertex>", /* glsl */`
                #include <project_vertex>
                vec4 lightPosition = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                lightPosition = instanceMatrix * lightPosition;
                #endif
                lightPosition = modelMatrix * lightPosition;
                vLightPosition = lightPosition.xz;
                vLightHeight = lightPosition.y;
            `)
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>\nvarying vec2 vLightPosition;\nvarying float vLightHeight;\n${PARS}\n${STAY_ON_SIDE}\n${HERO_VISIBILITY}`)
            .replace("#include <lights_fragment_begin>", /* glsl */`
                #include <lights_fragment_begin>
                {
                    vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
                    if (${flatTops ? "worldNormal.y < 0.99" : "true"})
                    {
                        vec4 field;
                        vec2 toLight;
                        readLights(stayOnSide(vLightPosition + worldNormal.xz * ${NORMAL_OFFSET.toFixed(3)}), field, toLight);
                        toLight /= max(length(toLight), 0.02);
                        vec3 worldDirection = normalize(vec3(toLight.x, ${LIGHT_ELEVATION.toFixed(3)}, toLight.y));

                        directLight.color = field.rgb * ${LIGHT_GAIN.toFixed(3)};
                        directLight.direction = normalize((viewMatrix * vec4(worldDirection, 0.0)).xyz);
                        directLight.visible = true;
                        RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);

                        vec2 fromHero = vLightPosition + worldNormal.xz * ${NORMAL_OFFSET.toFixed(3)} - heroPosition;
                        float heroDistance = length(fromHero);
                        if (heroDistance < ${HERO_REACH.toFixed(3)})
                        {
                            vec3 toHero = vec3(-fromHero.x, ${HERO_HEIGHT.toFixed(3)} - vLightHeight, -fromHero.y);
                            float heroFade = 1.0 - heroDistance * heroDistance / ${(HERO_REACH * HERO_REACH).toFixed(3)};

                            directLight.color = ${HERO_COLOR} * ${HERO_GAIN.toFixed(3)} * heroFade * heroFade / length(toHero)
                                * heroVisibility(atan(fromHero.y, fromHero.x), heroDistance);
                            directLight.direction = normalize((viewMatrix * vec4(normalize(toHero), 0.0)).xyz);
                            RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
                        }
                    }
                }
            `)
    }
    material.customProgramCacheKey = () => flatTops ? "light-field-flat-tops" : "light-field"
    material.needsUpdate = true
}


/**
 * Makes the given outline material turn into a rim on the side a light comes from, where its meeple stands in the dark and
 * the light still reaches it. It replaces what the material does with its shape.
 *
 * @param material      material of the hull around a part
 * @param field         light field
 * @param outline       thickness of the outline
 */
export function applyRimLight(material: MeshBasicMaterial, { uniforms }: LightField, outline: number): void
{
    material.toneMapped = false
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\nvarying float vRim;\nvarying vec3 vRimColor;\n${PARS}`)
            .replace("#include <begin_vertex>", /* glsl */`
                #include <begin_vertex>
                mat4 rimMatrix = modelMatrix * instanceMatrix;
                vec4 rimField;
                vec2 rimDirection;
                readLights((rimMatrix * vec4(transformed, 1.0)).xz, rimField, rimDirection);
                float rimOwn = length(rimDirection);

                vRim = smoothstep(${RIM_FADE_START.toFixed(3)}, ${RIM_FADE_END.toFixed(3)}, rimOwn)
                    * (1.0 - smoothstep(${RIM_GATE_START.toFixed(3)}, ${RIM_GATE_END.toFixed(3)}, rimField.a))
                    * smoothstep(0.0, 0.7, dot(normalize(mat3(rimMatrix) * normal).xz, rimDirection / max(rimOwn, 1e-4)));

                vec3 rimHue = rimField.rgb / max(max(rimField.r, max(rimField.g, rimField.b)), 1e-4);
                vRimColor = mix(rimHue, vec3(1.0), ${RIM_PALE.toFixed(3)}) * ${RIM_BRIGHTNESS.toFixed(3)};

                transformed += normal * ${outline.toFixed(4)} * (1.0 + vRim * ${RIM_WIDEN.toFixed(3)});
            `)
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>\nvarying float vRim;\nvarying vec3 vRimColor;`)
            .replace("#include <color_fragment>", /* glsl */`
                #include <color_fragment>
                diffuseColor.rgb = mix(diffuseColor.rgb, vRimColor, vRim);
            `)
    }
    material.customProgramCacheKey = () => "rim-light"
    material.needsUpdate = true
}
