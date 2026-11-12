import {
  BackSide,
  BoxGeometry,
  DataTexture,
  LinearFilter,
  Mesh,
  NoColorSpace,
  PMREMGenerator,
  RGBAFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from "../vendor/three-r180.js";
import { SKY_COLORS, SUN_LIGHT } from "../core/config.js";

var SKY_NOISE_GLSL = `
uniform sampler2D tNoise;
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return texture2D(tNoise, (i + f + 0.5) / 256.0).r; }
float fbm5(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.96875; }
float fbm3(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.875; }
`;

var SKY_COLOR_GLSL = `
uniform vec3 uSunDir, uZen, uHor, uHorAway, uSunCol;
float skyToSun(vec3 d){ return clamp(dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz)) * 0.5 + 0.5, 0.0, 1.0); }
vec3 horizonColor(vec3 d){
  float ts = skyToSun(d);
  vec3 c = mix(uHorAway, uHor, smoothstep(0.15, 0.85, ts));
  c = mix(c, uSunCol * vec3(1.06, 1.0, 0.9), pow(ts, 9.0) * 0.55);
  return c;
}
`;

function createNoiseTexture() {
  let e = new Uint8Array(262144),
    t = 2654435769,
    n = () => (
      (t ^= t << 13),
      (t >>>= 0),
      (t ^= t >>> 17),
      (t ^= t << 5),
      (t >>>= 0),
      t / 4294967296
    );
  for (let o = 0; o < 256 * 256; o++)
    ((e[o * 4] = n() * 256),
      (e[o * 4 + 1] = n() * 256),
      (e[o * 4 + 2] = n() * 256),
      (e[o * 4 + 3] = 255));
  let s = new DataTexture(e, 256, 256, RGBAFormat, UnsignedByteType);
  return (
    (s.wrapS = s.wrapT = RepeatWrapping),
    (s.magFilter = s.minFilter = LinearFilter),
    (s.generateMipmaps = !1),
    (s.colorSpace = NoColorSpace),
    (s.needsUpdate = !0),
    s
  );
}

var H6 = `
// SALTLINE_SKY
precision highp float;
varying vec3 vDir;
uniform float uTime, uEnv;
${SKY_NOISE_GLSL}
${SKY_COLOR_GLSL}

void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float mu = dot(d, uSunDir);
  float s = max(mu, 0.0);
  float ts = skyToSun(d);

  // ---- clear day: pale horizon blending into a deep blue zenith ----
  vec3 hc = horizonColor(d);
  float grad = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(hc, uZen, smoothstep(0.0, 0.75, grad));
  // mie aureole around the sun
  col += uSunCol * vec3(1.0, 0.9, 0.74) * (pow(s, 8.0) * 0.05 + pow(s, 64.0) * 0.22 + pow(s, 600.0) * 1.4 + pow(s, 6000.0) * 12.0);

  // ---- sparse high cirrus, drifting slowly ----
  vec2 cuv = d.xz / (h + 0.16) * vec2(0.5, 0.9);
  vec2 q = cuv + vec2(-0.006, 0.002) * uTime;
  float warp = fbm3(q * 0.55 + 7.1);
  float cirrus = smoothstep(0.56, 0.82, fbm5(q * vec2(0.55, 2.2) + warp * 0.8));
  cirrus *= smoothstep(0.015, 0.22, h) * (1.0 - smoothstep(0.55, 0.95, h)) * 0.35;
  vec3 cirrusC = mix(vec3(0.72, 0.78, 0.86), vec3(1.0, 0.99, 0.96), pow(ts, 2.0));
  col = mix(col, cirrusC, cirrus * (1.0 - 0.55 * uEnv));

  // sun disk (not in the environment capture: the directional light is the sun there)
  float disk = smoothstep(0.999905, 0.999955, mu);
  col += uSunCol * vec3(1.0, 0.94, 0.82) * disk * 130.0 * (1.0 - uEnv);

  // below the horizon: sea haze / ground bounce (mostly hidden by geometry)
  if (d.y < 0.0) {
    float t = clamp(-d.y * 5.0, 0.0, 1.0);
    vec3 low = mix(uHorAway * 0.55, vec3(0.11, 0.12, 0.13), uEnv);
    low += uSunCol * 0.18 * pow(ts, 6.0) * exp(d.y * 7.0);
    col = mix(hc + uSunCol * pow(s, 48.0) * 0.8, low, smoothstep(0.0, 1.0, t));
  }
  // keep the PMREM free of fireflies
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

var V6 = `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`;

function W6(i) {
  return {
    tNoise: {
      value: i,
    },
    uTime: {
      value: 0,
    },
    uEnv: {
      value: 0,
    },
    uSunDir: {
      value: SUN_LIGHT.dir.clone(),
    },
    uZen: {
      value: SKY_COLORS.zenith.clone(),
    },
    uHor: {
      value: SKY_COLORS.horizon.clone(),
    },
    uHorAway: {
      value: SKY_COLORS.horizonAway.clone(),
    },
    uSunCol: {
      value: SUN_LIGHT.color.clone(),
    },
  };
}

function Hy(i) {
  let e = new ShaderMaterial({
      name: "saltline-sky",
      side: BackSide,
      depthWrite: !1,
      depthTest: !0,
      fog: !1,
      toneMapped: !1,
      uniforms: W6(i),
      vertexShader: V6,
      fragmentShader: H6,
    }),
    t = new BoxGeometry(2, 2, 2),
    n = new Mesh(t, e);
  return (
    (n.name = "sky"),
    (n.frustumCulled = !1),
    (n.renderOrder = -1e3),
    (n.castShadow = !1),
    (n.receiveShadow = !1),
    (n.matrixAutoUpdate = !1),
    {
      mesh: n,
      material: e,
      geometry: t,
    }
  );
}

function Vy(i, e) {
  let t = new PMREMGenerator(i),
    n = e.material.clone();
  ((n.uniforms.tNoise.value = e.material.uniforms.tNoise.value),
    (n.uniforms.uEnv.value = 1));
  let s = new Scene(),
    o = new Mesh(e.geometry, n);
  ((o.frustumCulled = !1), s.add(o));
  let r = t.fromScene(s, 0, 0.1, 100);
  return (n.dispose(), t.dispose(), r);
}

export { createNoiseTexture, Hy, Vy, SKY_NOISE_GLSL, SKY_COLOR_GLSL };
