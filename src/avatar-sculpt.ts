import * as THREE from 'three';

/** Procedural modelling helpers for the vinyl-toy avatar. Everything here is
 * plain typed-array geometry: it runs in node (tests) as well as in WebGL. */
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
export type SculptRing = [y: number, width: number, depth: number, centerZ?: number, centerX?: number];

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
export const smoothstep = (edge0: number, edge1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };
/** A smooth hump of the given half width centred on `center`. */
export const bump = (x: number, center: number, halfWidth: number) => { const d = Math.abs(x - center) / halfWidth; return d >= 1 ? 0 : .5 + .5 * Math.cos(Math.PI * d); };
const signedPow = (value: number, exponent: number) => Math.sign(value) * Math.pow(Math.abs(value), exponent);

/** Samples `surface(u,v)` on a lattice and returns a smooth indexed mesh.
 * Seams (u=0/1) and poles (a row collapsed to one point) share their normals,
 * and the winding is chosen so that the faces look away from the mesh centre
 * (or towards `facing` for open, flat patches). */
export function sculptGrid(columns: number, rows: number, surface: (u: number, v: number, out: THREE.Vector3) => void, facing?: Vec3): THREE.BufferGeometry {
  const stride = columns + 1, count = stride * (rows + 1), positions = new Float32Array(count * 3), point = new THREE.Vector3();
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    surface(column / columns, row / rows, point);
    positions.set([point.x, point.y, point.z], (row * stride + column) * 3);
  }
  const same = (a: number, b: number) => Math.abs(positions[a * 3] - positions[b * 3]) < 1e-7 && Math.abs(positions[a * 3 + 1] - positions[b * 3 + 1]) < 1e-7 && Math.abs(positions[a * 3 + 2] - positions[b * 3 + 2]) < 1e-7;
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * stride + column, b = a + stride;
    if (!same(a, b) && !same(b, a + 1) && !same(a, a + 1)) indices.push(a, b, a + 1);
    if (!same(b, b + 1) && !same(b + 1, a + 1) && !same(b, a + 1)) indices.push(b, b + 1, a + 1);
  }
  // Orientation: signed volume around the centroid, or agreement with `facing`.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) { cx += positions[i * 3]; cy += positions[i * 3 + 1]; cz += positions[i * 3 + 2]; }
  cx /= count; cy /= count; cz /= count;
  let measure = 0;
  for (let i = 0; i < indices.length; i += 3) {
    A.fromArray(positions, indices[i] * 3); B.fromArray(positions, indices[i + 1] * 3); C.fromArray(positions, indices[i + 2] * 3);
    N.subVectors(B, A).cross(C.sub(A));
    measure += facing ? N.x * facing[0] + N.y * facing[1] + N.z * facing[2] : N.dot(A.set(A.x - cx, A.y - cy, A.z - cz));
  }
  if (measure < 0) for (let i = 0; i < indices.length; i += 3) { const swap = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = swap; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const share = (members: number[]) => {
    N.set(0, 0, 0); for (const member of members) N.add(A.fromBufferAttribute(normals, member));
    if (N.lengthSq() < 1e-12) return; N.normalize();
    for (const member of members) normals.setXYZ(member, N.x, N.y, N.z);
  };
  for (let row = 0; row <= rows; row++) {
    const first = row * stride, last = first + columns;
    if (!same(first, last)) continue;
    let pole = true; for (let column = 1; column < columns && pole; column++) pole = same(first, first + column);
    share(pole ? Array.from({ length: stride }, (_, column) => first + column) : [first, last]);
  }
  return geometry;
}

/** Catmull-Rom refinement of a ring list (each parameter separately). */
export function refineRings(rings: SculptRing[], steps = 2): SculptRing[] {
  if (steps <= 1) return rings;
  const result: SculptRing[] = [], at = (index: number) => rings[Math.min(rings.length - 1, Math.max(0, index))];
  for (let ring = 0; ring < rings.length - 1; ring++) for (let step = 0; step < steps; step++) {
    const t = step / steps, p0 = at(ring - 1), p1 = at(ring), p2 = at(ring + 1), p3 = at(ring + 2), next = [0, 0, 0, 0, 0] as number[];
    for (let k = 0; k < 5; k++) {
      const a = p0[k] ?? 0, b = p1[k] ?? 0, c = p2[k] ?? 0, d = p3[k] ?? 0;
      next[k] = .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    }
    // A spline may not swing outside its neighbours: joints stay hidden.
    for (const k of [1, 2]) next[k] = Math.max(Math.min(p1[k] ?? 0, p2[k] ?? 0), Math.min(Math.max(p1[k] ?? 0, p2[k] ?? 0), next[k]));
    next[0] = Math.max(Math.min(p1[0], p2[0]), Math.min(Math.max(p1[0], p2[0]), next[0]));
    result.push(next as SculptRing);
  }
  result.push(rings[rings.length - 1]);
  return result;
}

