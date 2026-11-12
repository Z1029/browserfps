import {
  BufferAttribute,
  BufferGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Sphere,
  Vector3,
} from "../../vendor/three-r180.js";
import { SKY_COLORS, SUN_LIGHT, WORLD_BOUNDS } from "../../core/config.js";

var B1 = [
  [-0.92, 0.39, 9.5, 0.06],
  [-0.75, -0.66, 5.7, 0.04],
  [-0.99, 0.12, 3.3, 0.026],
  [-0.5, 0.87, 2, 0.016],
];

var Db = [
  [-0.8, 0.6, 1.31, 0.02],
  [-0.95, -0.31, 0.83, 0.014],
  [-0.35, -0.94, 0.57, 0.01],
  [-0.6, 0.8, 0.39, 0.007],
  [-1, 0.05, 0.27, 0.005],
  [0.3, 0.95, 0.47, 0.006],
  [-0.86, -0.51, 0.21, 0.0035],
];

for (let i of B1.concat(Db)) {
  let e = Math.hypot(i[0], i[1]);
  ((i[0] /= e),
    (i[1] /= e),
    (i[4] = (2 * Math.PI) / i[2]),
    (i[5] = Math.sqrt(9.81 * i[4])));
}

var fi = (i) => (Number.isInteger(i) ? i.toFixed(1) : i.toFixed(5));

function Lb(i, e, t) {
  let n = 1 - MathUtils.smoothstep(Math.hypot(i - 30, e), 50, 220),
    s = 0;
  for (let o of B1)
    s += o[3] * Math.sin(o[4] * (o[0] * i + o[1] * e) - o[5] * t);
  return WORLD_BOUNDS.seaY + s * n;
}

var CR = B1.map(
  (i) =>
    `  { float ph = ${fi(i[4])} * dot(vec2(${fi(i[0])}, ${fi(i[1])}), swp.xz) - ${fi(i[5])} * uTime; sdisp.y += ${fi(i[3])} * sin(ph); sdisp.xz += vec2(${fi(i[0])}, ${fi(i[1])}) * (${fi(i[3] * 0.6)} * cos(ph)); }`,
).join(`
`);

var PR = B1.map(
  (i) =>
    `  slopeA += vec2(${fi(i[0])}, ${fi(i[1])}) * (${fi(i[3] * i[4])} * cos(${fi(i[4])} * dot(vec2(${fi(i[0])}, ${fi(i[1])}), sxz) - ${fi(i[5])} * uTime));`,
).join(`
`);

var IR = Db.map(
  (i) =>
    `  slopeB += vec2(${fi(i[0])}, ${fi(i[1])}) * (${fi(i[3] * i[4])} * cos(${fi(i[4])} * dot(vec2(${fi(i[0])}, ${fi(i[1])}), sxz) - ${fi(i[5])} * uTime));`,
).join(`
`);

var zR = `
uniform float uTime; uniform sampler2D uDetail, uDetailN; uniform vec3 uHazeA, uHazeB, uSunDirW;
varying vec3 vGWorld; varying float vSAmp;
float gRough; vec2 gNxz; float gOcc; float gSDist; float gSpark;
`;

