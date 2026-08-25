import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const SUPPORTED_FORMATS = new Set(['glb', 'gltf', 'obj']);

function dataUrlPayload(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('The imported model data is incomplete.');
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (header.includes(';base64')) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }
  return decodeURIComponent(payload);
}

function parseGltf(data, format) {
  const payload = dataUrlPayload(data);
  const input = format === 'glb'
    ? (typeof payload === 'string' ? new TextEncoder().encode(payload).buffer : payload)
    : (typeof payload === 'string' ? payload : new TextDecoder().decode(payload));
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(input, '', (gltf) => resolve(gltf.scene), reject);
  });
}

function cloneMaterial(material) {
  const cloned = material?.clone?.() ?? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  cloned.side = THREE.DoubleSide;
  if ('vertexColors' in cloned && !cloned.vertexColors) cloned.vertexColors = false;
  return cloned;
}

function normalizedParts(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) throw new Error('The model does not contain any renderable meshes.');
  const size = bounds.getSize(new THREE.Vector3());
  const unitScale = 1 / Math.max(size.y, size.x, size.z, 1e-6);
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  const normalize = new THREE.Matrix4()
    .makeTranslation(-centerX, -bounds.min.y, -centerZ)
    .premultiply(new THREE.Matrix4().makeScale(unitScale, unitScale, unitScale));
  const parts = [];

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.getAttribute('position')) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const groups = child.geometry.groups.length
      ? child.geometry.groups
      : [{ start: 0, count: child.geometry.index?.count ?? child.geometry.getAttribute('position').count, materialIndex: 0 }];
    const baked = child.geometry.clone();
    baked.applyMatrix4(normalize.clone().multiply(child.matrixWorld));
    baked.computeBoundingBox();
    baked.computeBoundingSphere();
    for (const group of groups) {
      const geometry = baked.clone();
      geometry.clearGroups();
      geometry.setDrawRange(group.start, group.count);
      parts.push({ geometry, material: cloneMaterial(sourceMaterials[group.materialIndex] ?? sourceMaterials[0]) });
    }
    baked.dispose();
  });

  if (!parts.length) throw new Error('The model does not contain any renderable meshes.');
  return parts;
}

export function importedModelFormat(fileName = '') {
  const format = String(fileName).split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_FORMATS.has(format) ? format : '';
}

export async function loadImportedPropModel(model) {
  const format = String(model?.format ?? importedModelFormat(model?.name)).toLowerCase();
  if (!SUPPORTED_FORMATS.has(format)) throw new Error('Choose a GLB, glTF, or OBJ model.');
  if (typeof model?.data !== 'string' || !model.data.startsWith('data:')) {
    throw new Error('The imported model data is missing.');
  }
  let root;
  if (format === 'obj') {
    const payload = dataUrlPayload(model.data);
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    root = new OBJLoader().parse(text);
  } else {
    root = await parseGltf(model.data, format);
  }
  return normalizedParts(root);
}

export function createImportedModelObject(parts, name = 'imported-prop') {
  const group = new THREE.Group();
  group.name = name;
  for (const part of parts) group.add(new THREE.Mesh(part.geometry, part.material));
  return group;
}

export function disposeImportedModelParts(parts) {
  const textures = new Set();
  for (const part of parts ?? []) {
    part.geometry?.dispose?.();
    const materials = Array.isArray(part.material) ? part.material : [part.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose?.();
    }
  }
  for (const texture of textures) texture.dispose();
}