/** Smooth elliptical (or slightly squared, `power`>2) profiles stacked along Y.
 * A ring of zero size closes the form with a rounded pole. `lit` (as many
 * rings) lends its normals: a part that dips inside a neighbour can still be
 * lit as if it ran straight on, so no band shows where the neighbour takes over. */
export function sculptLoft(rings: SculptRing[], segments = 20, refine = 1, power = 2, lit?: SculptRing[]): THREE.BufferGeometry {
  const dense = refineRings(rings, refine), e = 2 / power;
  const geometry = sculptGrid(segments, dense.length - 1, (u, v, out) => {
    const ring = dense[Math.round(v * (dense.length - 1))], angle = u * Math.PI * 2;
    out.set((ring[4] ?? 0) + signedPow(Math.sin(angle), e) * ring[1], ring[0], (ring[3] ?? 0) + signedPow(Math.cos(angle), e) * ring[2]);
  });
  if (lit && lit.length === rings.length) geometry.setAttribute('normal', sculptLoft(lit, segments, refine, power).getAttribute('normal'));
  return geometry;
}
/** Front (+z) or back surface of a loft, for placing painted details on it. */
export function loftSurface(rings: SculptRing[], power = 2, back = false) {
  return (x: number, y: number) => {
    let index = 0; while (index < rings.length - 2 && rings[index + 1][0] < y) index++;
    const a = rings[index], b = rings[index + 1], t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0] || 1)));
    const w = a[1] + (b[1] - a[1]) * t, d = a[2] + (b[2] - a[2]) * t, zc = (a[3] ?? 0) + ((b[3] ?? 0) - (a[3] ?? 0)) * t;
    const inside = Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / Math.max(w, 1e-4)), power));
    return zc + (back ? -1 : 1) * d * Math.pow(inside, 1 / power);
  };
}

/** A rounded, slightly squared ellipsoid with independent top/bottom and
 * front/back extents: the head, muzzles, feet and other soft volumes. */
export class SuperShape {
  constructor(readonly w: number, readonly top: number, readonly bottom: number, readonly front: number, readonly back: number,
    readonly round = 2.15, readonly crown = 2.15, readonly jaw = 2.5) {}
  /** Distance from the centre to the surface along a unit direction. */
  radius(x: number, y: number, z: number): number {
    const nv = y >= 0 ? this.crown : this.jaw;
    const lateral = Math.pow(Math.abs(x) / this.w, this.round) + Math.pow(Math.abs(z) / (z >= 0 ? this.front : this.back), this.round);
    return Math.pow(Math.pow(lateral, nv / this.round) + Math.pow(Math.abs(y) / (y >= 0 ? this.top : this.bottom), nv), -1 / nv);
  }
  /** Surface depth in front of (x,y); 0 outside the silhouette. */
  frontZ = (x: number, y: number): number => this.depth(x, y, this.front);
  backZ = (x: number, y: number): number => -this.depth(x, y, this.back);
  private depth(x: number, y: number, extent: number) {
    const nv = y >= 0 ? this.crown : this.jaw, vertical = 1 - Math.pow(Math.min(1, Math.abs(y) / (y >= 0 ? this.top : this.bottom)), nv);
    if (vertical <= 0) return 0;
    const inner = Math.pow(vertical, this.round / nv) - Math.pow(Math.abs(x) / this.w, this.round);
    return inner <= 0 ? 0 : extent * Math.pow(inner, 1 / this.round);
  }
  /** Surface point along a (not necessarily unit) direction, pushed out by `lift`. */
  along(x: number, y: number, z: number, lift = 0): Vec3 {
    const length = Math.hypot(x, y, z), r = this.radius(x / length, y / length, z / length) + lift;
    return [x / length * r, y / length * r, z / length * r];
  }
  /** The same form, `amount` larger all round (a hat or helmet worn over it). */
  grown(amount: number): SuperShape {
    return new SuperShape(this.w + amount, this.top + amount, this.bottom + amount, this.front + amount, this.back + amount, this.round, this.crown, this.jaw);
  }
  geometry(columns = 28, rows = 16, inflate = 0): THREE.BufferGeometry {
    return sculptGrid(columns, rows, (u, v, out) => {
      const phi = u * Math.PI * 2, theta = v * Math.PI, x = Math.sin(theta) * Math.sin(phi), y = Math.cos(theta), z = Math.sin(theta) * Math.cos(phi);
      out.set(x, y, z).multiplyScalar(this.radius(x, y, z) + inflate);
    });
  }
}

