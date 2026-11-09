import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, PerspectiveCamera, Ray, Vector3 } from 'three';
import { FREE_CAMERA, FOLLOW_CAMERA, INTERIOR_CAMERA_BOUNDS, constrainInteriorCamera, followCameraPosition, followCameraFov, resetFollowCamera, frameInteriorChart, frameInteriorCommunity, panCameraPosition, tiltCameraPosition } from '../src/office-camera';
import { OFFICE_GEOMETRY, WALL_CHART_GEOMETRY, REAR_WALL_CHART_GEOMETRY, WALL_CLOCK_GEOMETRY, COMMUNITY_WALL_GEOMETRY, ROOM_BOUNDS, ROOM_SPAWN, SEATS } from '../shared/classroom-layout';
import { AVATAR_SEATED_Y } from '../shared/avatar-rig';

const room = OFFICE_GEOMETRY;
const chart = WALL_CHART_GEOMETRY;
function cameraFor(aspect = 16 / 9) {
  const camera = new PerspectiveCamera(FREE_CAMERA.fov, aspect, 0.05, FREE_CAMERA.far);
  const target = new Vector3().copy(FREE_CAMERA.defaultTarget);
  camera.position.copy(FREE_CAMERA.defaultPosition); camera.lookAt(target); camera.updateMatrixWorld();
  return { camera, target };
}
function inside(camera: PerspectiveCamera) {
  const b = INTERIOR_CAMERA_BOUNDS, p = camera.position;
  assert.ok(Number.isFinite(p.x + p.y + p.z));
  assert.ok(p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && p.z >= b.minZ && p.z <= b.maxZ, `outside interior: ${p.toArray()}`);
}

test('initial camera and every free pan/orbit/dolly remain inside four walls, floor and ceiling', () => {
  const { camera, target } = cameraFor(); inside(camera);
  for (const horizontal of [-1000, -20, 0, 20, 1000]) for (const vertical of [-1000, 0, 1000]) {
    panCameraPosition(camera, target, horizontal, vertical); inside(camera);
    for (const distance of [0.01, 1, 12, 55, 1000]) for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) for (const polar of [0.01, 0.6, 1.5, 2.5, 3.13]) {
      camera.position.copy(target).add(new Vector3(Math.sin(yaw) * Math.sin(polar), Math.cos(polar), Math.cos(yaw) * Math.sin(polar)).multiplyScalar(distance));
      constrainInteriorCamera(camera, target); inside(camera);
      assert.ok(camera.position.distanceTo(target) >= 0.3);
    }
  }
  camera.position.set(Infinity, NaN, -Infinity); target.set(NaN, Infinity, NaN); constrainInteriorCamera(camera, target); inside(camera);
});

test('chart framing fits all four horizontal panels beside desktop overlays and in portrait from inside', () => {
  for (const aspect of [16 / 9, 1280 / 650, 390 / 700, 320 / 900, 300 / 1000, 844 / 390]) for (const fraction of aspect > 1 ? [0.5, 0.72, 1] : [1]) {
    const { camera, target } = cameraFor(aspect); frameInteriorChart(camera, target, chart, fraction); constrainInteriorCamera(camera, target); inside(camera);
    for (const x of [-chart.width / 2, chart.width / 2]) for (const y of [chart.y - chart.height / 2, chart.y + chart.height / 2]) {
      const p = new Vector3(x, y, chart.z).project(camera);
      assert.ok(p.x > -0.98 && p.x < fraction * 2 - 1 && Math.abs(p.y) < 0.98 && Math.abs(p.z) < 1, `chart clipped: ${JSON.stringify({ aspect, fraction, p })}`);
    }
    assert.equal(camera.zoom, 1); assert.ok(camera.fov <= 165);
  }
});

