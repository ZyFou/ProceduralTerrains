import * as THREE from 'three/webgpu';
import {
  Fn,
  atan,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  positionGeometry,
  pow,
  screenCoordinate,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

function promoteLegacyUniforms(legacyUniforms) {
  const nodes = {};
  for (const [name, entry] of Object.entries(legacyUniforms || {})) {
    nodes[name] = uniform(entry?.value);
  }
  return nodes;
}

function promotePostUniforms(legacyUniforms) {
  const nodes = {};
  const textureUniforms = new Set(['tDiffuse', 'tDepth', 'tCloud', 'tSceneDepth', 'tInput']);
  for (const [name, entry] of Object.entries(legacyUniforms || {})) {
    nodes[name] = textureUniforms.has(name)
      ? texture(entry?.value ?? null)
      : uniform(entry?.value);
  }
  return nodes;
}

function syncPromotedUniforms(nodes, legacyUniforms) {
  for (const [name, entry] of Object.entries(legacyUniforms || {})) {
    if (nodes[name]) nodes[name].value = entry?.value;
  }
}

const luma = (color) => dot(color, vec3(0.2126, 0.7152, 0.0722));

function hash21(point) {
  const p = fract(point.mul(vec2(123.34, 456.21)));
  const mixed = p.add(dot(p, p.add(45.32)));
  return fract(mixed.x.mul(mixed.y));
}

function fullscreenMaterial(name, fragmentNode) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.name = name;
  material.userData.renderRole = name.replace(':webgpu', '');
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.vertexNode = vec4(positionGeometry.xy, 0, 1);
  material.fragmentNode = fragmentNode;
  return material;
}

function createLookPostMaterial(legacyUniforms) {
  const uniforms = promotePostUniforms(legacyUniforms);
  const {
    tDiffuse,
    uTexel,
    uExposure,
    uContrast,
    uSaturation,
    uVignette,
    uBloomStrength,
    uBloomThreshold,
    uSunRaysStrength,
    uSunScreen,
    uSunVisible,
    uSunRaysColor,
  } = uniforms;

  const sample = (coord) => tDiffuse.sample(clamp(coord, vec2(0.001), vec2(0.999))).rgb;
  const brightSample = (coord) => {
    const color = sample(coord);
    return color.mul(smoothstep(uBloomThreshold, 1.25, luma(color)));
  };
  const vUv = uv();
  let color = sample(vUv);
  const px = uTexel.mul(2);
  const bloomOffsets = [
    vec2(px.x, 0), vec2(px.x.negate(), 0),
    vec2(0, px.y), vec2(0, px.y.negate()),
    vec2(px.x, px.y).mul(1.7), vec2(px.x.negate(), px.y).mul(1.7),
    vec2(px.x, px.y.negate()).mul(1.7),
    vec2(px.x.negate(), px.y.negate()).mul(1.7),
  ];
  let bloom = vec3(0);
  for (const offset of bloomOffsets) bloom = bloom.add(brightSample(vUv.add(offset)));
  color = color.add(bloom.mul(uBloomStrength.div(8)));

  const rayDirection = uSunScreen.sub(vUv);
  const rayDistance = length(rayDirection);
  const rayStep = rayDirection.div(24);
  let rayUv = vUv;
  let shaft = float(0);
  let shaftSq = float(0);
  let rayWeight = 0;
  let decay = 1;
  for (let index = 0; index < 24; index++) {
    rayUv = rayUv.add(rayStep);
    const source = smoothstep(0.78, 1.08, luma(sample(rayUv)));
    shaft = shaft.add(source.mul(decay));
    shaftSq = shaftSq.add(source.mul(source).mul(decay));
    rayWeight += decay;
    decay *= 0.93;
  }
  const meanSource = shaft.div(rayWeight);
  const sourceVariance = sqrt(max(shaftSq.div(rayWeight).sub(meanSource.mul(meanSource)), 0));
  const localSource = smoothstep(0.78, 1.08, luma(color));
  shaft = max(meanSource.sub(localSource), 0).mul(1.35).add(sourceVariance.mul(0.95));
  const localDarkness = float(1).sub(smoothstep(0.38, 0.92, luma(color)));
  const reveal = mix(0.32, 1, localDarkness);
  const angle = atan(rayDirection.y, rayDirection.x);
  const phase = hash21(vec2(floor(angle.mul(3)), 7)).mul(6.2831853);
  const broadStreak = sin(angle.mul(23).add(phase)).mul(0.5).add(0.5);
  const fineStreak = sin(angle.mul(61).sub(phase.mul(0.73))).mul(0.5).add(0.5);
  const streak = broadStreak.mul(fineStreak.mul(0.35).add(0.65)).mul(0.58).add(0.42);
  const radialFade = float(1).sub(smoothstep(0, 1.3, rayDistance));
  const atmosphericShaft = mix(0.07, 0.36, localDarkness).mul(streak).mul(radialFade);
  const rays = uSunRaysColor.mul(
    shaft.mul(streak).mul(reveal).mul(radialFade).mul(0.85)
      .add(atmosphericShaft.mul(0.65)),
  ).mul(uSunRaysStrength).mul(0.9);
  color = color.add(select(
    uSunVisible.greaterThan(0.5).and(uSunRaysStrength.greaterThan(0.001)),
    rays,
    vec3(0),
  ));

  color = color.mul(max(uExposure, 0));
  color = color.sub(0.5).mul(uContrast).add(0.5);
  color = mix(vec3(luma(color)), color, uSaturation);
  const vignette = smoothstep(0.95, 0.28, length(vUv.sub(0.5)));
  color = color.mul(mix(float(1).sub(uVignette), 1, vignette));
  const material = fullscreenMaterial('post:look:webgpu', vec4(max(color, vec3(0)), 1));
  material.uniforms = uniforms;
  return material;
}

