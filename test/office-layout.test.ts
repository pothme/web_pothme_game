import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOFAS, LOUNGE_TABLES, REFRESHMENT_STATION, MAP_LAYOUT_VERSION, OFFICE_EXPANSION_SCALE, OFFICE_GEOMETRY, ROOM_BOUNDS, ROOM_SPAWN, SEATS, WALL_CHART_GEOMETRY, REAR_WALL_CHART_GEOMETRY, WALL_CLOCK_GEOMETRY, COMMUNITY_WALL_GEOMETRY, WALK_OBSTACLES, findWalkPath, isWalkable, isWalkableSegment, nearestWalkable } from '../shared/classroom-layout';

test('layout v9 furnishes the expanded room while retaining the chart size and room shell', () => {
  assert.equal(MAP_LAYOUT_VERSION, 9);
  assert.equal(OFFICE_GEOMETRY.width, 60.3 * Math.SQRT2 * 1.5);
  assert.equal(OFFICE_GEOMETRY.depth, (53.55 * Math.SQRT2 / 2 - 0.96) * 1.5 + 0.96);
  assert.equal(WALL_CHART_GEOMETRY.z, 1.125 * Math.SQRT2 - 53.55 * Math.SQRT2 / 2 + 0.48);
  assert.equal(WALL_CHART_GEOMETRY.width / (30 * Math.sqrt(6)), 1.5);
  assert.equal(WALL_CHART_GEOMETRY.height / (6.5 * Math.sqrt(6)), 1.5);
  assert.ok(Math.abs(WALL_CHART_GEOMETRY.y - WALL_CHART_GEOMETRY.height / 2 - 0.4) < 1e-10);
  assert.ok(WALL_CHART_GEOMETRY.y < 5.1 * Math.sqrt(6), 'the center lowers as well as the bottom edge');
  assert.equal(OFFICE_EXPANSION_SCALE, Math.sqrt(6));
  assert.ok(Math.abs(WALL_CHART_GEOMETRY.width / WALL_CHART_GEOMETRY.height - WALL_CHART_GEOMETRY.pixelWidth / WALL_CHART_GEOMETRY.pixelHeight) < 1e-10);
  assert.ok(WALL_CHART_GEOMETRY.width < OFFICE_GEOMETRY.width);
  assert.ok(WALL_CHART_GEOMETRY.y - WALL_CHART_GEOMETRY.height / 2 > 0);
  assert.ok(WALL_CHART_GEOMETRY.y + WALL_CHART_GEOMETRY.height / 2 < OFFICE_GEOMETRY.wallHeight);
  assert.equal(SOFAS.length, 10); assert.equal(LOUNGE_TABLES.length, 4); assert.equal(SEATS.length, 56);
  assert.deepEqual(SEATS.map(seat => seat.id), Array.from({length:56},(_,id)=>id));
  for (const seat of SEATS) {
    if (seat.kind === 'sofa') {
      const sofa = SOFAS[seat.sofaId!];
      assert.equal(SEATS.filter(other => other.sofaId === seat.sofaId).length, 4);
      assert.equal(seat.yaw, Math.PI);
      assert.ok(Math.abs(seat.x - sofa.x) < sofa.width / 2);
      assert.ok(seat.standZ < seat.z - 1.3);
    } else {
      const table = LOUNGE_TABLES[seat.tableId!];
      assert.equal(SEATS.filter(other => other.tableId === seat.tableId).length, 4);
      const towardTable = Math.atan2(table.x - seat.x, table.z - seat.z);
      assert.ok(Math.abs(Math.sin(seat.yaw - towardTable)) < 1e-10);
      assert.ok(Math.hypot(seat.standX - table.x, seat.standZ - table.z) > Math.hypot(seat.x - table.x, seat.z - table.z));
    }
    assert.ok(isWalkable(seat.standX, seat.standZ));
    assert.equal(isWalkable(seat.x, seat.z), false, 'walking cannot clip through furniture');
  }
  assert.ok(isWalkable(ROOM_SPAWN.x, ROOM_SPAWN.z));
});