export type ShellOptions = {
  columns?: number; rows?: number;
  /** Height (shape-local y, or distance along the pole axis) where the shell ends for azimuth phi (0 = front, + = the figure's left). */
  edge: (phi: number) => number;
  /** Thickness above the surface at azimuth phi, polar angle theta. */
  thickness: (phi: number, theta: number) => number;
  /** 'up' covers from the crown downward (hair, hats); 'back' from the back of the head forward (helmets, hoods). */
  pole?: 'up' | 'back';
};
/** A moulded shell lying on a SuperShape: it starts at the pole, ends where the
 * surface reaches `edge(phi)` and finishes with a rounded lip that tucks into
 * the surface, so it reads as thick soft vinyl rather than a paper cut-out. */
export function sculptShell(shape: SuperShape, options: ShellOptions): THREE.BufferGeometry {
  const columns = options.columns ?? 48, rows = options.rows ?? 11, lipRows = 3, up = (options.pole ?? 'up') === 'up';
  const direction = (phi: number, theta: number, out: THREE.Vector3) => {
    const s = Math.sin(theta), c = Math.cos(theta);
    return up ? out.set(s * Math.sin(phi), c, s * Math.cos(phi)) : out.set(s * Math.sin(phi), s * Math.cos(phi), -c);
  };
  const D = new THREE.Vector3(), edgeTheta = new Float32Array(columns + 1), lipAngle = new Float32Array(columns + 1), edgeThickness = new Float32Array(columns + 1);
  for (let column = 0; column <= columns; column++) {
    const phi = (column % columns) / columns * Math.PI * 2 - Math.PI, target = options.edge(phi);
    let low = 0, high = Math.PI;
    for (let step = 0; step < 22; step++) {
      const middle = (low + high) / 2; direction(phi, middle, D);
      const along = (up ? D.y : -D.z) * shape.radius(D.x, D.y, D.z);
      if (along > target) low = middle; else high = middle;
    }
    edgeTheta[column] = (low + high) / 2;
    edgeThickness[column] = options.thickness(phi, edgeTheta[column]);
    direction(phi, edgeTheta[column], D);
    lipAngle[column] = Math.min(edgeTheta[column] * .5, edgeThickness[column] / shape.radius(D.x, D.y, D.z) * 1.15);
  }
  return sculptGrid(columns, rows + lipRows, (u, v, out) => {
    const column = Math.round(u * columns), row = Math.round(v * (rows + lipRows)), phi = (column % columns) / columns * Math.PI * 2 - Math.PI;
    let theta: number, lift: number;
    if (row <= rows) { theta = (edgeTheta[column] - lipAngle[column]) * row / rows; lift = row === 0 ? options.thickness(0, 0) : options.thickness(phi, theta); }
    else {
      const a = (row - rows) / lipRows * Math.PI / 2;
      theta = edgeTheta[column] - lipAngle[column] * (1 - Math.sin(a));
      lift = options.thickness(phi, edgeTheta[column] - lipAngle[column]) * Math.cos(a) - .006 * (1 - Math.cos(a));
    }
    direction(phi, theta, out); out.multiplyScalar(shape.radius(out.x, out.y, out.z) + lift);
  });
}

export type SweepOptions = { segments?: number; rows?: number; flat?: number; up?: Vec3; round?: boolean; tension?: number };
/** A soft tube along a curve. `radius` may vary with t; `flat` scales the
 * section across `up` (a ribbon); round ends close like a capsule. */
export function sculptSweep(points: Vec3[], radius: number | ((t: number) => number), options: SweepOptions = {}): THREE.BufferGeometry {
  const segments = options.segments ?? 8, rows = options.rows ?? Math.max(4, points.length * 3), flat = options.flat ?? 1, round = options.round ?? true;
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)), false, 'catmullrom', options.tension ?? .5);
  const radiusAt = typeof radius === 'number' ? () => radius : radius, length = curve.getLength();
  const cap = round ? Math.min(.3, radiusAt(0) / Math.max(length, 1e-4)) : 0, capEnd = round ? Math.min(.3, radiusAt(1) / Math.max(length, 1e-4)) : 0;
  const samples: [number, number][] = [];
  if (round) for (let k = 0; k < 3; k++) samples.push([cap * (1 - Math.cos(k * Math.PI / 6)), Math.sin(k * Math.PI / 6)]);
  for (let row = 0; row <= rows; row++) samples.push([cap + (1 - cap - capEnd) * row / rows, 1]);
  if (round) for (let k = 2; k >= 0; k--) samples.push([1 - capEnd * (1 - Math.cos(k * Math.PI / 6)), Math.sin(k * Math.PI / 6)]);
  const centers: THREE.Vector3[] = [], normals: THREE.Vector3[] = [], binormals: THREE.Vector3[] = [];
  const tangent = new THREE.Vector3(), previous = new THREE.Vector3(...(options.up ?? [0, 0, 1]));
  for (const [t] of samples) {
    centers.push(curve.getPoint(t)); curve.getTangent(t, tangent);
    // `previous` is the reference for the flat axis; projecting keeps it stable.
    const binormal = previous.clone().addScaledVector(tangent, -previous.dot(tangent));
    if (binormal.lengthSq() < 1e-8) binormal.set(tangent.y, tangent.z, tangent.x).addScaledVector(tangent, -tangent.dot(binormal));
    binormal.normalize(); previous.copy(binormal);
    binormals.push(binormal); normals.push(new THREE.Vector3().crossVectors(binormal, tangent).normalize());
  }
  return sculptGrid(segments, samples.length - 1, (u, v, out) => {
    const row = Math.round(v * (samples.length - 1)), angle = u * Math.PI * 2, [t, scale] = samples[row], r = radiusAt(t) * scale;
    out.copy(centers[row]).addScaledVector(normals[row], Math.cos(angle) * r).addScaledVector(binormals[row], Math.sin(angle) * r * flat);
  });
}