test('rear chart framing faces the opposite inward screen with all four panels readable in desktop and portrait', () => {
  const rear=REAR_WALL_CHART_GEOMETRY;
  for(const aspect of [16/9,1280/650,390/700,320/900,300/1000,844/390]) for(const fraction of aspect>1?[.5,.72,1]:[1]) {
    const {camera,target}=cameraFor(aspect);
    frameInteriorChart(camera,target,rear,fraction); constrainInteriorCamera(camera,target); inside(camera);
    assert.ok(camera.position.z<rear.z,'rear preset looks from inside the room');
    assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(new Vector3(0,0,1))<1e-8,'rear camera points along +Z');
    for(const x of [-rear.width/2,rear.width/2]) for(const y of [rear.y-rear.height/2,rear.y+rear.height/2]) {
      const p=new Vector3(x,y,rear.z).project(camera);
      assert.ok(p.x>-.98&&p.x<fraction*2-1&&Math.abs(p.y)<.98&&Math.abs(p.z)<1,`rear chart clipped: ${JSON.stringify({aspect,fraction,p})}`);
    }
    const left=new Vector3(rear.width/2,rear.y,rear.z).project(camera),right=new Vector3(-rear.width/2,rear.y,rear.z).project(camera);
    assert.ok(left.x<right.x,'a yaw-PI rear surface keeps CSS chart order left-to-right');
  }
});

test('corner and seat follow chooses a roomward fallback and keeps body/name visible in narrow portrait', () => {
  const locations = [ROOM_SPAWN, { x: ROOM_BOUNDS.minX, z: ROOM_BOUNDS.minZ }, { x: ROOM_BOUNDS.maxX, z: ROOM_BOUNDS.maxZ }, { x: ROOM_BOUNDS.minX, z: ROOM_BOUNDS.maxZ }, { x: ROOM_BOUNDS.maxX, z: ROOM_BOUNDS.minZ }, ...SEATS.map(s => ({ x: s.x, z: s.z, seated: true }))];
  for (const aspect of [16 / 9, 390 / 700, 320 / 900]) for (const player of locations) for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
    const { camera, target } = cameraFor(aspect);
    target.set(player.x, FOLLOW_CAMERA.focusHeight, player.z);
    camera.position.copy(target).add(new Vector3(Math.sin(yaw) * 6, 3.4, Math.cos(yaw) * 6));
    followCameraPosition(camera, target, player); inside(camera);
    assert.ok(camera.position.distanceTo(target) >= FOLLOW_CAMERA.minDistance);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), seatOffset = 'seated' in player ? AVATAR_SEATED_Y : 0;
    const points = [new Vector3(player.x, seatOffset, player.z), new Vector3(player.x, 2.3 + seatOffset, player.z)];
    for (const side of [-1, 1]) points.push(new Vector3(player.x, 2 + seatOffset, player.z).addScaledVector(right, side * 1.2));
    for (const point of points) { point.project(camera); assert.ok(Math.abs(point.x) < 0.97 && Math.abs(point.y) < 0.97 && Math.abs(point.z) < 1, `person clipped: ${JSON.stringify({ aspect, player, point })}`); }
  }
});

test('following crosses the former rear wall into the expanded floor without an old-depth clamp',()=>{
  const oldRearWall=WALL_CHART_GEOMETRY.z-.48+53.55*Math.SQRT2/2;
  assert.ok(ROOM_BOUNDS.maxZ>oldRearWall+15,'the regression route enters the new rear band');
  for(const aspect of [390/700,320/900,844/390]) {
    const {camera,target}=cameraFor(aspect),aim={elevation:0};
    resetFollowCamera(camera,target,{x:0,z:oldRearWall-4},aim,true);
    for(let z=oldRearWall-4;z<ROOM_BOUNDS.maxZ;z+=.5) {
      const player={x:0,z}; followCameraPosition(camera,target,player,true,aim); inside(camera);
      assert.ok(Math.abs(target.x-player.x)<1e-8&&Math.abs(target.z-player.z)<1e-8,'follow focus tracks the actual position across the old wall');
      const right=new Vector3().setFromMatrixColumn(camera.matrixWorld,0);
      const points=[new Vector3(0,.1,z),new Vector3(0,2.4,z)];
      for(const side of [-1,1])points.push(new Vector3(0,2.1,z).addScaledVector(right,side*1.2));
      for(const point of points){
        point.project(camera);
        assert.ok(Math.abs(point.x)<.97&&Math.abs(point.y)<.97&&Math.abs(point.z)<1,`expanded-floor avatar clipped: ${JSON.stringify({aspect,z,point})}`);
      }
    }
    assert.ok(camera.position.z>oldRearWall+8,'the camera can enter the added floor rather than stopping at the former rear boundary');
  }
});

