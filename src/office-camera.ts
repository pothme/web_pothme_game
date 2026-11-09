import { MathUtils, Spherical, Vector3, type PerspectiveCamera } from 'three';
import { OFFICE_GEOMETRY, WALL_CHART_GEOMETRY, REAR_WALL_CHART_GEOMETRY, ROOM_SPAWN } from '../shared/classroom-layout';
import { AVATAR_SEATED_Y } from '../shared/avatar-rig';

const room = OFFICE_GEOMETRY;
export const INTERIOR_CAMERA_BOUNDS = Object.freeze({
  minX: -room.width / 2 + 0.65, maxX: room.width / 2 - 0.65,
  minY: 0.2, maxY: room.wallHeight - 0.35,
  minZ: room.centerZ - room.depth / 2 + 0.65, maxZ: room.centerZ + room.depth / 2 - 0.65,
});
export const FREE_CAMERA = Object.freeze({
  fov: 62, minDistance: 1, maxDistance: Math.hypot(room.width, room.depth, room.wallHeight),
  far: Math.hypot(room.width, room.depth, room.wallHeight) + 20,
  minPolarAngle: 0.02, maxPolarAngle: Math.PI - 0.02,
  defaultTarget: Object.freeze({ x: 0, y: WALL_CHART_GEOMETRY.y, z: WALL_CHART_GEOMETRY.z }),
  // Start well ahead of the rear wall: the enlarged display occupies the view,
  // rather than pulling the visitor back in proportion with the wider hall.
  defaultPosition: Object.freeze({ x: 0, y: WALL_CHART_GEOMETRY.y * 0.75, z: Math.min(INTERIOR_CAMERA_BOUNDS.maxZ - 2, WALL_CHART_GEOMETRY.z + WALL_CHART_GEOMETRY.width * 0.61) }),
});
export const FOLLOW_CAMERA = Object.freeze({
  minDistance: 4.5, maxDistance: 14, focusHeight: 1.05,
  minPolarAngle: FREE_CAMERA.minPolarAngle, maxPolarAngle: FREE_CAMERA.maxPolarAngle,
  defaultOffset: Object.freeze({ x: 4, y: 3.4, z: 6 }),
  visitorFocus: Object.freeze({ x: ROOM_SPAWN.x, y: 1.05, z: ROOM_SPAWN.z }),
});
/** Explicit upward looking may raise the aim while the rig still follows x/z. */
export interface FollowCameraAim { elevation: number }

/** Narrow phones retain the follow rig's horizontal space without orbit jumps. */
export function followCameraFov(aspect: number, compact = false): number {
  if (!compact || !Number.isFinite(aspect) || aspect >= 0.55) return FREE_CAMERA.fov;
  return Math.min(100, MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(FREE_CAMERA.fov / 2)) * 0.55 / Math.max(0.3, aspect))));
}

/** Keep the entire near plane inside the shell, including a wide portrait lens. */
export function interiorCameraBounds(camera: PerspectiveCamera) {
  const halfHeight = camera.near * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV() / 2));
  const nearRadius = Math.hypot(camera.near, halfHeight, halfHeight * camera.aspect);
  const clearance = nearRadius + 0.03;
  return {
    minX: Math.max(INTERIOR_CAMERA_BOUNDS.minX, -room.width / 2 + 0.3 + clearance),
    maxX: Math.min(INTERIOR_CAMERA_BOUNDS.maxX, room.width / 2 - 0.3 - clearance),
    minY: Math.max(INTERIOR_CAMERA_BOUNDS.minY, 0.015 + clearance),
    maxY: Math.min(INTERIOR_CAMERA_BOUNDS.maxY, room.wallHeight - 0.15 - clearance),
    minZ: Math.max(INTERIOR_CAMERA_BOUNDS.minZ, WALL_CHART_GEOMETRY.z + clearance),
    maxZ: Math.min(INTERIOR_CAMERA_BOUNDS.maxZ, REAR_WALL_CHART_GEOMETRY.z - clearance),
  };
}

