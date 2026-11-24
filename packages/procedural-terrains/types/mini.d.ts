import type { Camera } from 'three';
import type { TerrainOptions, FiniteTerrain, TerrainLayer, TerrainExtension } from './index.js';
export interface MiniState {
  version: number;
  recipe: 'procedural' | 'cove' | 'islet' | 'lake';
  seed: number;
  preset: string | null;
  width: number;
  quality: 'balanced' | 'high' | 'capture';
  relief: number;
  waterLevel: number;
  vegetation: number;
  propScale: number;
  clouds: number;
  cloudSpread: number;
  cloudShape: 'circle' | 'square';
  cutStyle: 'strata' | 'soil' | 'dark';
  shape: 'square' | 'circle' | 'hexagon';
  socle: boolean;
  backdrop: number[];
  waterEdges: number;
  waterBevel: number;
  terrainBevel: number;
  bevelSync: boolean;
  bevelStyle: 'rounded' | 'chamfer';
}
export interface MiniFraming {
  theta: number;
  phi: number;
  radius: number;
  target: number[];
  minRadius: number;
  maxRadius: number;
  minPhi: number;
  maxPhi: number;
  panLimit: number;
}
export declare class MiniPresentation implements TerrainLayer {
  constructor(terrain: FiniteTerrain, state: MiniState, options?: { backdrop?: boolean });
  readonly state: MiniState;
  configure(patch: Partial<MiniState>, options?: { signal?: AbortSignal }): Promise<void>;
  prepare(camera: Camera, options?: { signal?: AbortSignal }): Promise<void>;
  beforeRender(): void;
  framing(): MiniFraming;
  serialize(): TerrainExtension;
  getDiagnostics(): Record<string, unknown>;
  dispose(): void;
}
export declare function createMiniTerrain(
  options: TerrainOptions & { mini?: Partial<MiniState>; backdrop?: boolean },
): Promise<FiniteTerrain>;
export declare function createMiniTerrainState(options?: Partial<MiniState>): MiniState;
export declare function normalizeMiniTerrainState(state: Partial<MiniState>): MiniState;
export declare function resolveMiniLayout(state: MiniState): {
  width: number;
  heightScale: number;
  seaLevel: number;
  segments: number;
  [key: string]: unknown;
};
export declare function resolveMiniFraming(
  state: MiniState,
  options?: { fov?: number; aspect?: number },
): MiniFraming;
