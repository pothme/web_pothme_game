import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { sculptPatch, sculptSweep, type PatchOptions, type SweepOptions, type Vec2, type Vec3 } from './avatar-sculpt';

/** A flat colour, or paint that varies over the piece (airbrushed tips, stripes). */
export type Tint = number | ((x: number, y: number, z: number) => number);
const scratch = new THREE.Color();
/** Blend of two 0xrrggbb paints (in display space, like mixing paint swatches). */
export const mixColor = (a: number, b: number, amount: number) => {
  const t = Math.min(1, Math.max(0, amount)), channel = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t) << shift;
  return channel(16) | channel(8) | channel(0);
};
export const darken = (color: number, amount = .86) => mixColor(color, 0x000000, 1 - amount);
export const lighten = (color: number, amount = .2) => mixColor(color, 0xfffaf0, amount);

export interface AvatarPainter {
  features: string[];
  /** Geometry in the joint's own units; `gloss` 0 = matte vinyl, 1 = lacquer. */
  put(owner: THREE.Object3D, geometry: THREE.BufferGeometry, tint: Tint, gloss?: number, position?: Vec3, scale?: Vec3, rotation?: Vec3): void;
  blob(owner: THREE.Object3D, tint: Tint, position: Vec3, size: Vec3, rotation?: Vec3, gloss?: number, detail?: number): void;
  box(owner: THREE.Object3D, tint: Tint, position: Vec3, size: Vec3, radius?: number, rotation?: Vec3, gloss?: number, detail?: number): void;
  line(owner: THREE.Object3D, tint: Tint, points: Vec3[], radius: number | ((t: number) => number), gloss?: number, options?: SweepOptions): void;
  /** Painted detail following `surface`; outline in the surface's x/y plane. */
  decal(owner: THREE.Object3D, tint: Tint, surface: (x: number, y: number) => number, outline: Vec2[], options?: PatchOptions, gloss?: number, position?: Vec3): void;
  /** Raised line drawn on `surface`. */
  trace(owner: THREE.Object3D, tint: Tint, surface: (x: number, y: number) => number, points: Vec2[], radius: number, gloss?: number, lift?: number): void;
  /** Like `put`, but the paint is chosen once per triangle (at its centre):
   * crisp checks and stripes whose edges follow the mesh. */
  facets(owner: THREE.Object3D, geometry: THREE.BufferGeometry, tint: Tint, gloss?: number, position?: Vec3, scale?: Vec3): void;
  /** @deprecated No-op: nothing is authored in the first avatar's coordinates any more. */
  fitLegacy(owner: THREE.Object3D, scale: Vec3, offset?: Vec3): void;
}

/** Lays the shared vertices out so that every three consecutive ones are a
 * triangle of the mesh, in its winding. Rendering reads only the index, but
 * code that walks the vertex buffer in threes (the winding regression test)
 * still sees real triangles. A vertex no free triangle could claim is repeated
 * with its triangle (a few percent); vertices no triangle uses are dropped. */
function layOutByTriangle(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geometry.index!.array, slot = new Int32Array(geometry.getAttribute('position').count).fill(-1), order: number[] = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    if (a !== b && b !== c && a !== c && slot[a] < 0 && slot[b] < 0 && slot[c] < 0) { slot[a] = order.length; slot[b] = order.length + 1; slot[c] = order.length + 2; order.push(a, b, c); }
  }
  for (let i = 0; i < index.length; i += 3) {
    if (slot[index[i]] >= 0 && slot[index[i + 1]] >= 0 && slot[index[i + 2]] >= 0) continue;
    for (let corner = 0; corner < 3; corner++) if (slot[index[i + corner]] < 0) slot[index[i + corner]] = order.length + corner;
    order.push(index[i], index[i + 1], index[i + 2]);
  }
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const size = attribute.itemSize, from = attribute.array, values = new Float32Array(order.length * size);
    for (let vertex = 0; vertex < order.length; vertex++) for (let k = 0; k < size; k++) values[vertex * size + k] = from[order[vertex] * size + k];
    result.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  result.setIndex(Array.from(index, vertex => slot[vertex]));
  geometry.dispose();
  return result;
}