function bayer4(point) {
  const q = mod(floor(point), 4);
  const choose = (x, a, b, c, d) => select(
    x.lessThan(0.5), a,
    select(x.lessThan(1.5), b, select(x.lessThan(2.5), c, d)),
  );
  const row0 = choose(q.x, 0, 8, 2, 10);
  const row1 = choose(q.x, 12, 4, 14, 6);
  const row2 = choose(q.x, 3, 11, 1, 9);
  const row3 = choose(q.x, 15, 7, 13, 5);
  return select(
    q.y.lessThan(0.5), row0,
    select(q.y.lessThan(1.5), row1, select(q.y.lessThan(2.5), row2, row3)),
  );
}

function createCameraPostMaterial(legacyUniforms) {
  const uniforms = promotePostUniforms(legacyUniforms);
  const {
    tDiffuse,
    uSourceSize,
    uOutputSize,
    uReconstructionMode,
    uDithering,
    uDitherStrength,
    uDitherLevels,
    uDitherScale,
    uCrt,
    uCrtStrength,
    uCrtLensBend,
    uCrtLineWidth,
    uChromatic,
    uChromaticStrength,
    uTime,
  } = uniforms;
  const sample = (coord) => tDiffuse.sample(clamp(coord, vec2(0.001), vec2(0.999))).rgb;
  const sampleClean = (coord) => {
    const point = coord.mul(uSourceSize).sub(0.5);
    const base = floor(point);
    const fraction = fract(point);
    const guide = sample(coord);
    let accumulated = vec3(0);
    let total = float(0);
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        const offset = vec2(x, y);
        const sampleUv = base.add(offset).add(0.5).div(uSourceSize);
        const sampled = sample(sampleUv);
        const delta = offset.sub(fraction);
        const spatial = exp(dot(delta, delta).mul(-0.85));
        const edge = float(1).div(luma(sampled).sub(luma(guide)).abs().mul(28).add(1));
        const weight = spatial.mul(edge).add(0.0001);
        accumulated = accumulated.add(sampled.mul(weight));
        total = total.add(weight);
      }
    }
    return accumulated.div(total);
  };
  const sampleSource = (coord) => {
    const safeUv = clamp(coord, vec2(0.001), vec2(0.999));
    const linear = sample(safeUv);
    const snapped = floor(safeUv.mul(uSourceSize)).add(0.5).div(uSourceSize);
    return select(
      uReconstructionMode.greaterThan(1.5),
      sample(snapped),
      select(uReconstructionMode.greaterThan(0.5), sampleClean(safeUv), linear),
    );
  };

  const vUv = uv();
  const crtStrength = uCrt.mul(uCrtStrength);
  const centered = vUv.mul(2).sub(1);
  const warped = centered.mul(
    dot(centered, centered).mul(crtStrength).mul(uCrtLensBend).mul(0.18).add(1),
  );
  const warpedUv = warped.mul(0.5).add(0.5);
  const inside = step(0, warpedUv.x).mul(step(warpedUv.x, 1))
    .mul(step(0, warpedUv.y)).mul(step(warpedUv.y, 1));
  let color = sampleSource(warpedUv);

  const chromaPixels = uChromatic.mul(uChromaticStrength).add(crtStrength.mul(1.25));
  const chroma = centered.mul(chromaPixels).div(max(uOutputSize, vec2(1)));
  const shifted = vec3(
    sampleSource(warpedUv.add(chroma)).r,
    color.g,
    sampleSource(warpedUv.sub(chroma)).b,
  );
  color = select(chromaPixels.greaterThan(0.001), shifted, color);

  const fragmentCoord = screenCoordinate.xy;
  const ditherCoord = select(
    uReconstructionMode.greaterThan(1.5),
    floor(warpedUv.mul(uSourceSize)),
    fragmentCoord,
  );
  const threshold = bayer4(floor(ditherCoord.div(max(uDitherScale, 1)))).div(16).sub(0.5);
  const levels = clamp(floor(uDitherLevels.add(0.5)), 2, 32).sub(1);
  const quantized = floor(clamp(color, 0, 1).mul(levels).add(threshold).add(0.5)).div(levels);
  color = select(
    uDithering.greaterThan(0.5).and(uDitherStrength.greaterThan(0.001)),
    mix(color, quantized, uDitherStrength),
    color,
  );

  const lineWidth = max(uCrtLineWidth, 1);
  const scanPhase = mod(fragmentCoord.y, lineWidth.mul(2)).div(lineWidth);
  const scan = mix(0.76, 1, cos(scanPhase.mul(3.14159265)).mul(0.5).add(0.5));
  const maskCell = mod(floor(fragmentCoord.x), 3);
  const mask = select(
    maskCell.lessThan(1), vec3(1, 0.86, 0.86),
    select(maskCell.lessThan(2), vec3(0.86, 1, 0.86), vec3(0.86, 0.86, 1)),
  );
  const noise = hash21(fragmentCoord.add(floor(uTime.mul(30)))).sub(0.5).mul(0.035);
  const edge = smoothstep(1.25, 0.38, length(centered));
  const crtColor = color
    .mul(mix(vec3(1), mask.mul(scan), crtStrength))
    .add(noise.mul(crtStrength))
    .mul(mix(1, edge, crtStrength.mul(0.45)));
  color = select(crtStrength.greaterThan(0.001), crtColor, color);

  const material = fullscreenMaterial(
    'post:camera:webgpu',
    vec4(max(color, vec3(0)).mul(inside), 1),
  );
  material.uniforms = uniforms;
  return material;
}

