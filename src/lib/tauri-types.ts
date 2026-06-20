/**
 * TypeScript contract for Tauri Rust commands in `src-tauri/src/lib.rs`.
 *
 * Use with `invoke` from `@tauri-apps/api/core`:
 *
 *   import { invoke } from '@tauri-apps/api/core';
 *   const result = await invoke<SearchResponse>('search_songs', {
 *     keywords: '晴天',
 *     limit: 12,
 *     preferredSource: 'auto',
 *   });
 */

export interface Song {
  id: number;
  name: string;
  /** Joined artist names, e.g. "Artist A / Artist B". */
  artists: string;
  album: string;
  duration: number;
  picUrl: string | null;
  /** Best/preferred source name for this song. */
  source: string;
  /** All source names that returned this song. */
  sources: string[];
}

export interface SearchResponse {
  songs: Song[];
  source: string;
}

export interface LyricResponse {
  lyric: string;
  translatedLyric: string;
}

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
}

export interface SystemAudioCaptureResponse {
  url: string;
}

// ---------------------------------------------------------------------------
// Command argument types
// ---------------------------------------------------------------------------

export interface SearchSongsArgs {
  keywords: string;
  limit?: number;
  preferred_source?: string;
}

export interface GetSongUrlArgs {
  id: number;
  source?: string;
}

export interface GetLyricArgs {
  id: number;
}

// ---------------------------------------------------------------------------
// Command name constants
// ---------------------------------------------------------------------------

export const COMMANDS = {
  searchSongs: 'search_songs',
  getSongUrl: 'get_song_url',
  getLyric: 'get_lyric',
  loadPlaylists: 'load_playlists',
  savePlaylists: 'save_playlists',
  startSystemAudioCapture: 'start_system_audio_capture',
  stopSystemAudioCapture: 'stop_system_audio_capture',
} as const;

// ---------------------------------------------------------------------------
// Convenience invoke signatures for the frontend adapter
// ---------------------------------------------------------------------------

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

export interface CommandArgsMap {
  [COMMANDS.searchSongs]: SearchSongsArgs;
  [COMMANDS.getSongUrl]: GetSongUrlArgs;
  [COMMANDS.getLyric]: GetLyricArgs;
  [COMMANDS.loadPlaylists]: undefined;
  [COMMANDS.savePlaylists]: Playlist[];
  [COMMANDS.startSystemAudioCapture]: undefined;
  [COMMANDS.stopSystemAudioCapture]: undefined;
}

export interface CommandReturnMap {
  [COMMANDS.searchSongs]: SearchResponse;
  [COMMANDS.getSongUrl]: string;
  [COMMANDS.getLyric]: LyricResponse;
  [COMMANDS.loadPlaylists]: Playlist[];
  [COMMANDS.savePlaylists]: Playlist[];
  [COMMANDS.startSystemAudioCapture]: SystemAudioCaptureResponse;
  [COMMANDS.stopSystemAudioCapture]: void;
}
