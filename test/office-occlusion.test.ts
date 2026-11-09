import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, ShaderLib, Texture, UniformsUtils, Vector3, type Material, type WebGLRenderer } from 'three';
import { createOfficeOcclusion } from '../src/office-occlusion';

function compile(material: Material, kind: 'standard' | 'basic' = 'standard') {
  const template = ShaderLib[kind];
  const shader = {
    uniforms: UniformsUtils.clone(template.uniforms),
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  };
  material.onBeforeCompile(shader as Parameters<Material['onBeforeCompile']>[0], undefined as unknown as WebGLRenderer);
  return shader;
}

test('only selected furniture receives shared material clones, preserving maps and render settings', t => {
  const geometry = new BoxGeometry();
  const map = new Texture();
  const shared = new MeshStandardMaterial({ color: 0x567890, map, roughness: 0.7 });
  const label = new MeshBasicMaterial({ map, alphaMap: map, transparent: true, opacity: 0.8, depthWrite: false });
  const originalCompile = shared.onBeforeCompile;
  const sofa = new Mesh(geometry, shared), table = new Mesh(geometry, shared);
  const avatar = new Mesh(geometry, shared), shell = new Mesh(geometry, shared);
  const originalSlots = [shared, label, shared];
  const labelledFurniture = new Mesh(geometry, originalSlots);
  const clearance = createOfficeOcclusion([sofa, table, labelledFurniture]);
  t.after(() => { clearance.dispose(); geometry.dispose(); shared.dispose(); label.dispose(); map.dispose(); });

  assert.notEqual(sofa.material, shared);
  assert.equal(table.material, sofa.material);
  assert.notEqual(labelledFurniture.material, originalSlots);
  assert.equal(labelledFurniture.material[0], sofa.material);
  assert.equal(labelledFurniture.material[2], sofa.material);
  assert.notEqual(labelledFurniture.material[1], label);
  assert.equal(avatar.material, shared);
  assert.equal(shell.material, shared);
  assert.equal(shared.onBeforeCompile, originalCompile);
  assert.equal(shared.map, map);
  assert.equal(sofa.material.map, map);
  assert.equal(sofa.material.color.getHex(), shared.color.getHex());
  assert.equal(sofa.material.roughness, shared.roughness);
  assert.equal(sofa.material.transparent, false);
  assert.equal(sofa.material.depthTest, true);
  assert.equal(sofa.material.depthWrite, true);
  const clonedLabel = labelledFurniture.material[1] as MeshBasicMaterial;
  assert.equal(clonedLabel.map, map);
  assert.equal(clonedLabel.alphaMap, map);
  assert.equal(clonedLabel.transparent, label.transparent);
  assert.equal(clonedLabel.opacity, label.opacity);
  assert.equal(clonedLabel.depthWrite, label.depthWrite);
  assert.equal(clonedLabel.depthTest, label.depthTest);
});

test('dispose restores original material slots and releases each clone once without disposing shared assets', t => {
  const geometry = new BoxGeometry(), texture = new Texture();
  const shared = new MeshStandardMaterial({ map: texture }), label = new MeshBasicMaterial({ map: texture });
  const originalSlots = [shared, label, shared];
  const furniture = new Mesh(geometry, originalSlots), otherFurniture = new Mesh(geometry, shared);
  const avatar = new Mesh(geometry, shared);
  const clearance = createOfficeOcclusion([furniture, otherFurniture]);
  t.after(() => { clearance.dispose(); geometry.dispose(); shared.dispose(); label.dispose(); texture.dispose(); });
  const clones = new Set(furniture.material);
  const disposedClones = new Map<Material, number>();
  let disposedOriginals = 0, disposedTextures = 0, disposedGeometry = 0;
  for (const clone of clones) clone.addEventListener('dispose', () => disposedClones.set(clone, (disposedClones.get(clone) ?? 0) + 1));
  for (const original of [shared, label]) original.addEventListener('dispose', () => disposedOriginals++);
  texture.addEventListener('dispose', () => disposedTextures++);
  geometry.addEventListener('dispose', () => disposedGeometry++);

  clearance.dispose();
  assert.equal(furniture.material, originalSlots);
  assert.equal(otherFurniture.material, shared);
  assert.equal(avatar.material, shared);
  assert.equal(clones.size, 2);
  assert.deepEqual([...disposedClones.values()], [1, 1]);
  assert.equal(disposedOriginals, 0);
  assert.equal(disposedTextures, 0);
  assert.equal(disposedGeometry, 0);
  clearance.dispose();
  assert.deepEqual([...disposedClones.values()], [1, 1]);
  assert.equal(furniture.material, originalSlots);
});