test('chart preset includes the Seoul clock above the enlarged display', () => {
  const clock = WALL_CLOCK_GEOMETRY;
  for (const aspect of [16 / 9, 1280 / 650, 390 / 700, 320 / 900, 844 / 390]) {
    const { camera, target } = cameraFor(aspect); frameInteriorChart(camera, target, chart); constrainInteriorCamera(camera, target);
    for (const x of [-clock.width / 2, clock.width / 2]) for (const y of [clock.y - clock.height / 2, clock.y + clock.height / 2]) {
      const p = new Vector3(x, y, clock.z).project(camera);
      assert.ok(Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.98 && Math.abs(p.z) < 1, `clock clipped: ${JSON.stringify({ aspect, p })}`);
    }
  }
});

test('community preset fits all three right-wall cards on mobile and beside desktop overlays', () => {
  const board = COMMUNITY_WALL_GEOMETRY;
  for (const aspect of [16 / 9, 1280 / 650, 390 / 700, 320 / 900, 844 / 390]) for (const fraction of aspect > 1 ? [0.5, 0.72, 1] : [1]) {
    const { camera, target } = cameraFor(aspect); frameInteriorCommunity(camera, target, board, fraction); constrainInteriorCamera(camera, target); inside(camera);
    assert.ok(camera.position.x < board.x && Math.abs(camera.position.z - target.z) < 0.01);
    for (const z of [board.z - board.width / 2, board.z + board.width / 2]) for (const y of [board.y - board.height / 2, board.y + board.height / 2]) {
      const p = new Vector3(board.x, y, z).project(camera);
      assert.ok(p.x > -0.98 && p.x < fraction * 2 - 1 && Math.abs(p.y) < 0.98 && Math.abs(p.z) < 1, `community clipped: ${JSON.stringify({ aspect, fraction, p })}`);
    }
  }
});

test('free camera never snaps to player movement, sitting, disconnection or corrections', () => {
  const { camera, target } = cameraFor(); panCameraPosition(camera, target, 2, 1);
  const position = camera.position.clone(), focus = target.clone(), rotation = camera.quaternion.clone();
  for (const player of [ROOM_SPAWN, { x: -15.9, z: -13.5 }, { ...SEATS[0]!, seated: true }, null]) {
    followCameraPosition(camera, target, player, false);
    assert.deepEqual(camera.position.toArray(), position.toArray()); assert.deepEqual(target.toArray(), focus.toArray()); assert.deepEqual(camera.quaternion.toArray(), rotation.toArray());
  }
});

test('follow pitch can look well above the avatar without floor snapping and preserves the chosen angle while moving', () => {
  const { camera, target } = cameraFor(390 / 700), aim = { elevation: 0 };
  const player = { x: 0, z: -12 };
  target.set(player.x, FOLLOW_CAMERA.focusHeight, player.z);
  camera.position.copy(target).add(new Vector3().copy(FOLLOW_CAMERA.defaultOffset));
  constrainInteriorCamera(camera, target, true, aim);
  assert.ok(FOLLOW_CAMERA.maxPolarAngle > Math.PI / 2, 'follow must permit looking from below the aim');
  for (let i = 0; i < 8; i++) { tiltCameraPosition(camera, target, 'up', true, aim); inside(camera); }
  const upward = camera.getWorldDirection(new Vector3());
  assert.ok(upward.y > 0.7, 'upward view must reach the high chart instead of stopping at a level horizon');
  assert.ok(aim.elevation > 0 && camera.position.y < 0.3);
  const beforeMove = camera.quaternion.clone();
  followCameraPosition(camera, target, { x: 2, z: -13 }, true, aim); inside(camera);
  assert.ok(camera.quaternion.angleTo(beforeMove) < 1e-7, 'ordinary movement retains the deliberate upward angle');
  for (let i = 0; i < 12; i++) { tiltCameraPosition(camera, target, 'down', true, aim); inside(camera); }
  assert.ok(camera.getWorldDirection(new Vector3()).y < -0.7, 'the expanded orbit also supports looking down');
  aim.elevation = 0; camera.position.copy(target).add(new Vector3().copy(FOLLOW_CAMERA.defaultOffset));
  followCameraPosition(camera, target, player, true, aim);
  assert.equal(target.y, FOLLOW_CAMERA.focusHeight); inside(camera);
  const head = new Vector3(player.x, 2.3, player.z).project(camera), feet = new Vector3(player.x, 0, player.z).project(camera);
  assert.ok(Math.abs(head.y) < 1 && Math.abs(feet.y) < 1, 'returning to My character restores a safe body view');
});

