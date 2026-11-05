import { resolve } from "node:path"
import { powerAssert } from "rollup-plugin-power-assert"
import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"
import glsl from "vite-plugin-glsl"

const TEST_PATTERN = "test/**/*.{js,ts}"

export default defineConfig(({ mode }) => {
    const PRODUCTION = mode === "production"
    // options from the environment or from .env files, e.g. DISABLE_MUSIC=1 in .env.local
    const env = loadEnv(mode, import.meta.dirname, "")
    return {
        // relative URLs so the build works from any sub-directory
        base: "./",

        plugins: [
            // import .glsl/.frag/.vert files as strings, with #include support
            glsl({ minify: PRODUCTION }),
            // descriptive power-assert messages for assert() in tests
            powerAssert({ include: TEST_PATTERN })
        ],

        define: {
            __PROD: JSON.stringify(PRODUCTION),
            __DEV: JSON.stringify(!PRODUCTION),
            __STATS: JSON.stringify(!!process.env.STATS),
            __DISABLE_MUSIC: JSON.stringify(env.DISABLE_MUSIC === "1")
        },

        // shared modules of workers are split into chunks, which needs ES module workers
        worker: {
            format: "es"
        },

        test: {
            include: [TEST_PATTERN]
        },

        build: {
            outDir: "docs",
            emptyOutDir: true,
            sourcemap: true,
            rolldownOptions: {
                input: {
                    main: resolve(import.meta.dirname, "index.html"),
                    "2d": resolve(import.meta.dirname, "index2d.html"),
                    test: resolve(import.meta.dirname, "test.html"),
                    "3d": resolve(import.meta.dirname, "3d.html"),
                    meeple: resolve(import.meta.dirname, "meeple.html"),
                    world: resolve(import.meta.dirname, "world.html"),
                    path: resolve(import.meta.dirname, "path.html"),
                    map: resolve(import.meta.dirname, "map.html"),
                    dungeon: resolve(import.meta.dirname, "dungeon.html"),
                    dungeon3d: resolve(import.meta.dirname, "dungeon3d.html")
                }
            }
        },

        server: {
            allowedHosts: ["pronto.fritz.box"]
        }
    }
})