function createVisualPostMaterials(lookUniforms, cameraUniforms) {
  return {
    lookMaterial: createLookPostMaterial(lookUniforms),
    cameraMaterial: createCameraPostMaterial(cameraUniforms),
  };
}

function valueNoise2(point) {
  const cell = floor(point);
  const local = fract(point);
  const fade = local.mul(local).mul(float(3).sub(local.mul(2)));
  const a = hash21(cell);
  const b = hash21(cell.add(vec2(1, 0)));
  const c = hash21(cell.add(vec2(0, 1)));
  const d = hash21(cell.add(vec2(1, 1)));
  return mix(mix(a, b, fade.x), mix(c, d, fade.x), fade.y);
}

function createUnderwaterMaterial(legacyUniforms) {
  const uniforms = promotePostUniforms(legacyUniforms);
  const {
    tDiffuse,
    tDepth,
    uStrength,
    uTime,
    uNear,
    uFar,
    uWaterShallow,
    uWaterDeep,
    uSubmergeDepth,
    uVisibility,
    uIntensity,
    uDistortion,
    uHighMode,
    uParticles,
    uLightShafts,
    uSunScreen,
    uSunVisible,
    uAspect,
    uDepthValid,
  } = uniforms;
  const vUv = uv();
  const strength = uStrength.mul(uIntensity);
  const high = uHighMode.greaterThan(0.5);
  const wobble = strength.mul(0.0035).mul(uDistortion.add(0.4));
  const highOffset = vec2(
    sin(vUv.y.mul(30).add(uTime.mul(1.9)))
      .add(sin(vUv.y.mul(11).sub(uTime.mul(1.1))))
      .mul(wobble).mul(0.6),
    cos(vUv.x.mul(26).sub(uTime.mul(1.4)))
      .add(cos(vUv.x.mul(9).add(uTime.mul(0.8))))
      .mul(wobble).mul(0.55),
  );
  const liteOffset = vec2(
    sin(vUv.y.mul(28).add(uTime.mul(1.7))).mul(wobble),
    cos(vUv.x.mul(23).sub(uTime.mul(1.3))).mul(wobble).mul(0.7),
  );
  const sampleUv = clamp(vUv.add(select(high, highOffset, liteOffset)), vec2(0.001), vec2(0.999));
  const sourceColor = tDiffuse.sample(sampleUv).rgb;

  const depth = tDepth.sample(sampleUv).x;
  const viewZ = uNear.mul(uFar).div(uFar.sub(uNear).mul(depth).sub(uFar));
  const sampledDistance = min(viewZ.negate(), uFar);
  const distance = select(uDepthValid.lessThan(0.5), uFar.mul(0.5), sampledDistance);
  const murk = clamp(uSubmergeDepth.div(45), 0, 1);
  let waterColor = mix(uWaterShallow, uWaterDeep, murk.mul(0.65).add(0.35));
  const waterLuma = dot(waterColor, vec3(0.299, 0.587, 0.114));
  waterColor = mix(vec3(waterLuma), waterColor, select(high, 0.52, 0.66));
  waterColor = vec3(
    waterColor.r,
    waterColor.g.mul(1.03),
    waterColor.b.mul(select(high, 0.78, 0.86)),
  );
  waterColor = clamp(waterColor, vec3(0), vec3(1));

  const densityBase = select(high, murk.mul(1.8).add(1.4), murk.mul(1.4).add(1.6));
  const density = densityBase.div(max(uVisibility, 10));
  const fog = clamp(float(1).sub(exp(density.mul(density).mul(distance).mul(distance).negate())), 0, 1);
  let underwater = sourceColor.mul(float(0.85).sub(murk.mul(0.25)));
  underwater = mix(
    underwater,
    underwater.mul(vec3(0.65).add(waterColor.mul(1.25))),
    select(high, 0.30, 0.26),
  );
  const absorption = vec3(0.32, 0.17, 0.10).mul(murk.mul(0.9).add(0.6));
  const absorbed = underwater.mul(exp(
    absorption.mul(distance).div(max(uVisibility, 10)).negate(),
  ));
  underwater = select(high, absorbed, underwater);
  const softLuma = dot(underwater, vec3(0.299, 0.587, 0.114));
  underwater = mix(underwater, vec3(softLuma), select(high, 0.12, 0.18));
  underwater = mix(
    uWaterShallow.add(uWaterDeep).mul(0.2).add(0.18),
    underwater,
    0.88,
  );

  const sunDelta = vec2(vUv.x.sub(uSunScreen.x).mul(uAspect), vUv.y.sub(uSunScreen.y));
  const sunRadius = length(sunDelta);
  const sunAngle = atan(sunDelta.y, sunDelta.x);
  const streak = valueNoise2(vec2(
    sunAngle.mul(5),
    sunRadius.mul(6).sub(uTime.mul(0.6)),
  ));
  const shaft = smoothstep(1.1, 0, sunRadius)
    .mul(streak.mul(0.6).add(0.4))
    .mul(smoothstep(0, 0.25, vUv.y));
  const shaftColor = vec3(1, 0.97, 0.85).mul(shaft).mul(uLightShafts).mul(0.5);
  underwater = underwater.add(select(
    high.and(uLightShafts.greaterThan(0.001)).and(uSunVisible.greaterThan(0.5)),
    shaftColor,
    vec3(0),
  ));

  const particlePoint = vec2(vUv.x.mul(uAspect), vUv.y).mul(70)
    .add(vec2(
      sin(uTime.mul(0.3).add(vUv.y.mul(10))).mul(0.5),
      uTime.mul(0.4),
    ));
  const particle = smoothstep(0.993, 1, hash21(floor(particlePoint)));
  underwater = underwater.add(select(
    high.and(uParticles.greaterThan(0.001)),
    vec3(0.8, 0.9, 1).mul(particle).mul(uParticles).mul(0.35),
    vec3(0),
  ));

  const upLook = smoothstep(0.55, 1, vUv.y);
  const shimmer = valueNoise2(vec2(vUv.x.mul(10).add(uTime.mul(0.7)), uTime.mul(0.4)));
  const surfaceLight = waterColor.mul(upLook)
    .mul(shimmer.mul(0.05).add(0.05))
    .mul(float(1).sub(murk.mul(0.6)));
  underwater = underwater.add(select(high, surfaceLight, vec3(0)));
  underwater = mix(underwater, waterColor, fog);
  const vignette = smoothstep(1.25, 0.45, length(vUv.sub(0.5)).mul(1.6));
  underwater = underwater.mul(mix(select(high, 0.72, 0.78), 1, vignette));

  const material = fullscreenMaterial(
    'post:underwater:webgpu',
    vec4(mix(sourceColor, underwater, strength), 1),
  );
  material.uniforms = uniforms;
  return material;
}