var DR = `
{
  vec2 sxz = vGWorld.xz;
  float sd = length(cameraPosition - vGWorld); gSDist = sd;
  vec2 slopeA = vec2(0.0), slopeB = vec2(0.0);
${PR}
${IR}
  float nearB = 1.0 - smoothstep(25.0, 110.0, sd);
  vec2 t1 = texture2D(uDetailN, sxz * 0.113 + uTime * vec2(-0.021, 0.009)).ba - 0.5;
  vec2 t2 = texture2D(uDetailN, sxz * 0.031 + uTime * vec2(-0.007, -0.004)).ba - 0.5;
  vec2 t3 = texture2D(uDetailN, sxz.yx * 0.39 + uTime * vec2(0.031, -0.027)).ba - 0.5;
  gNxz = slopeA * vSAmp + slopeB * nearB + t1 * 0.2 + t2 * 0.24 + t3 * 0.1 * nearB;
  // foam / scum along the quay wall (x = 30) and around the moored hull x[33,49] z[-60,-9]
  float dq = sxz.x - 30.0;
  vec2 hq = abs(sxz - vec2(41.0, -34.5)) - vec2(4.0, 21.5);
  float dh = length(max(hq, 0.0)) + min(max(hq.x, hq.y), 0.0) - 4.0;
  float de = min(dq, dh);
  vec4 fn = texture2D(uDetail, sxz * 0.41 + uTime * vec2(-0.012, 0.007));
  vec4 fn2 = texture2D(uDetail, sxz * 0.093 + uTime * vec2(0.004, 0.003));
  float band = 1.0 - smoothstep(0.0, 0.2 + fn2.g * fn2.g * 2.2, de);
  float foam = clamp(band * smoothstep(0.5, 0.68, fn.a * 0.55 + fn.r * 0.25 + fn2.g * 0.3 + band * 0.2), 0.0, 1.0) * step(-0.3, de);
  float scum = (1.0 - smoothstep(0.0, 5.0, de)) * smoothstep(0.4, 0.7, fn2.g);
  vec3 alb = vec3(0.0045, 0.013, 0.017);
  alb = mix(alb, vec3(0.03, 0.04, 0.034), scum * 0.6);
  alb = mix(alb, vec3(0.3, 0.32, 0.3), foam * 0.7);
  diffuseColor.rgb *= alb;
  // wind structure: broad cat's-paw patches (ruffled, darker, duller) between calmer slicks, plus long swell shading
  vec4 fn3 = texture2D(uDetail, sxz * 0.0123 + uTime * vec2(0.0016, 0.0011));
  float gust = smoothstep(0.38, 0.62, fn2.g * 0.45 + fn3.g * 0.75 - 0.1);
  float swell = sin(dot(sxz, vec2(-0.118, 0.05)) - uTime * 0.55 + fn3.a * 5.0) * 0.5 + 0.5;
  gNxz = gNxz * mix(0.4, 1.35, gust) + vec2(-0.92, 0.39) * (swell - 0.5) * 0.07;
  gSpark = mix(0.55, 1.0, swell) * mix(1.0, 0.6, gust);
  diffuseColor.rgb *= mix(1.0, 0.6, gust);
  gRough = mix(mix(0.1, 0.32, smoothstep(12.0, 380.0, sd)) * mix(0.62, 1.5, gust), 0.65, max(foam, scum * 0.3));
  gNxz *= 1.0 - foam * 0.6;
  gOcc = mix(0.3, 1.0, smoothstep(0.0, 8.0, de)) * mix(0.8, 1.05, swell);
}
`;

var LR = `
{
  vec3 sdir = normalize(vGWorld - cameraPosition);
  float toSun = pow(max(dot(normalize(sdir.xz + vec2(1e-5)), normalize(uSunDirW.xz)), 0.0), 3.0);
  vec3 hz = mix(uHazeA, uHazeB, toSun);
  outgoingLight = mix(outgoingLight, hz, smoothstep(220.0, 860.0, gSDist) * 0.8);
}
`;

function gv(i, e, t, n, s) {
  let o = [i],
    r = i,
    a = t;
  for (; r < e - 0.001;)
    ((r = Math.min(e, r + a)), o.push(r), (a = Math.min(s, a * n)));
  return o;
}

