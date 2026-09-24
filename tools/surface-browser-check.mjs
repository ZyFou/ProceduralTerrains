import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const quick=process.argv.includes('--quick');
const planetQuick=process.argv.includes('--planet-quick');
const rolesPreview=process.argv.includes('--roles-preview');
const snowPreview=process.argv.includes('--snow-preview');
const desertPreview=process.argv.includes('--desert-preview');
const preview=rolesPreview||snowPreview||desertPreview;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[];
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/@vite/client',route=>route.fulfill({body:'export const injectQuery=(url)=>url; export const createHotContext=()=>({on(){},accept(){},dispose(){}});',contentType:'text/javascript'}));
  await page.goto('http://127.0.0.1:6064/tools/surface-qa.html');
  const result=await page.evaluate(async({quick,planetQuick,preview,snowPreview,desertPreview})=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {createTerrainUniforms,createTerrainMaterial}=await import('/src/engine/terrain/TerrainMaterial.js');
    const {createPlanetMaterial}=await import('/src/engine/terrain/PlanetMaterial.js');
    const {buildSurfaceResources}=await import('/src/engine/terrain/surface/SurfaceResources.js');
    const {createSurfaceDocument}=await import('/src/engine/terrain/surface/SurfaceDocument.js');
    const {syncSurfaceMaterialBackend}=await import('/src/engine/terrain/surface/SurfaceArrayGLSL.js');
    const {SurfacePaintLayers}=await import('/src/manual/SurfacePaintLayers.js');
    const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),preserveDrawingBuffer:true});renderer.setSize(quick?128:preview?512:800,quick?96:preview?384:600);
    const gl=renderer.getContext(),logs=[];
    renderer.debug.onShaderError=(context,program,vs,fs)=>{logs.push(context.getProgramInfoLog(program),context.getShaderInfoLog(vs),context.getShaderInfoLog(fs));};
    const doc=createSurfaceDocument();doc.settings.profile='eco';
    if(!preview)for(const key of Object.keys(doc.roles))doc.roles[key]='polyhaven:brown_mud';
    const start=performance.now(),pack=await buildSurfaceResources({document:doc});
    const uniforms=createTerrainUniforms();
    if(preview)uniforms.uSeaLevel.value=-100;
    if(snowPreview||desertPreview){
      uniforms.uSnowLine.value=snowPreview?0.45:1;
      const pixels=new Uint8Array(256*256*4);
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const i=(y*256+x)*4;
        const slope=desertPreview?0.9*x/255:0,ny=1-slope;
        pixels[i]=Math.round(255*(0.5+0.5*Math.sqrt(1-ny*ny)));
        pixels[i+1]=Math.round(255*(0.5+0.5*ny));pixels[i+2]=128;
        pixels[i+3]=Math.round(255*(snowPreview?0.2+0.5*x/255:0.15));
      }
      const height=new THREE.DataTexture(pixels,256,256,THREE.RGBAFormat);
      height.minFilter=THREE.LinearFilter;height.magFilter=THREE.LinearFilter;height.needsUpdate=true;
      uniforms.uTerrainHeightTex.value=height;uniforms.uUseTerrainHeightTex.value=1;
      uniforms.uBakeOrigin.value.set(-250,-250);uniforms.uBakeSpan.value.set(500,500);
    }
    if(desertPreview){
      uniforms.uSeaLevel.value=80;uniforms.uTempBias.value=1;uniforms.uMoistBias.value=-1;
      uniforms.uSurfBlend.value=1;uniforms.uSurfTransition.value=0;
    }
    uniforms.uSurfaceArrayMode.value=1;uniforms.uSurfMode.value=1;uniforms.uSurfBreakup.value=0.6;uniforms.uSurfDiffuse.value=pack.diffuse;uniforms.uSurfProps.value=pack.props;
    if(uniforms.uSurfReveal)uniforms.uSurfReveal.value=1;
    uniforms.uSurfaceRoleMap.value=pack.mapping;uniforms.uSurfaceRoleTint.value=pack.tints;uniforms.uSurfaceAssetSize.value=[...pack.sizes,...new Array(64-pack.sizes.length).fill(2)];
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,800/600,0.1,10000);camera.position.set(250,350,400);camera.lookAt(0,0,0);
    if(snowPreview){camera.position.set(250,470,650);camera.lookAt(0,160,0);}
    const geo=new THREE.PlaneGeometry(500,500,32,32);geo.rotateX(-Math.PI/2);
    const material=createTerrainMaterial(uniforms,3,undefined,{variant:desertPreview?'surface':'full'}),mesh=new THREE.Mesh(geo,material);scene.add(mesh);
    syncSurfaceMaterialBackend(material);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
    const terrain={programs:renderer.info.programs.length,errors:logs.splice(0)};
    if(desertPreview){
      const zero=document.querySelector('canvas').toDataURL('image/png');
      uniforms.uSurfTransition.value=1;renderer.render(scene,camera);
      return {renderer:gl.getParameter(gl.RENDERER),samplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),ms:Math.round(performance.now()-start),terrain,
        previewImages:{zero,full:document.querySelector('canvas').toDataURL('image/png')}};
    }
    if(quick||preview)return {renderer:gl.getParameter(gl.RENDERER),samplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),ms:Math.round(performance.now()-start),terrain};
    if(planetQuick){
      mesh.material=createPlanetMaterial(uniforms,3);syncSurfaceMaterialBackend(mesh.material);
      await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
      return {renderer:gl.getParameter(gl.RENDERER),samplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),ms:Math.round(performance.now()-start),terrain,planet:{errors:logs.splice(0)}};
    }
    const paint=new SurfacePaintLayers({origin:{x:-250,z:-250},span:{x:500,z:500}});const layer=paint.addLayer('polyhaven:brown_mud');paint.stamp({x:0,z:0,radius:100,layerId:layer.id});paint.bind(uniforms);paint.flushUploads();
    uniforms.uSurfacePaintMap.value[layer.slot].set(0,-1,0,1);renderer.render(scene,camera);
    const paintResult={errors:logs.splice(0),weight:paint.sample(0,0,0)};
    mesh.material=createPlanetMaterial(uniforms,3);syncSurfaceMaterialBackend(mesh.material);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
    const planet={errors:logs.splice(0)};
    const {buildTerrainBakeFragment}=await import('/src/engine/terrain/TerrainExporter.js');
    const {buildHeightGLSL}=await import('/src/engine/terrain/terrainGLSL.js');
    const {generateStackGLSL}=await import('/src/engine/terrain/noise/noiseStackCodegen.js');
    const {defaultLegacyStack}=await import('/src/engine/terrain/noise/NoiseStack.js');
    const bake=new THREE.ShaderMaterial({uniforms:{...uniforms,uBoardSize:{value:500},uBoardSizeXZ:{value:new THREE.Vector2(500,500)},uCellOffset:{value:new THREE.Vector2()},uBakeMode:{value:2},uBakeLighting:{value:false},uHeightVertexGrid:{value:0},uEps:{value:0.35}},defines:{OCTAVES:3},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',fragmentShader:buildTerrainBakeFragment(buildHeightGLSL(generateStackGLSL(defaultLegacyStack()).body2d))});
    mesh.material=bake;syncSurfaceMaterialBackend(bake);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
    const baking={errors:logs.splice(0)};
    mesh.material=material;renderer.render(scene,camera);
    return {renderer:gl.getParameter(gl.RENDERER),samplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),arrayLayers:gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),ms:Math.round(performance.now()-start),budget:pack.budget,terrain,paint:paintResult,planet,baking};
  },{quick,planetQuick,preview,snowPreview,desertPreview});
  const {previewImages,...metrics}=result;
  const previewName=snowPreview?'snow-preview':rolesPreview?'roles-preview':'render';
  const outputName=quick?'quick-result':planetQuick?'planet-quick-result':desertPreview?'desert-transition':snowPreview?'snow-preview':rolesPreview?'roles-preview':'result';
  await fs.mkdir('output/surface-qa',{recursive:true});
  if(previewImages){
    for(const [name,data] of Object.entries(previewImages))await fs.writeFile(`output/surface-qa/desert-transition-${name}.png`,Buffer.from(data.split(',')[1],'base64'));
  }else if(!quick&&!planetQuick)await page.screenshot({path:`output/surface-qa/${previewName}.png`});
  await fs.writeFile(`output/surface-qa/${outputName}.json`,JSON.stringify({...metrics,errors},null,2));
  console.log(JSON.stringify({...metrics,errors},null,2));
  if(errors.length||Object.values(result).some(v=>v?.errors?.some(Boolean)))process.exitCode=1;
}finally{await browser.close();}
