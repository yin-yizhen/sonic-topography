import {
  ACTIVE_CUSTOM_THEME_STORAGE_KEY,
  ACTIVE_THEME_STORAGE_KEY,
  BUILT_IN_THEME_IDS,
  CUSTOM_THEME_ID,
  CUSTOM_THEME_STORAGE_KEY,
  THEME_ROTATION_STORAGE_KEY,
  defaultCustomThemeSettings,
  defaultThemeRotationSettings,
  normalizeCustomThemeSettings,
  normalizeThemeRotationSettings,
  type CustomThemeSettings,
  type ThemeRotationSettings,
} from './themes';
import { GROUND_EQ_STORAGE_KEY, normalizeGroundEqSettings, type StoredGroundEqSettings } from './groundEqSettings';
import { TRIGGER_SETTINGS_STORAGE_KEY, normalizeTriggerConfig, type StoredTriggerSettings } from './triggerSettings';
import { QQ_MUSIC_COOKIE_STORAGE_KEY, normalizeQqMusicCookie } from './qqMusicCookie';

export const PRESET_TRANSFER_VERSION = 1;
export const PLAYLIST_STORAGE_KEY = 'sonic-topography-playlists-v1';

export interface TransferSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  fee: number;
}

export interface TransferPlaylist {
  id: string;
  name: string;
  songs: TransferSong[];
}

export interface PresetTransferPackage {
  app: 'sonic-topography';
  version: number;
  exportedAt: string;
  data: {
    playlists: TransferPlaylist[];
    triggerSettings: StoredTriggerSettings;
    groundEqSettings: StoredGroundEqSettings;
    customThemes: CustomThemeSettings[];
    activeCustomThemeId: string;
    activeThemeId: string;
    themeRotation: ThemeRotationSettings;
    qqMusicCookie?: string;
  };
}

export interface CreatePresetTransferOptions {
  includeQqMusicCookie?: boolean;
}

