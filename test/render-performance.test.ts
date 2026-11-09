import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { officePixelRatio, createOfficeShadowBudget, freezeOfficeArchitecture, createChartTransformTracker, applyOfficeMovementDelta } from '../src/render-performance';

test('3D pixel budget preserves small-screen density and bounds high-DPI framebuffers', () => {
  assert.equal(officePixelRatio(3, true, 390, 740), 1.5);
  assert.equal(officePixelRatio(2, false, 1280, 800), 1.7);
  for (const [width, height, compact] of [[1920,1080,false],[3840,2160,false],[2048,1536,true]] as const) {
    const ratio = officePixelRatio(2, compact, width, height);
    assert.ok(width * height * ratio ** 2 <= (compact ? 2_000_000 : 4_000_000) + 0.01);
  }
  assert.equal(officePixelRatio(NaN, false, 1280, 800), 1);
});

test('camera-only frames reuse shadows and moving actors refresh at 30 Hz without losing a final change', () => {
  const stationary = createOfficeShadowBudget(), walking = createOfficeShadowBudget();
  let idlePasses = 0, movingPasses = 0;
  for (let frame = 0; frame < 600; frame++) {
    idlePasses += Number(stationary.shouldUpdate(frame * 1000 / 60, false));
    movingPasses += Number(walking.shouldUpdate(frame * 1000 / 60, true));
  }
  assert.equal(idlePasses, 1); assert.equal(movingPasses, 300);
  assert.equal(walking.shouldUpdate(10000, false), true);
  assert.equal(walking.shouldUpdate(10040, false), false);
  stationary.invalidate();
  assert.equal(stationary.shouldUpdate(10001, false), true);
  stationary.invalidate();
  assert.equal(stationary.shouldUpdate(10010, false), false);
  assert.equal(stationary.shouldUpdate(10040, false), true);
});

test('freezing architecture retains world positions and allows newly attached animated actors to update', () => {
  const room = new Group(), furniture = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  room.position.set(2,0,3); furniture.position.set(4,1,5); mesh.position.set(1,1,1); room.add(furniture); furniture.add(mesh);
  freezeOfficeArchitecture(room);
  const original = mesh.matrixWorld.clone();
  const actor = new Group(), arm = new Group(); actor.add(arm); room.add(actor);
  actor.position.set(10,0,9); arm.rotation.z = .7; room.updateMatrixWorld();
  assert.deepEqual(mesh.matrixWorld.elements, original.elements);
  assert.equal(mesh.matrixAutoUpdate, false); assert.equal(mesh.matrixWorldAutoUpdate, false);
  assert.equal(actor.matrixAutoUpdate, true); assert.equal(arm.matrixAutoUpdate, true);
  assert.deepEqual(actor.getWorldPosition(new Vector3()).toArray(), [12,0,12]);
  const firstArm = arm.matrixWorld.clone(); arm.rotation.z = -.7; room.updateMatrixWorld();
  assert.notDeepEqual(arm.matrixWorld.elements, firstArm.elements);
});

test('CSS3D update gating responds to orbit, projection, size and explicit remount but skips unchanged frames', () => {
  const tracker = createChartTransformTracker(), camera = new PerspectiveCamera(50, 1.6, .05, 500);
  camera.updateMatrixWorld();
  assert.equal(tracker.changed(camera, 1280, 800), true);
  assert.equal(tracker.changed(camera, 1280, 800), false);
  camera.position.x = 2; camera.updateMatrixWorld();
  assert.equal(tracker.changed(camera, 1280, 800), true);
  camera.fov = 60; camera.updateProjectionMatrix();
  assert.equal(tracker.changed(camera, 1280, 800), true);
  assert.equal(tracker.changed(camera, 390, 740), true);
  assert.equal(tracker.changed(camera, 390, 740), false);
  tracker.invalidate(); assert.equal(tracker.changed(camera, 390, 740), true);
});

test('single-player movement deltas preserve local prediction, seat targets and action state', () => {
  const avatar = { target: new Vector3(1,.1,2), seat: null as number|null, action: {kind:'jump'} as unknown };
  assert.equal(applyOfficeMovementDelta(avatar, {x:3,z:4}, true), true);
  assert.deepEqual(avatar.target.toArray(), [1,.1,2]); assert.ok(avatar.action);
  applyOfficeMovementDelta(avatar, {x:3,z:4,action:null}, false);
  assert.deepEqual(avatar.target.toArray(), [3,0,4]); assert.equal(avatar.action, null);
  avatar.seat = 0; applyOfficeMovementDelta(avatar, {x:10,z:20}, false);
  assert.deepEqual(avatar.target.toArray(), [3,0,4]);
  assert.equal(applyOfficeMovementDelta(avatar, {x:NaN,z:20}, false), false);
});
