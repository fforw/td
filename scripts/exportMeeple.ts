/**
 * Writes the procedural meeple parts as an OBJ file to tweak them in Blender, assembled like a meeple of height 0
 * in meeple units, +y up and facing +z.
 *
 *     node scripts/exportMeeple.ts [out.obj]
 */
import { writeFileSync } from "node:fs"
import { Group, Mesh, MeshBasicMaterial } from "three"
import { OBJExporter } from "three/addons/exporters/OBJExporter.js"
import { createBodyGeometry, createCurlyHair, createHeadGeometry, createShortHair, HEAD_Y } from "../src/meepleParts.ts"

const out = process.argv[2] ?? "meeple.obj"

const material = new MeshBasicMaterial()
const group = new Group()

function part(name: string, geometry: Mesh["geometry"], y = 0): void
{
    const mesh = new Mesh(geometry, material)
    mesh.name = name
    mesh.position.y = y
    group.add(mesh)
}

part("body", createBodyGeometry())
// hair is placed relative to the head center, like the instance matrices do
part("head", createHeadGeometry(), HEAD_Y)
part("hair_curly", createCurlyHair(), HEAD_Y)
part("hair_short", createShortHair(), HEAD_Y)

group.updateMatrixWorld(true)
writeFileSync(out, new OBJExporter().parse(group))
console.log("wrote", out)
