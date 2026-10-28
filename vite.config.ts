import { resolve } from "node:path"
import { powerAssert } from "rollup-plugin-power-assert"
import { defineConfig } from "vitest/config"
import glsl from "vite-plugin-glsl"

const TEST_PATTERN = "test/**/*.{js,ts}"

export default defineConfig(({ mode }) => {
    const PRODUCTION = mode === "production"
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
            __STATS: JSON.stringify(!!process.env.STATS)
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
                    test: resolve(import.meta.dirname, "test.html"),
                    "3d": resolve(import.meta.dirname, "3d.html")
                }
            }
        }
    }
})