test('standard and textured label shader templates retain their render chunks and receive the same clearance uniforms', t => {
  const geometry = new BoxGeometry(), shared = new MeshStandardMaterial(), label = new MeshBasicMaterial({ transparent: true });
  const solidMesh = new Mesh(geometry, shared), labelMesh = new Mesh(geometry, label);
  const clearance = createOfficeOcclusion([solidMesh, labelMesh]);
  t.after(() => { clearance.dispose(); geometry.dispose(); shared.dispose(); label.dispose(); });
  const standard = compile(solidMesh.material), basic = compile(labelMesh.material, 'basic');

  for (const [shader, kind] of [[standard, 'standard'], [basic, 'basic']] as const) {
    assert.match(shader.vertexShader, /varying vec3 officeWorldPosition;/);
    assert.match(shader.vertexShader, /#include <project_vertex>[\s\S]*officeWorldPosition = \(modelMatrix \* vec4\(transformed, 1\.0\)\)\.xyz;/);
    assert.match(shader.fragmentShader, /uniform vec3 officeLens;/);
    assert.match(shader.fragmentShader, /uniform vec3 officeFocus;/);
    assert.match(shader.fragmentShader, /uniform float officeRadius;/);
    assert.match(shader.fragmentShader, /if \(officeClearance > officeThreshold\) discard;/);
    for (const chunk of ['clipping_planes_fragment', 'map_fragment', 'alphatest_fragment', 'opaque_fragment']) {
      assert.ok(shader.fragmentShader.includes(`#include <${chunk}>`), `${kind} lost ${chunk}`);
    }
    assert.deepEqual(shader.uniforms.diffuse.value, ShaderLib[kind].uniforms.diffuse.value);
    assert.ok(!ShaderLib[kind].vertexShader.includes('officeWorldPosition'));
    assert.ok(!ShaderLib[kind].fragmentShader.includes('officeClearance'));
    assert.equal(ShaderLib[kind].uniforms.officeLens, undefined);
  }
  for (const key of ['officeLens', 'officeFocus', 'officeRadius']) assert.equal(standard.uniforms[key], basic.uniforms[key]);
  assert.equal(solidMesh.material.customProgramCacheKey(), labelMesh.material.customProgramCacheKey());
  assert.notEqual(solidMesh.material.customProgramCacheKey(), shared.customProgramCacheKey());
});

test('frame updates copy camera and focus into persistent uniforms without moving or retaining either input', t => {
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial(), mesh = new Mesh(geometry, material);
  const clearance = createOfficeOcclusion([mesh]);
  t.after(() => { clearance.dispose(); geometry.dispose(); material.dispose(); });
  const shader = compile(mesh.material);
  const lensUniform = shader.uniforms.officeLens, focusUniform = shader.uniforms.officeFocus, radiusUniform = shader.uniforms.officeRadius;
  const camera = new PerspectiveCamera(62, 390 / 700, 0.05, 300);
  const focus = new Vector3(3, 0.9, -15);
  camera.position.set(7, 4, -9); camera.lookAt(focus); camera.updateMatrixWorld();
  const beforeCamera = camera.toJSON(), beforeFocus = focus.clone();

  clearance.update(camera, focus, 1.7);
  assert.deepEqual(camera.toJSON(), beforeCamera);
  assert.deepEqual(focus, beforeFocus);
  assert.notEqual(lensUniform.value, camera.position);
  assert.notEqual(focusUniform.value, focus);
  assert.deepEqual(lensUniform.value, camera.position);
  assert.deepEqual(focusUniform.value, focus);
  assert.equal(radiusUniform.value, 1.7);

  camera.position.set(-9, 2, -30); focus.set(-10, 1, -35);
  assert.deepEqual(lensUniform.value.toArray(), [7, 4, -9]);
  assert.deepEqual(focusUniform.value.toArray(), [3, 0.9, -15]);
  clearance.update(camera, focus);
  assert.equal(shader.uniforms.officeLens, lensUniform);
  assert.equal(shader.uniforms.officeFocus, focusUniform);
  assert.equal(shader.uniforms.officeRadius, radiusUniform);
  assert.deepEqual(lensUniform.value, camera.position);
  assert.deepEqual(focusUniform.value, focus);
  assert.equal(radiusUniform.value, 1.3);
});