function createCloudCompositeMaterial(legacyUniforms) {
  const uniforms = promotePostUniforms(legacyUniforms);
  const {
    tCloud,
    tSceneDepth,
    uLowTexel,
    uDepthSharpness,
    uAlphaSharpness,
    uUseDepth,
  } = uniforms;
  const vUv = uv();
  const centerDepth = select(
    uUseDepth.greaterThan(0.5),
    tSceneDepth.sample(vUv).x,
    1,
  );
  const point = vUv.div(uLowTexel).sub(0.5);
  const fraction = fract(point);
  const base = floor(point).add(0.5).mul(uLowTexel);
  const guideUv = floor(vUv.div(uLowTexel)).add(0.5).mul(uLowTexel);
  const guideAlpha = tCloud.sample(clamp(guideUv, vec2(0), vec2(1))).a;
  let accumulated = vec4(0);
  let total = float(0);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const sampleUv = base.add(vec2(x, y).mul(uLowTexel));
      const bilinear = (x === 0 ? float(1).sub(fraction.x) : fraction.x)
        .mul(y === 0 ? float(1).sub(fraction.y) : fraction.y);
      const neighbourDepth = tSceneDepth.sample(sampleUv).x;
      const depthDelta = neighbourDepth.sub(centerDepth).abs().mul(uDepthSharpness);
      const depthWeight = select(
        uUseDepth.greaterThan(0.5),
        float(1).div(depthDelta.mul(depthDelta).add(1)),
        1,
      );
      const cloud = tCloud.sample(sampleUv);
      const alphaDelta = cloud.a.sub(guideAlpha).abs().mul(uAlphaSharpness);
      const alphaWeight = float(1).div(alphaDelta.mul(alphaDelta).add(1));
      const weight = bilinear.mul(depthWeight).mul(alphaWeight).add(0.00001);
      accumulated = accumulated.add(cloud.mul(weight));
      total = total.add(weight);
    }
  }
  const material = fullscreenMaterial(
    'cloud:composite:webgpu',
    accumulated.div(total),
  );
  material.uniforms = uniforms;
  material.transparent = true;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return material;
}

