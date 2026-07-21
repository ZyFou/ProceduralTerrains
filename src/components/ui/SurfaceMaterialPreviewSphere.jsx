import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Small self-contained Three.js preview — deliberately isolated from the main
// terrain renderer (its own canvas/scene/renderer) so browsing surface
// materials never touches the live terrain scene. Shows diffuse/normal/
// roughness/AO on a sphere so a material reads the same regardless of which
// biome/slope it'll eventually be painted on.
export default function SurfaceMaterialPreviewSphere({ diffuseUrl, normalUrl, roughnessUrl, aoUrl, size = 176 }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 10);
    camera.position.set(0, 0, 2.5);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 2.5, 3);
    scene.add(hemi, sun);

    const geometry = new THREE.SphereGeometry(1, 64, 64);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    // Only DirectX-convention normal maps are supported (no OpenGL variant in
    // this pipeline) — DX stores the green channel flipped vs. what Three.js
    // expects, so mirror Y to read it correctly instead of inverting relief.
    material.normalScale.set(1, -1);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const loader = new THREE.TextureLoader();
    let raf = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
    const onPointerMove = (e) => {
      if (!dragging) return;
      mesh.rotation.y += (e.clientX - lastX) * 0.012;
      mesh.rotation.x = Math.max(-1.1, Math.min(1.1, mesh.rotation.x + (e.clientY - lastY) * 0.012));
      lastX = e.clientX; lastY = e.clientY;
    };
    const onPointerUp = (e) => { dragging = false; canvas.releasePointerCapture?.(e.pointerId); };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    const tick = () => {
      if (!dragging) mesh.rotation.y += 0.004;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    stateRef.current = { renderer, scene, material, loader, loadedTextures: [] };

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
      stateRef.current?.loadedTextures.forEach((t) => t.dispose());
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      stateRef.current = null;
    };
    // Renderer/scene are created once per mount; texture URLs are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { material, loader } = state;
    state.loadedTextures.forEach((t) => t.dispose());
    const nextTextures = [];

    const applySlot = (url, mapKey, { srgb = false } = {}) => {
      const prev = material[mapKey];
      if (!url) {
        material[mapKey] = null;
        material.needsUpdate = true;
        return;
      }
      loader.load(
        url,
        (tex) => {
          if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
          material[mapKey] = tex;
          material.needsUpdate = true;
          nextTextures.push(tex);
        },
        undefined,
        () => { /* missing/broken map — leave slot empty, not fatal */ },
      );
      void prev;
    };

    applySlot(diffuseUrl, 'map', { srgb: true });
    applySlot(normalUrl, 'normalMap');
    applySlot(roughnessUrl, 'roughnessMap');
    applySlot(aoUrl, 'aoMap');
    state.loadedTextures = nextTextures;
  }, [diffuseUrl, normalUrl, roughnessUrl, aoUrl]);

  return <canvas ref={canvasRef} className="surface-preview-sphere" width={size} height={size} />;
}