export function createAvatarPainter() {
  const pieces = new Map<THREE.Object3D, THREE.BufferGeometry[]>(), features: string[] = [];
  const transform = new THREE.Object3D(), matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  /** Every piece keeps its shared vertices (an index buffer): about a fifth of
   * the memory and vertex work of loose triangles. The source is not modified. */
  function bake(owner: THREE.Object3D, source: THREE.BufferGeometry, tint: Tint, gloss: number, position: Vec3, scale: Vec3, rotation: Vec3, perFace = false) {
    // Paint chosen per triangle needs three vertices of its own for each triangle.
    const flat = perFace && source.index ? source.toNonIndexed() : source;
    transform.position.set(...position); transform.scale.set(...scale); transform.rotation.set(...rotation); transform.updateMatrix();
    matrix.copy(transform.matrix);
    const points = (flat.getAttribute('position') as THREE.BufferAttribute).clone().applyMatrix4(matrix);
    const normals = (flat.getAttribute('normal') as THREE.BufferAttribute).clone().applyNormalMatrix(normalMatrix.getNormalMatrix(matrix));
    const index = flat.index ? Array.from(flat.index.array) : Array.from({ length: points.count }, (_, vertex) => vertex);
    // Mirrored pieces share a draw with unmirrored ones, so their triangle
    // winding is reversed as well as their normals to stay visible from outside.
    if (matrix.determinant() < 0) for (let i = 0; i < index.length; i += 3) { const swap = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = swap; }
    const colors = new Float32Array(points.count * 3), shine = new Float32Array(points.count).fill(gloss);
    if (typeof tint === 'number') scratch.setHex(tint);
    for (let i = 0; i < points.count; i++) {
      if (typeof tint !== 'number' && (!perFace || i % 3 === 0)) {
        if (perFace) scratch.setHex(tint((points.getX(i) + points.getX(i + 1) + points.getX(i + 2)) / 3, (points.getY(i) + points.getY(i + 1) + points.getY(i + 2)) / 3, (points.getZ(i) + points.getZ(i + 1) + points.getZ(i + 2)) / 3));
        else scratch.setHex(tint(points.getX(i), points.getY(i), points.getZ(i)));
      }
      colors[i * 3] = scratch.r; colors[i * 3 + 1] = scratch.g; colors[i * 3 + 2] = scratch.b;
    }
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', points); geometry.setAttribute('normal', normals);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('gloss', new THREE.BufferAttribute(shine, 1));
    geometry.setIndex(index);
    // Loose triangles (boxes, extrusions, per-triangle paint) are welded where position, normal and paint agree.
    if (!source.index || perFace) { const welded = mergeVertices(geometry); geometry.dispose(); geometry = welded; }
    if (flat !== source) flat.dispose();
    source.dispose();
    const batch = pieces.get(owner) ?? []; batch.push(geometry); pieces.set(owner, batch);
  }
  const one: Vec3 = [1, 1, 1], zero: Vec3 = [0, 0, 0];
  const put: AvatarPainter['put'] = (owner, geometry, tint, gloss = 0, position = zero, scale = one, rotation = zero) => bake(owner, geometry, tint, gloss, position, scale, rotation);
  const painter: AvatarPainter = {
    features, put,
    blob(owner, tint, position, size, rotation = zero, gloss = 0, detail = 14) { put(owner, new THREE.SphereGeometry(1, detail, Math.max(6, Math.round(detail * .65))), tint, gloss, position, size, rotation); },
    box(owner, tint, position, size, radius = .03, rotation = zero, gloss = 0, detail = 1) { put(owner, new RoundedBoxGeometry(...size, detail, radius), tint, gloss, position, one, rotation); },
    line(owner, tint, points, radius, gloss = 0, options) { put(owner, sculptSweep(points, radius, options), tint, gloss); },
    decal(owner, tint, surface, outline, options, gloss = 0, position = zero) { put(owner, sculptPatch(surface, outline, options), tint, gloss, position); },
    trace(owner, tint, surface, points, radius, gloss = 0, lift = radius * .35) {
      put(owner, sculptSweep(points.map(([x, y]) => [x, y, surface(x, y) + lift] as Vec3), radius, { segments: 6, rows: Math.max(3, points.length * 2 - 2), flat: .7 }), tint, gloss);
    },
    facets(owner, geometry, tint, gloss = 0, position = zero, scale = one) { bake(owner, geometry, tint, gloss, position, scale, zero, true); },
    fitLegacy() {},
  };
  /** One mesh per joint. Returns the geometries so the avatar can dispose them. */
  function finish(material: THREE.Material) {
    const geometries: THREE.BufferGeometry[] = [];
    for (const [owner, parts] of pieces) {
      const geometry = layOutByTriangle(mergeGeometries(parts, false)!); parts.forEach(part => part.dispose());
      geometry.computeBoundingSphere(); geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = false; owner.add(mesh);
    }
    pieces.clear();
    return geometries;
  }
  return { painter, finish };
}
