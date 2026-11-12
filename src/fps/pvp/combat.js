// PvP combat: local shots only resolve against the world.
// Opponent hit registration is decided by the receiving browser.
export function createPvpCombat(context) {
  const stats = { shots: 0, hits: 0, kills: 0 };

  return {
    stats,
    reset() {
      stats.shots = 0;
      stats.hits = 0;
      stats.kills = 0;
    },
    playerShot(origin, dir, { damage = 28, range = 300 } = {}) {
      stats.shots++;
      let hit = null;
      try {
        hit = context.physics.raycast(origin, dir, range);
      } catch {
        hit = null;
      }
      if (!hit) return null;
      const impact = {
        point: hit.point,
        normal: hit.normal,
        dist: hit.dist,
        surface: hit.surface,
        enemy: null,
        dir,
        from: "player",
      };
      context.events.emit("impact", impact);
      return impact;
    },
    enemyShot() {
      return false;
    },
    explode() {},
  };
}
