import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  acos,
  attribute,
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
  fwidth,
  int,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
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
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

const MANUAL_TERRAIN_TEXTURE_UNIFORMS = new Set([
  'uManualHeightTexture',
  'uManualSurfaceTextureA',
  'uManualSurfaceTextureB',
  'uDestructionTexture',
  'uTileOccupancy',
  'uSurfDiffuse',
  'uSurfProps',
  'uPaintHeightTexture',
  'uSplineHeightTexture',
  'uErosionOffsetTex',
]);

const LEGACY_WATER_TEXTURE_UNIFORMS = new Set([
  'uManualHeightTexture',
  'uDestructionTexture',
  'uWaterTerrainHeightTex',
  'uTileOccupancy',
]);

const LEGACY_WATER_NODE_UNIFORMS = Object.freeze([
  'uManualEnabled', 'uManualOrigin', 'uManualSpan', 'uManualHeightTexture',
  'uDestructionEnabled', 'uDestructionOrigin', 'uDestructionSpan',
  'uDestructionTexture', 'uWaterTerrainHeightTex', 'uUseWaterTerrainBiomeTex',
  'uBakeOrigin', 'uBakeSpan', 'uHeightScale', 'uSeaLevel',
  'uTileOccupancy', 'uTileGridOrigin', 'uTileGridDim', 'uTileCellSize',
  'uUseTiles', 'uTileShape', 'uTileDiskRadius',
  'uWaterAnim', 'uWaterFadeStart', 'uWaterFadeEnd', 'uWaterQuality',
  'uWaterDetail', 'uWaterReflection', 'uWaveComplexity', 'uFoamWidth',
  'uVisualFoamBreakup', 'uVisualShallowWaterSoftness',
  'uColShallow', 'uColDeep', 'uColFoam', 'uPaletteSaturation',
  'uPaletteTint', 'uSunDir', 'uTerrainSunCol', 'uTerrainSunIntensity',
  'uTerrainSkyAmb', 'uFogColor', 'uFogDensity', 'uTime',
]);

const MANUAL_TERRAIN_NODE_UNIFORMS = Object.freeze([
  'uSeedOffset', 'uFrequency', 'uAmplitude', 'uOctaves', 'uStackNormalize',
  'uStackOutMin', 'uStackOutMax', 'uTerrainSmoothing', 'uPersistence',
  'uLacunarity', 'uRidge', 'uWarp', 'uFalloff', 'uEdgeFalloffMode',
  'uMoistScale', 'uMoistBias', 'uBiomeScale', 'uTempBias',
  'uTerrainFormationSeaLevel', 'uPaintBaseMult', 'uPaintEnabled',
  'uPaintOpacity', 'uPaintBoardSize', 'uPaintHeightTexture',
  'uSplineEnabled', 'uSplineOrigin', 'uSplineSpan', 'uSplineHeightTexture',
  'uErosionEnabled', 'uErosionOffsetTex', 'uBakeOrigin', 'uBakeSpan',
  'uManualEnabled', 'uManualOrigin', 'uManualSpan',
  'uManualHeightTexture', 'uManualSurfaceMode', 'uManualSurfaceOrigin',
  'uManualSurfaceSpan', 'uManualSurfaceTextureA', 'uManualSurfaceTextureB',
  'uDestructionEnabled', 'uDestructionOrigin', 'uDestructionSpan',
  'uDestructionTexture', 'uHeightScale', 'uSeaLevel', 'uEps',
  'uSkirtDepth', 'uPlinthBaseY', 'uWallThickness', 'uBoardHalf',
  'uChunkSize', 'uTileOccupancy', 'uTileGridOrigin', 'uTileGridDim',
  'uTileCellSize', 'uUseTiles', 'uTileShape', 'uTileDiskRadius',
  'uInfiniteMode', 'uNormalStrength', 'uAO',
  'uGrid', 'uLodDebug', 'uMergeDebug', 'uColorMode', 'uTileDebugView',
  'uTerrainDetailDebug', 'uFogColor', 'uFogDensity',
  'uPlinthColor', 'uSunDir', 'uPaletteSaturation', 'uPaletteContrast',
  'uPaletteTint', 'uTerrainSunCol', 'uTerrainSunIntensity',
  'uTerrainSkyAmb', 'uTerrainBounce', 'uColSand', 'uColDryGrass',
  'uColGrass', 'uColForest', 'uColSwamp', 'uColRedRock', 'uColRedRock2',
  'uColRock', 'uColRockHi', 'uColSnow', 'uSnowLine',
  'uAnalysisEnabled', 'uAnalysisMode', 'uAnalysisOpacity', 'uAnalysisMin',
  'uAnalysisMax', 'uAnalysisThresholdA', 'uAnalysisThresholdB',
  'uAnalysisContourSpacing', 'uAnalysisContourStrength',
  'uSurfDiffuse', 'uSurfProps', 'uSurfMode', 'uSurfAmount',
  'uSurfPaletteInfluence', 'uSurfScale', 'uSurfBreakup', 'uSurfBlend',
  'uSurfNormalAmt', 'uSurfRoughAmt', 'uSurfAOAmt', 'uSurfTriplanar',
  'uSurfNear', 'uSurfFar',
]);

let manualTerrainFallbackTexture = null;

function getManualTerrainFallbackTexture() {
  if (!manualTerrainFallbackTexture) {
    manualTerrainFallbackTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    manualTerrainFallbackTexture.needsUpdate = true;
    manualTerrainFallbackTexture.name = 'WebGPUManualTerrainFallback';
  }
  return manualTerrainFallbackTexture;
}

function promoteUniformEntry(entry, textureUniform = false) {
  if (entry?.isNode) return entry;
  if (entry?.node?.isNode) return entry.node;
  let current = entry?.value;
  const node = textureUniform
    ? texture(current || getManualTerrainFallbackTexture())
    : uniform(current);
  if (entry && typeof entry === 'object') {
    Object.defineProperty(entry, 'value', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (next) => {
        current = next;
        node.value = textureUniform
          ? (next || getManualTerrainFallbackTexture())
          : next;
      },
    });
    Object.defineProperty(entry, 'node', {
      configurable: true,
      enumerable: false,
      value: node,
    });
  }
  return node;
}

function promoteLegacyWaterUniforms(legacyUniforms) {
  const nodes = {};
  for (const name of LEGACY_WATER_NODE_UNIFORMS) {
    nodes[name] = promoteUniformEntry(
      legacyUniforms?.[name],
      LEGACY_WATER_TEXTURE_UNIFORMS.has(name),
    );
  }
  return nodes;
}

function promoteManualTerrainUniforms(legacyUniforms) {
  for (const name of MANUAL_TERRAIN_NODE_UNIFORMS) {
    const entry = legacyUniforms?.[name];
    if (!entry || entry.isNode) continue;
    if (MANUAL_TERRAIN_TEXTURE_UNIFORMS.has(name)) {
      let current = entry.value || getManualTerrainFallbackTexture();
      const node = texture(current);
      // Project loading legitimately clears optional texture uniforms. TSL's
      // TextureNode cannot hold null, so retain a transparent 1x1 resource
      // while the feature's enable/mode uniform keeps the sample a no-op.
      Object.defineProperty(node, 'value', {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (next) => {
          current = next || getManualTerrainFallbackTexture();
        },
      });
      legacyUniforms[name] = node;
    } else {
      legacyUniforms[name] = uniform(entry.value);
    }
  }
  return legacyUniforms;
}

