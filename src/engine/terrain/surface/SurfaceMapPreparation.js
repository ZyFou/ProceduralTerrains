// Local imports and historical textures enter exactly the same array layout.
async function imagePixels(url,size) {
  const response=await fetch(url);if(!response.ok)throw new Error(`Texture HTTP ${response.status}: ${url}`);
  const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none'});
  try {const canvas=new OffscreenCanvas(size,size),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,size,size);return ctx.getImageData(0,0,size,size).data;}finally{bitmap.close();}
}
export async function prepareSurfaceMaps(maps,size,{normalConvention='GL'}={}) {
  if(!maps.albedo)throw new Error('Albedo map required');
  const loaded={};for(const [key,url] of Object.entries(maps)){if(url)loaded[key]=await imagePixels(url,size);}
  let color=new Uint8Array(size*size*4),props=new Uint8Array(color.length);
  for(let i=0;i<color.length;i+=4){color.set(loaded.albedo.subarray(i,i+3),i);color[i+3]=loaded.height?.[i]??128;props[i]=loaded.normal?.[i]??128;props[i+1]=loaded.normal ? (normalConvention==='DX'?255-loaded.normal[i+1]:loaded.normal[i+1]):128;props[i+2]=loaded.roughness?.[i]??230;props[i+3]=loaded.ao?.[i]??255;}
  const levels=[];
  const linear=v=>(v/=255)<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
  const srgb=v=>Math.round(255*(v<=0.0031308?v*12.92:1.055*v**(1/2.4)-0.055));
  for(let n=size;n>=1;n/=2){levels.push({size:n,color,props});if(n===1)break;const next=n/2,c=new Uint8Array(next*next*4),p=new Uint8Array(c.length);
    for(let y=0;y<next;y++)for(let x=0;x<next;x++){const out=(y*next+x)*4,indices=[(y*2*n+x*2)*4,(y*2*n+x*2+1)*4,((y*2+1)*n+x*2)*4,((y*2+1)*n+x*2+1)*4];let nx=0,ny=0,nz=0;
      for(let k=0;k<3;k++)c[out+k]=srgb(indices.reduce((s,i)=>s+linear(color[i+k]),0)/4);c[out+3]=Math.round(indices.reduce((s,i)=>s+color[i+3],0)/4);
      for(const i of indices){const a=props[i]/127.5-1,b=props[i+1]/127.5-1;nx+=a;ny+=b;nz+=Math.sqrt(Math.max(0,1-a*a-b*b));}const length=Math.hypot(nx,ny,nz)||1;p[out]=Math.round((nx/length+1)*127.5);p[out+1]=Math.round((ny/length+1)*127.5);for(let k=2;k<4;k++)p[out+k]=Math.round(indices.reduce((s,i)=>s+props[i+k],0)/4);
    }color=c;props=p;
  }
  return levels;
}
