// Static soldier NPC loaded from a GLB. Preloaded once, then cloned synchronously by the prop factory.
import { Box3, Group, Quaternion, Vector3 } from "../../vendor/three-r180.js";
import { GLTFLoader } from "../../vendor/GLTFLoader.js";
import { clone as cloneSkeleton } from "../../vendor/SkeletonUtils.js";

const MODEL_URL = "models/soldier.glb";
const TARGET_HEIGHT = 1.8;

let template = null;
let loadPromise = null;

export function preloadSoldier() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve) => {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const raw = new Box3().setFromObject(root).getSize(new Vector3());
        root.scale.multiplyScalar(TARGET_HEIGHT / (raw.y || 1));
        root.updateMatrixWorld(true);
        const box = new Box3().setFromObject(root);
        const center = box.getCenter(new Vector3());
        root.position.x -= center.x;
        root.position.y -= box.min.y;
        root.position.z -= center.z;
        root.updateMatrixWorld(true);
        poseArmsDown(root);
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        template = root;
        resolve(root);
      },
      undefined,
      (err) => {
        console.error("[soldier] failed to load", err);
        resolve(null);
      },
    );
  });
  return loadPromise;
}

// Rotate the upper-arm bones so the bind T-pose becomes an at-attention stance.
function poseArmsDown(root) {
  const find = (prefix) => {
    let hit = null;
    root.traverse((o) => {
      if (!hit && o.isBone && o.name.startsWith(prefix)) hit = o;
    });
    return hit;
  };
  const lower = (armPrefix, forePrefix, side) => {
    const arm = find(armPrefix);
    const fore = find(forePrefix);
    if (!arm || !fore || !arm.parent) return;
    const boneDir = fore.position.clone().normalize();
    const from = boneDir.applyQuaternion(arm.getWorldQuaternion(new Quaternion()));
    const to = new Vector3(side * 0.25, -1, 0).normalize();
    const spin = new Quaternion().setFromUnitVectors(from, to);
    const parentWorld = arm.parent.getWorldQuaternion(new Quaternion());
    const world = spin.multiply(arm.getWorldQuaternion(new Quaternion()));
    arm.quaternion.copy(parentWorld.invert().multiply(world));
  };
  lower("mixamorigLeftArm", "mixamorigLeftForeArm", 1);
  lower("mixamorigRightArm", "mixamorigRightForeArm", -1);
  root.updateMatrixWorld(true);
}

export function buildSoldier() {
  if (!template) return null;
  const wrapper = new Group();
  wrapper.add(cloneSkeleton(template));
  wrapper.userData.noMerge = true;
  wrapper.userData.colliders = [
    { min: [-0.25, 0, -0.25], max: [0.25, TARGET_HEIGHT, 0.25], surface: "concrete" },
  ];
  wrapper.userData.size = [0.5, TARGET_HEIGHT, 0.5];
  return wrapper;
}