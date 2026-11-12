// Local hitscan combat for the solo range: world geometry plus practice targets.
export function createRangeCombat(context) {
  const stats = { shots: 0, hits: 0, kills: 0 };
  const targets = [];

  return {
    stats,
    targets,
    reset() {
      stats.shots = 0;
      stats.hits = 0;
      stats.kills = 0;
      targets.length = 0;
    },
    playerShot(origin, dir, { damage = 28, range = 300 } = {}) {
      stats.shots++;
      let wall = null;
      try {
        wall = context.physics.raycast(origin, dir, range);
      } catch {
        wall = null;
      }
      const wallDist = wall ? wall.dist : range;

      let best = null;
      for (const target of targets) {
        if (!target.alive) continue;
        const hit = target.hitTest(origin, dir, wallDist);
        if (hit && (!best || hit.t < best.t)) best = { target, ...hit };
      }

      if (best) {
        const point = origin.clone().addScaledVector(dir, best.t);
        const killed =
          best.target.onHit({ damage, part: best.part, point, dir }) === true;
        stats.hits += 1;
        if (killed) stats.kills += 1;
        const normal = dir.clone().negate();
        if (context.fx && context.fx.sparks) {
          context.fx.sparks(point, normal, best.part === "weak" ? 14 : 9);
        }
        context.events.emit("player:hitEnemy", {
          enemy: best.target,
          part: best.part,
          killed,
          weak: best.part === "weak",
        });
        return {
          point,
          normal,
          dist: best.t,
          surface: "enemy",
          enemy: best.target,
          part: best.part,
          dir,
          from: "player",
          killed,
        };
      }

      if (wall) {
        const impact = {
          point: wall.point,
          normal: wall.normal,
          dist: wall.dist,
          surface: wall.surface,
          enemy: null,
          dir,
          from: "player",
        };
        context.events.emit("impact", impact);
        return impact;
      }
      return null;
    },
    enemyShot() {
      return false;
    },
    explode() {},
  };
}
