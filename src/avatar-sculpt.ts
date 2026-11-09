import * as THREE from 'three';

export type SculptRing = [y: number, width: number, depth: number, centerZ?: number];

/** Relax a sleeve around its unchanged shoulder/elbow pivots. The upper edge
 * rolls inward and down towards the outside instead of forming a broad pad.
 * Use the deformation's inverse-transpose for normals so this stays smooth
 * after batching, including printed details and short sleeves. */
export function softenAvatarShoulder(geometry: THREE.BufferGeometry, side: number): void {
  const positions=geometry.getAttribute('position'), normals=geometry.getAttribute('normal');
  const transformedNormal=new THREE.Vector3();
  for(let index=0;index<positions.count;index++){
    const x=positions.getX(index), y=positions.getY(index), z=positions.getZ(index);
    const t=THREE.MathUtils.clamp((y+.16)/.25,0,1), curve=t*t*(3-2*t);
    const slope=t>0&&t<1?6*t*(1-t)/.25:0;
    const width=.84-.05*curve, shift=-.025-side*.10*x;
    positions.setXYZ(index,width*x-side*.025*curve,y+shift*curve,z*.88);
    if(normals){
      const nx=normals.getX(index),ny=normals.getY(index),nz=normals.getZ(index);
      const a=width,b=(-.05*x-side*.025)*slope,d=-side*.10*curve,e=1+shift*slope,det=a*e-b*d;
      transformedNormal.set((e*nx-d*ny)/det,(-b*nx+a*ny)/det,nz/.88).normalize();
      normals.setXYZ(index,transformedNormal.x,transformedNormal.y,transformedNormal.z);
    }
  }
  positions.needsUpdate=true;
  if(normals)normals.needsUpdate=true;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
}

/** Smooth closed elliptical profiles. The same profile can describe a cheek,
 * a gently padded sleeve, or trousers without visible primitive joints. */
export function sculptLoft(rings: SculptRing[], segments = 20): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  for (const [y, width, depth, centerZ = 0] of rings) {
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * width, y, Math.sin(angle) * depth + centerZ);
    }
  }
  const duplicateRing = (ring: number) => {
    const offset = positions.length / 3;
    for (let segment = 0; segment <= segments; segment++) {
      const start = (ring * (segments + 1) + segment) * 3;
      positions.push(positions[start], positions[start + 1], positions[start + 2]);
    }
    return offset;
  };
  for (let ring = 0; ring < rings.length - 1; ring++) {
    let lower = ring * (segments + 1), upper = lower + segments + 1;
    // Closure discs are hidden inside the adjacent sleeve/leg. Give them their
    // own rim vertices: averaging their downward normals into the clothing
    // sides otherwise creates a dark horizontal band at every animated joint.
    const flatClosure = Math.abs(rings[ring + 1][0] - rings[ring][0]) < .01;
    const lowerPoint = rings[ring][1] === 0 && rings[ring][2] === 0;
    const upperPoint = rings[ring + 1][1] === 0 && rings[ring + 1][2] === 0;
    if (flatClosure && lowerPoint && !upperPoint) upper = duplicateRing(ring + 1);
    if (flatClosure && upperPoint && !lowerPoint) lower = duplicateRing(ring);
    for (let segment = 0; segment < segments; segment++) {
      const a = lower + segment, b = upper + segment;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  // Share normals on the angular seam to avoid a dark line down a soft form.
  const normals = geometry.getAttribute('normal');
  for (let ring = 0; ring < rings.length; ring++) {
    const first = ring * (segments + 1), last = first + segments;
    const normal = new THREE.Vector3().fromBufferAttribute(normals, first)
      .add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize();
    normals.setXYZ(first, normal.x, normal.y, normal.z); normals.setXYZ(last, normal.x, normal.y, normal.z);
  }
  return geometry;
}

/** One continuous hair shell; its hairline rises above the forehead and wraps
 * lower at the temples and nape. Fringes overlap this shell, never float above it. */
export function sculptHairCap(bob = false): THREE.BufferGeometry {
  const columns = 32, rows = 13, positions: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const phi = column / columns * Math.PI * 2, front = Math.max(0, Math.cos(phi));
    const edge = (bob ? 2.45 : 2.03) - front * (bob ? 1.23 : .81);
    const theta = row / rows * edge;
    const radius = 1 + .018 * Math.cos(phi * 3 + theta * 2) * Math.sin(theta);
    positions.push(Math.sin(phi) * Math.sin(theta) * .405 * radius,
      .027 + Math.cos(theta) * .37,
      -.024 + Math.cos(phi) * Math.sin(theta) * .322 * radius);
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + columns + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** A broad, flattened sculpted forelock. Its elliptical section and continuous
 * pointed edge avoid the cylindrical spikes produced by a TubeGeometry lock. */
export function sculptForelock(points: [number, number, number][], width: number, thickness = .032): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const rows = 12, columns = 10, positions: number[] = [], indices: number[] = [];
  // A stable horizontal section is intentional: a swept fringe sometimes
  // changes from upward to downward travel. A Frenet frame flips at that
  // inflection and twists a wide ribbon inside out.
  const cross = new THREE.Vector3(1, 0, 0), normal = new THREE.Vector3(0, 0, 1);
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, center = curve.getPoint(t);
    const taper = Math.max(.015, Math.pow(Math.sin(Math.PI * (.17 + t * .83)), .72));
    for (let column = 0; column <= columns; column++) {
      const angle = column / columns * Math.PI * 2;
      const point = center.clone().addScaledVector(cross, Math.cos(angle) * width * taper)
        .addScaledVector(normal, Math.sin(angle) * thickness * taper);
      positions.push(point.x, point.y, point.z);
    }
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + columns + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
