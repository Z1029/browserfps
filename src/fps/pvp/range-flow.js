// Solo range flow: a 60-second bot fight or a fixed-position orb drill.
import {
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "../vendor/three-r180.js";
import { createMenus } from "../ui/menus.js";
import { SPAWNS, yawToCenter } from "./arena.js";
import { buildRival } from "./rival.js";
import { readRangeBest, writeRangeBest } from "../../range-store.js";
import { t } from "../../i18n.js";

const DURATION = 60;
const COUNTDOWN = 3;
const BOT_COUNT = 3;
const BOT_MAX_HEALTH = 100;
const BOT_DAMAGE = 7;
const BOT_HEIGHT = 1.8;
const BOT_RADIUS = 0.4;
const BALL_COUNT = 4;
const BALL_RADIUS = 0.34;
const EYE_HEIGHT = 1.6;

const rand = (min, max) => min + Math.random() * (max - min);

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error("missing_element:" + id);
  return element;
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
  return { t, part: y > base.y + height * 0.78 ? "weak" : "body" };
}

function raySphere(origin, dir, center, radius, maxDist) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = 2 * (ox * dir.x + oy * dir.y + oz * dir.z);
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / 2;
  const t2 = (-b + root) / 2;
  const t = t1 >= 0 ? t1 : t2 >= 0 ? t2 : null;
  if (t === null || t > maxDist) return null;
  return { t, part: "body" };
}

