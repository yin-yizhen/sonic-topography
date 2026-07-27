export const GROUND_EQ_STORAGE_KEY = 'sonic-topography-ground-eq-v1';
export const GROUND_EQ_BAND_COUNT = 8;
export const DEFAULT_GROUND_EQ_VALUE = 50;
export const DEFAULT_GROUND_MOTION_SPEED = 50;
export const DEFAULT_GROUND_AMPLITUDE = 50;
export const DEFAULT_TERRAIN_DENSITY = 46;
export const DEFAULT_FLOATING_BLOCKS_ENABLED = true;
export const DEFAULT_FLOATING_BLOCK_INTENSITY = 55;
export const DEFAULT_FLOATING_BLOCK_MIN_SIZE = 9;
export const DEFAULT_FLOATING_BLOCK_MAX_SIZE = 26;
export const DEFAULT_FLOATING_BLOCK_SPEED = 77;
export const DEFAULT_FLOATING_BLOCK_COUNT = 80;
export const TERRAIN_BASE_SIZE = 168;
export const TERRAIN_MIN_GRID_SIZE = 96;
export const TERRAIN_DEFAULT_GRID_SIZE = 160;
export const TERRAIN_MAX_GRID_SIZE = 224;

export type GroundEqBandId =
  | 'subBass'
  | 'bass'
  | 'lowMid'
  | 'mid'
  | 'highMid'
  | 'presence'
  | 'brilliance'
  | 'air';

export interface StoredGroundEqSettings {
  bands: number[];
  motionSpeed: number;
  amplitude?: number;
  terrainDensity?: number;
  floatingBlocksEnabled?: boolean;
  floatingBlockIntensity?: number;
  floatingBlockMinSize?: number;
  floatingBlockMaxSize?: number;
  floatingBlockSpeed?: number;
  floatingBlockCount?: number;
  enabledBands?: boolean[];
}

export const GROUND_EQ_BAND_IDS: GroundEqBandId[] = [
  'subBass',
  'bass',
  'lowMid',
  'mid',
  'highMid',
  'presence',
  'brilliance',
  'air',
];

export const defaultGroundEqBands = [90, 92, 50, 50, 50, 50, 50, 48];

const LEGACY_CURVE_BAND_INDEXES = [0, 2, 4, 6, 8, 11, 12, 15];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBandValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_GROUND_EQ_VALUE;
}

function normalizeMotionSpeed(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_GROUND_MOTION_SPEED;
}

function normalizeAmplitude(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_GROUND_AMPLITUDE;
}

function normalizeTerrainDensity(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_TERRAIN_DENSITY;
}

function normalizeFloatingBlocksEnabled(value: unknown) {
  return typeof value === 'boolean' ? value : DEFAULT_FLOATING_BLOCKS_ENABLED;
}

function normalizeEnabledBands(value: unknown) {
  if (Array.isArray(value) && value.length === GROUND_EQ_BAND_COUNT) {
    return value.map(v => typeof v === 'boolean' ? v : true);
  }
  return new Array(GROUND_EQ_BAND_COUNT).fill(true);
}

function normalizeFloatingBlockIntensity(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_FLOATING_BLOCK_INTENSITY;
}

function normalizeFloatingBlockMinSize(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_FLOATING_BLOCK_MIN_SIZE;
}

function normalizeFloatingBlockMaxSize(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_FLOATING_BLOCK_MAX_SIZE;
}

function normalizeFloatingBlockSpeed(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : DEFAULT_FLOATING_BLOCK_SPEED;
}

function bandsFromLegacyCurve(curve: unknown[]) {
  return LEGACY_CURVE_BAND_INDEXES.map((index) => normalizeBandValue(curve[index]));
}

export function normalizeGroundEqSettings(value: Partial<StoredGroundEqSettings> & { curve?: unknown[] } | null | undefined): StoredGroundEqSettings {
  const source = Array.isArray(value?.bands)
    ? value.bands
    : (Array.isArray(value?.curve) ? bandsFromLegacyCurve(value.curve) : defaultGroundEqBands);
  const bands = Array.from({ length: GROUND_EQ_BAND_COUNT }, (_, index) => normalizeBandValue(source[index]));
  return { 
    bands, 
    motionSpeed: normalizeMotionSpeed(value?.motionSpeed),
    amplitude: normalizeAmplitude(value?.amplitude),
    terrainDensity: normalizeTerrainDensity(value?.terrainDensity),
    floatingBlocksEnabled: normalizeFloatingBlocksEnabled(value?.floatingBlocksEnabled),
    floatingBlockIntensity: normalizeFloatingBlockIntensity(value?.floatingBlockIntensity),
    floatingBlockMinSize: normalizeFloatingBlockMinSize(value?.floatingBlockMinSize),
    floatingBlockMaxSize: normalizeFloatingBlockMaxSize(value?.floatingBlockMaxSize),
    floatingBlockSpeed: normalizeFloatingBlockSpeed(value?.floatingBlockSpeed),
    enabledBands: normalizeEnabledBands(value?.enabledBands),
  };
}

