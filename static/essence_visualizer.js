/* global THREE */

const ESSENCE_STATES = {
  standby: {
    speed: 0.38,
    breathe: 0.68,
    glow: 0.88,
    spread: 0.98,
    core: 0.9,
  },
  working: {
    speed: 0.8,
    breathe: 0.9,
    glow: 1.0,
    spread: 1.0,
    core: 1.0,
  },
  listening: {
    speed: 0.45,
    breathe: 0.7,
    glow: 0.95,
    spread: 1.05,
    core: 0.95,
  },
  speaking: {
    speed: 0.45,
    breathe: 0.72,
    glow: 0.88,
    spread: 1.0,
    core: 0.92,
  },
  reconnecting: {
    speed: 0.1,
    breathe: 0.15,
    glow: 0.3,
    spread: 0.75,
    core: 0.35,
  },
};

const STATE_COLORS = {
  standby: {
    primary: [0.03, 0.08, 0.12],
    secondary: [0.1, 0.88, 0.66],
    accent: [0.38, 0.98, 0.8],
  },
  working: {
    primary: [0.1, 0.08, 0.05],
    secondary: [0.95, 0.68, 0.12],
    accent: [1.0, 0.82, 0.28],
  },
  listening: {
    primary: [0.04, 0.1, 0.14],
    secondary: [0.1, 0.78, 0.88],
    accent: [0.35, 0.95, 0.92],
  },
  speaking: {
    primary: [0.05, 0.12, 0.08],
    secondary: [0.22, 0.88, 0.38],
    accent: [0.55, 1.0, 0.45],
  },
  reconnecting: {
    primary: [0.08, 0.1, 0.09],
    secondary: [0.28, 0.38, 0.32],
    accent: [0.42, 0.5, 0.44],
  },
};

const ESSENCE_SIZE_SCALE = 1.05;

function shaderParamsForState(state) {
  const essence = ESSENCE_STATES[state] || ESSENCE_STATES.standby;
  const colors = STATE_COLORS[state] || STATE_COLORS.standby;

  return {
    color: [...colors.primary],
    secondaryColor: [...colors.secondary],
    accentColor: [...colors.accent],
    energySpeed: 0.18 + essence.speed * 0.72,
    energyStrength: 0.45 + essence.breathe * 0.65,
    glow: essence.glow,
    radiusScale: 0.42 + essence.spread * 0.05 + essence.core * 0.03,
  };
}

const REST_BREATH_CYCLE = 5.6;

function computeRestBreath(time) {
  const phase = (time % REST_BREATH_CYCLE) / REST_BREATH_CYCLE;
  if (phase < 0.36) {
    const t = phase / 0.36;
    return t * t * (3 - 2 * t);
  }
  if (phase < 0.44) {
    return 1;
  }
  const t = (phase - 0.44) / 0.56;
  const eased = t * t * (3 - 2 * t);
  return 1 - eased;
}

function lerpRgb(current, target, blend) {
  const t = Math.max(0, Math.min(1, blend));
  return current.map((value, index) => value + (target[index] - value) * t);
}

function lerpShaderParams(current, target, blend) {
  const t = Math.max(0, Math.min(1, blend));
  const mixFloat = (key) => current[key] + (target[key] - current[key]) * t;

  return {
    color: lerpRgb(current.color, target.color, t),
    secondaryColor: lerpRgb(current.secondaryColor, target.secondaryColor, t),
    accentColor: lerpRgb(current.accentColor, target.accentColor, t),
    energySpeed: mixFloat("energySpeed"),
    energyStrength: mixFloat("energyStrength"),
    glow: mixFloat("glow"),
    radiusScale: mixFloat("radiusScale"),
  };
}