test('widening the display shell leaves every v6 sofa seat and stand-up position unchanged', () => {
  const previousX = [-15.1, -13.7, -12.3, -10.9, 10.9, 12.3, 13.7, 15.1];
  for (const [index, seat] of SEATS.slice(0, 16).entries()) {
    assert.equal(seat.id, index); assert.equal(seat.x, previousX[index % 8]);
    assert.equal(seat.z, index < 8 ? -19.1 : -6.9);
    assert.equal(seat.standX, seat.x); assert.equal(seat.standZ, index < 8 ? -20.7 : -8.5);
  }
});

test('the rear display is 1.5x farther from the anchored front display with walkable new floor',()=>{
  const front=WALL_CHART_GEOMETRY,rear=REAR_WALL_CHART_GEOMETRY,room=OFFICE_GEOMETRY;
  for(const key of ['width','height','x','y','pixelWidth','pixelHeight'] as const) assert.equal(rear[key],front[key]);
  assert.equal(front.yaw,0); assert.equal(rear.yaw,Math.PI);
  assert.ok(Math.abs((rear.z+front.z)/2-room.centerZ)<1e-10,'screens face each other symmetrically');
  assert.ok(Math.abs(room.centerZ+room.depth/2-rear.z-.48)<1e-10);
  assert.ok(ROOM_BOUNDS.minZ>front.z&&ROOM_BOUNDS.maxZ<rear.z,'all players remain on the display faces');
  assert.ok(room.width/2-4.2-3>rear.width/2+.15,'the relocated door and sign clear the rear monitor bezel');
  const oldDepth=53.55*Math.SQRT2/2,oldGap=oldDepth-.96;
  assert.ok(Math.abs((rear.z-front.z)/oldGap-1.5)<1e-10);
  const oldRearWall=front.z-.48+oldDepth;
  const newFloor={x:0,z:ROOM_BOUNDS.maxZ-1};
  assert.ok(newFloor.z>oldRearWall+10,'the newly available floor extends past the previous rear wall');
  assert.deepEqual(ROOM_SPAWN,{x:0,z:-4});
  assert.ok(isWalkableSegment(ROOM_SPAWN.x,ROOM_SPAWN.z,newFloor.x,newFloor.z));
  assert.deepEqual(findWalkPath(ROOM_SPAWN.x,ROOM_SPAWN.z,newFloor.x,newFloor.z).at(-1),newFloor);
  assert.equal(isWalkable(0,room.centerZ+room.depth/2),false,'the expanded rear wall still bounds movement');
});

test('counter approach is reachable near the window and every seat leaves the chart aisle clear', () => {
  const station = REFRESHMENT_STATION;
  assert.ok(station.x - station.width / 2 > -OFFICE_GEOMETRY.width / 2);
  assert.ok(Math.abs(station.x + OFFICE_GEOMETRY.width / 2 - 2.2) < 0.006, 'the counter follows the moved window wall');
  assert.ok(isWalkable(station.standX, station.standZ));
  assert.ok(Math.hypot(station.standX - station.x, station.standZ - station.z) < station.interactionRadius - 0.5);
  assert.ok(WALK_OBSTACLES.every(obstacle => obstacle.z - obstacle.d > WALL_CHART_GEOMETRY.z + 8));
  assert.ok(WALK_OBSTACLES.every(obstacle => obstacle.z + obstacle.d < REAR_WALL_CHART_GEOMETRY.z - 8));
  for (const seat of SEATS) {
    const route = findWalkPath(seat.standX, seat.standZ, station.standX, station.standZ);
    assert.deepEqual(route.at(-1), { x: station.standX, z: station.standZ });
    let from = { x: seat.standX, z: seat.standZ };
    for (const point of route) { assert.ok(isWalkableSegment(from.x, from.z, point.x, point.z)); from = point; }
  }
});