export function readGroundEqSettingsStorage(): StoredGroundEqSettings {
  if (typeof window === 'undefined') {
    return {
      bands: defaultGroundEqBands,
      motionSpeed: DEFAULT_GROUND_MOTION_SPEED,
      amplitude: DEFAULT_GROUND_AMPLITUDE,
      terrainDensity: DEFAULT_TERRAIN_DENSITY,
      floatingBlocksEnabled: DEFAULT_FLOATING_BLOCKS_ENABLED,
      floatingBlockIntensity: DEFAULT_FLOATING_BLOCK_INTENSITY,
      floatingBlockMinSize: DEFAULT_FLOATING_BLOCK_MIN_SIZE,
      floatingBlockMaxSize: DEFAULT_FLOATING_BLOCK_MAX_SIZE,
      floatingBlockSpeed: DEFAULT_FLOATING_BLOCK_SPEED,
      enabledBands: new Array(GROUND_EQ_BAND_COUNT).fill(true),
    };
  }

  try {
    const raw = window.localStorage.getItem(GROUND_EQ_STORAGE_KEY);
    return normalizeGroundEqSettings(raw ? JSON.parse(raw) : undefined);
  } catch (error) {
    console.warn('Unable to read ground EQ settings:', error);
    return {
      bands: defaultGroundEqBands,
      motionSpeed: DEFAULT_GROUND_MOTION_SPEED,
      amplitude: DEFAULT_GROUND_AMPLITUDE,
      terrainDensity: DEFAULT_TERRAIN_DENSITY,
      floatingBlocksEnabled: DEFAULT_FLOATING_BLOCKS_ENABLED,
      floatingBlockIntensity: DEFAULT_FLOATING_BLOCK_INTENSITY,
      floatingBlockMinSize: DEFAULT_FLOATING_BLOCK_MIN_SIZE,
      floatingBlockMaxSize: DEFAULT_FLOATING_BLOCK_MAX_SIZE,
      floatingBlockSpeed: DEFAULT_FLOATING_BLOCK_SPEED,
      enabledBands: new Array(GROUND_EQ_BAND_COUNT).fill(true),
    };
  }
}

export function writeGroundEqSettingsStorage(settings: StoredGroundEqSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GROUND_EQ_STORAGE_KEY, JSON.stringify(normalizeGroundEqSettings(settings)));
}

export function readGroundEqBandValue(bands: number[], band: GroundEqBandId) {
  const normalized = normalizeGroundEqSettings({ bands }).bands;
  const index = GROUND_EQ_BAND_IDS.indexOf(band);
  return normalized[index >= 0 ? index : 0];
}

export function applyGroundEqBandValue(value: number, bands: number[], band: GroundEqBandId) {
  const eq = readGroundEqBandValue(bands, band);
  const delta = (eq - DEFAULT_GROUND_EQ_VALUE) / DEFAULT_GROUND_EQ_VALUE;

  if (delta >= 0) {
    return clamp(value * (1 + delta * 1.8), 0, 1);
  }

  const dullness = Math.abs(delta);
  return clamp(Math.max(0, value - dullness * 0.35) * (1 - dullness * 0.35), 0, 1);
}

export function deriveTerrainGridSettings(terrainDensity: unknown) {
  const density = normalizeTerrainDensity(terrainDensity);
  const gridSize = Math.round(TERRAIN_MIN_GRID_SIZE + ((TERRAIN_MAX_GRID_SIZE - TERRAIN_MIN_GRID_SIZE) * density) / 100);
  const spacing = TERRAIN_BASE_SIZE / gridSize;
  return {
    density,
    gridSize,
    spacing,
    // Pillars fill their whole cell. A narrower box leaves a gap between pillars,
    // and since nothing closes the terrain from below, a grazing ray that lines up
    // with a grid axis slips down that gap, exits beneath the terrain and paints the
    // page backdrop as a hard line converging on the vanishing point. The per-cell
    // grid look survives either way: it comes from the top-face edge glow in the
    // terrain shader, not from the physical gap.
    boxWidth: spacing,
    instanceCount: gridSize * gridSize,
    terrainSize: TERRAIN_BASE_SIZE,
  };
}