function cloudHash13(point) {
  const p = fract(point.mul(0.1031));
  const mixed = p.add(dot(p, p.zyx.add(31.32)));
  return fract(mixed.x.add(mixed.y).mul(mixed.z));
}

function cloudValueNoise(point) {
  const cell = floor(point);
  const local = fract(point);
  const fade = local.mul(local).mul(local)
    .mul(local.mul(local.mul(6).sub(15)).add(10));
  const n000 = cloudHash13(cell);
  const n100 = cloudHash13(cell.add(vec3(1, 0, 0)));
  const n010 = cloudHash13(cell.add(vec3(0, 1, 0)));
  const n110 = cloudHash13(cell.add(vec3(1, 1, 0)));
  const n001 = cloudHash13(cell.add(vec3(0, 0, 1)));
  const n101 = cloudHash13(cell.add(vec3(1, 0, 1)));
  const n011 = cloudHash13(cell.add(vec3(0, 1, 1)));
  const n111 = cloudHash13(cell.add(vec3(1, 1, 1)));
  return mix(
    mix(mix(n000, n100, fade.x), mix(n010, n110, fade.x), fade.y),
    mix(mix(n001, n101, fade.x), mix(n011, n111, fade.x), fade.y),
    fade.z,
  );
}

function rotateCloudOctave(point) {
  // Exact column-major equivalent of CL_ROT from cloudGLSL.js.
  return vec3(
    point.y.mul(-0.8).sub(point.z.mul(0.6)),
    point.x.mul(0.8).add(point.y.mul(0.36)).sub(point.z.mul(0.48)),
    point.x.mul(0.6).sub(point.y.mul(0.48)).add(point.z.mul(0.64)),
  );
}