test('interior viewport rays always meet the closed room before the far plane', () => {
  const shell = new Box3(new Vector3(-room.width / 2, 0, room.centerZ - room.depth / 2), new Vector3(room.width / 2, room.wallHeight, room.centerZ + room.depth / 2));
  const { camera, target } = cameraFor();
  for (const position of [new Vector3().copy(FREE_CAMERA.defaultPosition), new Vector3(INTERIOR_CAMERA_BOUNDS.minX, 1, INTERIOR_CAMERA_BOUNDS.minZ), new Vector3(INTERIOR_CAMERA_BOUNDS.maxX, INTERIOR_CAMERA_BOUNDS.maxY, INTERIOR_CAMERA_BOUNDS.maxZ)]) {
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
      camera.position.copy(position); target.copy(position).add(new Vector3(Math.sin(yaw), Math.sin(yaw * 2), Math.cos(yaw)));
      constrainInteriorCamera(camera, target); inside(camera);
      for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
        const direction = new Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
        const hit = new Ray(camera.position, direction).intersectBox(shell, new Vector3());
        assert.ok(hit && hit.distanceTo(camera.position) < camera.far, 'viewport must see an interior surface rather than exterior void');
      }
    }
  }
});

test('wide mobile lenses keep all near-plane corners inside the room and between both chart surfaces', () => {
  const b = INTERIOR_CAMERA_BOUNDS;
  const shell = new Box3(new Vector3(-room.width / 2 + 0.09, 0.015, room.centerZ - room.depth / 2 + 0.09), new Vector3(room.width / 2 - 0.09, room.wallHeight - 0.15, room.centerZ + room.depth / 2 - 0.09));
  for (const aspect of [320 / 900, 390 / 700, 844 / 390]) for (const fov of [FREE_CAMERA.fov, 150, 165]) {
    const { camera, target } = cameraFor(aspect); camera.fov = fov; camera.updateProjectionMatrix();
    for (const x of [b.minX, 0, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) for (const pitch of [-1, 0, 1]) {
      camera.position.set(x, y, z); target.set(0, y + pitch * 8, room.centerZ);
      constrainInteriorCamera(camera, target); inside(camera);
      for (const nx of [-1, 1]) for (const ny of [-1, 1]) {
        const nearCorner = new Vector3(nx, ny, -1).unproject(camera);
        assert.ok(shell.containsPoint(nearCorner), `near plane crosses the shell: ${JSON.stringify({ aspect, fov, camera: camera.position, nearCorner })}`);
        assert.ok(nearCorner.z>WALL_CHART_GEOMETRY.z&&nearCorner.z<REAR_WALL_CHART_GEOMETRY.z,'turning at either wall cannot put the lens behind a chart aperture');
      }
    }
  }
});

test('entry and My character recover a visible body from an upward visitor camera, and chart preset resets straight ahead', () => {
  for (const aspect of [320 / 900, 390 / 700, 844 / 390]) for (const player of [ROOM_SPAWN, { ...SEATS[31]!, seated: true }]) {
    const { camera, target } = cameraFor(aspect), aim = { elevation: 20 };
    camera.fov = 165; camera.zoom = 2; camera.up.set(1, 0, 0);
    camera.position.set(INTERIOR_CAMERA_BOUNDS.maxX, INTERIOR_CAMERA_BOUNDS.maxY, INTERIOR_CAMERA_BOUNDS.minZ);
    target.set(-25, 30, -30); camera.lookAt(target); camera.updateProjectionMatrix();
    resetFollowCamera(camera, target, player, aim); inside(camera);
    assert.equal(aim.elevation, 0); assert.equal(camera.fov, FREE_CAMERA.fov); assert.equal(camera.zoom, 1);
    for (const y of [0.1, 2.4]) {
      const body = new Vector3(player.x, y, player.z).project(camera);
      assert.ok(Math.abs(body.x) < 0.95 && Math.abs(body.y) < 0.95 && Math.abs(body.z) < 1, 'entry must show the actual character after a tilted visitor view');
    }
    for (let step = 0; step < 8; step++) tiltCameraPosition(camera, target, 'up', true, aim);
    frameInteriorChart(camera, target, chart); constrainInteriorCamera(camera, target); inside(camera);
    assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(new Vector3(0, 0, -1)) < 1e-8, 'chart preset discards pitch/yaw and faces the display');
    for (const x of [-chart.width / 2, chart.width / 2]) for (const y of [0.4, chart.y + chart.height / 2]) {
      const corner = new Vector3(x, y, chart.z).project(camera);
      assert.ok(Math.abs(corner.x) < 0.98 && Math.abs(corner.y) < 0.98, 'all chart corners remain visible after reset');
    }
  }
});

