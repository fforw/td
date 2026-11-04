import { FaceType } from "../map/geometry"

/**
 * Colors and symbols of the old map
 */
export const SEPIA = {
    /**
     * Color of the paper, which shows through at the open border of the map
     */
    paper: "#ecdcb6",
    /**
     * Color of the lines
     */
    ink: "#3f2a14",
    /**
     * Color of the shore lines running along the coast within the water
     */
    shore: "rgba(185 179 148 / 0.85)",
    /**
     * Color of the stains and the darkened edges of the paper, as #rrggbb
     */
    stain: "#6b4a1e",
    /**
     * Fill color per region, see regionOf(). They get darker the harder a region is to cross.
     */
    regions: new Map([
        [FaceType.GRASS, "#ecdcb6"],
        [FaceType.SAND, "#e6d29f"],
        [FaceType.SNOW, "#f0e8d6"],
        [FaceType.TREE, "#d2bb86"],
        [FaceType.SWAMP, "#b5a06c"],
        [FaceType.ROCK, "#78634d"],
        [FaceType.WATER, "#8c8d96"],
        [FaceType.WALL, "#494039"]
    ]),
    /**
     * Atlas sprite per face type and the size of its largest variant in map units. The others keep their size relative
     * to it, so images of the same sprite should have the same scale.
     */
    symbols: new Map([
        [FaceType.TREE, { sprite: "tree", size: 160 }],
        [FaceType.TREE2, { sprite: "tree2", size: 160 }],
        [FaceType.SWAMP, { sprite: "reeds", size: 100 }],
        [FaceType.ROCK, { sprite: "mountain", size: 100 }],
        [FaceType.WALL, { sprite: "castle", size: 220 }]
    ])
}
