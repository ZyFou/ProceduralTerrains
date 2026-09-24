import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 540 } });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/@vite/client', route => route.fulfill({ body: 'export const injectQuery=(url)=>url; export const createHotContext=()=>({on(){},accept(){},dispose(){}});', contentType: 'text/javascript' }));
  await page.goto('http://127.0.0.1:6064/tools/surface-qa.html');
  const report = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { buildSurfaceResources } = await import('/src/engine/terrain/surface/SurfaceResources.js');
    const { createSurfaceDocument } = await import('/src/engine/terrain/surface/SurfaceDocument.js');
    const { SURFACE_ARRAY_UNIFORMS, SURFACE_ARRAY_FUNCTIONS } = await import('/src/engine/terrain/surface/SurfaceArrayGLSL.js');
    const ids = ['polyhaven:snow_02', 'polyhaven:sand_03', 'polyhaven:rock_face'];
    const doc = createSurfaceDocument();
    doc.settings.profile = 'eco';
    for (const role of Object.keys(doc.roles)) doc.roles[role] = ids[0];
    doc.roles.snow = 'pt:powder-snow';
    doc.roles.sand = 'pt:dune-sand';
    doc.roles.rock = ids[2];
    const pack = await buildSurfaceResources({ document: doc, references: ids });
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), preserveDrawingBuffer: true });
    renderer.setSize(1200, 540);
    const shaderErrors = [];
    renderer.debug.onShaderError = (gl, program, vs, fs) => shaderErrors.push(gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x252b31);
    const camera = new THREE.OrthographicCamera(-34, 34, 15.3, -15.3, 0.1, 200);
    camera.position.set(0, 30, 38);
    camera.lookAt(0, 0, 0);
    const vertexShader = `varying vec3 vPos; varying vec3 vNormal; void main(){vec4 world=modelMatrix*vec4(position,1.0);vPos=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*world;}`;
    const fragmentShader = `precision highp float; varying vec3 vPos; varying vec3 vNormal; uniform float uSurfBreakup; uniform float uSurfScale; uniform int uRole;
      struct SurfMaterialSample {vec3 albedo;vec3 normal;float rough;float ao;float height;float missing;};
      float vnoise(vec2 p){return 0.5;}
      ${SURFACE_ARRAY_UNIFORMS}
      ${SURFACE_ARRAY_FUNCTIONS}
      void main(){pbrWorldDx=dFdx(vPos);pbrWorldDy=dFdy(vPos);vec3 ng=normalize(vNormal);vec3 tri=pow(abs(ng),vec3(4.0));tri/=max(dot(tri,vec3(1)),0.0001);
        SurfMaterialSample s=pbrRole(uRole,vPos,tri,ng);
        float lit=0.35+0.65*max(dot(s.normal,normalize(vec3(0.5,1.0,0.4))),0.0);
        gl_FragColor=vec4(pow(max(s.albedo*lit*mix(1.0,s.ao,0.55),vec3(0.0)),vec3(1.0/2.2)),1.0);
      }`;
    const geometry = new THREE.PlaneGeometry(19, 19, 80, 80);
    for (let i = 0; i < ids.length; i++) {
      const material = new THREE.ShaderMaterial({
        defines: { SURFACE_ARRAYS: 1 }, vertexShader, fragmentShader, side: THREE.DoubleSide,
        uniforms: {
          uSurfDiffuse: { value: pack.diffuse }, uSurfProps: { value: pack.props },
          uSurfBreakup: { value: 0.5 }, uSurfScale: { value: 1 }, uRole: { value: [12, 0, 10][i] },
          uSurfaceRoleMap: { value: pack.mapping }, uSurfaceRoleTint: { value: pack.tints },
          uSurfaceAssetSize: { value: [...pack.sizes, ...new Array(64 - pack.sizes.length).fill(2)] },
        },
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = i === 2 ? -Math.PI / 3 : -Math.PI / 2;
      mesh.position.x = (i - 1) * 22;
      scene.add(mesh);
    }
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    return { assets: ids, resolution: pack.budget.resolution, shaderErrors };
  });
  await fs.mkdir('output/surface-qa', { recursive: true });
  await page.screenshot({ path: 'output/surface-qa/materials.png' });
  console.log(JSON.stringify({ ...report, errors }, null, 2));
  if (errors.length || report.shaderErrors.some(Boolean)) process.exitCode = 1;
} finally {
  await browser.close();
}