test('mobile address-bar and orientation resizing preserve the chosen follow pose and keep the character visible', () => {
  for (const player of [ROOM_SPAWN, { ...SEATS[31]!, seated: true }]) {
    const { camera, target } = cameraFor(390 / 700), aim = { elevation: 0 };
    resetFollowCamera(camera, target, player, aim, true);
    const position = camera.position.clone(), rotation = camera.quaternion.clone(), focus = target.clone();
    for (const aspect of [390 / 700, 390 / 840, 320 / 900, 300 / 1000, 844 / 390, 390 / 500, 390 / 700]) {
      camera.aspect = aspect; camera.fov = followCameraFov(aspect, true); camera.updateProjectionMatrix();
      followCameraPosition(camera, target, player, true, aim); inside(camera);
      assert.ok(camera.position.distanceTo(position) < 1e-8, 'resizing must not jump from behind the person to the opposite side of the room');
      assert.ok(camera.quaternion.angleTo(rotation) < 1e-7, 'resizing must retain the chosen heading and pitch');
      assert.ok(target.distanceTo(focus) < 1e-8);
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const body = [new Vector3(player.x, 0.1, player.z), new Vector3(player.x, 2.4, player.z)];
      for (const side of [-1, 1]) body.push(new Vector3(player.x, 2.1, player.z).addScaledVector(right, side * 1.2));
      for (const point of body) {
        point.project(camera);
        assert.ok(Math.abs(point.x) < 0.97 && Math.abs(point.y) < 0.97 && Math.abs(point.z) < 1, 'body and name must remain visible in a narrow mobile viewport');
      }
    }
  }
});

test('mobile follow resizing retains a deliberate upward view and desktop keeps its original lens', () => {
  const { camera, target } = cameraFor(390 / 700), aim = { elevation: 0 }, player = { x: 0, z: -12 };
  resetFollowCamera(camera, target, player, aim, true);
  for (let step = 0; step < 4; step++) tiltCameraPosition(camera, target, 'up', true, aim);
  const rotation = camera.quaternion.clone(), position = camera.position.clone();
  for (const aspect of [320 / 900, 390 / 500, 390 / 700]) {
    camera.aspect = aspect; camera.fov = followCameraFov(aspect, true); camera.updateProjectionMatrix();
    followCameraPosition(camera, target, player, true, aim);
    assert.ok(camera.position.distanceTo(position) < 1e-8);
    assert.ok(camera.quaternion.angleTo(rotation) < 1e-7, 'a viewport resize must not erase the requested upward camera angle');
    assert.equal(followCameraFov(aspect, false), FREE_CAMERA.fov, 'desktop lens behavior stays unchanged');
  }
});
