// Two-player network bridge on top of the existing WebRTC peer link.
import { Vector3 } from "../vendor/three-r180.js";
import { KILL_TARGET, pickSpawn, spawnFor } from "./arena.js";
import { buildRival } from "./rival.js";
import { t } from "../../i18n.js";

const STATE_INTERVAL = 1 / 30;
const PING_INTERVAL = 2;
const READY_INTERVAL = 0.6;
const DEFAULT_DAMAGE = 26;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finite(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toVector(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = finite(value[0]);
  const y = finite(value[1]);
  const z = finite(value[2]);
  if (x === null || y === null || z === null) return null;
  return new Vector3(x, y, z);
}

function rayCapsule(origin, dir, base, height, radius, maxDist) {
  const ox = origin.x - base.x;
  const oz = origin.z - base.z;
  const horizontal = dir.x * dir.x + dir.z * dir.z;
  let t;

  if (horizontal < 1e-6) {
    if (ox * ox + oz * oz > radius * radius) return null;
    t = 0;
  } else {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * horizontal * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * horizontal);
    const t2 = (-b + root) / (2 * horizontal);
    if (t2 < 0) return null;
    t = Math.max(t1, 0);
  }

  if (t > maxDist) return null;
  const y = origin.y + dir.y * t;
  if (y < base.y - 0.18 || y > base.y + height + 0.12) return null;
  return { t, head: y > base.y + height * 0.78 };
}

function lerpAngle(from, to, weight) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * weight;
}