/** Keep the lens behind the actual walls, floor and ceiling at every entry point. */
export function constrainInteriorCamera(camera: PerspectiveCamera, target: Vector3, following = false, aim?: FollowCameraAim): void {
  const b = interiorCameraBounds(camera), aimBounds = INTERIOR_CAMERA_BOUNDS;
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  target.set(MathUtils.clamp(finite(target.x, 0), aimBounds.minX, aimBounds.maxX), MathUtils.clamp(finite(target.y, 4), 0.2, room.wallHeight - 0.2), MathUtils.clamp(finite(target.z, 0), aimBounds.minZ, aimBounds.maxZ));
  if (following && aim) {
    // Lowering an orbit used to hit the floor and snap above the avatar. Move
    // the aim by the same height correction so the requested upward angle is
    // retained, while the lens itself always stays inside the room.
    const lensY = finite(camera.position.y, FREE_CAMERA.defaultPosition.y);
    const wantedShift = MathUtils.clamp(lensY, b.minY, b.maxY) - lensY;
    const shift = MathUtils.clamp(target.y + wantedShift, 0.2, room.wallHeight - 0.2) - target.y;
    camera.position.y = lensY + shift; target.y += shift;
    aim.elevation = finite(aim.elevation, 0) + shift;
  }
  const clampLens = () => camera.position.set(
    MathUtils.clamp(finite(camera.position.x, 0), b.minX, b.maxX),
    MathUtils.clamp(finite(camera.position.y, FREE_CAMERA.defaultPosition.y), b.minY, b.maxY),
    MathUtils.clamp(finite(camera.position.z, FREE_CAMERA.defaultPosition.z), b.minZ, b.maxZ),
  );
  clampLens();
  const followDistance = Math.max(FOLLOW_CAMERA.minDistance, 1.55 / (Math.tan(MathUtils.degToRad(camera.fov / 2)) * Math.max(0.3, camera.aspect)));
  if (following && camera.position.distanceTo(target) < followDistance) {
    // At a corner, look at the person from the room side instead of crushing
    // the lens against their head while preserving an impossible outside orbit.
    const inward = new Vector3(-target.x, 0, room.centerZ - target.z);
    if (inward.lengthSq() < 0.01) inward.set(0, 0, 1);
    inward.normalize().multiplyScalar(Math.max(6, followDistance + 0.5));
    const chosenHeight = camera.position.y;
    camera.position.copy(target).add(inward); camera.position.y = chosenHeight; clampLens();
  }
  if (camera.position.distanceToSquared(target) < 0.16) {
    target.set(0, MathUtils.clamp(camera.position.y, 1, room.wallHeight - 1), room.centerZ);
    if (camera.position.distanceToSquared(target) < 0.16) target.z -= 3;
  }
  camera.lookAt(target); camera.updateMatrixWorld();
}

/** Free views ignore avatar updates; optional following translates the orbit rig. */
export function followCameraPosition(camera: PerspectiveCamera, target: Vector3, player: { x: number; z: number; seated?: boolean } | null, enabled = true, aim?: FollowCameraAim): void {
  if (!enabled) return;
  const focus = player ? new Vector3(player.x, FOLLOW_CAMERA.focusHeight + (player.seated ? AVATAR_SEATED_Y : 0), player.z) : new Vector3().copy(FOLLOW_CAMERA.visitorFocus);
  if (aim) focus.y += Number.isFinite(aim.elevation) ? aim.elevation : 0;
  camera.position.add(focus.clone().sub(target)); target.copy(focus);
  constrainInteriorCamera(camera, target, true, aim);
}

/** Entry and My character discard a prior visitor/free-camera pitch and zoom. */
export function resetFollowCamera(camera: PerspectiveCamera, target: Vector3, player: { x: number; z: number; seated?: boolean } | null, aim?: FollowCameraAim, compact = false): void {
  if (aim) aim.elevation = 0;
  camera.fov = followCameraFov(camera.aspect, compact); camera.zoom = 1; camera.up.set(0, 1, 0);
  camera.updateProjectionMatrix();
  camera.position.copy(target).add(new Vector3().copy(FOLLOW_CAMERA.defaultOffset));
  followCameraPosition(camera, target, player, true, aim);
}

