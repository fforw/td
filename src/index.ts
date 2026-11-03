import "./style.css"
import "./game/title.css"
import { randomSeed, resetRandom } from "./math/random"
import { createSubtitle } from "./game/subtitle"

const seedParam = new URLSearchParams(location.search).get("seed")
const seed = randomSeed(seedParam ? +seedParam : null)
resetRandom(seed)

const subtitle = createSubtitle()

document.title = "Treasure & Dread: " + subtitle.text
document.querySelector("#title .subtitle")!.textContent = subtitle.text

const fixed = document.createElement("a")
fixed.href = "index.html?seed=" + seed
fixed.appendChild(document.createTextNode("seed"))
document.getElementById("footer")!.appendChild(fixed)