export type PatchOptions = { rings?: number; lift?: number; dome?: number; center?: Vec2; bevel?: number; back?: boolean };
/** A painted or softly embossed detail that follows a surface z(x,y). The
 * boundary is a closed outline in the surface's x/y plane. */
export function sculptPatch(surface: (x: number, y: number) => number, boundary: Vec2[], options: PatchOptions = {}): THREE.BufferGeometry {
  const lift = options.lift ?? .004, dome = options.dome ?? 0, bevel = options.bevel ?? .12;
  const center = options.center ?? [boundary.reduce((sum, point) => sum + point[0], 0) / boundary.length, boundary.reduce((sum, point) => sum + point[1], 0) / boundary.length];
  // Flat facets must not sink into a curved surface: large patches get more rings.
  const reach = boundary.reduce((max, point) => Math.max(max, Math.hypot(point[0] - center[0], point[1] - center[1])), 0);
  const rings = Math.max(options.rings ?? 1, Math.ceil(reach / .05));
  return sculptGrid(boundary.length, rings + 1, (u, v, out) => {
    const point = boundary[Math.round(u * boundary.length) % boundary.length], ring = Math.round(v * (rings + 1));
    // The last ring is the bevel: it returns to the surface just outside the outline.
    const rho = ring > rings ? 1 : ring / rings * (1 - bevel), x = center[0] + (point[0] - center[0]) * rho, y = center[1] + (point[1] - center[1]) * rho;
    out.set(x, y, surface(x, y) + (options.back ? -1 : 1) * (ring > rings ? -.002 : lift + dome * (1 - rho * rho)));
  }, [0, 0, options.back ? -1 : 1]);
}
export function ellipseOutline(cx: number, cy: number, rx: number, ry: number, roll = 0, segments = 18, power = 2): Vec2[] {
  const result: Vec2[] = [], c = Math.cos(roll), s = Math.sin(roll), e = 2 / power;
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, x = signedPow(Math.cos(a), e) * rx, y = signedPow(Math.sin(a), e) * ry;
    result.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return result;
}
/** Closed smooth outline through a few control points. */
export function smoothOutline(points: Vec2[], steps = 4): Vec2[] {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(point[0], point[1], 0)), true, 'catmullrom', .5);
  return curve.getPoints(points.length * steps).slice(0, -1).map(point => [point.x, point.y] as Vec2);
}
/** Straight-edged outline with every edge subdivided so it can follow a curved surface. */
export function polygonOutline(points: Vec2[], steps = 3): Vec2[] {
  const result: Vec2[] = [];
  points.forEach((point, index) => { const next = points[(index + 1) % points.length]; for (let step = 0; step < steps; step++) result.push([point[0] + (next[0] - point[0]) * step / steps, point[1] + (next[1] - point[1]) * step / steps]); });
  return result;
}

/** A rounded cone (ears, tufts, spikes): elliptical base at y=0, tip at `height`.
 * `point` 1 = dome, larger = more pointed; `lean` shifts the tip sideways. */
export function sculptHorn(rx: number, rz: number, height: number, point = 1.6, lean: Vec2 = [0, 0], segments = 14, rows = 7): THREE.BufferGeometry {
  return sculptGrid(segments, rows, (u, v, out) => {
    const angle = u * Math.PI * 2, t = Math.sin(v * Math.PI / 2), scale = Math.pow(Math.max(0, 1 - Math.pow(t, point)), .62);
    out.set(Math.sin(angle) * rx * scale + lean[0] * t * t, height * t, Math.cos(angle) * rz * scale + lean[1] * t * t);
  });
}