function kb(i, e) {
  let t = WORLD_BOUNDS.seaY,
    n = gv(27.5, 880, 0.75, 1.075, 120),
    s = gv(48, 880, 0.9, 1.085, 120),
    r = s
      .map((M) => -M)
      .reverse()
      .concat(gv(-48 + 0.9, 48 - 0.9, 0.9, 1, 0.9), s.slice(0)),
    a = n.length,
    l = r.length,
    c = 12,
    u = new Float32Array((a * l + c) * 3),
    h = [],
    f = 0;
  for (let M = 0; M < l; M++)
    for (let E = 0; E < a; E++)
      ((u[f++] = n[E]), (u[f++] = t), (u[f++] = r[M]));
  for (let M = 0; M < l - 1; M++)
    for (let E = 0; E < a - 1; E++) {
      let w = M * a + E,
        S = w + 1,
        z = w + a,
        H = z + 1;
      h.push(w, z, S, S, z, H);
    }
  let p = (M, E, w, S) => {
    let z = f / 3;
    for (let [H, O] of [
      [M, E],
      [w, E],
      [M, S],
      [w, S],
    ])
      ((u[f++] = H), (u[f++] = t), (u[f++] = O));
    h.push(z, z + 2, z + 1, z + 1, z + 2, z + 3);
  };
  (p(-880, -880, 27.5, -158),
    p(-880, 158, 27.5, 880),
    p(-880, -158, -158, 158));
  let d = new BufferGeometry();
  d.setAttribute("position", new BufferAttribute(u, 3));
  let v = new Float32Array(u.length);
  for (let M = 1; M < v.length; M += 3) v[M] = 1;
  (d.setAttribute("normal", new BufferAttribute(v, 3)),
    d.setIndex(h),
    (d.boundingSphere = new Sphere(new Vector3(0, t, 0), 1300)));
  let g = SKY_COLORS.horizonAway.clone().multiplyScalar(0.85),
    x = SKY_COLORS.horizon.clone().multiplyScalar(0.8),
    y = {
      uTime: {
        value: 0,
      },
      uDetail: {
        value: e.detail,
      },
      uDetailN: {
        value: e.detailN,
      },
      uHazeA: {
        value: g,
      },
      uHazeB: {
        value: x,
      },
      uSunDirW: {
        value: SUN_LIGHT.dir.clone(),
      },
    },
    b = new MeshStandardMaterial({
      color: 16777215,
      roughness: 0.1,
      metalness: 0,
    });
  ((b.name = "sea"),
    (b.onBeforeCompile = (M) => {
      (Object.assign(M.uniforms, y),
        (M.vertexShader =
          `uniform float uTime; varying vec3 vGWorld; varying float vSAmp;
` +
          M.vertexShader.replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
  vec3 swp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vSAmp = 1.0 - smoothstep(50.0, 220.0, distance(swp.xz, vec2(30.0, 0.0)));
  vec3 sdisp = vec3(0.0);
${CR}
  transformed += sdisp * vSAmp;
  vGWorld = swp;`,
          )),
        (M.fragmentShader = M.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
` + zR,
          )
          .replace("#include <map_fragment>", DR)
          .replace(
            "#include <roughnessmap_fragment>",
            "float roughnessFactor = gRough;",
          )
          .replace(
            "#include <normal_fragment_maps>",
            `#include <normal_fragment_maps>
  normal = normalize(mat3(viewMatrix) * normalize(vec3(-gNxz.x, 1.0, -gNxz.y)));`,
          )
          .replace(
            "#include <lights_fragment_maps>",
            `#include <lights_fragment_maps>
  radiance *= gOcc; iblIrradiance *= gOcc;`,
          )
          .replace(
            "#include <lights_fragment_end>",
            `#include <lights_fragment_end>
  { // sun glitter: strongest along the sun's azimuth, calmer to the sides; broken by swell and cat's paws
    vec3 sv = normalize(vGWorld - cameraPosition);
    float az = max(dot(normalize(sv.xz + vec2(1e-5)), normalize(uSunDirW.xz)), 0.0);
    reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(40.0)) * gSpark * mix(0.3, 1.0, az * az * az);
  }`,
          )
          .replace(
            "#include <opaque_fragment>",
            LR +
              `
#include <opaque_fragment>`,
          )));
    }),
    (b.customProgramCacheKey = () => "saltline-sea-1"));
  let m = new Mesh(d, b);
  ((m.name = "sea"),
    (m.receiveShadow = !0),
    (m.castShadow = !1),
    (m.frustumCulled = !1),
    (m.matrixAutoUpdate = !1));
  let A = new MeshStandardMaterial({
      color: 724238,
      roughness: 0.55,
      metalness: 0,
    }),
    _ = new Mesh(
      new PlaneGeometry(320, 4.4)
        .rotateY(Math.PI / 2)
        .translate(29.88, -2.18, 0),
      A,
    );
  return (
    (_.name = "quaySkirt"),
    (_.receiveShadow = !0),
    (_.matrixAutoUpdate = !1),
    {
      mesh: m,
      skirt: _,
      uniforms: y,
      material: b,
    }
  );
}

export { Lb, kb };