const ORB_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const ORB_FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_audio_level;
uniform vec3 u_color;
uniform vec3 u_secondary_color;
uniform vec3 u_accent_color;
uniform float u_energy_time;
uniform float u_energy_strength;
uniform float u_glow;
uniform float u_radius_scale;
uniform float u_breath;
uniform float u_idle_lift;

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float auroraBands(vec3 normal, float time, float strength, float audio) {
  vec3 n = normal;
  float swirl = time * 0.22;
  mat2 rot = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl));
  vec2 nxz = rot * vec2(n.x, n.z);

  float band1 = sin(dot(vec3(nxz.x, n.y, nxz.y), vec3(1.2, 0.4, 0.6)) * 5.0 + time * 0.9) * 0.5 + 0.5;
  float band2 = sin(dot(n, vec3(-0.5, 1.0, 0.3)) * 6.2 - time * 0.62 + 1.4) * 0.5 + 0.5;
  float band3 = sin(dot(n, vec3(0.3, -0.6, 1.0)) * 4.4 + time * 0.38 + 2.6) * 0.5 + 0.5;

  band1 = smoothstep(0.28, 0.82, band1);
  band2 = smoothstep(0.32, 0.85, band2);
  band3 = smoothstep(0.3, 0.78, band3);

  float organic = noise2d(vec2(atan(n.y, n.x) * 2.5, acos(n.z) * 3.0) + time * 0.15);
  float combined = band1 * 0.4 + band2 * 0.35 + band3 * 0.25;
  combined = mix(combined, organic, 0.18);
  combined *= strength * (0.85 + audio * 0.32);
  return combined;
}

vec3 glassRim(vec3 normal, vec3 viewDir, float audio) {
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);
  vec3 rim = mix(u_secondary_color, u_accent_color, 0.55) * fresnel * u_glow * (0.55 + audio * 0.16);
  vec3 fringe = vec3(
    fresnel * u_accent_color.r * 1.04,
    fresnel * u_accent_color.g * 0.98,
    fresnel * u_accent_color.b * 1.06
  ) * 0.14;
  return rim + fringe;
}

float coreRadiance(float z, float audio) {
  return pow(z, 2.2) * (0.55 + audio * 0.22);
}

float circularVignette(vec2 p) {
  float dist = length(p);
  return 1.0 - smoothstep(0.68, 0.92, dist);
}

