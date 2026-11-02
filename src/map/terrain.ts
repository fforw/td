import Prando from "prando"
import { createNoise2D, type NoiseFunction2D } from "simplex-noise"
import { FaceType } from "../core/geometry"

/*
 * Terrain from a virtual climate. The map stays flat, but every point has a height, temperature and moisture that
 * only depend on the world seed and the position, so neighboring patches agree along their borders no matter in which
 * order they get built.
 *
 * All distances are in map units, a patch is about 700 x 600 units.
 */

const TAU = Math.PI * 2

/**
 * Wavelengths of the two height octaves: areas that are generally higher or lower than others and local variation
 */
const HEIGHT_LARGE = 4000
const HEIGHT_SMALL = 400

/**
 * Weight of the large height octave, the small one gets the rest
 */
const HEIGHT_LARGE_WEIGHT = 0.7

const MOISTURE_SCALE = 2500

/**
 * North-south distance from one cold low of the temperature curve to the next. The curve repeats forever, which is far
 * more than anyone explores.
 */
const CLIMATE_PERIOD = 40 * 600

/**
 * Temperature loss per height above the sea level
 */
const LAPSE_RATE = 0.45

/**
 * Temperature loss from the driest to the wettest areas. Besides making wet areas a bit colder, it bends the climate
 * borders, which would otherwise run straight from west to east wherever the height doesn't change the temperature.
 */
const MOISTURE_COOLING = 0.25

/**
 * Heights in the range -1 to 1 and temperatures and moisture in the range 0 to 1 at which the terrain changes
 */
export const SEA_LEVEL = -0.15
const BEACH_HEIGHT = SEA_LEVEL + 0.04
const SWAMP_HEIGHT = SEA_LEVEL + 0.15
const ROCK_HEIGHT = 0.5
const FREEZE_TEMPERATURE = 0.08
const SNOW_TEMPERATURE = 0.15
const FOREST_MOISTURE = 0.5
const SWAMP_MOISTURE = 0.62
const PRAIRIE_MOISTURE = 0.38
const PRAIRIE_TEMPERATURE = 0.5
const PINE_TEMPERATURE = 0.4

/**
 * Up to START_INNER from the origin the height is the height of plain land so the starting castle doesn't end up in
 * water or on a mountain. Up to START_RADIUS it blends into the noise.
 */
const START_INNER = 600
const START_RADIUS = 1200
const START_HEIGHT = 0.1

export interface Climate
{
    /**
     * Height from -1 to 1
     */
    height: number
    /**
     * Temperature from 0 (cold) to 1 (hot), including the loss with height
     */
    temperature: number
    /**
     * Moisture from 0 (dry) to 1 (wet)
     */
    moisture: number
}


/**
 * Returns the face type for the given climate.
 *
 * @param climate   climate at the face
 * @param random    random numbers for the mix of types within an area, like trees and clearings in a forest
 */
export function classify(climate: Climate, random: () => number): FaceType
{
    const { height, temperature, moisture } = climate

    if (height < SEA_LEVEL)
    {
        return temperature < FREEZE_TEMPERATURE ? FaceType.SNOW : FaceType.WATER
    }
    if (temperature < SNOW_TEMPERATURE)
    {
        return FaceType.SNOW
    }
    if (height < BEACH_HEIGHT)
    {
        return FaceType.SAND
    }
    if (height > ROCK_HEIGHT && random() < 0.5)
    {
        return FaceType.ROCK
    }
    if (moisture > SWAMP_MOISTURE && height < SWAMP_HEIGHT)
    {
        return FaceType.SWAMP
    }
    if (moisture < PRAIRIE_MOISTURE && temperature > PRAIRIE_TEMPERATURE)
    {
        return FaceType.PRAIRIE
    }

    const tree = temperature < PINE_TEMPERATURE ? FaceType.TREE2 : FaceType.TREE
    if (moisture > FOREST_MOISTURE)
    {
        // forests with clearings
        return random() < 0.85 ? tree : FaceType.GRASS
    }
    // grassland with a few trees
    return random() < 0.08 ? tree : FaceType.GRASS
}


export default class Terrain
{
    private heightLarge: NoiseFunction2D
    private heightSmall: NoiseFunction2D
    private moistureNoise: NoiseFunction2D

    constructor(seed: number)
    {
        const prando = new Prando(seed)
        const random = () => prando.next()
        this.heightLarge = createNoise2D(random)
        this.heightSmall = createNoise2D(random)
        this.moistureNoise = createNoise2D(random)
    }

    /**
     * Returns the climate at the given position in map units
     */
    climate(x: number, y: number): Climate
    {
        let height =
            this.heightLarge(x / HEIGHT_LARGE, y / HEIGHT_LARGE) * HEIGHT_LARGE_WEIGHT +
            this.heightSmall(x / HEIGHT_SMALL, y / HEIGHT_SMALL) * (1 - HEIGHT_LARGE_WEIGHT)

        const d = Math.max(0, Math.sqrt(x * x + y * y) - START_INNER) / (START_RADIUS - START_INNER)
        if (d < 1)
        {
            const w = 1 - d * d * (3 - 2 * d)
            height += (START_HEIGHT - height) * w
        }

        const moisture = 0.5 + 0.5 * this.moistureNoise(x / MOISTURE_SCALE, y / MOISTURE_SCALE)

        // the start lies halfway between the warmest and the coldest band
        const base = 0.5 + 0.5 * Math.sin(TAU * y / CLIMATE_PERIOD)
        const temperature = Math.min(1, Math.max(0,
            base - Math.max(0, height - SEA_LEVEL) * LAPSE_RATE - (moisture - 0.5) * MOISTURE_COOLING
        ))

        return { height, temperature, moisture }
    }

    /**
     * Returns the face type at the given position in map units
     */
    faceType(x: number, y: number, random: () => number): FaceType
    {
        return classify(this.climate(x, y), random)
    }
}
