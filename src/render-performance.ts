import type { Object3D, PerspectiveCamera, Vector3 } from 'three';

/** Keep charts/text at native DOM resolution; bound only the 3D drawing buffer.
 * Small displays retain their previous density, while high-DPI/large monitors
 * cannot silently multiply the room's fragment work without limit. */
export function officePixelRatio(dpr: number, compact: boolean, width: number, height: number) {
  const density = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, compact ? 1.5 : 1.7);
  const area = Math.max(1, width) * Math.max(1, height);
  return Math.min(density, Math.sqrt((compact ? 2_000_000 : 4_000_000) / area));
}

/** The light/room never moves. Reuse its depth map during camera-only motion;
 * keep the most recent actor change pending until the next 30 Hz shadow slot. */
export function createOfficeShadowBudget() {
  let pending = true, lastUpdate = -Infinity, wasAnimating = false;
  return {
    invalidate() { pending = true; },
    shouldUpdate(now: number, actorAnimating: boolean) {
      // Also refresh the final neutral pose after an action/move has ended.
      pending ||= actorAnimating || wasAnimating;
      wasAnimating = actorAnimating;
      if (!pending || now - lastUpdate < 1000 / 30 - 0.01) return false;
      pending = false; lastUpdate = now; return true;
    },
  };
}

/** Called once before any moving avatars/markers are attached. */
export function freezeOfficeArchitecture(root: Object3D) {
  root.updateMatrixWorld(true);
  root.traverse(object => { object.matrixAutoUpdate = false; object.matrixWorldAutoUpdate = false; });
}

export function createChartTransformTracker() {
  const previousWorld = new Float64Array(16), previousProjection = new Float64Array(16);
  let initialized = false, lastWidth = 0, lastHeight = 0;
  return {
    invalidate() { initialized = false; },
    changed(camera: PerspectiveCamera, width: number, height: number) {
      const world = camera.matrixWorld.elements, projection = camera.projectionMatrix.elements;
      let changed = !initialized || width !== lastWidth || height !== lastHeight;
      for (let i = 0; i < 16; i++) {
        if (world[i] !== previousWorld[i] || projection[i] !== previousProjection[i]) changed = true;
        previousWorld[i] = world[i]; previousProjection[i] = projection[i];
      }
      initialized = true; lastWidth = width; lastHeight = height;
      return changed;
    },
  };
}

/** Movement deltas never relocate the predicting local player or a seated actor.
 * Full snapshots remain responsible for joins, seats, labels, props and links. */
export function applyOfficeMovementDelta(
  avatar: { target: Vector3; seat: number | null; action: unknown },
  delta: { x: number; z: number; action?: null },
  mine: boolean,
) {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.z)) return false;
  if (delta.action === null) avatar.action = null;
  if (!mine && avatar.seat === null) avatar.target.set(delta.x, 0, delta.z);
  return true;
}
