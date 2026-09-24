import * as THREE from 'three';
import { zlibSync, unzlibSync } from 'fflate';
import { MANUAL_SURFACE_MATERIALS } from './ManualSurfaceCatalog.js';
const TILE=256,GRID=4,GROUPS=8,PAGE=TILE+2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export class SurfacePaintLayers {
  constructor({origin={x:0,z:0},span={x:1,z:1}}={}) {
    this.origin={...origin};this.span={...span};this.layers=[];this.tiles=new Map();this.revision=0;
    this.dirty=new Set();this.history=[];this.redoHistory=[];this.transaction=null;this.texture=null;
  }
  addLayer(materialInstanceId,name=materialInstanceId) {
    const slots=new Set(this.layers.map(l=>l.slot)),slot=Array.from({length:32},(_,i)=>i).find(i=>!slots.has(i));
    if(slot===undefined)throw new Error('32 paint layers maximum. Remove a layer before adding another.');
    const layer={id:crypto.randomUUID(),materialInstanceId,name,slot,visible:true,locked:false,opacity:1};
    this.layers.push(layer);this.revision++;return layer;
  }
  updateLayer(id,patch){const layer=this.layers.find(l=>l.id===id);if(!layer)throw new Error(`Unknown paint layer ${id}`);Object.assign(layer,patch,{id:layer.id,slot:layer.slot});layer.opacity=clamp(Number(layer.opacity));this.revision++;}
  beginStroke(){if(!this.transaction)this.transaction={before:new Map(),layers:structuredClone(this.layers)};}
  endStroke(){if(!this.transaction)return;const tx=this.transaction;this.transaction=null;if(!tx.before.size)return;tx.after=new Map([...tx.before.keys()].map(k=>[k,this.tiles.get(k)?.slice()||null]));this.history.push(tx);this.redoHistory=[];while(this.history.length>20)this.history.shift();}
  _restore(patches){for(const [key,value] of patches){if(value)this.tiles.set(key,value.slice());else this.tiles.delete(key);this.dirty.add(key);}this.revision++;}
  undo(){const tx=this.history.pop();if(!tx)return false;this._restore(tx.before);this.redoHistory.push(tx);return true;}
  redo(){const tx=this.redoHistory.pop();if(!tx)return false;this._restore(tx.after);this.history.push(tx);return true;}
  _key(x,y,group){return `${Math.floor(x/TILE)},${Math.floor(y/TILE)},${group}`;}
  _offset(x,y,slot){return ((y%TILE)*TILE+x%TILE)*4+slot%4;}
  read(x,y,slot){if(x<0||y<0||x>=1024||y>=1024)return 0;return (this.tiles.get(this._key(x,y,slot>>2))?.[this._offset(x,y,slot)]||0)/255;}
  write(x,y,slot,value) {
    const key=this._key(x,y,slot>>2);let tile=this.tiles.get(key);
    if(this.transaction&&!this.transaction.before.has(key))this.transaction.before.set(key,tile?.slice()||null);
    if(!tile){tile=new Uint8Array(TILE*TILE*4);this.tiles.set(key,tile);}
    const offset=this._offset(x,y,slot),encoded=Math.round(clamp(value)*255);
    if(tile[offset]===encoded)return;tile[offset]=encoded;this.dirty.add(key);
    // Neighbour gutters depend on boundary texels of this tile.
    const [tx,ty,g]=key.split(',').map(Number);for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]])if(tx+dx>=0&&tx+dx<GRID&&ty+dy>=0&&ty+dy<GRID)this.dirty.add(`${tx+dx},${ty+dy},${g}`);
  }
  sample(x,z,slot){const px=Math.floor((x-this.origin.x)/this.span.x*1024),py=Math.floor((z-this.origin.z)/this.span.z*1024);return this.read(px,py,slot);}
  stamp({x,z,radius,strength=0.45,falloff=0.72,tool='paint',layerId,filter}) {
    const layer=this.layers.find(l=>l.id===layerId);if(!layer||layer.locked||!layer.visible)return;
    const cx=(x-this.origin.x)/this.span.x*1024,cy=(z-this.origin.z)/this.span.z*1024;
    const rx=radius/this.span.x*1024,ry=radius/this.span.z*1024;
    const minX=Math.max(0,Math.floor(cx-rx)),maxX=Math.min(1023,Math.ceil(cx+rx)),minY=Math.max(0,Math.floor(cy-ry)),maxY=Math.min(1023,Math.ceil(cy+ry));
    const smooth=tool==='blend'?new Map():null;
    if(smooth)for(let py=minY;py<=maxY;py++)for(let px=minX;px<=maxX;px++){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=this.read(px+dx,py+dy,layer.slot);smooth.set(py*1024+px,sum/9);}
    for(let py=minY;py<=maxY;py++)for(let px=minX;px<=maxX;px++) {
      const distance=Math.hypot((px-cx)/rx,(py-cy)/ry);if(distance>1)continue;
      const wx=this.origin.x+px/1024*this.span.x,wz=this.origin.z+py/1024*this.span.z;
      let t=clamp((1-distance)/Math.max(0.02,falloff));const alpha=t*t*(3-2*t)*clamp(strength)*(filter?.(wx,wz)??1);
      const current=this.read(px,py,layer.slot);
      if(tool==='eraseAll'){for(const l of this.layers)if(!l.locked)this.write(px,py,l.slot,this.read(px,py,l.slot)*(1-alpha));}
      else this.write(px,py,layer.slot,tool==='erase'?current*(1-alpha):tool==='blend'?current+(smooth.get(py*1024+px)-current)*alpha:current+(1-current)*alpha);
    }
    this.revision++;
  }
  bind(uniforms) {
    if(!this.texture){this.texture=new THREE.DataArrayTexture(new Uint8Array(PAGE*PAGE*4*GRID*GRID*GROUPS),PAGE,PAGE,GRID*GRID*GROUPS);this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;this.texture.needsUpdate=true;}
    uniforms.uSurfacePaintArray.value=this.texture;uniforms.uSurfacePaintEnabled.value=1;
    uniforms.uSurfacePaintRegion.value.set(this.origin.x,this.origin.z,this.span.x,this.span.z);
    uniforms.uSurfacePaintOpacity.value=Array.from({length:32},(_,slot)=>{const l=this.layers.find(l=>l.slot===slot);return l?.visible?l.opacity:0;});
  }
  flushUploads() {
    if(!this.texture||!this.dirty.size)return false;
    for(const key of this.dirty){const [tx,ty,g]=key.split(',').map(Number),page=(ty*GRID+tx)*GROUPS+g,offset=page*PAGE*PAGE*4;
      for(let y=0;y<PAGE;y++)for(let x=0;x<PAGE;x++)for(let c=0;c<4;c++)this.texture.image.data[offset+(y*PAGE+x)*4+c]=Math.round(this.read(tx*TILE+x-1,ty*TILE+y-1,g*4+c)*255);
      this.texture.addLayerUpdate(page);
    }
    this.texture.needsUpdate=true;this.dirty.clear();return true;
  }
  clear(){this.beginStroke();for(const [key,tile] of this.tiles){this.transaction.before.set(key,tile.slice());tile.fill(0);this.dirty.add(key);}this.endStroke();this.revision++;}
  isEmpty(){for(const tile of this.tiles.values())if(tile.some(v=>v))return false;return true;}
  serialize(){return {version:2,origin:this.origin,span:this.span,resolution:1024,layers:structuredClone(this.layers),tiles:[...this.tiles].filter(([,v])=>v.some(n=>n)).map(([key,data])=>({key,data:encode(zlibSync(data))}))};}
  static load(data){const field=new SurfacePaintLayers(data);field.layers=structuredClone(data.layers||[]);if(field.layers.length>32||new Set(field.layers.map(l=>l.slot)).size!==field.layers.length||field.layers.some(l=>!Number.isInteger(l.slot)||l.slot<0||l.slot>31))throw new Error('Invalid surface paint layers');for(const tile of data.tiles||[]){if(!/^[0-3],[0-3],[0-7]$/.test(tile.key))throw new Error('Invalid paint tile');const bytes=unzlibSync(decode(tile.data));if(bytes.length!==TILE*TILE*4)throw new Error('Invalid paint mask size');field.tiles.set(tile.key,bytes);field.dirty.add(tile.key);}return field;}
  static migrate(legacy){const field=new SurfacePaintLayers(legacy);for(const material of MANUAL_SURFACE_MATERIALS)field.addLayer(`legacy:${material.id}`,material.label);for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const source=Math.min(legacy.resolution-1,Math.floor(y/1024*legacy.resolution))*legacy.resolution+Math.min(legacy.resolution-1,Math.floor(x/1024*legacy.resolution));for(let c=0;c<7;c++){const v=legacy._channelAt(source,c);if(v)field.write(x,y,c,v);}}return field;}
  dispose(){this.texture?.dispose();}
}
