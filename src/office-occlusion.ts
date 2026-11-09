import { Material, Mesh, Vector3, type PerspectiveCamera } from 'three';

/** Opaque depth-tested cutouts keep the DOM chart aperture working. Ordinary
 * alpha blending would draw furniture after the aperture and cover it again.
 * This only patches the static furniture supplied by the scene, never avatars,
 * room walls, floor, chart mask or invisible interaction meshes. */
export function createOfficeOcclusion(meshes: readonly Mesh[]) {
  const uniforms = {
    officeLens: { value: new Vector3() },
    officeFocus: { value: new Vector3() },
    officeRadius: { value: 1.3 },
  };
  const clones = new Map<Material, Material>();
  const originals = new Map<Mesh, Material | Material[]>();
  const patch = (original: Material) => {
    let clone = clones.get(original);
    if (clone) return clone;
    clone = original.clone();
    clone.name = `${original.name || original.type}:view-clearance`;
    clone.customProgramCacheKey = () => 'office-view-clearance-v1';
    clone.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec3 officeWorldPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nofficeWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = `
        varying vec3 officeWorldPosition;
        uniform vec3 officeLens;
        uniform vec3 officeFocus;
        uniform float officeRadius;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        vec3 officeDelta = officeWorldPosition - officeLens;
        vec3 officeAxis = officeFocus - officeLens;
        float officeLength = length(officeAxis);
        float officeClearance = 1.0 - smoothstep(0.55, 1.4, length(officeDelta));
        if (officeLength > 0.3) {
          officeAxis /= officeLength;
          float officeAlong = dot(officeDelta, officeAxis);
          if (officeAlong > 0.0 && officeAlong < officeLength - 0.06) {
            float officeT = clamp(officeAlong / officeLength, 0.0, 1.0);
            float officeWidth = mix(0.32, officeRadius, officeT);
            float officeSide = length(officeDelta - officeAxis * officeAlong);
            float officeCorridor = 1.0 - smoothstep(officeWidth * 0.78, officeWidth, officeSide);
            officeCorridor *= 1.0 - smoothstep(officeLength - 0.18, officeLength - 0.06, officeAlong);
            officeClearance = max(officeClearance, officeCorridor);
          }
        }
        // A stationary 4x4 ordered pattern softens the edge without translucent
        // sorting, extra draw calls, changing collision, or frame-to-frame noise.
        vec2 officePixel = mod(floor(gl_FragCoord.xy), 4.0);
        vec2 officeLow = mod(officePixel, 2.0);
        vec2 officeHigh = floor(officePixel / 2.0);
        float officeBayerLow = 2.0 * officeLow.x + 3.0 * officeLow.y - 4.0 * officeLow.x * officeLow.y;
        float officeBayerHigh = 2.0 * officeHigh.x + 3.0 * officeHigh.y - 4.0 * officeHigh.x * officeHigh.y;
        float officeThreshold = (4.0 * officeBayerLow + officeBayerHigh + 0.5) / 16.0;
        if (officeClearance > officeThreshold) discard;
      `);
    };
    clones.set(original, clone);
    return clone;
  };
  for (const mesh of meshes) {
    originals.set(mesh, mesh.material);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(patch) : patch(mesh.material);
  }
  return {
    update(camera: PerspectiveCamera, focus: Vector3, radius = 1.3) {
      uniforms.officeLens.value.copy(camera.position);
      uniforms.officeFocus.value.copy(focus);
      uniforms.officeRadius.value = radius;
    },
    dispose() {
      for (const [mesh, original] of originals) mesh.material = original;
      for (const clone of clones.values()) clone.dispose();
      originals.clear(); clones.clear();
    },
  };
}
