import * as THREE from 'three';

const configureTexture = (texture, srgb) => {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export function serializePreparedSurface(atlas) {
  const { diffuse, props, ...metadata } = atlas;
  if (atlas.backend === 'array') {
    const encode = (texture) => texture.mipmaps.map(({ width, height, data }) => ({ width, height, data }));
    const color = encode(diffuse);
    const properties = encode(props);
    return {
      result: {
        ...metadata,
        mapping: atlas.mapping.map((value) => value.toArray()),
        tints: atlas.tints.map((value) => value.toArray()),
        textures: { kind: 'array', color, properties, depth: diffuse.image.depth },
      },
      transfer: [...color, ...properties].map((level) => level.data.buffer),
    };
  }
  const color = diffuse.image.transferToImageBitmap();
  const properties = props.image.transferToImageBitmap();
  return {
    result: { ...metadata, textures: { kind: 'atlas', color, properties } },
    transfer: [color, properties],
  };
}

export function materializePreparedSurface(prepared) {
  const { textures, ...metadata } = prepared;
  let diffuse;
  let props;
  if (textures.kind === 'array') {
    const makeArray = (mipmaps, srgb) => {
      const first = mipmaps[0];
      const texture = new THREE.CompressedArrayTexture(
        mipmaps, first.width, first.height, textures.depth,
        THREE.RGBAFormat, THREE.UnsignedByteType,
      );
      texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    };
    diffuse = makeArray(textures.color, true);
    props = makeArray(textures.properties, false);
    metadata.mapping = metadata.mapping.map((value) => new THREE.Vector4(...value));
    metadata.tints = metadata.tints.map((value) => new THREE.Vector3(...value));
  } else {
    diffuse = configureTexture(new THREE.Texture(textures.color), true);
    props = configureTexture(new THREE.Texture(textures.properties), false);
  }
  return { ...metadata, diffuse, props };
}