export function createNet(context) {
  const link = context.link;
  if (!link) throw new Error("multiplayer_link_missing");

  const role = context.role === "guest" ? "guest" : "host";
  const opponent = role === "host" ? "guest" : "host";
  const player = context.player;
  const scores = { host: 0, guest: 0 };
  const seenDeaths = new Set();

  const model = buildRival();
  context.scene.add(model.root);

  const home = spawnFor(opponent);
  const target = new Vector3(home.x, 0, home.z);
  const position = target.clone();
  let targetYaw = 0;
  let yaw = 0;
  let targetPitch = 0;
  let pitch = 0;
  let targetAlive = true;
  let targetCrouching = false;
  let crouch = 0;
  let walkPhase = 0;
  let walkSpeed = 0;

  let peerReady = false;
  let readyAckSent = false;
  let readyTimer = 0;
  let pingTimer = 0;
  let stateTimer = 0;
  let lastRemoteShotAt = -Infinity;
  let ended = false;

  const callbacks = {
    onReady: () => {},
    onScore: () => {},
    onDeath: () => {},
    onMatch: () => {},
    onRematch: () => {},
    onDisconnect: () => {},
    onPing: () => {},
  };

  function sendState(force = false) {
    if (!force && stateTimer < STATE_INTERVAL) return;
    stateTimer = 0;
    link.sendState({
      t: "s",
      p: [player.pos.x, player.pos.y, player.pos.z],
      y: player.yaw,
      pi: player.pitch,
      a: player.alive ? 1 : 0,
      c: player.crouching ? 1 : 0,
    });
  }

  function registerDeath(id, victim, by) {
    if (!id || seenDeaths.has(id)) return;
    seenDeaths.add(id);
    if (seenDeaths.size > 200) seenDeaths.clear();

    scores[by] += 1;
    callbacks.onScore({ ...scores });

    if (by === role) {
      context.combat.stats.kills += 1;
      context.combat.stats.hits += 1;
      context.events.emit("player:hitEnemy", {
        enemy: null,
        part: "body",
        killed: true,
        weak: false,
      });
      context.hud.feed(t("feed.kill"));
    } else {
      context.hud.feed(t("feed.dead"));
    }

    if (victim === opponent) {
      targetAlive = false;
      model.root.visible = false;
    }

    callbacks.onDeath({ victim, by, scores: { ...scores } });

    if (scores[by] >= KILL_TARGET && !ended) {
      ended = true;
      if (role === "host") link.sendEvent({ t: "match", winner: by });
      callbacks.onMatch(by);
    }
  }

  function handleShot(message) {
    const origin = toVector(message.o);
    const dir = toVector(message.d);
    if (!origin || !dir || dir.lengthSq() < 1e-6) return;
    dir.normalize();

    let wall = null;
    try {
      wall = context.physics.raycast(origin, dir, 320);
    } catch {
      wall = null;
    }
    const maxDist = wall ? wall.dist : 320;
    const end = wall ? wall.point : origin.clone().addScaledVector(dir, 320);

    if (context.fx && context.fx.tracer) context.fx.tracer(origin, end);

    if (!player.alive || ended) return;

    const hit = rayCapsule(
      origin,
      dir,
      player.pos,
      player.crouching ? 1.15 : 1.8,
      0.38,
      maxDist,
    );
    if (!hit) return;

    const base = clamp(finite(message.dmg, DEFAULT_DAMAGE), 4, 120);
    const damage = hit.head ? base * 1.8 : base;
    lastRemoteShotAt = performance.now();
    player.damage(damage, origin);

    if (player.alive) {
      const point = origin.clone().addScaledVector(dir, hit.t);
      link.sendEvent({
        t: "hurt",
        hp: player.health,
        head: hit.head,
        point: [point.x, point.y, point.z],
      });
    }
  }

  function handleHurt(message) {
    if (ended) return;
    const point = toVector(message.point);
    if (point && context.fx && context.fx.sparks) {
      context.fx.sparks(point, new Vector3(0, 1, 0), message.head ? 14 : 9);
    }
    context.events.emit("player:hitEnemy", {
      enemy: null,
      part: message.head ? "weak" : "body",
      killed: false,
      weak: !!message.head,
    });
  }

  function handleDeath(message) {
    const id = typeof message.id === "string" ? message.id : "";
    const victim = message.victim === "host" || message.victim === "guest" ? message.victim : null;
    const by = message.by === "host" || message.by === "guest" ? message.by : null;
    if (!victim || !by) return;
    registerDeath(id, victim, by);
  }

  link.onEvent = (message) => {
    const type = typeof message.t === "string" ? message.t : "";
    switch (type) {
      case "ready":
        if (!peerReady) {
          peerReady = true;
          callbacks.onReady();
        }
        if (!readyAckSent) {
          readyAckSent = true;
          link.sendEvent({ t: "ready" });
        }
        break;
      case "shot":
        handleShot(message);
        break;
      case "hurt":
        handleHurt(message);
        break;
      case "dead":
        handleDeath(message);
        break;
      case "match":
        if (!ended) {
          ended = true;
          callbacks.onMatch(message.winner === "guest" ? "guest" : "host");
        }
        break;
      case "rematch":
        callbacks.onRematch();
        break;
      case "rematch-request":
        if (role === "host") {
          link.sendEvent({ t: "rematch" });
          callbacks.onRematch();
        }
        break;
      case "ping":
        link.sendEvent({ t: "pong", ts: message.ts });
        break;
      case "pong": {
        const ts = finite(message.ts);
        if (ts !== null) {
          callbacks.onPing(Math.max(1, Math.round((Date.now() - ts) / 2)));
        }
        break;
      }
      default:
        break;
    }
  };

  link.onState = (message) => {
    const point = toVector(message.p);
    if (!point) return;
    target.copy(point);
    const nextYaw = finite(message.y);
    if (nextYaw !== null) targetYaw = nextYaw;
    const nextPitch = finite(message.pi);
    if (nextPitch !== null) targetPitch = nextPitch;
    const aliveFlag = finite(message.a);
    if (aliveFlag !== null) targetAlive = aliveFlag > 0;
    targetCrouching = message.c === 1;
  };

  link.onDisconnect = (reason) => {
    callbacks.onDisconnect(reason);
  };

  context.events.on("weapon:fire", ({ origin, dir }) => {
    if (ended || !player.alive || !origin || !dir) return;
    link.sendEvent({
      t: "shot",
      o: [origin.x, origin.y, origin.z],
      d: [dir.x, dir.y, dir.z],
      dmg: finite(context.weapon?.damage, DEFAULT_DAMAGE),
    });
  });

  context.events.on("player:dead", () => {
    if (ended) return;
    // Environmental deaths (falls, water) must not credit the opponent.
    if (performance.now() - lastRemoteShotAt > 6000) return;
    const id = crypto.randomUUID();
    link.sendEvent({ t: "dead", id, victim: role, by: opponent });
    registerDeath(id, role, opponent);
  });

  function update(dt) {
    stateTimer += dt;
    sendState(false);

    if (!peerReady) {
      readyTimer += dt;
      if (readyTimer >= READY_INTERVAL) {
        readyTimer = 0;
        link.sendEvent({ t: "ready" });
      }
    }

    pingTimer += dt;
    if (pingTimer >= PING_INTERVAL) {
      pingTimer = 0;
      link.sendEvent({ t: "ping", ts: Date.now() });
    }

    const previous = position.clone();
    const blend = 1 - Math.exp(-dt * 15);
    position.lerp(target, blend);
    yaw = lerpAngle(yaw, targetYaw, blend);
    pitch += (targetPitch - pitch) * blend;
    crouch += ((targetCrouching ? 1 : 0) - crouch) * Math.min(1, dt * 10);

    const moved = position.distanceTo(previous);
    const speed = dt > 0 ? moved / dt : 0;
    walkSpeed += (Math.min(speed, 8) - walkSpeed) * Math.min(1, dt * 8);
    walkPhase += walkSpeed * dt * 2.4;

    const swing = Math.sin(walkPhase) * Math.min(1, walkSpeed / 3) * 0.6;
    model.root.position.copy(position);
    model.root.rotation.y = yaw;
    model.root.scale.y = 1 - crouch * 0.28;
    model.root.visible = targetAlive;
    model.legs[0].rotation.x = swing;
    model.legs[1].rotation.x = -swing;
    model.arms[0].rotation.x = -swing * 0.45;
    model.arms[1].rotation.x = swing * 0.2;
    model.head.rotation.x = clamp(-pitch * 0.55, -0.55, 0.55);
  }

  return {
    role,
    opponent,
    scores,
    callbacks,
    update,
    sendState,
    pickSpawn: () => pickSpawn(target),
    get peerReady() {
      return peerReady;
    },
    resetScores() {
      scores.host = 0;
      scores.guest = 0;
      seenDeaths.clear();
      ended = false;
      callbacks.onScore({ ...scores });
    },
    requestRematch() {
      link.sendEvent({ t: role === "host" ? "rematch" : "rematch-request" });
    },
    dispose() {
      context.scene.remove(model.root);
    },
  };
}