float idleCausticShimmer(vec3 normal, float time, float lift) {
  if (lift < 0.01) {
    return 0.0;
  }
  float n1 = noise2d(vec2(atan(normal.y, normal.x) * 3.2, acos(normal.z) * 4.0) + time * 0.28);
  float n2 = noise2d(vec2(normal.x, normal.y) * 5.5 - time * 0.22);
  return smoothstep(0.35, 0.82, n1 * 0.6 + n2 * 0.4) * lift * 0.65;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  p.x *= aspect;

  float breathe = u_breath;
  float breathGlow = 0.94 + breathe * 0.06;
  float audioExpansion = u_audio_level * 0.028;
  float radius = u_radius_scale + audioExpansion + breathe * u_radius_scale * 0.0036;

  vec2 sphereUv = p / radius;
  float radiusSquared = dot(sphereUv, sphereUv);
  float screenDistance = length(sphereUv);

  float atmosphereInner = exp(-radiusSquared * 2.4);
  float atmosphereOuter = exp(-max(screenDistance - 0.5, 0.0) * 3.6);
  float haloBloom = exp(-max(screenDistance - 0.68, 0.0) * 2.6);
  float bloomStrength = atmosphereOuter * 0.62 + haloBloom * 0.55;
  bloomStrength *= u_glow * breathGlow * (0.5 + u_audio_level * 0.28);
  bloomStrength *= 1.0 + u_idle_lift * (0.12 + breathe * 0.08);
  bloomStrength *= circularVignette(p);

  float edgeFeather = smoothstep(1.35, 0.55, screenDistance);
  float spherePresence = atmosphereInner * edgeFeather;

  vec3 viewDirection = vec3(0.0, 0.0, 1.0);
  vec3 normal = vec3(0.0, 0.0, 1.0);
  float z = 0.0;

  if (radiusSquared < 1.0) {
    z = sqrt(max(0.0, 1.0 - radiusSquared));
    normal = normalize(vec3(sphereUv.x, sphereUv.y, z));
  } else {
    normal = normalize(vec3(sphereUv.x, sphereUv.y, 0.02));
  }

  vec3 lightDirection = normalize(vec3(-0.4, 0.5, 0.88));
  float diffuse = dot(normal, lightDirection) * 0.5 + 0.5;
  float depthShading = 0.42 + z * 0.58;

  float aurora = auroraBands(normal, u_energy_time, u_energy_strength, u_audio_level);
  float idleShimmer = idleCausticShimmer(normal, u_time, u_idle_lift);
  aurora = mix(aurora, min(aurora + idleShimmer * 0.28, 1.0), u_idle_lift);
  vec3 auroraColor = mix(u_secondary_color, u_accent_color, aurora * 0.75);

  float core = coreRadiance(z, u_audio_level);
  vec3 deepBase = u_color * (0.65 + diffuse * 0.35);
  vec3 surfaceColor = deepBase * depthShading;
  surfaceColor = mix(surfaceColor, auroraColor, aurora * 0.72);
  surfaceColor += mix(u_secondary_color, u_accent_color, 0.5) * core * 0.65;
  surfaceColor += glassRim(normal, viewDirection, u_audio_level);

  vec3 bloomColor = mix(u_secondary_color, u_accent_color, 0.45);
  vec3 color = surfaceColor * spherePresence;
  color += bloomColor * bloomStrength;

  float alpha = max(spherePresence * 0.95, bloomStrength * 0.88);
  alpha = smoothstep(0.0, 0.08, alpha) * clamp(alpha, 0.0, 1.0);
  float vignette = circularVignette(p);
  alpha *= vignette;
  color *= vignette;

  gl_FragColor = vec4(color, alpha);
}
`;

const BLOOM_FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_audio_level;
uniform vec3 u_secondary_color;
uniform vec3 u_accent_color;
uniform float u_glow;
uniform float u_radius_scale;
uniform float u_breath;
uniform float u_idle_lift;

varying vec2 vUv;

float circularVignette(vec2 p) {
  float dist = length(p);
  return 1.0 - smoothstep(0.68, 0.92, dist);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  p.x *= aspect;

  float breathe = u_breath;
  float breathGlow = 0.94 + breathe * 0.06;
  float radius = u_radius_scale * (1.22 + u_idle_lift * 0.02) + u_audio_level * 0.028 + breathe * u_radius_scale * 0.0042;
  float dist = length(p / radius);

  float inner = exp(-dist * dist * 1.8);
  float outer = exp(-max(dist - 0.52, 0.0) * 1.8);
  float strength = (inner * 0.42 + outer * 0.58) * u_glow * breathGlow * (0.4 + u_audio_level * 0.22);
  strength *= 1.0 + u_idle_lift * 0.1;
  strength *= circularVignette(p);

  vec3 bloomColor = mix(u_secondary_color, u_accent_color, 0.55);
  gl_FragColor = vec4(bloomColor * strength, strength * 0.65);
}
`;

function createBloomUniforms(params) {
  return {
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_time: { value: 0 },
    u_audio_level: { value: 0 },
    u_secondary_color: { value: new THREE.Vector3(...params.secondaryColor) },
    u_accent_color: { value: new THREE.Vector3(...params.accentColor) },
    u_glow: { value: params.glow },
    u_radius_scale: { value: params.radiusScale },
    u_breath: { value: 0 },
    u_idle_lift: { value: 0 },
  };
}