function bridgeManualTerrainArrayUniform(legacyUniforms, name, length, fallback) {
  const entry = legacyUniforms?.[name];
  if (!entry) return uniformArray(new Array(length).fill(fallback), 'float');
  if (entry.node?.isArrayBufferNode) return entry.node;

  let current = Array.isArray(entry.value)
    ? entry.value
    : new Array(length).fill(fallback);
  const node = uniformArray(current, 'float');
  Object.defineProperty(entry, 'value', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next) => {
      current = Array.isArray(next) ? next : new Array(length).fill(fallback);
      node.array = current;
    },
  });
  Object.defineProperty(entry, 'node', {
    configurable: true,
    enumerable: false,
    value: node,
  });
  return node;
}

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
      ? texture(entry?.value || getManualTerrainFallbackTexture())
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

function legacySmoothstep(edge0, edge1, value) {
  const t = clamp(value.sub(edge0).div(float(edge1).sub(edge0)), 0, 1);
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function legacyHash12(point) {
  const p3 = fract(vec3(point.x, point.y, point.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}

function legacyValueNoise(point) {
  const cell = floor(point);
  const local = fract(point);
  const fade = local.mul(local).mul(local)
    .mul(local.mul(local.mul(6).sub(15)).add(10));
  const a = legacyHash12(cell);
  const b = legacyHash12(cell.add(vec2(1, 0)));
  const c = legacyHash12(cell.add(vec2(0, 1)));
  const d = legacyHash12(cell.add(vec2(1, 1)));
  return mix(mix(a, b, fade.x), mix(c, d, fade.x), fade.y);
}

function legacyRotate(point) {
  return vec2(
    point.x.mul(0.8).add(point.y.mul(0.6)),
    point.x.mul(-0.6).add(point.y.mul(0.8)),
  );
}

function createLegacyFbm(octaves, uPersistence, uLacunarity, uOctaves = null) {
  return (input) => {
    const point = vec2(input).toVar();
    const amplitude = float(0.5).toVar();
    const sum = float(0).toVar();
    const normalization = float(0).toVar();
    const count = uOctaves
      ? int(clamp(uOctaves, 1, octaves))
      : int(octaves);
    Loop(count, () => {
      sum.addAssign(legacyValueNoise(point).mul(amplitude));
      normalization.addAssign(amplitude);
      amplitude.mulAssign(uPersistence);
      point.assign(legacyRotate(point).mul(uLacunarity));
    });
    return sum.div(max(normalization, 0.0001));
  };
}

function legacyFbm3(input) {
  let point = input;
  let value = legacyValueNoise(point).mul(0.55);
  point = legacyRotate(point).mul(2.13);
  value = value.add(legacyValueNoise(point).mul(0.3));
  point = legacyRotate(point).mul(2.13);
  return value.add(legacyValueNoise(point).mul(0.15));
}

function createLegacyRidgedFbm(octaves, uPersistence, uLacunarity, uOctaves = null) {
  return (input) => {
    const point = vec2(input).toVar();
    const amplitude = float(0.5).toVar();
    const sum = float(0).toVar();
    const normalization = float(0).toVar();
    const carry = float(1).toVar();
    const count = uOctaves
      ? int(clamp(uOctaves, 1, octaves))
      : int(octaves);
    Loop(count, () => {
      const ridge = float(1).sub(abs(legacyValueNoise(point).mul(2).sub(1))).pow(2);
      sum.addAssign(amplitude.mul(ridge).mul(carry));
      carry.assign(clamp(ridge.mul(1.4), 0, 1));
      normalization.addAssign(amplitude);
      amplitude.mulAssign(uPersistence);
      point.assign(legacyRotate(point).mul(uLacunarity));
    });
    return sum.div(max(normalization, 0.0001));
  };
}

function createLegacyGeneratedHeight(
  uniforms,
  octaves,
  tileOccupancyAtCell,
  legacyLayerStrength,
) {
  const {
    uSeedOffset,
    uFrequency,
    uAmplitude,
    uOctaves,
    uStackNormalize,
    uStackOutMin,
    uStackOutMax,
    uTerrainSmoothing,
    uPersistence,
    uLacunarity,
    uRidge,
    uWarp,
    uFalloff,
    uEdgeFalloffMode,
    uMoistScale,
    uMoistBias,
    uBiomeScale,
    uTempBias,
    uTerrainFormationSeaLevel,
    uHeightScale,
    uBoardHalf,
    uTileGridOrigin,
    uTileCellSize,
    uUseTiles,
    uTileShape,
    uTileDiskRadius,
    uInfiniteMode,
  } = uniforms;
  const fbm = createLegacyFbm(octaves, uPersistence, uLacunarity, uOctaves);
  const fbm4 = createLegacyFbm(4, uPersistence, uLacunarity);
  const ridgedFbm = createLegacyRidgedFbm(
    octaves,
    uPersistence,
    uLacunarity,
    uOctaves,
  );

  const tileFalloff = (point) => {
    const cellSize = max(uTileCellSize, 1);
    const relative = point.sub(uTileGridOrigin).div(cellSize);
    const cell = floor(relative);
    const local = fract(relative).mul(2).sub(1);
    const band = max(uFalloff, 0.0001);
    const xPositive = mix(
      legacySmoothstep(0, band, float(1).sub(local.x)),
      1,
      tileOccupancyAtCell(cell.add(vec2(1, 0))),
    );
    const xNegative = mix(
      legacySmoothstep(0, band, float(1).add(local.x)),
      1,
      tileOccupancyAtCell(cell.add(vec2(-1, 0))),
    );
    const zPositive = mix(
      legacySmoothstep(0, band, float(1).sub(local.y)),
      1,
      tileOccupancyAtCell(cell.add(vec2(0, 1))),
    );
    const zNegative = mix(
      legacySmoothstep(0, band, float(1).add(local.y)),
      1,
      tileOccupancyAtCell(cell.add(vec2(0, -1))),
    );
    return xPositive.mul(xNegative).mul(zPositive).mul(zNegative);
  };
  const assemblyFalloff = (point) => {
    const square = tileFalloff(point);
    const band = max(uFalloff.mul(max(uTileCellSize, 1)), 0.0001);
    const circleT = clamp(uTileDiskRadius.sub(length(point)).div(band), 0, 1);
    const circle = legacySmoothstep(0, 1, circleT);
    return mix(square, circle, step(0.5, uTileShape));
  };

  return (point) => {
    const p = point.mul(uFrequency).add(uSeedOffset);
    const biomePoint = p.mul(uBiomeScale);
    const continentalness = legacyFbm3(
      biomePoint.mul(0.085).add(vec2(211.3, 57.9)),
    );
    const temperature = clamp(
      legacyFbm3(biomePoint.mul(0.15).add(vec2(71.7, 313.1)))
        .mul(1.5).sub(0.25).add(uTempBias),
      0,
      1,
    );
    const moisture = clamp(
      legacyFbm3(biomePoint.mul(uMoistScale).mul(0.13).add(vec2(91.7, 53.9)))
        .mul(1.5).sub(0.25).add(uMoistBias),
      0,
      1,
    );
    const erosion = legacyFbm3(
      biomePoint.mul(0.19).add(vec2(157.1, 423.7)),
    );
    const region = legacyFbm3(p.mul(0.7).add(vec2(631.4, 199.2)));
    const jitter = region.sub(0.5).mul(0.16);
    const hot = legacySmoothstep(0.52, 0.74, temperature.add(jitter));
    const dry = legacySmoothstep(0.55, 0.3, moisture.sub(jitter));
    const wet = legacySmoothstep(0.55, 0.78, moisture.add(jitter));
    const lowContinental = legacySmoothstep(0.55, 0.32, continentalness);
    const eroded = legacySmoothstep(0.4, 0.7, erosion.add(jitter.mul(0.5)));
    const desert = hot.mul(dry).mul(float(1).sub(eroded.mul(0.55)));
    const canyon = dry.mul(eroded)
      .mul(legacySmoothstep(0.3, 0.55, continentalness));
    const wetland = wet.mul(lowContinental).mul(float(1).sub(hot.mul(0.4)));
    const mountainsBiome = legacySmoothstep(0.38, 0.62, continentalness)
      .mul(float(1).sub(eroded.mul(0.7)));

    const warp = vec2(
      fbm4(p.add(vec2(13.7, 41.3))),
      fbm4(p.add(vec2(87.2, 9.1))),
    );
    const q = p.add(warp.sub(0.5).mul(uWarp)
      .mul(float(1).sub(canyon.mul(0.5))));
    const base = fbm(q);
    const baseAmplitude = float(0.3)
      .mul(float(1).sub(desert.mul(0.45)))
      .mul(float(1).sub(wetland.mul(0.75)));
    let height = base.mul(baseAmplitude).add(0.06);
    const dune = float(1).sub(abs(legacyValueNoise(vec2(
      q.x.mul(2.2).add(q.y.mul(0.4)),
      q.y.mul(0.8),
    ).add(vec2(311.7, 89.1))).mul(2).sub(1)));
    height = height.add(dune.mul(dune).mul(0.05).mul(desert));
    const ridge = ridgedFbm(q.mul(1.7).add(vec2(31.4, 27.2)));
    const smoothAmount = clamp(uTerrainSmoothing, 0, 1);
    const ridgeShape = mix(
      pow(ridge, 1.35),
      pow(ridge, 0.62).mul(0.58),
      smoothAmount,
    );
    const chain = legacySmoothstep(
      0.34,
      0.66,
      fbm4(q.mul(0.35).add(vec2(5.1, 17.7))),
    );
    const mountains = chain
      .mul(mix(0.35, 1, mountainsBiome))
      .mul(float(1).sub(desert.mul(0.85)))
      .mul(float(1).sub(wetland));
    height = height.add(ridgeShape.mul(mountains).mul(uRidge)
      .mul(mix(1.15, 0.82, smoothAmount)));
    const sea01 = uTerrainFormationSeaLevel.div(max(uHeightScale, 1));
    height = mix(height, sea01.add(0.012).add(base.mul(0.03)), wetland.mul(0.85));
    const terraceSteps = float(14);
    const terraceValue = floor(height.mul(terraceSteps))
      .add(legacySmoothstep(0.2, 0.8, fract(height.mul(terraceSteps))))
      .div(terraceSteps);
    height = mix(height, terraceValue, canyon.mul(0.75));

    const height01 = clamp(height.div(1.35), 0, 1);
    const peak = max(height01.sub(0.42), 0);
    const compressed = float(0.42).add(peak.div(
      float(1).add(smoothAmount.mul(3.2).mul(peak).div(0.58)),
    )).mul(1.35);
    height = mix(
      height,
      compressed,
      legacySmoothstep(0.42, 0.72, height01).mul(smoothAmount),
    );
    // The default generated stack is one `replace` legacy layer, followed by
    // the stack-wide amplitude multiplier. Keep this ordering identical to
    // stackHeight2D() so smoothing and mountain-edge additions see world data
    // at the same stage as the GLSL implementation.
    height = height.mul(legacyLayerStrength).mul(uAmplitude);

    const squareEdge = mix(
      max(point.x.abs(), point.y.abs()).div(max(uBoardHalf, 1)),
      length(point.div(max(uBoardHalf, 1))).mul(0.7071),
      0.5,
    );
    const squareT = clamp(
      float(1).sub(squareEdge).div(max(uFalloff, 0.0001)),
      0,
      1,
    );
    const squareRim = legacySmoothstep(0, 1, squareT);
    const studioRim = mix(squareRim, assemblyFalloff(point), step(0.5, uUseTiles));
    const rim = mix(studioRim, 1, step(0.5, uInfiniteMode));
    const falloffEnabled = step(0.0001, uFalloff);
    const attenuated = height.mul(mix(1, rim, falloffEnabled));
    const edgePoint = p.add(vec2(173.7, 419.2));
    const edgeMountains = pow(ridgedFbm(edgePoint.mul(2.35)), 1.25);
    const edgeBreakup = legacyValueNoise(edgePoint.mul(5.1).add(vec2(61.4, 27.8)));
    const mountainEdge = height.add(
      edgeMountains.mul(0.55).add(edgeBreakup.mul(0.12))
        .mul(float(1).sub(rim)).mul(uAmplitude).mul(clamp(uFalloff, 0, 1)),
    );
    height = mix(attenuated, mountainEdge, step(0.5, uEdgeFalloffMode));
    const stackSoftClamp = (value) => select(
      value.lessThanEqual(0),
      0,
      select(
        value.lessThanEqual(1),
        value,
        min(1.35, float(1).add(float(0.35).mul(
          float(1).sub(exp(value.sub(1).div(0.35).negate())),
        ))),
      ),
    );
    const normalized = stackSoftClamp(
      height.sub(uStackOutMin).div(max(uStackOutMax.sub(uStackOutMin), 0.0001)),
    );
    height = mix(clamp(height, 0, 1.35), normalized, step(0.5, uStackNormalize));
    return height.mul(uHeightScale);
  };
}

function boundedTextureSample(textureNode, point, origin, span) {
  const sampleUv = point.sub(origin).div(max(span, vec2(1)));
  const inside = step(0, sampleUv.x).mul(step(sampleUv.x, 1))
    .mul(step(0, sampleUv.y)).mul(step(sampleUv.y, 1));
  return textureNode.sample(clamp(sampleUv, vec2(0), vec2(1))).mul(inside);
}

function createManualTerrainMaterial(
  legacyUniforms,
  { variant = 'manual', legacyGenerated = false, octaves = 7 } = {},
) {
  const surfaceTiles = bridgeManualTerrainArrayUniform(
    legacyUniforms,
    'uSurfTile',
    13,
    12,
  );
  const surfaceRolesReady = bridgeManualTerrainArrayUniform(
    legacyUniforms,
    'uSurfRolePresent',
    13,
    0,
  );
  const layerStrengths = bridgeManualTerrainArrayUniform(
    legacyUniforms,
    'uLayerStrength',
    12,
    0,
  );
  const uniforms = promoteManualTerrainUniforms(legacyUniforms);
  const {
    uPaintBaseMult,
    uPaintEnabled,
    uPaintOpacity,
    uPaintBoardSize,
    uPaintHeightTexture,
    uSplineEnabled,
    uSplineOrigin,
    uSplineSpan,
    uSplineHeightTexture,
    uErosionEnabled,
    uErosionOffsetTex,
    uBakeOrigin,
    uBakeSpan,
    uManualEnabled,
    uManualOrigin,
    uManualSpan,
    uManualHeightTexture,
    uManualSurfaceMode,
    uManualSurfaceOrigin,
    uManualSurfaceSpan,
    uManualSurfaceTextureA,
    uManualSurfaceTextureB,
    uDestructionEnabled,
    uDestructionOrigin,
    uDestructionSpan,
    uDestructionTexture,
    uHeightScale,
    uSeaLevel,
    uEps,
    uSkirtDepth,
    uPlinthBaseY,
    uWallThickness,
    uBoardHalf,
    uChunkSize,
    uTileOccupancy,
    uTileGridOrigin,
    uTileGridDim,
    uTileCellSize,
    uUseTiles,
    uTileShape,
    uTileDiskRadius,
    uInfiniteMode,
    uNormalStrength,
    uAO,
    uGrid,
    uLodDebug,
    uMergeDebug,
    uColorMode,
    uTileDebugView,
    uTerrainDetailDebug,
    uFogColor,
    uFogDensity,
    uPlinthColor,
    uSunDir,
    uPaletteSaturation,
    uPaletteContrast,
    uPaletteTint,
    uTerrainSunCol,
    uTerrainSunIntensity,
    uTerrainSkyAmb,
    uTerrainBounce,
    uColSand,
    uColDryGrass,
    uColGrass,
    uColForest,
    uColSwamp,
    uColRedRock,
    uColRedRock2,
    uColRock,
    uColRockHi,
    uColSnow,
    uSnowLine,
    uAnalysisEnabled,
    uAnalysisMode,
    uAnalysisOpacity,
    uAnalysisMin,
    uAnalysisMax,
    uAnalysisThresholdA,
    uAnalysisThresholdB,
    uAnalysisContourSpacing,
    uAnalysisContourStrength,
    uSurfDiffuse,
    uSurfProps,
    uSurfMode,
    uSurfAmount,
    uSurfPaletteInfluence,
    uSurfScale,
    uSurfBreakup,
    uSurfNormalAmt,
    uSurfRoughAmt,
    uSurfAOAmt,
    uSurfTriplanar,
    uSurfNear,
    uSurfFar,
  } = uniforms;

  const manualSample = (point) => boundedTextureSample(
    uManualHeightTexture,
    point,
    uManualOrigin,
    uManualSpan,
  ).r.mul(step(0.5, uManualEnabled));
  const destructionSample = (point) => boundedTextureSample(
    uDestructionTexture,
    point,
    uDestructionOrigin,
    uDestructionSpan,
  ).rg.mul(step(0.5, uDestructionEnabled));
  const tileOccupancyAtCell = (cell) => {
    const inside = step(0, cell.x).mul(step(0, cell.y))
      .mul(step(cell.x, uTileGridDim.x.sub(0.5)))
      .mul(step(cell.y, uTileGridDim.y.sub(0.5)));
    const sampleUv = cell.add(0.5).div(max(uTileGridDim, vec2(1)));
    return step(0.5, uTileOccupancy.sample(sampleUv).r).mul(inside);
  };
  const tileWallAt = (point) => {
    const cellSize = max(uTileCellSize, 1);
    const relative = point.sub(uTileGridOrigin).div(cellSize);
    const edgeEpsilon = float(2).div(cellSize);
    const floorX = floor(relative.x);
    const floorZ = floor(relative.y);
    const nearestX = floor(relative.x.add(0.5));
    const onXBoundary = step(abs(relative.x.sub(nearestX)), edgeEpsilon);
    const occupiedLeft = tileOccupancyAtCell(vec2(nearestX.sub(1), floorZ));
    const occupiedRight = tileOccupancyAtCell(vec2(nearestX, floorZ));
    const wallX = onXBoundary.mul(abs(occupiedLeft.sub(occupiedRight)));
    const nearestZ = floor(relative.y.add(0.5));
    const onZBoundary = step(abs(relative.y.sub(nearestZ)), edgeEpsilon);
    const occupiedDown = tileOccupancyAtCell(vec2(floorX, nearestZ.sub(1)));
    const occupiedUp = tileOccupancyAtCell(vec2(floorX, nearestZ));
    const wallZ = onZBoundary.mul(abs(occupiedDown.sub(occupiedUp)));
    return vec3(
      wallX.add(wallZ),
      occupiedLeft.sub(occupiedRight).mul(wallX),
      occupiedDown.sub(occupiedUp).mul(wallZ),
    );
  };
  const tileOccupiedAt = (point) => {
    const relative = point.sub(uTileGridOrigin).div(max(uTileCellSize, 1));
    let occupied = tileOccupancyAtCell(floor(relative));
    const disk = step(length(point), uTileDiskRadius);
    occupied = occupied.mul(mix(1, disk, step(0.5, uTileShape)));
    return mix(1, occupied, step(0.5, uUseTiles));
  };
  const generatedHeightAt = legacyGenerated
    ? createLegacyGeneratedHeight(
      uniforms,
      Math.max(1, Math.round(octaves)),
      tileOccupancyAtCell,
      layerStrengths.element(0),
    )
    : () => float(0);
  const paintSample = legacyGenerated ? (point) => {
    const sampleUv = point.div(max(uPaintBoardSize, 1)).add(0.5);
    const inside = step(0, sampleUv.x).mul(step(sampleUv.x, 1))
      .mul(step(0, sampleUv.y)).mul(step(sampleUv.y, 1));
    return uPaintHeightTexture.sample(clamp(sampleUv, vec2(0), vec2(1))).r
      .mul(inside).mul(uPaintOpacity).mul(step(0.5, uPaintEnabled));
  } : () => float(0);
  const splineSample = legacyGenerated ? (point) => boundedTextureSample(
    uSplineHeightTexture,
    point,
    uSplineOrigin,
    uSplineSpan,
  ).r.mul(step(0.5, uSplineEnabled)) : () => float(0);
  const erosionSample = legacyGenerated ? (point) => boundedTextureSample(
    uErosionOffsetTex,
    point,
    uBakeOrigin,
    uBakeSpan,
  ).r.mul(step(0.5, uErosionEnabled)) : () => float(0);
  const heightAt = (point) => generatedHeightAt(point).mul(uPaintBaseMult)
    .add(paintSample(point))
    .add(manualSample(point))
    .add(splineSample(point))
    .add(erosionSample(point))
    .add(destructionSample(point).r);

  const surfaceArrayValue = (arrayNode, role) => {
    let value = arrayNode.element(12);
    for (let index = 11; index >= 0; index -= 1) {
      value = select(role.lessThan(index + 0.5), arrayNode.element(index), value);
    }
    return value;
  };
  const surfacePalette = (role) => select(
    role.lessThan(1.5), uColSand,
    select(
      role.lessThan(4.5), uColGrass,
      select(
        role.lessThan(7.5), uColSwamp,
        select(
          role.lessThan(8.5), uColRedRock,
          select(
            role.lessThan(9.5), uColRedRock2,
            select(role.lessThan(11.5), uColRock, uColSnow),
          ),
        ),
      ),
    ),
  );
  const randomizedSurfaceUv = (input, role, salt) => {
    const cell = floor(input);
    const local = fract(input);
    const key = cell.add(vec2(
      role.mul(19.17).add(salt),
      role.mul(5.83).sub(salt),
    ));
    const breakup = clamp(uSurfBreakup, 0, 1);
    const scale = mix(
      1,
      mix(0.72, 1.36, hash21(key.add(vec2(29.1, 11.7)))),
      breakup,
    );
    const offset = vec2(
      hash21(key.add(vec2(73.4, 2.6))),
      hash21(key.add(vec2(9.4, 91.2))),
    ).sub(0.5).mul(breakup);
    return cell.add(local.sub(0.5).mul(scale).add(0.5).add(offset));
  };
  const surfaceAtlasUv = (input, role) => vec2(
    fract(input.x),
    role.mul(4).add(0.006).add(fract(input.y).mul(0.988)).div(52),
  );
  const sampleSurfaceRole = (role, worldPosition, triBlend, geometricNormal) => {
    const tile = surfaceArrayValue(surfaceTiles, role);
    const inverseTile = max(uSurfScale, 0.01).div(max(tile, 0.01));
    const uvX = randomizedSurfaceUv(worldPosition.zy.mul(inverseTile), role, 1);
    const uvY = randomizedSurfaceUv(worldPosition.xz.mul(inverseTile), role, 2);
    const uvZ = randomizedSurfaceUv(worldPosition.xy.mul(inverseTile), role, 3);
    const diffuseX = uSurfDiffuse.sample(surfaceAtlasUv(uvX, role)).rgb;
    const diffuseY = uSurfDiffuse.sample(surfaceAtlasUv(uvY, role)).rgb;
    const diffuseZ = uSurfDiffuse.sample(surfaceAtlasUv(uvZ, role)).rgb;
    const propsX = uSurfProps.sample(surfaceAtlasUv(uvX, role));
    const propsY = uSurfProps.sample(surfaceAtlasUv(uvY, role));
    const propsZ = uSurfProps.sample(surfaceAtlasUv(uvZ, role));
    let albedo = diffuseX.mul(triBlend.x)
      .add(diffuseY.mul(triBlend.y))
      .add(diffuseZ.mul(triBlend.z));
    const normalXy = propsX.rg.mul(2).sub(1);
    const normalYy = propsY.rg.mul(2).sub(1);
    const normalZy = propsZ.rg.mul(2).sub(1);
    const normalX = normalize(geometricNormal.add(vec3(0, normalXy.y.negate(), normalXy.x)));
    const normalY = normalize(geometricNormal.add(vec3(normalYy.x, 0, normalYy.y.negate())));
    const normalZ = normalize(geometricNormal.add(vec3(normalZy.x, normalZy.y.negate(), 0)));
    const sampledNormal = normalize(
      normalX.mul(triBlend.x).add(normalY.mul(triBlend.y)).add(normalZ.mul(triBlend.z)),
    );
    const roughness = propsX.b.mul(triBlend.x)
      .add(propsY.b.mul(triBlend.y)).add(propsZ.b.mul(triBlend.z));
    const ao = propsX.a.mul(triBlend.x)
      .add(propsY.a.mul(triBlend.y)).add(propsZ.a.mul(triBlend.z));
    const ready = step(0.5, surfaceArrayValue(surfaceRolesReady, role));
    const tintAmount = clamp(uSurfPaletteInfluence, 0, 1).mul(ready);
    const luminance = dot(albedo, vec3(0.299, 0.587, 0.114));
    const tinted = max(surfacePalette(role).mul(mix(0.48, 1.55, luminance)), vec3(0));
    albedo = mix(albedo, tinted, tintAmount);
    return { albedo, normal: sampledNormal, roughness, ao };
  };

  const vWorldPosition = varying(vec3());
  const vWall = varying(float());
  const vSkirt = varying(float());
  const vLod = varying(float());
  const vWallMesh = varying(float());
  const vTerrainHeight = varying(float());
  const vTerrainNormal = varying(vec3());

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = `terrain:${variant}:webgpu`;
  material.userData.renderRole = `terrain:${variant}`;
  material.userData.terrainVariant = variant;
  material.userData.preservesLinearDataOutputs = true;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  material.uniforms = uniforms;

  const buildVertexNode = () => Fn(() => {
    const worldPosition = modelWorldMatrix.mul(vec4(positionGeometry, 1)).toVar();
    const height = heightAt(worldPosition.xz);
    if (legacyGenerated) {
      // The generated WebGPU path evaluates height in the vertex stage. Derive
      // its normal from the same continuous field here so it is interpolated
      // across the mesh instead of exposing one flat normal per triangle.
      const normalEps = max(uEps, 0.001);
      const heightX = heightAt(worldPosition.xz.add(vec2(normalEps, 0)));
      const heightZ = heightAt(worldPosition.xz.add(vec2(0, normalEps)));
      vTerrainNormal.assign(normalize(vec3(
        heightX.sub(height).div(normalEps).negate(),
        1,
        heightZ.sub(height).div(normalEps).negate(),
      )));
    } else {
      vTerrainNormal.assign(vec3(0, 1, 0));
    }
    const aSkirt = attribute('aSkirt', 'float');
    const aWall = attribute('aWall', 'float');
    const outer = step(uBoardHalf.sub(1), worldPosition.x.abs())
      .add(step(uBoardHalf.sub(1), worldPosition.z.abs()));
    const finite = float(1).sub(step(0.5, uInfiniteMode));
    const tiled = step(0.5, uUseTiles);
    const circular = step(0.5, uTileShape);
    const singleWall = aSkirt.mul(step(0.5, outer))
      .mul(float(1).sub(tiled)).mul(finite);
    const tileWall = tileWallAt(worldPosition.xz);
    const tileOuter = step(0.5, tileWall.x);
    const squareWall = aSkirt.mul(tileOuter).mul(tiled)
      .mul(float(1).sub(circular)).mul(finite);
    const radialWall = aSkirt.mul(step(0.5, aWall))
      .mul(tiled).mul(circular).mul(finite);
    const wall = max(max(singleWall, squareWall), radialWall);
    const skirt = aSkirt.mul(float(1).sub(wall));

    const singleOutDirection = vec2(sign(worldPosition.x), sign(worldPosition.z))
      .mul(vec2(
        step(uBoardHalf.sub(1), worldPosition.x.abs()),
        step(uBoardHalf.sub(1), worldPosition.z.abs()),
      ));
    const outDirection = singleOutDirection.mul(singleWall)
      .add(tileWall.yz.mul(squareWall));
    worldPosition.x.addAssign(outDirection.x.mul(uWallThickness));
    worldPosition.z.addAssign(outDirection.y.mul(uWallThickness));
    worldPosition.y.assign(mix(
      height.sub(skirt.mul(uSkirtDepth)),
      uPlinthBaseY,
      wall,
    ));

    vWorldPosition.assign(worldPosition.xyz);
    vWall.assign(wall);
    vSkirt.assign(max(skirt, wall));
    vLod.assign(attribute('aLod', 'float'));
    vWallMesh.assign(aWall);
    vTerrainHeight.assign(height);
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(worldPosition);
  })();
  material.vertexNode = buildVertexNode();

  const buildFragmentNode = (surfaceEnabled) => Fn(() => {
    const point = vWorldPosition.xz;
    uInfiniteMode.lessThan(0.5)
      .and(uTileShape.greaterThan(0.5))
      .and(vWallMesh.lessThan(0.5))
      .and(tileOccupiedAt(point).lessThan(0.5))
      .discard();
    const eps = max(uEps, 0.001);
    const height = legacyGenerated ? vTerrainHeight : heightAt(point);
    const heightX = legacyGenerated ? height : heightAt(point.add(vec2(eps, 0)));
    const heightZ = legacyGenerated ? height : heightAt(point.add(vec2(0, eps)));
    let geometricNormal;
    if (legacyGenerated) {
      geometricNormal = normalize(vTerrainNormal);
    } else {
      geometricNormal = normalize(vec3(
        heightX.sub(height).div(eps).negate(),
        1,
        heightZ.sub(height).div(eps).negate(),
      ));
    }
    let normal = normalize(vec3(
      geometricNormal.x.mul(uNormalStrength),
      1,
      geometricNormal.z.mul(uNormalStrength),
    ));
    const slope = float(1).sub(geometricNormal.y);
    const height01 = clamp(height.div(max(uHeightScale, 0.001)), 0, 1);
    const relativeHeight = vWorldPosition.y.sub(uSeaLevel);

    let albedo = mix(uColGrass, uColDryGrass, smoothstep(0.18, 0.45, height01));
    albedo = mix(albedo, uColRock, smoothstep(0.4, 0.75, height01));
    albedo = mix(albedo, uColRock, clamp(slope.mul(1.8), 0, 1).mul(0.6));
    albedo = mix(albedo, uColRockHi, smoothstep(0.6, 0.85, height01)
      .mul(float(1).sub(slope)));
    albedo = mix(albedo, uColSnow, smoothstep(
      uSnowLine.sub(0.08),
      uSnowLine.add(0.06),
      height01.sub(slope.mul(0.25)),
    ));
    albedo = mix(uColSand, albedo, smoothstep(0, 6, relativeHeight));

    let surfaceAo = float(1);
    let surfaceRoughness = float(0.8);
    let surfaceAmount = float(0);
    let manualSurfaceDebug = vec3(0);

    if (surfaceEnabled) {
      const weightsA = boundedTextureSample(
        uManualSurfaceTextureA,
        point,
        uManualSurfaceOrigin,
        uManualSurfaceSpan,
      ).mul(step(0.5, uManualSurfaceMode));
      const weightsB = boundedTextureSample(
        uManualSurfaceTextureB,
        point,
        uManualSurfaceOrigin,
        uManualSurfaceSpan,
      ).mul(step(0.5, uManualSurfaceMode));
      const coverage = clamp(
        weightsA.x.add(weightsA.y).add(weightsA.z).add(weightsA.w)
          .add(weightsB.x).add(weightsB.y).add(weightsB.z),
        0,
        1,
      );
      const painted = uColGrass.mul(weightsA.x)
        .add(uColRock.mul(weightsA.y))
        .add(uColSand.mul(weightsA.z))
        .add(uColSnow.mul(weightsA.w))
        .add(uColSwamp.mul(weightsB.x))
        .add(uColRedRock.mul(weightsB.y))
        .add(uColRedRock2.mul(weightsB.z))
        .div(max(coverage, 0.0001));
      albedo = mix(albedo, painted, coverage);

      const weightedRoles = [
        [3, weightsA.x],
        [10, weightsA.y],
        [0, weightsA.z],
        [12, weightsA.w],
        [6, weightsB.x],
        [8, weightsB.y],
        [9, weightsB.z],
      ];
      let bestRole = float(0);
      let secondRole = float(0);
      let bestWeight = float(0);
      let secondWeight = float(0);
      for (const [roleIndex, weight] of weightedRoles) {
        const becomesBest = weight.greaterThan(bestWeight);
        const becomesSecond = weight.greaterThan(secondWeight);
        secondRole = select(
          becomesBest,
          bestRole,
          select(becomesSecond, float(roleIndex), secondRole),
        );
        secondWeight = select(
          becomesBest,
          bestWeight,
          select(becomesSecond, weight, secondWeight),
        );
        bestRole = select(becomesBest, float(roleIndex), bestRole);
        bestWeight = select(becomesBest, weight, bestWeight);
      }

      const triRaw = pow(abs(geometricNormal), vec3(4));
      const triNormalized = triRaw.div(max(triRaw.x.add(triRaw.y).add(triRaw.z), 0.0001));
      const triBlend = select(uSurfTriplanar.greaterThan(0.5), triNormalized, vec3(0, 1, 0));
      const bestSurface = sampleSurfaceRole(bestRole, vWorldPosition, triBlend, geometricNormal);
      const secondSurface = sampleSurfaceRole(
        secondRole,
        vWorldPosition,
        triBlend,
        geometricNormal,
      );
      const secondMix = clamp(
        secondWeight.div(max(bestWeight.add(secondWeight), 0.0001)),
        0,
        0.85,
      );
      const texturedAlbedo = mix(bestSurface.albedo, secondSurface.albedo, secondMix);
      const texturedNormal = normalize(mix(bestSurface.normal, secondSurface.normal, secondMix));
      const texturedRoughness = mix(
        bestSurface.roughness,
        secondSurface.roughness,
        secondMix,
      );
      const texturedAo = mix(bestSurface.ao, secondSurface.ao, secondMix);
      const surfaceDistance = length(cameraPosition.sub(vWorldPosition));
      const fade = float(1).sub(smoothstep(uSurfNear, uSurfFar, surfaceDistance));
      const manualAmount = fade.mul(coverage);
      const generatedAmount = uSurfMode.mul(uSurfAmount).mul(fade).mul(coverage);
      surfaceAmount = mix(generatedAmount, manualAmount, step(0.5, uManualSurfaceMode))
        .mul(step(0.0001, bestWeight));
      manualSurfaceDebug = vec3(weightsA.x, coverage, surfaceAmount);
      albedo = mix(albedo, texturedAlbedo, surfaceAmount);
      const boostedNormal = normalize(
        geometricNormal.add(texturedNormal.sub(geometricNormal).mul(uSurfNormalAmt)),
      );
      normal = normalize(mix(normal, boostedNormal, clamp(surfaceAmount, 0, 1)));
      surfaceRoughness = mix(
        0.8,
        texturedRoughness,
        clamp(surfaceAmount.mul(uSurfRoughAmt), 0, 1),
      );
      surfaceAo = mix(1, texturedAo, clamp(surfaceAmount.mul(uSurfAOAmt), 0, 1));
    }

    const scorch = destructionSample(point).g;
    albedo = mix(albedo, vec3(0.055, 0.036, 0.025), scorch.mul(0.84));
    const luminance = dot(albedo, vec3(0.299, 0.587, 0.114));
    albedo = max(
      mix(vec3(luminance), albedo, uPaletteSaturation)
        .sub(0.5).mul(uPaletteContrast).add(0.5),
      vec3(0),
    ).mul(uPaletteTint);

    const concavity = clamp(
      heightX.add(heightZ).mul(0.5).sub(height).div(eps.mul(0.9)),
      0,
      1,
    );
    const valley = float(1).sub(smoothstep(0, uHeightScale.mul(0.55), height));
    const ao = float(1).sub(uAO.mul(concavity.mul(0.45).add(valley.mul(0.22))))
      .mul(surfaceAo);
    const diffuse = max(dot(normal, uSunDir), 0);
    const sun = uTerrainSunCol.mul(uTerrainSunIntensity).mul(diffuse);
    const sky = uTerrainSkyAmb.mul(0.5).mul(normal.y.mul(0.5).add(0.5));
    const bounce = uTerrainBounce.mul(0.25).mul(float(1).sub(normal.y.mul(0.5)));
    let color = albedo.mul(sun.add(sky).add(bounce)).mul(ao);
    const viewDirection = normalize(cameraPosition.sub(vWorldPosition));
    const halfDirection = normalize(uSunDir.add(viewDirection));
    const specularPower = mix(96, 8, clamp(surfaceRoughness, 0.04, 1));
    const specular = pow(max(dot(normal, halfDirection), 0), specularPower)
      .mul(float(1).sub(clamp(surfaceRoughness, 0, 1)))
      .mul(surfaceAmount)
      .mul(0.15)
      .mul(max(uSunDir.y, 0));
    color = color.add(uTerrainSunCol.mul(uTerrainSunIntensity).mul(specular));

    const rangeT = clamp(
      height.sub(uAnalysisMin).div(max(uAnalysisMax.sub(uAnalysisMin), 0.001)),
      0,
      1,
    );
    const heightAnalysis = mix(vec3(0.05, 0.17, 0.42), vec3(0.92, 0.72, 0.24), rangeT);
    const contour = float(1).sub(smoothstep(
      0,
      0.055,
      fract(height.div(max(uAnalysisContourSpacing, 1))).sub(0.5).abs(),
    )).mul(uAnalysisContourStrength);
    const contouredHeight = mix(heightAnalysis, vec3(0.04), contour);
    const slopeDegrees = acos(clamp(geometricNormal.y, -1, 1)).mul(57.2958);
    const safeThresholdA = max(uAnalysisThresholdA, 1);
    const safeThresholdSpan = max(uAnalysisThresholdB.sub(uAnalysisThresholdA), 1);
    const gentleSlope = mix(
      vec3(0.07, 0.35, 0.16),
      vec3(0.75, 0.78, 0.16),
      clamp(slopeDegrees.div(safeThresholdA), 0, 1),
    );
    const steepSlope = mix(
      vec3(0.92, 0.58, 0.10),
      vec3(0.70, 0.08, 0.08),
      clamp(slopeDegrees.sub(uAnalysisThresholdA).div(safeThresholdSpan), 0, 1),
    );
    const slopeAnalysis = select(slopeDegrees.lessThan(uAnalysisThresholdA), gentleSlope, steepSlope);
    const normalAnalysis = geometricNormal.mul(0.5).add(0.5);
    const curvature = clamp(
      heightX.add(heightZ).mul(0.5).sub(height).div(max(eps.mul(4), 0.001)),
      -0.5,
      0.5,
    );
    const curvatureAnalysis = select(
      curvature.greaterThan(0),
      mix(vec3(0.35), vec3(0.95, 0.65, 0.18), curvature.mul(2)),
      mix(vec3(0.35), vec3(0.12, 0.45, 0.95), curvature.negate().mul(2)),
    );
    const waterDepth = max(uSeaLevel.sub(height), 0);
    const depthAnalysis = mix(
      vec3(0.08, 0.35, 0.55),
      vec3(0.01, 0.02, 0.18),
      clamp(waterDepth.div(max(uAnalysisMax, 1)), 0, 1),
    );
    const analysis = select(
      uAnalysisMode.lessThan(1.5),
      contouredHeight,
      select(
        uAnalysisMode.lessThan(2.5),
        slopeAnalysis,
        select(
          uAnalysisMode.lessThan(3.5),
          normalAnalysis,
          select(uAnalysisMode.lessThan(4.5), curvatureAnalysis, depthAnalysis),
        ),
      ),
    );
    color = mix(
      color,
      analysis,
      step(0.5, uAnalysisEnabled).mul(uAnalysisOpacity),
    );

    const gridWidth = fwidth(point).add(0.00001);
    const gridPoint = fract(point.div(max(uChunkSize, 1)).sub(0.5))
      .sub(0.5).abs().mul(max(uChunkSize, 1)).div(gridWidth);
    const gridLine = float(1).sub(min(min(gridPoint.x, gridPoint.y), 1));
    const gridFade = smoothstep(
      420,
      60,
      length(cameraPosition.sub(vWorldPosition)).div(8),
    );
    color = mix(
      color,
      vec3(0.45, 0.8, 0.95),
      gridLine.mul(uGrid).mul(0.22).mul(gridFade.mul(0.65).add(0.35)),
    );
    const lodTint = select(
      vLod.lessThan(0.5), vec3(0.9, 0.28, 0.3),
      select(vLod.lessThan(1.5), vec3(0.96, 0.65, 0.14),
        select(vLod.lessThan(2.5), vec3(0.96, 0.85, 0.04), vec3(0.23, 0.51, 0.96))),
    );
    color = mix(color, lodTint, step(0.5, uLodDebug).mul(0.55));
    const mergeTint = select(
      vLod.lessThan(5), vec3(0.18, 0.95, 0.45),
      select(vLod.lessThan(6), vec3(0.95, 0.95, 0.15),
        select(vLod.lessThan(7), vec3(0.98, 0.55, 0.10), vec3(0.95, 0.20, 0.95))),
    );
    color = mix(
      color,
      mergeTint,
      step(0.5, uMergeDebug).mul(step(3.5, vLod)).mul(0.55),
    );

    const distance = length(cameraPosition.sub(vWorldPosition));
    const fog = float(1).sub(exp(uFogDensity.mul(uFogDensity)
      .mul(distance).mul(distance).negate()));
    color = mix(color, uFogColor, clamp(fog, 0, 1));

    const outputHeight = select(uColorMode.greaterThan(2.5), vWorldPosition.y, height);
    const outputHeight01 = clamp(outputHeight.div(max(uHeightScale, 0.001)), 0, 1);
    const packedHigh = floor(outputHeight01.mul(255)).div(255);
    const packedLow = fract(outputHeight01.mul(255));
    const packed = select(
      uColorMode.greaterThan(1.5),
      vec3(packedHigh, packedLow, 0),
      vec3(outputHeight01),
    );
    const tileDebug = select(
      uTileDebugView.lessThan(2.5),
      vec3(height01),
      albedo,
    );
    let output = pow(max(color, vec3(0)), vec3(1 / 2.2));
    // Full terrain writes wall and data-output modes in linear/output space;
    // applying display gamma to packed height bytes corrupts collision and
    // prop-placement readbacks.
    output = select(
      vWall.greaterThan(0.02),
      mix(uPlinthColor, uFogColor, clamp(fog, 0, 1)),
      output,
    );
    output = select(uColorMode.greaterThan(0.5), packed, output);
    output = select(uTileDebugView.greaterThan(0.5), tileDebug, output);
    const detailDebug = select(
      uTerrainDetailDebug.lessThan(1.5),
      vec3(clamp(slope.mul(2.4), 0, 1)),
      select(
        uTerrainDetailDebug.lessThan(7.5),
        normal.mul(0.5).add(0.5),
        manualSurfaceDebug,
      ),
    );
    output = select(uTerrainDetailDebug.greaterThan(0.5), detailDebug, output);
    return vec4(output, 1);
  })();

  const applyVariant = (nextVariant) => {
    const normalized = legacyGenerated
      ? (['base', 'detail', 'surface', 'full', 'hybrid-surface', 'hybrid'].includes(nextVariant)
        ? nextVariant : 'full')
      : (nextVariant === 'manual-empty' ? 'manual-empty' : 'manual');
    const surfaceEnabled = legacyGenerated
      ? ['surface', 'full', 'hybrid-surface', 'hybrid'].includes(normalized)
      : normalized === 'manual';
    material.fragmentNode = buildFragmentNode(surfaceEnabled);
    material.userData.terrainVariant = normalized;
    material.userData.renderRole = `terrain:${normalized}`;
    material.name = `terrain:${normalized}:webgpu`;
    material.needsUpdate = true;
  };
  material.userData.rebuildTerrainVariant = applyVariant;
  material.userData.exactLegacyHeight = legacyGenerated;
  material.userData.webGpuLegacyOctaves = legacyGenerated
    ? Math.max(1, Math.round(octaves))
    : null;
  material.userData.refreshSurfaceTextures = () => {
    material.vertexNode = buildVertexNode();
    applyVariant(material.userData.terrainVariant);
  };
  applyVariant(variant);
  return { material, uniforms };
}

function createLegacyStudioWaterMaterial(legacyUniforms) {
  const uniforms = promoteLegacyWaterUniforms(legacyUniforms);
  const {
    uManualEnabled,
    uManualOrigin,
    uManualSpan,
    uManualHeightTexture,
    uDestructionEnabled,
    uDestructionOrigin,
    uDestructionSpan,
    uDestructionTexture,
    uWaterTerrainHeightTex,
    uUseWaterTerrainBiomeTex,
    uBakeOrigin,
    uBakeSpan,
    uHeightScale,
    uSeaLevel,
    uTileOccupancy,
    uTileGridOrigin,
    uTileGridDim,
    uTileCellSize,
    uUseTiles,
    uTileShape,
    uTileDiskRadius,
    uWaterAnim,
    uWaterFadeStart,
    uWaterFadeEnd,
    uWaterQuality,
    uWaterDetail,
    uWaterReflection,
    uWaveComplexity,
    uFoamWidth,
    uVisualFoamBreakup,
    uVisualShallowWaterSoftness,
    uColShallow,
    uColDeep,
    uColFoam,
    uPaletteSaturation,
    uPaletteTint,
    uSunDir,
    uTerrainSunCol,
    uTerrainSunIntensity,
    uTerrainSkyAmb,
    uFogColor,
    uFogDensity,
    uTime,
  } = uniforms;

  const manualHeightAt = (point) => boundedTextureSample(
    uManualHeightTexture,
    point,
    uManualOrigin,
    uManualSpan,
  ).r.add(boundedTextureSample(
    uDestructionTexture,
    point,
    uDestructionOrigin,
    uDestructionSpan,
  ).r.mul(step(0.5, uDestructionEnabled)));
  const bakedHeightAt = (point) => boundedTextureSample(
    uWaterTerrainHeightTex,
    point,
    uBakeOrigin,
    uBakeSpan,
  ).a.mul(uHeightScale);
  const terrainHeightAt = (point) => mix(
    bakedHeightAt(point).mul(step(0.5, uUseWaterTerrainBiomeTex)),
    manualHeightAt(point),
    step(0.5, uManualEnabled),
  );
  const tileOccupancyAtCell = (cell) => {
    const inside = step(0, cell.x).mul(step(0, cell.y))
      .mul(step(cell.x, uTileGridDim.x.sub(0.5)))
      .mul(step(cell.y, uTileGridDim.y.sub(0.5)));
    const sampleUv = cell.add(0.5).div(max(uTileGridDim, vec2(1)));
    return step(0.5, uTileOccupancy.sample(sampleUv).r).mul(inside);
  };
  const tileOccupiedAt = (point) => {
    const relative = point.sub(uTileGridOrigin).div(max(uTileCellSize, 1));
    let occupied = tileOccupancyAtCell(floor(relative));
    const disk = step(length(point), uTileDiskRadius);
    occupied = occupied.mul(mix(1, disk, step(0.5, uTileShape)));
    return mix(1, occupied, step(0.5, uUseTiles));
  };

  const vWorldPosition = varying(vec3());
  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'water:studio:legacy:webgpu';
  material.userData.renderRole = 'water:studio:legacy';
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  material.toneMapped = false;
  material.uniforms = uniforms;
  material.vertexNode = Fn(() => {
    const worldPosition = modelWorldMatrix.mul(vec4(positionGeometry, 1));
    vWorldPosition.assign(worldPosition.xyz);
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(worldPosition);
  })();
  material.fragmentNode = Fn(() => {
    const point = vWorldPosition.xz;
    tileOccupiedAt(point).lessThan(0.5).discard();
    const depth = uSeaLevel.sub(terrainHeightAt(point));
    depth.lessThanEqual(0.02).discard();

    const animationTime = uTime.mul(uWaterAnim);
    const largeWave = sin(point.x.mul(0.055).add(animationTime.mul(0.6)))
      .add(cos(point.y.mul(0.047).sub(animationTime.mul(0.45))));
    const detailWave = sin(point.x.add(point.y).mul(0.14)
      .sub(animationTime.mul(0.8))).mul(uWaterDetail).mul(step(0.5, uWaterQuality));
    const waveStrength = uWaveComplexity.mul(0.16);
    const normal = normalize(vec3(
      cos(point.x.mul(0.055).add(animationTime.mul(0.6)))
        .add(cos(point.x.add(point.y).mul(0.14).sub(animationTime.mul(0.8)))
          .mul(uWaterDetail).mul(step(0.5, uWaterQuality))).mul(waveStrength).negate(),
      1,
      sin(point.y.mul(0.047).sub(animationTime.mul(0.45)))
        .add(cos(point.x.add(point.y).mul(0.14).sub(animationTime.mul(0.8)))
          .mul(uWaterDetail).mul(step(0.5, uWaterQuality))).mul(waveStrength),
    ));
    const shoreSoftness = clamp(uVisualShallowWaterSoftness, 0, 1);
    const depthGrade = clamp(depth.div(mix(55, 74, shoreSoftness)), 0, 1);
    let color = mix(uColShallow, uColDeep, depthGrade);
    color = mix(vec3(luma(color)), color, uPaletteSaturation).mul(uPaletteTint);

    const diffuse = max(dot(normal, normalize(uSunDir)), 0);
    const viewDirection = normalize(cameraPosition.sub(vWorldPosition));
    const halfVector = normalize(normalize(uSunDir).add(viewDirection));
    const specular = pow(max(dot(normal, halfVector), 0), 90)
      .mul(uWaterReflection).mul(0.55);
    const lighting = vec3(0.55).add(uTerrainSkyAmb.mul(0.35))
      .add(uTerrainSunCol.mul(diffuse).mul(uTerrainSunIntensity).mul(0.65));
    color = color.mul(lighting)
      .add(uTerrainSunCol.mul(specular).mul(uTerrainSunIntensity));

    const fresnel = pow(float(1).sub(max(dot(viewDirection, vec3(0, 1, 0)), 0)), 3);
    color = color.add(uFogColor.mul(fresnel).mul(uWaterReflection).mul(0.18));
    const foamNoise = largeWave.mul(0.5).add(0.5);
    const foamDistance = max(uFoamWidth, 0.5);
    const foam = float(1).sub(smoothstep(
      min(0.6, foamDistance.mul(0.5)),
      foamDistance.add(shoreSoftness.mul(1.8)),
      depth.add(foamNoise.mul(mix(0.8, 3.2, uVisualFoamBreakup))),
    ));
    color = mix(color, uColFoam.mul(lighting), foam.mul(0.75));

    const cameraDistance = length(cameraPosition.xz.sub(point));
    const edgeFade = float(1).sub(smoothstep(
      uWaterFadeStart,
      uWaterFadeEnd,
      cameraDistance,
    ));
    const alpha = clamp(float(0.5).add(depthGrade.mul(0.42))
      .add(fresnel.mul(0.15)).add(foam.mul(0.3)), 0, 0.94).mul(edgeFade);
    alpha.lessThan(0.01).discard();

    const distance3d = length(cameraPosition.sub(vWorldPosition));
    const fog = float(1).sub(exp(
      uFogDensity.mul(uFogDensity).mul(distance3d).mul(distance3d).negate(),
    ));
    color = mix(color, uFogColor, clamp(fog, 0, 1));
    return vec4(pow(max(color, vec3(0)), vec3(1 / 2.2)), alpha);
  })();
  return material;
}

function createLegacyStudioTerrainMaterial(legacyUniforms, options = {}) {
  const created = createManualTerrainMaterial(legacyUniforms, {
    ...options,
    // Keep one fixed WebGPU pipeline. uOctaves masks this maximum graph at
    // runtime, avoiding a large shader rebuild on every octave slider change.
    octaves: 9,
    legacyGenerated: true,
  });
  created.material.userData.webGpuLegacyDynamicOctaves = true;
  return created;
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
    createManualTerrainMaterial,
    createLegacyStudioTerrainMaterial,
    createLegacyStudioWaterMaterial,
  });
}