function readJsonStorage(key: string) {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function normalizeSong(value: any): TransferSong | null {
  const id = String(value?.id || '').trim();
  const name = String(value?.name || '').trim();
  if (!id || !name) return null;

  return {
    id,
    name,
    artist: String(value?.artist || ''),
    album: String(value?.album || ''),
    duration: Number.isFinite(Number(value?.duration)) ? Number(value.duration) : 0,
    fee: Number.isFinite(Number(value?.fee)) ? Number(value.fee) : 0,
  };
}

export function normalizeTransferPlaylists(value: unknown): TransferPlaylist[] {
  if (!Array.isArray(value)) {
    return [{ id: 'favorites', name: 'Favorites', songs: [] }];
  }

  const playlists = value.map((playlist: any, index) => {
    const songs = Array.isArray(playlist?.songs)
      ? playlist.songs.map(normalizeSong).filter(Boolean) as TransferSong[]
      : [];
    return {
      id: String(playlist?.id || `playlist-${Date.now()}-${index}`),
      name: String(playlist?.name || 'Playlist'),
      songs,
    };
  });

  if (!playlists.some((playlist) => playlist.id === 'favorites')) {
    playlists.unshift({ id: 'favorites', name: 'Favorites', songs: [] });
  }

  return playlists;
}

function normalizeActiveThemeId(value: unknown) {
  const themeId = String(value || '');
  return themeId === CUSTOM_THEME_ID || BUILT_IN_THEME_IDS.includes(themeId) ? themeId : 'nocturnal';
}

function normalizeActiveCustomThemeId(value: unknown, customThemes: CustomThemeSettings[]) {
  const presetId = String(value || '');
  return customThemes.some((preset) => preset.id === presetId)
    ? presetId
    : (customThemes[0]?.id || defaultCustomThemeSettings.id);
}

function normalizeTriggerSettings(value: any): StoredTriggerSettings {
  return {
    Pulse: normalizeTriggerConfig(value?.Pulse),
    Meteor: normalizeTriggerConfig(value?.Meteor),
  };
}

export function normalizePresetTransferPackage(value: unknown): PresetTransferPackage {
  const input = value as any;
  if (!input || input.app !== 'sonic-topography' || input.version !== PRESET_TRANSFER_VERSION || !input.data) {
    throw new Error('这个文件不是可用的 Sonic Topography 预设文件');
  }

  const customThemesRaw = Array.isArray(input.data.customThemes) && input.data.customThemes.length > 0
    ? input.data.customThemes
    : [defaultCustomThemeSettings];
  const customThemes = customThemesRaw.map((preset: any) => normalizeCustomThemeSettings(preset));
  const activeCustomThemeId = normalizeActiveCustomThemeId(input.data.activeCustomThemeId, customThemes);
  const availableThemeIds = [...BUILT_IN_THEME_IDS, ...customThemes.map((preset) => preset.id)];

  const normalized: PresetTransferPackage = {
    app: 'sonic-topography',
    version: PRESET_TRANSFER_VERSION,
    exportedAt: String(input.exportedAt || new Date().toISOString()),
    data: {
      playlists: normalizeTransferPlaylists(input.data.playlists),
      triggerSettings: normalizeTriggerSettings(input.data.triggerSettings),
      groundEqSettings: normalizeGroundEqSettings(input.data.groundEqSettings),
      customThemes,
      activeCustomThemeId,
      activeThemeId: normalizeActiveThemeId(input.data.activeThemeId),
      themeRotation: normalizeThemeRotationSettings(input.data.themeRotation || defaultThemeRotationSettings, availableThemeIds),
    },
  };

  const cookie = normalizeQqMusicCookie(input.data.qqMusicCookie);
  if (cookie) normalized.data.qqMusicCookie = cookie;

  return normalized;
}

export function createPresetTransferPackage(options: CreatePresetTransferOptions = {}): PresetTransferPackage {
  const customThemes = (readJsonStorage(CUSTOM_THEME_STORAGE_KEY) as unknown[] | undefined)?.map((preset) => normalizeCustomThemeSettings(preset))
    || [defaultCustomThemeSettings];
  const activeCustomThemeId = normalizeActiveCustomThemeId(
    typeof window === 'undefined' ? '' : window.localStorage.getItem(ACTIVE_CUSTOM_THEME_STORAGE_KEY),
    customThemes,
  );
  const availableThemeIds = [...BUILT_IN_THEME_IDS, ...customThemes.map((preset) => preset.id)];
  const activeThemeId = normalizeActiveThemeId(typeof window === 'undefined' ? '' : window.localStorage.getItem(ACTIVE_THEME_STORAGE_KEY));

  const presetPackage: PresetTransferPackage = {
    app: 'sonic-topography',
    version: PRESET_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      playlists: normalizeTransferPlaylists(readJsonStorage(PLAYLIST_STORAGE_KEY)),
      triggerSettings: normalizeTriggerSettings(readJsonStorage(TRIGGER_SETTINGS_STORAGE_KEY)),
      groundEqSettings: normalizeGroundEqSettings(readJsonStorage(GROUND_EQ_STORAGE_KEY)),
      customThemes,
      activeCustomThemeId,
      activeThemeId,
      themeRotation: normalizeThemeRotationSettings(readJsonStorage(THEME_ROTATION_STORAGE_KEY) || defaultThemeRotationSettings, availableThemeIds),
    },
  };

  if (options.includeQqMusicCookie && typeof window !== 'undefined') {
    const cookie = normalizeQqMusicCookie(window.localStorage.getItem(QQ_MUSIC_COOKIE_STORAGE_KEY));
    if (cookie) presetPackage.data.qqMusicCookie = cookie;
  }

  return normalizePresetTransferPackage(presetPackage);
}

export function writePresetTransferPackage(presetPackage: PresetTransferPackage) {
  if (typeof window === 'undefined') return normalizePresetTransferPackage(presetPackage);

  const normalized = normalizePresetTransferPackage(presetPackage);
  const data = normalized.data;
  window.localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(data.playlists));
  window.localStorage.setItem(TRIGGER_SETTINGS_STORAGE_KEY, JSON.stringify(data.triggerSettings));
  window.localStorage.setItem(GROUND_EQ_STORAGE_KEY, JSON.stringify(data.groundEqSettings));
  window.localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(data.customThemes));
  window.localStorage.setItem(ACTIVE_CUSTOM_THEME_STORAGE_KEY, data.activeCustomThemeId);
  window.localStorage.setItem(ACTIVE_THEME_STORAGE_KEY, data.activeThemeId);
  window.localStorage.setItem(THEME_ROTATION_STORAGE_KEY, JSON.stringify(data.themeRotation));

  if (data.qqMusicCookie) {
    window.localStorage.setItem(QQ_MUSIC_COOKIE_STORAGE_KEY, data.qqMusicCookie);
  } else {
    window.localStorage.removeItem(QQ_MUSIC_COOKIE_STORAGE_KEY);
  }

  return normalized;
}