function createOrbUniforms(params) {
  return {
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_time: { value: 0 },
    u_energy_time: { value: 0 },
    u_audio_level: { value: 0 },
    u_color: { value: new THREE.Vector3(...params.color) },
    u_secondary_color: { value: new THREE.Vector3(...params.secondaryColor) },
    u_accent_color: { value: new THREE.Vector3(...params.accentColor) },
    u_energy_strength: { value: params.energyStrength },
    u_glow: { value: params.glow },
    u_radius_scale: { value: params.radiusScale },
    u_breath: { value: 0 },
    u_idle_lift: { value: 0 },
  };
}

function smoothMotionParams(current, target, blend) {
  const t = Math.max(0, Math.min(1, blend));
  const mixFloat = (key) => current[key] + (target[key] - current[key]) * t;
  return {
    energySpeed: mixFloat("energySpeed"),
  };
}

class EssenceVisualizer {
  constructor(canvas, options = {}) {
    if (typeof THREE === "undefined") {
      throw new Error("Three.js is required for the essence orb.");
    }

    this.canvas = canvas;
    this.mini = Boolean(options.mini);
    this.state = "standby";
    this.target = shaderParamsForState("standby");
    this.current = shaderParamsForState("standby");
    this.time = 0;
    this.lastTs = 0;
    this.rafId = null;
    this.audioLevel = 0;
    this.targetAudioLevel = 0;
    this.audioPhase = 0;
    this.energyTime = 0;
    this.motion = {
      energySpeed: this.current.energySpeed,
    };
    this.useExternalAudio = false;
    this.idleLift = 1;
    this.width = 1;
    this.height = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(this.mini ? Math.min(window.devicePixelRatio || 1, 2) : Math.min(window.devicePixelRatio || 1, 3));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;

    this.uniforms = createOrbUniforms(this.current);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: ORB_VERTEX_SHADER,
      fragmentShader: ORB_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.bloomUniforms = createBloomUniforms(this.current);
    const bloomMaterial = new THREE.ShaderMaterial({
      uniforms: this.bloomUniforms,
      vertexShader: ORB_VERTEX_SHADER,
      fragmentShader: BLOOM_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.bloomMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bloomMaterial);
    this.scene.add(this.bloomMesh);
    this.scene.add(this.mesh);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.tick = this.tick.bind(this);
    this.rafId = requestAnimationFrame(this.tick);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.mini
      ? Math.min(window.devicePixelRatio || 1, 2)
      : Math.min(window.devicePixelRatio || 1, 3);
    this.width = Math.max(Math.round(rect.width * dpr), 1);
    this.height = Math.max(Math.round(rect.height * dpr), 1);
    this.renderer.setSize(this.width, this.height, false);
    this.uniforms.u_resolution.value.set(this.width, this.height);
    this.bloomUniforms.u_resolution.value.set(this.width, this.height);
  }

  setState(state) {
    this.state = state;
    this.target = shaderParamsForState(state);
  }

  setAudioLevel(level) {
    const clamped = Math.max(0, Math.min(1, level));
    this.targetAudioLevel = clamped;
    this.useExternalAudio = clamped > 0.01;
  }

  _updateAudioTarget(dt) {
    if (this.useExternalAudio) {
      if (this.targetAudioLevel <= 0.01) {
        this.useExternalAudio = false;
      } else {
        return;
      }
    }

    if (this.state === "listening") {
      this.audioPhase += dt * 3.2;
      const raw =
        0.08 +
        (0.5 + 0.5 * Math.sin(this.audioPhase)) * 0.18 +
        (0.5 + 0.5 * Math.sin(this.audioPhase * 2.1 + 0.8)) * 0.08;
      this.targetAudioLevel = Math.min(1, raw);
      return;
    }

    if (this.state === "standby") {
      this.audioPhase += dt * 1.2;
      const raw =
        0.02 +
        (0.5 + 0.5 * Math.sin(this.audioPhase)) * 0.06 +
        (0.5 + 0.5 * Math.sin(this.audioPhase * 1.65 + 0.9)) * 0.03;
      this.targetAudioLevel = Math.min(0.22, raw);
      return;
    }

    this.targetAudioLevel = 0;
  }

  _applyUniforms(params) {
    this.uniforms.u_color.value.set(params.color[0], params.color[1], params.color[2]);
    this.uniforms.u_secondary_color.value.set(
      params.secondaryColor[0],
      params.secondaryColor[1],
      params.secondaryColor[2],
    );
    this.uniforms.u_accent_color.value.set(
      params.accentColor[0],
      params.accentColor[1],
      params.accentColor[2],
    );

    let energyStrength = params.energyStrength;
    let glow = params.glow;
    let radiusScale = params.radiusScale;
    if (this.mini) {
      radiusScale *= 0.92;
      energyStrength *= 1.25;
      glow *= 1.15;
    } else {
      radiusScale *= ESSENCE_SIZE_SCALE;
    }
    this.uniforms.u_energy_strength.value = energyStrength;
    this.uniforms.u_glow.value = glow;
    this.uniforms.u_radius_scale.value = radiusScale;

    this.bloomUniforms.u_secondary_color.value.set(
      params.secondaryColor[0],
      params.secondaryColor[1],
      params.secondaryColor[2],
    );
    this.bloomUniforms.u_accent_color.value.set(
      params.accentColor[0],
      params.accentColor[1],
      params.accentColor[2],
    );
    this.bloomUniforms.u_glow.value = glow * (this.mini ? 1.2 : 1.0);
    this.bloomUniforms.u_radius_scale.value = radiusScale;
    this.uniforms.u_idle_lift.value = this.idleLift;
    this.bloomUniforms.u_idle_lift.value = this.idleLift;
  }

  tick(timestamp) {
    const rawDt = this.lastTs ? (timestamp - this.lastTs) / 1000 : 1 / 60;
    const dt = Math.min(0.033, Math.max(0.001, rawDt));
    this.lastTs = timestamp;
    this.time += dt;
    this._updateAudioTarget(dt);

    const colorBlend = 1 - Math.exp(-3.5 * dt);
    this.current = lerpShaderParams(this.current, this.target, colorBlend);

    const motionBlend = 1 - Math.exp(-1.8 * dt);
    this.motion = smoothMotionParams(this.motion, this.current, motionBlend);

    const audioBlend = 1 - Math.exp(-4.5 * dt);
    this.audioLevel += (this.targetAudioLevel - this.audioLevel) * audioBlend;

    const targetIdleLift = this.state === "standby" ? 1 : 0;
    const idleBlend = 1 - Math.exp(-2.8 * dt);
    this.idleLift += (targetIdleLift - this.idleLift) * idleBlend;

    this.energyTime += dt * this.motion.energySpeed;

    this.uniforms.u_time.value = this.time;
    this.uniforms.u_energy_time.value = this.energyTime;
    this.uniforms.u_audio_level.value = this.audioLevel;
    const breath = computeRestBreath(this.time);
    this.uniforms.u_breath.value = breath;
    this.bloomUniforms.u_time.value = this.time;
    this.bloomUniforms.u_audio_level.value = this.audioLevel;
    this.bloomUniforms.u_breath.value = breath;
    this._applyUniforms(this.current);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.tick);
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.resizeObserver.disconnect();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.bloomMesh.geometry.dispose();
    this.bloomMesh.material.dispose();
    this.renderer.dispose();
  }
}

function initEssenceOrbs() {
  if (typeof THREE === "undefined") {
    console.error("Three.js failed to load. Essence orb unavailable.");
    return;
  }

  const canvas = document.getElementById("essence-canvas");
  if (!canvas) {
    return;
  }

  try {
    window.mainEssence = new EssenceVisualizer(canvas, { mini: false });
  } catch (error) {
    console.error("Failed to initialize main essence orb:", error);
  }
}

window.initEssenceOrbs = initEssenceOrbs;
