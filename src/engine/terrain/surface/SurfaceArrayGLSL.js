export const SURFACE_ARRAY_UNIFORMS = /* glsl */ `
#ifdef SURFACE_ARRAYS
uniform highp sampler2DArray uSurfDiffuse;
uniform highp sampler2DArray uSurfProps;
uniform vec4 uSurfaceRoleMap[13];
uniform vec3 uSurfaceRoleTint[13];
uniform float uSurfaceAssetSize[64];
uniform vec4 uSurfaceGraphParams[128];
#ifdef SURFACE_PAINT_LAYERS
#define uSurfacePaintArray uPaintBiomeTexture
#endif
uniform float uSurfacePaintEnabled;
uniform int uSurfaceContributions;
uniform vec4 uSurfacePaintRegion;
uniform float uSurfacePaintOpacity[32];
uniform vec4 uSurfacePaintMap[32];
uniform vec3 uSurfacePaintTint[32];
#else
uniform sampler2D uSurfDiffuse;
uniform sampler2D uSurfProps;
#endif
`;
export const SURFACE_ARRAY_FUNCTIONS = /* glsl */ `
#ifdef SURFACE_ARRAYS
vec3 pbrMapped(vec3 p,vec4 m){float c=cos(m.y),s=sin(m.y);p.xz=mat2(c,-s,s,c)*p.xz+m.zw;return p;}
float pbrPaintWeight(vec2 p,int layer){
#ifndef SURFACE_PAINT_LAYERS
return 0.0;
#else
  if(uSurfacePaintEnabled<0.5||layer<0||layer>31)return 0.0;
  vec2 uv=(p-uSurfacePaintRegion.xy)/uSurfacePaintRegion.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))return 0.0;
  vec2 pixel=uv*1024.0,tile=floor(pixel/256.0);
  float page=(tile.y*4.0+tile.x)*8.0+float(layer/4);
  vec4 weights=texture(uSurfacePaintArray,vec3((mod(pixel,256.0)+1.0)/258.0,page));
  int c=layer-layer/4*4;return c==0?weights.r:c==1?weights.g:c==2?weights.b:weights.a;
#endif
}
vec2 pbrHash(vec2 p) {return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
void pbrPatch(vec2 uv, vec2 dx, vec2 dy, vec2 cell, float layer, out vec4 color, out vec4 props) {
  // Offset-only patches preserve directional strata and normal-map axes.
  vec2 offset=pbrHash(cell+layer*17.13)*uSurfBreakup;
  color=textureGrad(uSurfDiffuse,vec3(uv+offset,layer),dx,dy);
  props=textureGrad(uSurfProps,vec3(uv+offset,layer),dx,dy);
}
void pbrPlane(vec2 uv,float layer,out vec4 color,out vec4 props) {
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  if(uSurfBreakup<0.001){pbrPatch(uv,dx,dy,vec2(0),layer,color,props);return;}
  vec2 skew=vec2(uv.x-uv.y*0.57735027,uv.y*1.15470054);
  vec2 cell=floor(skew),f=fract(skew),a,b,c;vec3 weights;
  if(f.x+f.y<1.0){a=cell;b=cell+vec2(1,0);c=cell+vec2(0,1);weights=vec3(1.0-f.x-f.y,f.x,f.y);}
  else{a=cell+vec2(1);b=cell+vec2(0,1);c=cell+vec2(1,0);weights=vec3(f.x+f.y-1.0,1.0-f.x,1.0-f.y);}
  weights=weights*weights;weights/=max(dot(weights,vec3(1)),0.0001);
  vec4 ca,cb,cc,pa,pb,pc;
  pbrPatch(uv,dx,dy,a,layer,ca,pa);pbrPatch(uv,dx,dy,b,layer,cb,pb);pbrPatch(uv,dx,dy,c,layer,cc,pc);
  color=ca*weights.x+cb*weights.y+cc*weights.z;
  props=pa*weights.x+pb*weights.y+pc*weights.z;
}
SurfMaterialSample pbrAsset(int layer,vec3 wp,vec3 blend,vec3 ng,float scale) {
  float metres=max(uSurfaceAssetSize[layer],0.01)*max(scale,0.01);
  vec3 p=wp/max(metres,0.01)*max(uSurfScale,0.01);
  vec4 cx,cy,cz,px,py,pz;
  pbrPlane(p.zy,float(layer),cx,px);pbrPlane(p.xz,float(layer),cy,py);pbrPlane(p.xy,float(layer),cz,pz);
  vec2 nx=px.rg*2.0-1.0,ny=py.rg*2.0-1.0,nz=pz.rg*2.0-1.0;
  vec3 bump=vec3(0,nx.y,nx.x)*blend.x+vec3(ny.x,0,ny.y)*blend.y+vec3(nz.x,nz.y,0)*blend.z;
  bump-=ng*dot(bump,ng);
  SurfMaterialSample s;s.albedo=cx.rgb*blend.x+cy.rgb*blend.y+cz.rgb*blend.z;
  s.normal=normalize(ng+bump);s.rough=px.b*blend.x+py.b*blend.y+pz.b*blend.z;
  s.ao=px.a*blend.x+py.a*blend.y+pz.a*blend.z;s.height=cx.a*blend.x+cy.a*blend.y+cz.a*blend.z;s.missing=0.0;return s;
}
SurfMaterialSample pbrRole(int role,vec3 wp,vec3 blend,vec3 ng) {
  vec4 mapping=uSurfaceRoleMap[role];
  SurfMaterialSample s=pbrAsset(int(mapping.x),wp,blend,ng,mapping.w);
  if(mapping.y>=0.0){
    SurfMaterialSample b=pbrAsset(int(mapping.y),wp,blend,ng,mapping.w);
    float k=smoothstep(0.3,0.7,vnoise(wp.xz*0.05));
    s.albedo=mix(s.albedo,b.albedo,k);s.normal=normalize(mix(s.normal,b.normal,k));s.rough=mix(s.rough,b.rough,k);s.ao=mix(s.ao,b.ao,k);
  }
  s.albedo*=uSurfaceRoleTint[role];s.albedo*=1.0-mapping.z*0.35;s.rough=max(0.08,s.rough*(1.0-mapping.z));return s;
}
#endif
`;
export function syncSurfaceMaterialBackend(material) {
  if(!material?.uniforms?.uSurfaceArrayMode)return;
  const enabled=material.uniforms.uSurfaceArrayMode.value>0.5;
  const contributions=material.uniforms.uSurfaceContributions?.value||4;
  if(material.defines?.SURFACE_CONTRIBUTIONS!==contributions){material.defines ||= {};material.defines.SURFACE_CONTRIBUTIONS=contributions;material.needsUpdate=true;}
  const paint=enabled && material.uniforms.uSurfacePaintEnabled?.value>0.5;
  if(Boolean(material.defines?.SURFACE_PAINT_LAYERS)!==paint){
    material.defines ||= {};
    if(paint)material.defines.SURFACE_PAINT_LAYERS=1;else delete material.defines.SURFACE_PAINT_LAYERS;
    material.needsUpdate=true;
  }
  if(paint && material.uniforms.uPaintBiomeTexture)material.uniforms.uPaintBiomeTexture.value=material.uniforms.uSurfacePaintArray.value;
  const graph=enabled ? material.uniforms.uSurfaceGraphCode?.value || '' : '';
  if(material.userData.surfaceGraph!==graph || (graph && !material.fragmentShader.includes(graph))){
    material.fragmentShader=material.fragmentShader.replace(/\/\*SURFACE_GRAPH_BEGIN\*\/[\s\S]*?\/\*SURFACE_GRAPH_END\*\//,`/*SURFACE_GRAPH_BEGIN*/\n${graph}\n/*SURFACE_GRAPH_END*/`);
    material.defines ||= {};
    if(graph)material.defines.SURFACE_GRAPH_ACTIVE=1;else delete material.defines.SURFACE_GRAPH_ACTIVE;
    material.userData.surfaceGraph=graph;material.needsUpdate=true;
  }
  if(Boolean(material.defines?.SURFACE_ARRAYS)===enabled)return;
  material.defines ||= {};
  if(enabled)material.defines.SURFACE_ARRAYS=1;else delete material.defines.SURFACE_ARRAYS;
  material.needsUpdate=true;
}
export function installSurfaceMaterialBackend(material) {
  const previous=material.onBeforeRender;
  material.onBeforeRender=function(...args){syncSurfaceMaterialBackend(this);previous?.apply(this,args);};
  syncSurfaceMaterialBackend(material);return material;
}