/** An explicit pitch step works with both follow mode and an independently aimed camera. */
export function tiltCameraPosition(camera: PerspectiveCamera, target: Vector3, direction: 'up' | 'down', following = false, aim?: FollowCameraAim): void {
  const offset = camera.position.clone().sub(target), orbit = new Spherical().setFromVector3(offset);
  orbit.phi = MathUtils.clamp(orbit.phi + (direction === 'up' ? 1 : -1) * Math.PI / 15, FREE_CAMERA.minPolarAngle, FREE_CAMERA.maxPolarAngle);
  camera.position.copy(target).add(offset.setFromSpherical(orbit));
  constrainInteriorCamera(camera, target, following, aim);
}

export function panCameraPosition(camera: PerspectiveCamera, target: Vector3, horizontal: number, vertical: number): void {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const delta = right.multiplyScalar(horizontal).addScaledVector(up, vertical);
  camera.position.add(delta); target.add(delta); constrainInteriorCamera(camera, target);
}

/** Fit the physical display while keeping the lens inside even in portrait. */
export function frameInteriorChart(camera: PerspectiveCamera, target: Vector3, chart: { x: number; y: number; z: number; width: number; height: number; yaw?: number }, availableFraction = 1): void {
  camera.up.set(0, 1, 0);
  const aspect = Math.max(0.3, Number.isFinite(camera.aspect) ? camera.aspect : 1);
  const fraction = MathUtils.clamp(availableFraction, 0.5, 1);
  const requiredHeight = Math.max(chart.height * 1.2, chart.width * 1.06 / (aspect * fraction));
  const inward = Math.cos(chart.yaw ?? 0) >= 0 ? 1 : -1;
  const roomDistance = inward === 1 ? INTERIOR_CAMERA_BOUNDS.maxZ - chart.z : chart.z - INTERIOR_CAMERA_BOUNDS.minZ;
  const distance = Math.min(roomDistance, Math.max(8, requiredHeight / (2 * Math.tan(MathUtils.degToRad(FREE_CAMERA.fov / 2)))));
  // A shallow lounge still fits the unshrunk four-panel wall in narrow portrait.
  // This wider lens is restricted to the deliberate chart preset; follow resets it.
  camera.fov = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(requiredHeight / (2 * distance))), 25, 165);
  camera.zoom = 1; camera.updateProjectionMatrix();
  const visibleWidth = 2 * distance * Math.tan(MathUtils.degToRad(camera.fov / 2)) * aspect;
  const centerX = chart.x + inward * visibleWidth * (1 - fraction) / 2;
  target.set(centerX, chart.y, chart.z); camera.position.set(centerX, chart.y, chart.z + inward * distance);
  // The monitor is just ahead of the back wall; its target may be closer to the
  // wall than the lens margin. Keep this exact look direction for a flat fit.
  camera.position.x = MathUtils.clamp(camera.position.x, INTERIOR_CAMERA_BOUNDS.minX, INTERIOR_CAMERA_BOUNDS.maxX);
  target.x = camera.position.x;
  camera.lookAt(target); camera.updateMatrixWorld();
}

/** Face the right-hand community wall without moving the lens outside the room. */
export function frameInteriorCommunity(camera: PerspectiveCamera, target: Vector3, board: { x: number; y: number; z: number; width: number; height: number }, availableFraction = 1): void {
  camera.up.set(0, 1, 0);
  const aspect = Math.max(0.3, Number.isFinite(camera.aspect) ? camera.aspect : 1);
  const fraction = MathUtils.clamp(availableFraction, 0.5, 1);
  const requiredHeight = Math.max(board.height * 1.14, board.width * 1.1 / (aspect * fraction));
  const distance = Math.min(board.x - INTERIOR_CAMERA_BOUNDS.minX, Math.max(8, requiredHeight / (2 * Math.tan(MathUtils.degToRad(FREE_CAMERA.fov / 2)))));
  camera.fov = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(requiredHeight / (2 * distance))), 25, 120);
  camera.zoom = 1; camera.updateProjectionMatrix();
  const visibleWidth = 2 * distance * Math.tan(MathUtils.degToRad(camera.fov / 2)) * aspect;
  const centerZ = MathUtils.clamp(board.z + visibleWidth * (1 - fraction) / 2, INTERIOR_CAMERA_BOUNDS.minZ, INTERIOR_CAMERA_BOUNDS.maxZ);
  target.set(board.x, board.y, centerZ); camera.position.set(board.x - distance, board.y, centerZ);
  camera.lookAt(target); camera.updateMatrixWorld();
}
