export default async function ({ page, h, scene }) {
  await h.setPose(scene.views[1].pose);
  await h.settle({ timeoutMs: 90000 });
  console.log(JSON.stringify(await page.evaluate(() => {
    const u = window.__engine.water?.material?.uniforms || {};
    const pick = {};
    for (const k of ['uUseWaterTerrainBiomeTex', 'uWaterTier', 'uDepthColorStr', 'uDepthOpacityStr', 'uWaterHeightTaps', 'uUseTerrainHeightTex', 'uSceneRefractionEnabled', 'uCausticsQual', 'uFoamQual', 'uRefractionQual', 'uMicroWaveDetail', 'uWaterQuality', 'uBiomeColorEnabled', 'uWaterNaturalColor', 'uCausticsStr', 'uFoamEnabled']) pick[k] = u[k]?.value;
    pick.biomeTex = !!u.uWaterTerrainBiomeTex?.value;
    pick.heightTex = !!u.uWaterTerrainHeightTex?.value;
    pick.fragLen = window.__engine.water?.material?.fragmentShader?.length;
    return pick;
  })));
}
