import { MeshStandardMaterial, ShaderChunk } from 'three';

/** Soft designer-toy shading on top of MeshStandardMaterial.
 *
 *  - wrapped (half-lambert) diffuse: the side facing away from a light keeps its
 *    own colour instead of falling to grey;
 *  - the amount of light is compressed and most of the light's colour cast is
 *    removed, so pastel paint stays pastel under the warm office sun and under
 *    the cool sky fill alike;
 *  - a gentle warm fresnel rim (scaled by the light it stands in, so it never
 *    glows in a dark room) and a small saturation lift;
 *  - a per-vertex `gloss` attribute (0 matte vinyl … 1 lacquer) replaces separate
 *    materials for eyes, noses and shoes, so one avatar needs one material.
 *
 *  The material opts out of the renderer's ACES pass (`toneMapped=false`) and
 *  ends with its own soft shoulder: ACES would desaturate exactly the bright
 *  candy colours this look depends on. Lights, shadows cast on the floor and fog
 *  still behave as for any standard material. */
export function createVinylMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: .58, metalness: 0 });
  material.toneMapped = false;
  // 0 = open eyes, 1 = closed happy eyes. Both sets live in the eyes' own draw;
  // the set that is not shown collapses to a point (tags: see avatar-head.ts).
  const happy = { value: 0 }; material.userData.happy = happy;
  material.onBeforeCompile = shader => {
    shader.uniforms.vinylHappy = happy;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float gloss;\nvarying float vGloss;\nuniform float vinylHappy;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
// gloss = finish (0…1) + 2 for the open eyes or + 4 for the happy arcs.
float vinylTag = floor( gloss * 0.5 + 0.01 );
vGloss = gloss - vinylTag * 2.0;
if ( vinylTag > 0.5 && ( vinylTag < 1.5 ) == ( vinylHappy > 0.5 ) ) transformed = vec3( 0.0 );`);
    const lights = ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );',
      'reflectedLight.directDiffuse += vinylWrap( dot( geometryNormal, directLight.direction ) ) * directLight.color * diffuseBRDF * ( 1.0 - F );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vGloss;
float vinylWrap( float ndl ) {
  float wrapped = saturate( ( ndl + 0.62 ) / 1.62 );
  return wrapped * mix( 1.0, wrapped, 0.55 );
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.16, vGloss );')
      .replace('#include <lights_physical_pars_fragment>', lights)
      .replace('#include <opaque_fragment>', `{
  const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
  vec3 paint = diffuseColor.rgb;
  // Illumination relative to the paint colour, then compressed: shade ≈ 0.7, sun ≈ 1.2.
  vec3 light = totalDiffuse / max( paint, vec3( 0.02 ) );
  float amount = max( dot( light, LUMA ), 0.0001 );
  vec3 lightTint = mix( vec3( 1.0 ), light / amount, 0.38 );
  float level = pow( amount * 1.02, 0.52 );
  // In a dim scene the figure follows the light down instead of glowing against it.
  level *= mix( 0.45, 1.0, smoothstep( 0.03, 0.24, amount ) );
  vec3 toy = paint * lightTint * level;
  // Shaded paint leans a little towards its own saturated hue, never to grey.
  float shade = 1.0 - smoothstep( 0.55, 1.05, level );
  float paintLuma = dot( toy, LUMA );
  toy = max( mix( vec3( paintLuma ), toy, 1.10 + 0.22 * shade ), 0.0 );
  float facing = saturate( dot( geometryNormal, geometryViewDir ) );
  float rim = pow( 1.0 - facing, 2.6 ) * ( 0.55 + 0.45 * geometryNormal.y );
  toy += rim * ( paint * 0.5 + vec3( 0.16, 0.12, 0.07 ) ) * 0.55 * saturate( level * 1.5 );
  toy += totalSpecular * mix( 0.5, 1.6, vGloss ) + totalEmissiveRadiance;
  // Soft shoulder per channel: highlights roll off instead of clipping.
  vec3 over = max( toy - 0.82, 0.0 );
  outgoingLight = min( toy, 0.82 ) + 0.18 * ( 1.0 - exp( - over / 0.18 ) );
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'podeum-vinyl-toy-3';
  return material;
}
