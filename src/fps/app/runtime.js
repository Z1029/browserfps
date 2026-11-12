// Game context, staged startup (world first, then match) and frame loop.
import { PlaneGeometry, THREE, Vector3 } from "../vendor/three-r180.js";
import { chooseQuality } from "../core/quality.js";
import { createEventBus } from "../core/events.js";
import { createRandom } from "../core/random.js";
import { FALLBACKS } from "../core/fallbacks.js";
import { createMesh } from "../core/geometry.js";
import { createRenderer } from "../render/renderer.js";
import { createMaterials } from "../render/materials/materials.js";
import { createPhysics } from "../world/physics.js";
import { createProps } from "../world/props/props.js";
import { createLevel } from "../world/level/level.js";
import { createBackdrop } from "../world/backdrop/backdrop.js";
import { createGround } from "../world/ground/ground.js";
import { createEffects } from "../effects/effects.js";
import { createAudio } from "../audio/audio.js";
import { createInput } from "../input/input.js";
import { createPlayer } from "../player/player.js";
import { createPvpCombat } from "../pvp/combat.js";
import { createRangeCombat } from "../pvp/range-combat.js";
import { createWeapon } from "../weapons/weapon.js";
import { createHUD } from "../ui/hud.js";
import { createPvpFlow } from "../pvp/flow.js";
import { createRangeFlow } from "../pvp/range-flow.js";
import { createMenuCamera } from "../pvp/menu-camera.js";
import { bootElement, setBootProgress } from "./boot-screen.js";

let activeContext = null;

async function initializeSystem(context, name, factory, required = false) {
  const started = performance.now();
  try {
    context[name] = await factory();
  } catch (error) {
    console.error(`[boot] module "${name}" failed: ${(error && error.stack) || error}`);
    if (required || !FALLBACKS[name]) throw error;
    context[name] = FALLBACKS[name]();
  }
  const elapsed = performance.now() - started;
  if (elapsed > 150) console.log(`[boot] ${name} ${elapsed.toFixed(0)}ms`);
}

// Phase one: renderer, materials, collision, port level, backdrop and water.
// The menu camera keeps the finished world moving behind the lobby.
async function startWorld(options = {}) {
  if (activeContext) return activeContext;

  const params = Object.fromEntries(new URLSearchParams(location.search));
  const context = {
    THREE,
    params,
    link: options.link || null,
    role: options.role || "host",
    events: createEventBus(),
    rng: createRandom(+(params.seed || 4207)),
    time: { t: 0, dt: 0, frame: 0, real: 0 },
    quality: chooseQuality(params.q || (params.shot ? "test" : "")),
  };
  window.__G = context;

  await setBootProgress("Waking the renderer", 0.06);
  await initializeSystem(context, "render", () => createRenderer(context), true);
  context.renderer = context.render.renderer;
  context.scene = context.render.scene;
  context.camera = context.render.camera;
  context.viewCamera = context.render.viewCamera;

  await setBootProgress("Mixing paint and rust", 0.16);
  await initializeSystem(context, "mats", () => createMaterials(context), true);
  context.physics = createPhysics(context);
  context.props = createProps(context);

  await setBootProgress("Stacking containers", 0.36);
  await initializeSystem(context, "level", () => createLevel(context), true);

  await setBootProgress("Raising the cranes", 0.56);
  await initializeSystem(context, "backdrop", () => createBackdrop(context));

  await setBootProgress("Flooding the apron", 0.7);
  await initializeSystem(context, "ground", () => createGround(context));
  if (context.ground && context.ground.stub) {
    const plane = createMesh(
      new PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      context.mats.get("asphalt"),
      { cast: false },
    );
    context.scene.add(plane);
  }
  context.physics.build();

  context.menuCam = createMenuCamera(context);

  await setBootProgress("Waiting for first light", 0.9);
  try {
    await context.render.onLevelReady();
  } catch (error) {
    console.error("[boot] render.onLevelReady failed: " + ((error && error.stack) || error));
  }

  await setBootProgress("Ready", 1);
  bootElement.classList.add("done");
  setTimeout(() => {
    bootElement.hidden = true;
  }, 500);

  startLoop(context);
  activeContext = context;
  return context;
}

