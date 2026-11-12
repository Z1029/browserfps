// Slow cinematic camera that keeps the loaded port alive behind the lobby.
import { Vector3 } from "../vendor/three-r180.js";

export function createMenuCamera(context) {
  const camera = context.camera;
  const path = (context.level && context.level.cinematicPath) || [];
  const points = path.map((point) => ({
    pos: new Vector3(...point.pos),
    look: new Vector3(...point.look),
  }));

  camera.fov = 50;
  camera.updateProjectionMatrix();

  if (points.length < 2) {
    const center = new Vector3(0, 2, 0);
    let angle = 0.6;
    const position = new Vector3();
    return {
      update(dt) {
        angle += dt * 0.045;
        position.set(
          Math.cos(angle) * 26,
          7 + Math.sin(angle * 1.7) * 0.8,
          Math.sin(angle) * 24,
        );
        camera.position.copy(position);
        camera.lookAt(center);
      },
    };
  }

  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = points[i].pos.distanceTo(points[i - 1].pos);
    lengths.push(length);
    total += length;
  }
  total = Math.max(total, 4);

  const speed = 2.1;
  const position = new Vector3();
  const look = new Vector3();
  let traveled = 0;
  let sway = 0;

  return {
    update(dt) {
      sway += dt;
      traveled = (traveled + dt * speed) % total;

      let remaining = traveled;
      let index = 0;
      while (index < lengths.length - 1 && remaining > lengths[index]) {
        remaining -= lengths[index];
        index += 1;
      }
      const from = points[index];
      const to = points[Math.min(index + 1, points.length - 1)];
      const span = Math.max(lengths[Math.min(index, lengths.length - 1)] || 0, 1e-4);
      const t = Math.min(1, remaining / span);
      const eased = t * t * (3 - 2 * t);

      position.lerpVectors(from.pos, to.pos, eased);
      look.lerpVectors(from.look, to.look, eased);
      position.x += Math.sin(sway * 0.31) * 0.05;
      position.y += Math.sin(sway * 0.43 + 1.7) * 0.035;
      position.z += Math.sin(sway * 0.27 + 0.6) * 0.05;
      look.y += Math.sin(sway * 0.19) * 0.1;

      camera.position.copy(position);
      camera.lookAt(look);
      if (Math.abs(camera.fov - 50) > 0.01) {
        camera.fov = 50;
        camera.updateProjectionMatrix();
      }
    },
  };
}
