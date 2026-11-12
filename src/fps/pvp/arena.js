// Shared arena spawn points for the two-player match.
export const SPAWNS = [
  { x: -32, z: 6 },
  { x: 26, z: 6 },
  { x: -32, z: -18 },
  { x: 26, z: -18 },
];

export const KILL_TARGET = 5;
export const RESPAWN_SECONDS = 3;

export function yawToCenter(x, z) {
  return Math.atan2(x, z);
}

export function spawnFor(role) {
  return role === "host" ? SPAWNS[0] : SPAWNS[1];
}

export function pickSpawn(awayFrom) {
  let best = SPAWNS[0];
  let bestDistance = -1;
  for (const spawn of SPAWNS) {
    const dx = spawn.x - awayFrom.x;
    const dz = spawn.z - awayFrom.z;
    const distance = dx * dx + dz * dz;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = spawn;
    }
  }
  return best;
}