function cloudBaseFbm(point) {
  let samplePoint = point;
  let amplitude = 0.5;
  let sum = float(0);
  let normalization = 0;
  for (let octave = 0; octave < 3; octave++) {
    sum = sum.add(cloudValueNoise(samplePoint).mul(amplitude));
    normalization += amplitude;
    amplitude *= 0.5;
    samplePoint = rotateCloudOctave(samplePoint).mul(2.02);
  }
  return sum.div(normalization);
}

function createCloudOccupancyMaterials(legacyUniforms, { planet = false } = {}) {
  const uniforms = promoteLegacyUniforms(legacyUniforms);
  const {
    uCloudCoverage,
    uCloudSoftness,
    uCloudScale,
    uCloudDetailStrength,
    uCloudWind,
    uCloudRotation,
    uCloudTime,
    uCloudEvolve,
    uCloudNoiseOffset,
    uCloudDomainOrigin,
    uOccCenter,
    uOccExtent,
    uCloudBottom,
    uCloudTop,
    uCloudInner,
    uCloudOuter,
  } = uniforms;

  const rotateDomain = (point) => {
    const c = cos(uCloudRotation);
    const s = sin(uCloudRotation);
    return vec3(
      c.mul(point.x).add(s.mul(point.z)),
      point.y,
      s.negate().mul(point.x).add(c.mul(point.z)),
    );
  };
  const occupiedAt = (point) => {
    const drift = uCloudWind.mul(uCloudTime);
    const q = rotateDomain(point.sub(uCloudDomainOrigin))
      .mul(uCloudScale)
      .add(uCloudNoiseOffset)
      .add(drift)
      .add(vec3(0, uCloudTime.mul(uCloudEvolve), 0));
    const threshold = float(1).sub(uCloudCoverage)
      .sub(max(uCloudSoftness, 0.06))
      .sub(uCloudDetailStrength.mul(0.5))
      .sub(0.04);
    return step(threshold, cloudBaseFbm(q));
  };
  const octDecode = (encoded) => {
    const n = vec3(encoded, float(1).sub(encoded.x.abs()).sub(encoded.y.abs()));
    const folded = float(1).sub(n.yx.abs()).mul(sign(n.xy));
    return normalize(vec3(
      select(n.z.lessThan(0), folded.x, n.x),
      select(n.z.lessThan(0), folded.y, n.y),
      n.z,
    ));
  };

  const vUv = uv();
  let occupied = float(0);
  if (planet) {
    const direction = octDecode(vUv.mul(2).sub(1));
    const span = uCloudOuter.sub(uCloudInner);
    for (const height of [0.2, 0.5, 0.8]) {
      occupied = max(occupied, occupiedAt(direction.mul(uCloudInner.add(span.mul(height)))));
    }
  } else {
    const xz = uOccCenter.add(vUv.mul(2).sub(1).mul(uOccExtent));
    const span = uCloudTop.sub(uCloudBottom);
    for (const height of [0.25, 0.5, 0.75]) {
      occupied = max(occupied, occupiedAt(vec3(
        xz.x,
        uCloudBottom.add(span.mul(height)),
        xz.y,
      )));
    }
  }

  const generateMaterial = fullscreenMaterial(
    `cloud:occupancy:${planet ? 'planet' : 'studio'}:webgpu`,
    vec4(occupied, 0, 0, 1),
  );
  generateMaterial.uniforms = uniforms;
  generateMaterial.blending = THREE.NoBlending;

  const dilateLegacyUniforms = {
    tInput: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
  };
  const dilateUniforms = promotePostUniforms(dilateLegacyUniforms);
  let dilated = float(0);
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      dilated = max(
        dilated,
        dilateUniforms.tInput.sample(vUv.add(vec2(x, y).mul(dilateUniforms.uTexel))).r,
      );
    }
  }
  const dilateMaterial = fullscreenMaterial(
    'cloud:occupancy-dilate:webgpu',
    vec4(dilated, 0, 0, 1),
  );
  dilateMaterial.uniforms = dilateUniforms;
  dilateMaterial.blending = THREE.NoBlending;

  return {
    generateMaterial,
    dilateMaterial,
    setUniforms(nextUniforms) {
      syncPromotedUniforms(uniforms, nextUniforms);
    },
  };
}

