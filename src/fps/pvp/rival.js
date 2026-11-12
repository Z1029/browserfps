import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from "../vendor/three-r180.js";

export function buildRival(accentColor = 0xff6a2b, visorColor = 0xffc79a) {
  const root = new Group();

  const armor = new MeshStandardMaterial({
    color: 0x2c3c49,
    roughness: 0.72,
    metalness: 0.24,
  });
  const dark = new MeshStandardMaterial({
    color: 0x131b22,
    roughness: 0.8,
    metalness: 0.2,
  });
  const accent = new MeshStandardMaterial({
    color: accentColor,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0x2a0b04,
  });
  const visor = new MeshBasicMaterial({ color: visorColor });

  const mesh = (geometry, material, x, y, z) => {
    const part = new Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = true;
    return part;
  };

  const legGeometry = new BoxGeometry(0.19, 0.86, 0.23);
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new Group();
    hip.position.set(0.17 * side, 0.92, 0);
    hip.add(mesh(legGeometry, dark, 0, -0.43, 0));
    root.add(hip);
    legs.push(hip);
  }

  root.add(mesh(new BoxGeometry(0.66, 0.74, 0.36), armor, 0, 1.27, 0));
  root.add(mesh(new BoxGeometry(0.48, 0.34, 0.07), dark, 0, 1.34, -0.2));
  root.add(mesh(new BoxGeometry(0.7, 0.08, 0.38), accent, 0, 0.93, 0));

  const head = new Group();
  head.position.set(0, 1.64, 0);
  head.add(mesh(new SphereGeometry(0.225, 16, 12), dark, 0, 0, 0));
  head.add(mesh(new BoxGeometry(0.3, 0.08, 0.04), visor, 0, 0.02, -0.2));
  root.add(head);

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new Group();
    shoulder.position.set(0.41 * side, 1.42, 0);
    shoulder.add(mesh(new BoxGeometry(0.15, 0.62, 0.18), armor, 0, -0.29, -0.02));
    root.add(shoulder);
    arms.push(shoulder);
  }

  const rifle = mesh(new BoxGeometry(0.1, 0.12, 0.82), dark, 0.34, 1.16, -0.36);
  rifle.rotation.y = -0.04;
  root.add(rifle);
  root.add(mesh(new BoxGeometry(0.05, 0.05, 0.14), accent, 0.34, 1.24, -0.2));

  return { root, legs, arms, head };
}