test('rear lounge additions keep wide central, cross-room and between-group walkways', () => {
  // A 16-unit central aisle connects the full depth; a 2.9-unit cross-aisle joins both sides.
  for (const x of [-8, 0, 8]) assert.ok(isWalkableSegment(x, ROOM_BOUNDS.minZ, x, ROOM_BOUNDS.maxZ));
  for (const z of [-1.4, 0, 1.5]) assert.ok(isWalkableSegment(ROOM_BOUNDS.minX, z, ROOM_BOUNDS.maxX, z));
  const additions = [
    ...SOFAS.slice(6).map(sofa => ({x:sofa.x,z:sofa.z,w:sofa.width/2+.25,d:sofa.depth/2+.25})),
    ...LOUNGE_TABLES.slice(2).map(table => ({x:table.x,z:table.z,w:2.4+.54,d:2.4+.54})),
  ];
  for (const [index,group] of additions.entries()) {
    assert.ok(group.z-group.d>1.5,'new furniture belongs in the expanded rear band');
    assert.ok(REAR_WALL_CHART_GEOMETRY.z-group.z-group.d>12,'rear display has a broad clear viewing area');
    for(const other of additions.slice(index+1)) {
      assert.ok(Math.max(Math.abs(group.x-other.x)-group.w-other.w,Math.abs(group.z-other.z)-group.d-other.d)>6,'furniture groups keep more than six units of clear passage');
    }
  }
});

test('clock clears the chart and ceiling while popular posts fit the inward right wall', () => {
  const room = OFFICE_GEOMETRY, chart = WALL_CHART_GEOMETRY, clock = WALL_CLOCK_GEOMETRY, board = COMMUNITY_WALL_GEOMETRY;
  assert.ok(clock.y - clock.height / 2 > chart.y + chart.height / 2);
  assert.ok(clock.y + clock.height / 2 + 0.2 < room.wallHeight);
  assert.ok(clock.width < chart.width);
  assert.ok(board.x > chart.width / 2 + 0.5 && board.x < room.width / 2 - 0.1);
  assert.ok(board.y - board.height / 2 > 0 && board.y + board.height / 2 < room.wallHeight);
  assert.ok(board.z - board.width / 2 > room.centerZ - room.depth / 2 + 0.2);
  assert.ok(board.z + board.width / 2 < room.centerZ + room.depth / 2 - 0.2);
  assert.equal(board.y - board.height / 2, 1);
  assert.equal(board.width / board.height, 7 / 6);
});

test('lounge click paths reach corners, counter and every sofa through collision-safe segments', () => {
  const corners = [
    { x: ROOM_BOUNDS.minX, z: ROOM_BOUNDS.minZ }, { x: ROOM_BOUNDS.maxX, z: ROOM_BOUNDS.maxZ },
    { x: ROOM_BOUNDS.minX, z: ROOM_BOUNDS.maxZ }, { x: ROOM_BOUNDS.maxX, z: ROOM_BOUNDS.minZ },
  ];
  const destinations = [...corners, { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ }, ...SEATS.map(seat => ({ x: seat.standX, z: seat.standZ })), ...WALK_OBSTACLES];
  for (const start of [ROOM_SPAWN, ...corners]) for (const destination of destinations) {
    const route = findWalkPath(start.x, start.z, destination.x, destination.z);
    assert.ok(route.length > 0, `missing route from ${JSON.stringify(start)} to ${JSON.stringify(destination)}`);
    let previous = start;
    for (const point of route) {
      assert.ok(isWalkableSegment(previous.x, previous.z, point.x, point.z), `obstructed segment: ${JSON.stringify({ previous, point })}`);
      previous = point;
    }
    assert.deepEqual(previous, nearestWalkable(destination.x, destination.z));
  }
});

test('routing rejects invalid starts and projects outside destinations onto the bounded room', () => {
  assert.deepEqual(findWalkPath(NaN, 0, 0, 0), []);
  assert.deepEqual(findWalkPath(ROOM_SPAWN.x, ROOM_SPAWN.z, Infinity, 0), []);
  assert.deepEqual(findWalkPath(SOFAS[0].x, SOFAS[0].z, 0, -4), []);
  for (const point of [{ x: -1e5, z: 1e5 }, { x: NaN, z: Infinity }, ...WALK_OBSTACLES]) {
    const nearest = nearestWalkable(point.x, point.z);
    assert.ok(isWalkable(nearest.x, nearest.z));
  }
  const route = findWalkPath(ROOM_SPAWN.x, ROOM_SPAWN.z, 1e5, -1e5);
  assert.deepEqual(route.at(-1), { x: ROOM_BOUNDS.maxX, z: ROOM_BOUNDS.minZ });
});