export function createRangeFlow(context, mode) {
  const rangeMode = mode === "targets" ? "targets" : "bots";
  const player = context.player;
  const hud = context.hud;
  const input = context.input;
  const weapon = context.weapon;
  const events = context.events;
  const combat = context.combat;
  const ui = byId("ui");

  const overlay = byId("pvp-overlay");
  const overlayEyebrow = byId("pvp-eyebrow");
  const overlayTitle = byId("pvp-title");
  const overlayScore = byId("pvp-score");
  const rematchButton = byId("pvp-rematch");
  const rematchRow = rematchButton.closest(".row--actions");
  const leaveButton = byId("pvp-leave");

  const spawn = SPAWNS[0];
  const spawnPos = new Vector3(spawn.x, 0, spawn.z);
  const spawnYaw = yawToCenter(spawn.x, spawn.z);
  const spawnEye = spawnPos.clone().add(new Vector3(0, EYE_HEIGHT, 0));

  const scoreEl = document.createElement("div");
  scoreEl.className = "range-hud";
  scoreEl.hidden = true;
  scoreEl.innerHTML =
    '<span class="rg-mode" data-mode></span>' +
    '<b data-score>0</b><span class="rg-label">' +
    t("range.scoreLabel") +
    "</span><i></i>" +
    '<b data-time>60.0</b><span class="rg-label">' +
    t("range.timeLabel") +
    "</span>" +
    '<em data-best>' +
    t("range.bestLabel", { n: 0 }) +
    "</em>";
  ui.appendChild(scoreEl);
  const modeField = scoreEl.querySelector("[data-mode]");
  const scoreField = scoreEl.querySelector("[data-score]");
  const timeField = scoreEl.querySelector("[data-time]");
  const bestField = scoreEl.querySelector("[data-best]");
  modeField.textContent = t(rangeMode === "bots" ? "range.botsMode" : "range.targetsMode");

  const notice = document.createElement("div");
  notice.className = "pvp-notice";
  notice.hidden = true;
  ui.appendChild(notice);

  const menus = createMenus(context, {
    deploy() {},
    resume() {
      resume();
    },
    restart() {},
    retry() {},
    redeploy() {},
  });
  menus.applySettings();

  const menuRoot = menus.root;
  const pauseScreen = menuRoot.querySelector('.m-screen[data-s="paused"]');
  if (pauseScreen) {
    const kicker = pauseScreen.querySelector(".m-k");
    const heading = pauseScreen.querySelector(".m-h");
    const resumeBtn = pauseScreen.querySelector('[data-act="resume"]');
    if (kicker) kicker.textContent = t("pause.kicker");
    if (heading) heading.textContent = t("pause.title");
    if (resumeBtn) resumeBtn.textContent = t("pause.resume");
  }
  for (const row of menuRoot.querySelectorAll(".keys div")) {
    const text = row.textContent || "";
    if (text.includes("Cut relay") || text.includes("Melee")) row.remove();
  }

  const ballGeometry = new SphereGeometry(BALL_RADIUS, 18, 14);
  const ballMaterial = new MeshStandardMaterial({
    color: 0x3aa7ff,
    emissive: 0x0b2f5c,
    emissiveIntensity: 1.9,
    roughness: 0.3,
    metalness: 0.12,
  });

  const bots = [];
  const balls = [];
  let phase = "loading";
  let countdown = 0;
  let timeLeft = DURATION;
  let score = 0;
  let best = readRangeBest()[rangeMode] || 0;
  let elapsed = 0;
  let deadTimer = 0;
  let hadLock = false;

  function clearTo(point) {
    try {
      return context.physics.lineOfSight(spawnEye, point);
    } catch {
      return true;
    }
  }

  function pickBallPoint() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = spawnYaw + rand(-1.15, 1.15);
      const distance = rand(7, 18);
      const x = spawnPos.x - Math.sin(angle) * distance;
      const z = spawnPos.z - Math.cos(angle) * distance;
      if (x < -35 || x > 28 || z < -27 || z > 27) continue;
      const point = new Vector3(x, rand(1.0, 3.2), z);
      if (clearTo(point)) return point;
    }
    return spawnPos
      .clone()
      .add(new Vector3(-Math.sin(spawnYaw) * 12, 1.8, -Math.cos(spawnYaw) * 12));
  }

  function pickBotSpot() {
    const points = (context.level.coverPoints || []).filter((point) => point && point.y < 0.5);
    for (let attempt = 0; attempt < 50 && points.length; attempt += 1) {
      const point = points[Math.floor(Math.random() * points.length)];
      const distance = Math.hypot(point.x - spawnPos.x, point.z - spawnPos.z);
      if (distance < 8 || distance > 26) continue;
      if (bots.some((bot) => bot.alive && bot.pos.distanceTo(point) < 4)) continue;
      const candidate = new Vector3(point.x, 0, point.z);
      if (!clearTo(candidate.clone().add(new Vector3(0, 1.5, 0)))) continue;
      return candidate;
    }
    const angle = rand(0, Math.PI * 2);
    return new Vector3(
      spawnPos.x - Math.sin(angle) * 12,
      0,
      spawnPos.z - Math.cos(angle) * 12,
    );
  }

  function reseatBall(ball) {
    ball.base.copy(pickBallPoint());
    ball.phase = rand(0, Math.PI * 2);
    ball.mesh.position.copy(ball.base);
    ball.mesh.scale.setScalar(0.72);
  }

  function createBall() {
    const mesh = new Mesh(ballGeometry, ballMaterial);
    const base = pickBallPoint();
    mesh.position.copy(base);
    context.scene.add(mesh);
    const ball = {
      kind: "ball",
      alive: true,
      base,
      mesh,
      phase: rand(0, Math.PI * 2),
      hitTest(origin, dir, maxDist) {
        return raySphere(origin, dir, ball.base, BALL_RADIUS, maxDist);
      },
      onHit() {
        score += 1;
        updateHud();
        reseatBall(ball);
        return false;
      },
    };
    balls.push(ball);
    combat.targets.push(ball);
    return ball;
  }

  function createBot() {
    const model = buildRival(0xff5a40, 0xffb4a8);
    const pos = pickBotSpot();
    model.root.position.copy(pos);
    context.scene.add(model.root);
    const bot = {
      kind: "bot",
      alive: true,
      health: BOT_MAX_HEALTH,
      pos,
      model,
      cooldown: rand(1.2, 2.4),
      phase: rand(0, Math.PI * 2),
      respawnAt: 0,
      hitTest(origin, dir, maxDist) {
        return rayCapsule(origin, dir, bot.pos, BOT_HEIGHT, BOT_RADIUS, maxDist);
      },
      onHit({ damage, part }) {
        if (!bot.alive) return false;
        bot.health -= part === "weak" ? damage * 1.8 : damage;
        if (bot.health <= 0) {
          bot.alive = false;
          bot.health = 0;
          bot.model.root.visible = false;
          bot.respawnAt = elapsed + 1.6;
          score += part === "weak" ? 2 : 1;
          updateHud();
          return true;
        }
        return false;
      },
    };
    bots.push(bot);
    combat.targets.push(bot);
    return bot;
  }

  function clearTargets() {
    for (const bot of bots) context.scene.remove(bot.model.root);
    for (const ball of balls) context.scene.remove(ball.mesh);
    bots.length = 0;
    balls.length = 0;
    combat.targets.length = 0;
  }

  function spawnTargets() {
    if (rangeMode === "bots") {
      for (let index = 0; index < BOT_COUNT; index += 1) createBot();
    } else {
      for (let index = 0; index < BALL_COUNT; index += 1) createBall();
    }
  }

  function updateHud() {
    scoreField.textContent = String(score);
    timeField.textContent = Math.max(0, timeLeft).toFixed(1);
    bestField.textContent = t("range.bestLabel", { n: best });
    scoreEl.classList.toggle("low", timeLeft <= 10 && phase === "running");
    modeField.textContent = t(rangeMode === "bots" ? "range.botsMode" : "range.targetsMode");
  }

  function beginCountdown() {
    clearTargets();
    spawnTargets();
    score = 0;
    timeLeft = DURATION;
    countdown = COUNTDOWN;
    elapsed = 0;
    deadTimer = 0;
    phase = "countdown";
    player.reset({ pos: spawnPos.clone(), yaw: spawnYaw });
    player.enabled = false;
    weapon.reset();
    weapon.setVisible(true);
    weapon.reserve = 999;
    input.setGameplay(false);
    hud.show(true);
    hud.message("", 0);
    hud.setObjective("");
    hud.setMarkers([]);
    menus.show("none");
    overlay.hidden = true;
    notice.hidden = false;
    notice.textContent = String(COUNTDOWN);
    scoreEl.hidden = false;
    updateHud();
  }

  function startRunning() {
    phase = "running";
    notice.hidden = true;
    player.enabled = true;
    input.setGameplay(true);
    hud.show(true);
    hud.message(t("hud.lockHint"), 6);
    updateHud();
  }

  function endRange() {
    if (phase === "ended") return;
    phase = "ended";
    timeLeft = 0;
    player.enabled = false;
    input.setGameplay(false);
    input.exitLock();
    hud.show(false);
    scoreEl.hidden = true;
    notice.hidden = true;
    menus.show("none");
    if (score > best) {
      best = score;
      writeRangeBest(rangeMode, score);
    }
    overlayEyebrow.textContent = t("range.kicker");
    overlayTitle.textContent = t("range.timeUp");
    overlayScore.hidden = false;
    overlayScore.classList.add("lb-result-score--range");
    overlayScore.innerHTML =
      '<div class="rr-row"><span class="rr-label">' +
      t("range.resultScore") +
      '</span><b class="rr-value">' +
      score +
      "</b></div>" +
      '<div class="rr-row"><span class="rr-label">' +
      t("range.resultBest") +
      '</span><b class="rr-value">' +
      best +
      "</b></div>";
    rematchButton.hidden = false;
    if (rematchRow) rematchRow.hidden = false;
    rematchButton.disabled = false;
    rematchButton.textContent = t("range.retry");
    leaveButton.textContent = t("range.exit");
    overlay.hidden = false;
  }

  function respawnBot(bot) {
    bot.pos.copy(pickBotSpot());
    bot.model.root.position.copy(bot.pos);
    bot.model.root.visible = true;
    bot.health = BOT_MAX_HEALTH;
    bot.alive = true;
    bot.cooldown = rand(1.0, 2.0);
    bot.model.head.rotation.x = 0;
  }

  function updateBots(dt) {
    elapsed += dt;
    for (const bot of bots) {
      if (!bot.alive) {
        if (elapsed >= bot.respawnAt) respawnBot(bot);
        continue;
      }
      const dx = player.pos.x - bot.pos.x;
      const dz = player.pos.z - bot.pos.z;
      bot.model.root.rotation.y = Math.atan2(-dx, -dz);
      bot.phase += dt * 1.6;
      bot.model.legs[0].rotation.x = Math.sin(bot.phase) * 0.1;
      bot.model.legs[1].rotation.x = -Math.sin(bot.phase) * 0.1;
      bot.model.arms[0].rotation.x = -0.22;
      bot.model.arms[1].rotation.x = 0.12;

      bot.cooldown -= dt;
      if (bot.cooldown > 0 || !player.alive || phase !== "running") continue;
      bot.cooldown = rand(1.1, 2.3);

      const origin = bot.pos.clone();
      origin.y += 1.5;
      const target = player.pos.clone();
      target.y += 1.35;
      const dir = target.sub(origin).normalize();
      dir.x += rand(-0.05, 0.05);
      dir.y += rand(-0.03, 0.03);
      dir.z += rand(-0.05, 0.05);
      dir.normalize();

      let wall = null;
      try {
        wall = context.physics.raycast(origin, dir, 100);
      } catch {
        wall = null;
      }
      const maxDist = wall ? wall.dist : 100;
      const hit = rayCapsule(origin, dir, player.pos, BOT_HEIGHT, 0.42, maxDist);
      if (hit) player.damage(BOT_DAMAGE, origin);
      if (context.fx && context.fx.tracer) {
        context.fx.tracer(
          origin,
          wall ? wall.point : origin.clone().addScaledVector(dir, 100),
        );
      }
    }
  }

  function updateBalls(dt) {
    for (const ball of balls) {
      ball.phase += dt * 1.5;
      ball.mesh.position.y = ball.base.y + Math.sin(ball.phase) * 0.12;
      ball.mesh.rotation.y += dt * 1.4;
      const scale = ball.mesh.scale.x;
      if (scale < 1) ball.mesh.scale.setScalar(Math.min(1, scale + dt * 3));
    }
  }

  function pause() {
    if (phase !== "running") return;
    phase = "paused";
    player.enabled = false;
    input.setGameplay(false);
    input.exitLock();
    hud.show(false);
    scoreEl.hidden = true;
    notice.hidden = true;
    menus.show("paused");
  }

  function resume() {
    if (phase !== "paused") return;
    menus.show("none");
    hud.show(true);
    scoreEl.hidden = false;
    player.enabled = true;
    input.setGameplay(true);
    phase = "running";
    input.requestLock();
  }

  function update(dt) {
    if (phase === "countdown") {
      countdown -= dt;
      if (countdown > 0) {
        notice.textContent = String(Math.ceil(countdown));
      } else {
        startRunning();
      }
    }

    if (phase === "running") {
      if (rangeMode === "targets") {
        input.move.x = 0;
        input.move.y = 0;
      }
      if (deadTimer > 0) {
        deadTimer -= dt;
        if (deadTimer <= 0) {
          player.reset({ pos: spawnPos.clone(), yaw: spawnYaw });
          player.enabled = true;
          weapon.reset();
          weapon.reserve = 999;
          notice.hidden = true;
        }
      }
      weapon.reserve = 999;
      timeLeft -= dt;
      if (rangeMode === "bots") updateBots(dt);
      else updateBalls(dt);
      if (timeLeft <= 0) endRange();
      else updateHud();
    }

    return true;
  }

  events.on("player:dead", () => {
    if (phase !== "running" || rangeMode !== "bots") return;
    deadTimer = 2;
    notice.hidden = false;
    notice.textContent = t("range.down");
  });

  events.on("input:lock", ({ locked }) => {
    if (locked) {
      hadLock = true;
      hud.message("", 0);
      return;
    }
    if (phase === "running" && hadLock) pause();
  });

  addEventListener("keydown", (event) => {
    if (event.code !== "Escape" && event.code !== "KeyP") return;
    if (phase === "running" && !input.locked) pause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "running") pause();
  });

  rematchButton.addEventListener("click", () => {
    if (phase !== "ended") return;
    beginCountdown();
  });

  leaveButton.addEventListener("click", () => {
    location.reload();
  });

  beginCountdown();

  return {
    mode: rangeMode,
    get state() {
      return phase;
    },
    get score() {
      return score;
    },
    get remaining() {
      return timeLeft;
    },
    targets: combat.targets,
    update,
    pause,
    resume,
    start() {},
  };
}
