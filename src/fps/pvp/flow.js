// PvP match flow: replaces the mission/objective game flow.
import { Vector3 } from "../vendor/three-r180.js";
import { createMenus } from "../ui/menus.js";
import { createNet } from "./net.js";
import { t } from "../../i18n.js";
import {
  KILL_TARGET,
  RESPAWN_SECONDS,
  SPAWNS,
  spawnFor,
  yawToCenter,
} from "./arena.js";

const ROLE_LABEL = { host: "房主", guest: "对手" };

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error("missing_element:" + id);
  return element;
}

export function createPvpFlow(context) {
  const player = context.player;
  const hud = context.hud;
  const input = context.input;
  const weapon = context.weapon;
  const events = context.events;
  const net = createNet(context);
  const ui = byId("ui");

  const overlay = byId("pvp-overlay");
  const overlayEyebrow = byId("pvp-eyebrow");
  const overlayTitle = byId("pvp-title");
  const overlayScore = byId("pvp-score");
  const rematchButton = byId("pvp-rematch");
  const rematchRow = rematchButton.closest(".row--actions");
  const leaveButton = byId("pvp-leave");

  const scoreEl = document.createElement("div");
  scoreEl.className = "pvp-score";
  scoreEl.innerHTML =
    '<span class="pv-label">' + t("hud.me") + '</span><b data-me>0</b><i>:</i><b data-them>0</b>' +
    '<span class="pv-label">' + t("hud.rival") + '</span><em>' +
    t("hud.target", { n: KILL_TARGET }) +
    '</em><span class="pv-ping">-- ms</span>';
  scoreEl.hidden = true;
  ui.appendChild(scoreEl);
  const scoreMe = scoreEl.querySelector("[data-me]");
  const scoreThem = scoreEl.querySelector("[data-them]");

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

  let phase = "loading";
  let countdown = 0;
  let deadTimer = 0;
  let hadLock = false;

  const home = spawnFor(net.role);
  player.reset({
    pos: new Vector3(home.x, 0, home.z),
    yaw: yawToCenter(home.x, home.z),
  });
  weapon.reset();
  weapon.setVisible(true);
  player.enabled = false;
  input.setGameplay(false);
  hud.show(false);
  hud.setObjective("");
  hud.setMarkers([]);
  menus.show("none");
  notice.hidden = false;
  notice.textContent = t("hud.waiting");

  function updateScore() {
    if (scoreMe) scoreMe.textContent = String(net.scores[net.role]);
    if (scoreThem) scoreThem.textContent = String(net.scores[net.opponent]);
  }

  function toggleScore(visible) {
    scoreEl.hidden = !visible;
  }

  function beginCountdown() {
    if (phase !== "loading") return;
    phase = "countdown";
    countdown = 3;
    player.enabled = false;
    input.setGameplay(false);
    hud.show(true);
    updateScore();
    toggleScore(true);
    notice.hidden = false;
    notice.textContent = "3";
  }

  function startPlaying() {
    phase = "playing";
    countdown = 0;
    notice.hidden = true;
    player.enabled = true;
    input.setGameplay(true);
    hud.show(true);
    toggleScore(true);
    hud.message(t("hud.lockHint"), 6);
    net.sendState(true);
  }

  function pause() {
    if (phase !== "playing") return;
    phase = "paused";
    player.enabled = false;
    input.setGameplay(false);
    input.exitLock();
    hud.show(false);
    toggleScore(false);
    menus.show("paused");
  }

  function resume() {
    if (phase !== "paused") return;
    menus.show("none");
    hud.show(true);
    toggleScore(true);
    player.enabled = true;
    input.setGameplay(true);
    phase = "playing";
    input.requestLock();
  }

  function showResult(won) {
    overlayEyebrow.textContent = t("result.kicker");
    overlayTitle.textContent = t(won ? "result.win" : "result.lose");
    overlayScore.hidden = false;
    overlayScore.textContent =
      String(net.scores[net.role]) + " : " + String(net.scores[net.opponent]);
    rematchButton.hidden = false;
    if (rematchRow) rematchRow.hidden = false;
    rematchButton.disabled = false;
    rematchButton.textContent = t(net.role === "host" ? "result.rematchHost" : "result.rematchGuest");
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function finishMatch(winner) {
    if (phase === "ended") return;
    phase = "ended";
    deadTimer = 0;
    notice.hidden = true;
    player.enabled = false;
    input.setGameplay(false);
    input.exitLock();
    hud.show(false);
    toggleScore(false);
    menus.show("none");
    net.update(0);
    showResult(winner === net.role);
  }

  function resetMatch() {
    net.resetScores();
    const spawn = spawnFor(net.role);
    player.reset({
      pos: new Vector3(spawn.x, 0, spawn.z),
      yaw: yawToCenter(spawn.x, spawn.z),
    });
    weapon.reset();
    weapon.setVisible(true);
    player.enabled = true;
    deadTimer = 0;
    countdown = 0;
    phase = "playing";
    notice.hidden = true;
    hideOverlay();
    hud.show(true);
    toggleScore(true);
    updateScore();
    input.setGameplay(true);
    input.requestLock();
    net.sendState(true);
  }

  function disconnect(reason) {
    if (phase === "ended") return;
    phase = "ended";
    notice.hidden = true;
    player.enabled = false;
    input.setGameplay(false);
    input.exitLock();
    hud.show(false);
    toggleScore(false);
    menus.show("none");
    overlayEyebrow.textContent = t("disconnect.kicker");
    overlayTitle.textContent = t("disconnect.title");
    overlayScore.hidden = true;
    rematchButton.hidden = true;
    if (rematchRow) rematchRow.hidden = true;
    overlay.hidden = false;
    if (reason) hud.message(reason, 0);
  }

  net.callbacks.onReady = () => {
    beginCountdown();
  };
  net.callbacks.onScore = () => {
    updateScore();
  };
  net.callbacks.onDeath = ({ victim }) => {
    if (victim !== net.role || phase !== "playing") return;
    deadTimer = RESPAWN_SECONDS;
    hud.warn(t("hud.signalLost"), RESPAWN_SECONDS);
  };
  net.callbacks.onMatch = (winner) => {
    finishMatch(winner);
  };
  net.callbacks.onRematch = () => {
    if (phase === "ended") resetMatch();
  };
  net.callbacks.onDisconnect = (reason) => {
    disconnect(reason);
  };
  net.callbacks.onPing = (ms) => {
    const ping = scoreEl.querySelector(".pv-ping");
    if (ping) ping.textContent = ms + " ms";
  };

  events.on("player:dead", () => {
    if (phase !== "playing") return;
    if (deadTimer <= 0) deadTimer = RESPAWN_SECONDS;
  });

  events.on("input:lock", ({ locked }) => {
    if (locked) {
      hadLock = true;
      hud.message("", 0);
      return;
    }
    if (phase === "playing" && hadLock) pause();
  });

  addEventListener("keydown", (event) => {
    if (event.code !== "Escape" && event.code !== "KeyP") return;
    if (phase === "playing" && !input.locked) pause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "playing") pause();
  });

  rematchButton.addEventListener("click", () => {
    if (phase !== "ended") return;
    if (net.role === "host") {
      net.requestRematch();
      resetMatch();
    } else {
      net.requestRematch();
      rematchButton.disabled = true;
      rematchButton.textContent = t("result.waiting");
    }
  });

  leaveButton.addEventListener("click", () => {
    location.reload();
  });

  function update(dt) {
    if (phase === "countdown") {
      countdown -= dt;
      if (countdown > 0) {
        notice.textContent = String(Math.ceil(countdown));
      } else {
        startPlaying();
      }
    }

    if (phase === "playing" && deadTimer > 0) {
      deadTimer -= dt;
      notice.hidden = false;
      notice.textContent = t("hud.respawn", {
        s: Math.max(0, deadTimer).toFixed(1),
      });
      if (deadTimer <= 0) {
        const spawn = net.pickSpawn();
        player.reset({
          pos: new Vector3(spawn.x, 0, spawn.z),
          yaw: yawToCenter(spawn.x, spawn.z),
        });
        weapon.reset();
        weapon.setVisible(true);
        player.enabled = true;
        deadTimer = 0;
        notice.hidden = true;
        net.sendState(true);
      }
    }

    net.update(dt);
    return phase !== "title";
  }

  const flow = {
    get state() {
      return phase;
    },
    get scores() {
      return net.scores;
    },
    net,
    spawns: SPAWNS,
    roles: ROLE_LABEL,
    start() {},
    pause,
    resume,
    update,
    resetMatch,
  };

  return flow;
}
