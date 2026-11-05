import {
    ClampToEdgeWrapping,
    DataTexture,
    DataUtils,
    FloatType,
    HalfFloatType,
    LinearFilter,
    type Material,
    type MeshBasicMaterial,
    NearestFilter,
    type PixelFormat,
    RedFormat,
    RepeatWrapping,
    RGBAFormat,
    RGFormat,
    Vector2
} from "three"
import {
    castWallDistances,
    LIGHT_TEXELS,
    type LevelLighting,
    RIM_FADE_END,
    RIM_FADE_START,
    RIM_GATE_END,
    RIM_GATE_START,
    WALL_CLEARANCE
} from "../map/dungeonLights"

/*
 * Materials lit by the baked light field of a dungeon level. Everything looks up the light of its position, so moving things
 * cost the same as walls, no matter how many lights there are.
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
 * Where the hero light is while there is none
 */
const NO_HERO = 1e6

const PARS = /* glsl */`
    uniform sampler2D lightColors;
    uniform sampler2D lightDirections;
    uniform vec2 lightOrigin;
    uniform vec2 lightSize;
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
 * Textures and uniforms of a baked light field
 */
export interface LightField
{
    uniforms: {
        lightColors: { value: DataTexture }
        lightDirections: { value: DataTexture }
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
export function createLightField({ minX, minZ, width, height, colors, directions, walls }: LevelLighting): LightField
{
    // world positions need the full floats, and mixing the ends of different walls makes no sense
    const wallTexture = new DataTexture(walls, width, height, RGBAFormat, FloatType)
    wallTexture.magFilter = wallTexture.minFilter = NearestFilter
    wallTexture.wrapS = wallTexture.wrapT = ClampToEdgeWrapping
    wallTexture.needsUpdate = true

    const heroTexture = createTexture(new Float32Array(HERO_DIRECTIONS), HERO_DIRECTIONS, 1, RedFormat)
    heroTexture.wrapS = RepeatWrapping

    return {
        uniforms: {
            lightColors: { value: createTexture(colors, width, height, RGBAFormat) },
            lightDirections: { value: createTexture(directions, width, height, RGFormat) },
            lightWalls: { value: wallTexture },
            lightOrigin: { value: new Vector2(minX, minZ) },
            lightSize: { value: new Vector2(width / LIGHT_TEXELS, height / LIGHT_TEXELS) },
            heroDistances: { value: heroTexture },
            heroPosition: { value: new Vector2(NO_HERO, NO_HERO) }
        }
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
                        vec2 uv = (stayOnSide(vLightPosition + worldNormal.xz * ${NORMAL_OFFSET.toFixed(3)}) - lightOrigin) / lightSize;
                        vec2 toLight = texture2D(lightDirections, uv).rg;
                        toLight /= max(length(toLight), 0.02);
                        vec3 worldDirection = normalize(vec3(toLight.x, ${LIGHT_ELEVATION.toFixed(3)}, toLight.y));

                        directLight.color = texture2D(lightColors, uv).rgb * ${LIGHT_GAIN.toFixed(3)};
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
                vec2 rimUv = ((rimMatrix * vec4(transformed, 1.0)).xz - lightOrigin) / lightSize;
                vec4 rimField = texture2D(lightColors, rimUv);
                vec2 rimDirection = texture2D(lightDirections, rimUv).rg;
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
