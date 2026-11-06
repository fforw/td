/**
 * Drives a page of the running dev server in headless Chrome with software WebGL and takes small screenshots, for
 * pages that need WebGL or gamepad input. Frame rates mean nothing here. Steps run in the given order:
 *
 *     node scripts/shot.ts <url or path> [options and steps]
 *
 *     --size WxH      viewport size, default 1280x800 (option, before the page loads)
 *     --gamepad       replaces navigator.getGamepads with a standard pad, for --press (option)
 *     --wait MS       sleeps
 *     --until JS      waits up to 30s for the expression to be truthy
 *     --eval JS       evaluates the expression and prints the result, awaiting promises
 *     --press N       holds gamepad button N for a moment
 *     --stick A,B,C,D sets the four gamepad axes until the next time
 *     --scale F       scale of the following shots, default 0.5
 *     --clip AREA     area of the following shots: a CSS selector, "x,y,w,h", or "off"
 *     --shot FILE     writes a JPEG
 *
 * Prints the results and page errors and exits with 1 if there were errors.
 *
 *     node scripts/shot.ts /dungeon3d.html --wait 3000 --shot a.jpg --clip canvas --scale 1 --shot b.jpg
 */
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

const CHROME = "/usr/bin/google-chrome"
const BASE_URL = "http://localhost:5173"
const TIMEOUT = 30000
const PRESS_TIME = 600

const [page, ...args] = process.argv.slice(2)
if (!page || page.startsWith("--"))
{
    console.error("usage: node scripts/shot.ts <url or path> [options and steps], see the top of the script")
    process.exit(2)
}

function optionValue(name: string): string | undefined
{
    const index = args.indexOf(name)
    return index < 0 ? undefined : args.splice(index, 2)[1]
}

const [width, height] = (optionValue("--size") ?? "1280x800").split("x").map(Number)
const gamepadIndex = args.indexOf("--gamepad")
if (gamepadIndex >= 0)
{
    args.splice(gamepadIndex, 1)
}

const GAMEPAD_STUB = `
    window.__pressed = new Set();
    window.__axes = [0, 0, 0, 0];
    navigator.getGamepads = () => [{
        id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: window.__axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({
            pressed: window.__pressed.has(i),
            touched: window.__pressed.has(i),
            value: window.__pressed.has(i) ? 1 : 0
        }))
    }]`

const profile = mkdtempSync(join(tmpdir(), "td-shot-"))
const chrome = spawn(
    CHROME,
    [
        "--headless=new",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--remote-debugging-port=0",
        "--user-data-dir=" + profile,
        "about:blank"
    ],
    { stdio: "ignore" }
)

const problems = new Set<string>()
const waiting = new Map<number, (message: any) => void>()
let nextId = 1
let socket: WebSocket

function send(method: string, params = {}): Promise<any>
{
    return new Promise((resolve, reject) => {
        const id = nextId++
        waiting.set(id, message => (message.error ? reject(new Error(method + ": " + message.error.message)) : resolve(message.result)))
        socket.send(JSON.stringify({ id, method, params }))
    })
}

async function evaluate(expression: string): Promise<any>
{
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails)
    {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value
}

async function until(expression: string): Promise<void>
{
    const end = Date.now() + TIMEOUT
    while (!(await evaluate(expression)))
    {
        if (Date.now() > end)
        {
            throw new Error("timed out waiting for " + expression)
        }
        await sleep(100)
    }
}

function onMessage(message: any): void
{
    if (message.id)
    {
        waiting.get(message.id)?.(message)
        waiting.delete(message.id)
    }
    else if (message.method === "Runtime.exceptionThrown")
    {
        const { exception, text } = message.params.exceptionDetails
        problems.add(exception?.description ?? text)
    }
    else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error")
    {
        problems.add(message.params.args.map((arg: any) => arg.value ?? arg.description).join(" "))
    }
}

async function connect(): Promise<void>
{
    // chrome picks a free port and notes it in the profile, so several runs can coexist
    const end = Date.now() + TIMEOUT
    let target
    while (!target)
    {
        if (Date.now() > end)
        {
            throw new Error("could not connect to " + CHROME)
        }
        await sleep(100)
        try
        {
            const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]
            const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
            target = targets.find((t: any) => t.type === "page")
        }
        catch
        {
            // not up yet
        }
    }
    socket = new WebSocket(target.webSocketDebuggerUrl)
    socket.addEventListener("message", ({ data }) => onMessage(JSON.parse(data)))
    await new Promise(resolve => socket.addEventListener("open", resolve))
}

async function clipArea(area: string): Promise<number[]>
{
    if (/^[\d.]+(,[\d.]+){3}$/.test(area))
    {
        return area.split(",").map(Number)
    }
    const rect = await evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(area)})?.getBoundingClientRect();
        return r && [r.x, r.y, r.width, r.height]
    })()`)
    if (!rect)
    {
        throw new Error("no element for --clip " + area)
    }
    return rect
}

async function shot(file: string, scale: number, area: string): Promise<void>
{
    const [x, y, w, h] = area === "off" ? [0, 0, width, height] : await clipArea(area)
    const { data } = await send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 75,
        clip: { x, y, width: w, height: h, scale }
    })
    writeFileSync(file, Buffer.from(data, "base64"))
    console.log(`${file}: ${Math.round(w * scale)}x${Math.round(h * scale)}`)
}

async function runSteps(): Promise<void>
{
    let scale = 0.5
    let area = "off"
    for (let i = 0; i < args.length; i += 2)
    {
        const step = args[i]
        const value = args[i + 1]
        if (value === undefined)
        {
            throw new Error("missing value for " + step)
        }
        switch (step)
        {
            case "--wait":
                await sleep(Number(value))
                break
            case "--until":
                await until(value)
                break
            case "--eval":
                console.log(JSON.stringify(await evaluate(value)))
                break
            case "--press":
                await evaluate(`window.__pressed.add(${Number(value)})`)
                await sleep(PRESS_TIME)
                await evaluate(`window.__pressed.delete(${Number(value)})`)
                await sleep(PRESS_TIME)
                break
            case "--stick":
                await evaluate(`window.__axes = [${value}]`)
                break
            case "--scale":
                scale = Number(value)
                break
            case "--clip":
                area = value
                break
            case "--shot":
                await shot(value, scale, area)
                break
            default:
                throw new Error("unknown step " + step)
        }
    }
}

async function main(): Promise<void>
{
    await connect()
    await send("Page.enable")
    await send("Runtime.enable")
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false })
    if (gamepadIndex >= 0)
    {
        await send("Page.addScriptToEvaluateOnNewDocument", { source: GAMEPAD_STUB })
    }

    const url = /^https?:/.test(page) ? page : BASE_URL + page
    const { errorText } = await send("Page.navigate", { url })
    if (errorText)
    {
        throw new Error(`${url}: ${errorText}, is the dev server running?`)
    }
    await until(`document.readyState === "complete"`)
    await runSteps()
}

let failed = false
try
{
    await main()
}
catch (e)
{
    console.error("FAILED: " + (e as Error).message)
    failed = true
}

for (const problem of problems)
{
    console.error("page error: " + problem)
}

chrome.kill()
await sleep(200)
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
process.exit(failed || problems.size ? 1 : 0)