function createProceduralSkyMaterial(legacyUniforms) {
  const uniforms = promoteLegacyUniforms(legacyUniforms);
  const {
    uSkyZenith,
    uSkyHorizon,
    uSkySunColor,
    uSkyFogColor,
    uSkySunDir,
    uSkyLightIntensity,
    uSkyBrightness,
    uSkyHaze,
    uSkyStars,
    uSkyHdrIntensity,
    uSkySunGlow,
    uSkyHorizonGlow,
    uSkyAtmosphereTint,
  } = uniforms;

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'sky:procedural:webgpu';
  material.userData.renderRole = 'sky:procedural';
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.depthTest = true;
  material.toneMapped = false;

  material.vertexNode = Fn(() => {
    const worldPosition = positionGeometry.add(cameraPosition);
    const clip = cameraProjectionMatrix
      .mul(cameraViewMatrix)
      .mul(vec4(worldPosition, 1))
      .toVar();
    clip.z.assign(clip.w.mul(0.9999));
    return clip;
  })();

  material.fragmentNode = Fn(() => {
    const dir = normalize(positionGeometry);
    const y = dir.y;
    const horizonBlend = float(1).sub(pow(max(y, 0), 0.45));
    let skyColor = mix(uSkyZenith, uSkyHorizon, horizonBlend)
      .mul(uSkyAtmosphereTint);

    const hazeBand = exp(y.abs().mul(-8));
    skyColor = mix(skyColor, uSkyFogColor, hazeBand.mul(uSkyHaze));
    const belowBlend = clamp(y.negate().mul(5), 0, 1);
    skyColor = select(y.lessThan(0), mix(skyColor, uSkyFogColor, belowBlend), skyColor);

    const sunDot = max(dot(dir, normalize(uSkySunDir)), 0);
    const sunDisc = smoothstep(0.9994, 0.9998, sunDot);
    const sunGlow = pow(sunDot, 256).mul(0.8);
    const sunHalo = pow(sunDot, 32).mul(0.25);
    const sunScatter = pow(sunDot, 8).mul(0.08);
    const sunColor = uSkySunColor.mul(uSkyLightIntensity);
    skyColor = skyColor.add(sunColor.mul(
      sunDisc.mul(3)
        .add(sunGlow)
        .add(sunHalo.mul(uSkySunGlow))
        .mul(uSkySunGlow),
    ));

    const scatterMask = exp(y.abs().mul(-3));
    skyColor = skyColor.add(
      uSkySunColor.mul(sunScatter).mul(scatterMask).mul(uSkyLightIntensity),
    );
    const horizonWarmth = pow(sunDot, 4).mul(hazeBand).mul(0.3);
    skyColor = skyColor
      .add(uSkySunColor.mul(horizonWarmth).mul(uSkyLightIntensity)
        .mul(uSkyHorizonGlow.add(1)))
      .add(uSkyHorizon.mul(hazeBand).mul(uSkyHorizonGlow).mul(0.35));

    const nightFactor = smoothstep(0.15, -0.1, uSkySunDir.y).mul(uSkyStars);
    const starGrid = floor(dir.mul(300));
    const starSeed = fract(starGrid.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    starSeed.addAssign(dot(starSeed, starSeed.yxz.add(33.33)));
    const starHash = fract(starSeed.x.add(starSeed.y).mul(starSeed.z));
    const star = step(0.998, starHash).mul(pow(max(y, 0), 0.3));
    const twinkle = sin(starHash.mul(6283).add(starGrid.x.mul(0.5))).mul(0.3).add(0.7);
    const stars = vec3(0.8, 0.85, 1)
      .mul(star)
      .mul(twinkle)
      .mul(nightFactor)
      .mul(0.6);
    skyColor = skyColor.add(select(
      nightFactor.greaterThan(0.01).and(y.greaterThan(0)),
      stars,
      vec3(0),
    ));

    const linear = max(
      skyColor.mul(uSkyBrightness).mul(uSkyHdrIntensity),
      vec3(0),
    );
    return vec4(pow(linear, vec3(1 / 2.2)), 1);
  })();

  // Preserve the legacy `{ value }` contract used by TimeOfDay and water.
  material.uniforms = uniforms;
  return { material, uniforms };
}

export function createWebGpuMaterialBackend() {
  return Object.freeze({
    id: 'webgpu-tsl',
    createProceduralSkyMaterial,
    createVisualPostMaterials,
    createUnderwaterMaterial,
    createCloudCompositeMaterial,
    createCloudOccupancyMaterials,
  });
}