// Phase two: player, weapon, HUD and the match flow.
async function startMatch(options = {}) {
  const context = activeContext;
  if (!context) throw new Error("world_not_ready");
  if (context.game) return context;

  if (options.link) context.link = options.link;
  if (options.role) context.role = options.role;

  context.input = createInput(context);
  await initializeSystem(context, "fx", () => createEffects(context));
  await initializeSystem(
    context,
    "audio",
    () => (context.params.noaudio ? FALLBACKS.audio() : createAudio(context)),
  );
  context.player = createPlayer(context);
  context.combat =
    options.mode === "range" ? createRangeCombat(context) : createPvpCombat(context);
  await initializeSystem(context, "weapon", () => createWeapon(context));
  context.enemies = FALLBACKS.enemies();
  await initializeSystem(context, "hud", () => createHUD(context));

  context.menuCam = null;
  context.game =
    options.mode === "range"
      ? createRangeFlow(context, options.rangeMode)
      : createPvpFlow(context);
  return context;
}

function startLoop(context) {
  let previousFrameTime = performance.now();
  let averageFrameSeconds = 0;
  const updateSystem = (name, dt) => {
    const system = context[name];
    if (system && system.update) {
      try {
        system.update(dt);
      } catch (error) {
        updateSystem.err[name] ||
          ((updateSystem.err[name] = 1),
          console.error(`[loop] ${name}.update threw: ${(error && error.stack) || error}`));
      }
    }
  };
  updateSystem.err = {};

  window.__stats = () => ({
    ...(context.render.stats ? context.render.stats() : {}),
    fps: averageFrameSeconds ? +(1 / averageFrameSeconds).toFixed(1) : 0,
    state: context.game ? context.game.state : "menu",
  });

  context.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const frameSeconds = (now - previousFrameTime) / 1000;
    previousFrameTime = now;
    averageFrameSeconds = averageFrameSeconds
      ? averageFrameSeconds * 0.95 + frameSeconds * 0.05
      : frameSeconds;

    let dt = Math.min(frameSeconds, 0.05);
    if (context.params.dt) dt = +context.params.dt;
    context.time.dt = dt;
    context.time.t += dt;
    context.time.real = now / 1000;
    context.time.frame += 1;

    if (context.menuCam) {
      context.menuCam.update(dt);
      updateSystem("level", dt);
      updateSystem("backdrop", dt);
      updateSystem("ground", dt);
      updateSystem("mats", dt);
      try {
        context.render.frame(dt);
      } catch (error) {
        updateSystem.err.render ||
          ((updateSystem.err.render = 1),
          console.error("[loop] render.frame threw: " + ((error && error.stack) || error)));
      }
      context.input?.endFrame?.();
      window.__frames += 1;
      window.__frames === 2 && (window.__ready = true);
      return;
    }

    updateSystem("input", dt);
    let playing = false;
    if (context.game) {
      try {
        playing =
          context.game.update(dt) !== false &&
          context.game.state !== "title" &&
          context.game.state !== "paused";
      } catch (error) {
        updateSystem.err.game ||
          ((updateSystem.err.game = 1),
          console.error("[loop] game.update threw: " + ((error && error.stack) || error)));
      }
    }
    if (playing) {
      updateSystem("player", dt);
      updateSystem("weapon", dt);
      updateSystem("enemies", dt);
    }
    if (!context.game || context.game.state !== "paused") {
      updateSystem("fx", dt);
      updateSystem("ground", dt);
      updateSystem("level", dt);
      updateSystem("backdrop", dt);
      updateSystem("mats", dt);
    }
    updateSystem("audio", dt);
    updateSystem("hud", dt);

    if (context.bench) context.bench.frame(frameSeconds);

    try {
      context.render.frame(dt);
    } catch (error) {
      updateSystem.err.render ||
        ((updateSystem.err.render = 1),
        console.error("[loop] render.frame threw: " + ((error && error.stack) || error)));
    }
    context.input?.endFrame?.();
    window.__frames += 1;
    window.__frames === 2 && (window.__ready = true);
  });
}

export { startWorld, startMatch };
