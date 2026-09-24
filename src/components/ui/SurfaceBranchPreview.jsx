import React, { useRef, useState, useEffect } from 'react';
export default function SurfaceBranchPreview({graph,nodeId}) {
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const revision=useRef(0),urlRef=useRef('');
  useEffect(()=>()=>{revision.current++;if(urlRef.current)URL.revokeObjectURL(urlRef.current);},[]);
  const preview=async()=>{
    const current=++revision.current;setBusy(true);setError('');let renderer,resources,geometry,material;
    try {
      const THREE=await import('three');
      const [{createTerrainUniforms},{buildTerrainBakeFragment},{buildHeightGLSL},{generateStackGLSL},{defaultLegacyStack},{buildSurfaceResources},{syncSurfaceMaterialBackend},{createSurfaceDocument}]=await Promise.all([
        import('../../engine/terrain/TerrainMaterial.js'),import('../../engine/terrain/TerrainExporter.js'),import('../../engine/terrain/terrainGLSL.js'),import('../../engine/terrain/noise/noiseStackCodegen.js'),import('../../engine/terrain/noise/NoiseStack.js'),import('../../engine/terrain/surface/SurfaceResources.js'),import('../../engine/terrain/surface/SurfaceArrayGLSL.js'),import('../../engine/terrain/surface/SurfaceDocument.js'),
      ]);
      const branch={...graph,edges:[...graph.edges.filter(e=>!(e.target==='terrain-output'&&e.targetHandle==='surface')),{id:'preview-output',source:nodeId,sourceHandle:'surface',target:'terrain-output',targetHandle:'surface',type:'surface'}]};
      const doc=createSurfaceDocument({settings:{profile:'eco'}});
      resources=await buildSurfaceResources({document:doc,graph:branch,references:[]});
      if(current!==revision.current)return;
      const canvas=document.createElement('canvas');renderer=new THREE.WebGLRenderer({canvas,preserveDrawingBuffer:true});renderer.setSize(256,256);
      renderer.debug.onShaderError=()=>{throw new Error('Surface preview shader failed to compile');};
      const u=createTerrainUniforms();u.uSurfaceArrayMode.value=1;u.uSurfMode.value=1;u.uSurfDiffuse.value=resources.diffuse;u.uSurfProps.value=resources.props;u.uSurfaceRoleMap.value=resources.mapping;u.uSurfaceRoleTint.value=resources.tints;u.uSurfaceAssetSize.value=[...resources.sizes,...new Array(64-resources.sizes.length).fill(2)];u.uSurfaceGraphCode.value=resources.graph.body;u.uSurfaceGraphParams.value=Array.from({length:128},(_,i)=>new THREE.Vector4(...(resources.graph.values[i]||[0,0,0,0])));
      Object.assign(u,{uBoardSize:{value:10},uBoardSizeXZ:{value:new THREE.Vector2(10,10)},uCellOffset:{value:new THREE.Vector2()},uBakeMode:{value:2},uBakeLighting:{value:false},uHeightVertexGrid:{value:0},uEps:{value:0.01}});
      const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);geometry=new THREE.PlaneGeometry(2,2);
      material=new THREE.ShaderMaterial({uniforms:u,defines:{OCTAVES:2},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',fragmentShader:buildTerrainBakeFragment(buildHeightGLSL(generateStackGLSL(defaultLegacyStack()).body2d))});
      syncSurfaceMaterialBackend(material);scene.add(new THREE.Mesh(geometry,material));await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve));if(current!==revision.current)return;
      if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=URL.createObjectURL(blob);setUrl(urlRef.current);
    }catch(e){if(current===revision.current)setError(e.message);}finally{material?.dispose();geometry?.dispose();resources?.diffuse.dispose();resources?.props.dispose();renderer?.dispose();renderer?.forceContextLoss();if(current===revision.current)setBusy(false);}
  };
  return <div><button type="button" disabled={busy} onClick={preview}>{busy?'Rendering…':'Preview surface branch'}</button>{error&&<p role="alert">{error}</p>}{url&&<img src={url} alt="Surface branch preview" width="256" height="256"/>}</div>;
}
