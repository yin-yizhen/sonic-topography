import { invoke } from '@tauri-apps/api/core';
import {
  COMMANDS,
  SearchResponse,
  LyricResponse,
  Playlist,
  SystemAudioCaptureResponse,
} from './tauri-types';

export async function searchSongs(
  keywords: string,
  limit?: number,
  preferredSource?: string
): Promise<SearchResponse> {
  return invoke<SearchResponse>(COMMANDS.searchSongs, {
    keywords,
    limit,
    preferred_source: preferredSource,
  });
}

export async function getSongUrl(id: number, source?: string): Promise<string> {
  return invoke<string>(COMMANDS.getSongUrl, { id, source });
}

export async function getLyric(id: number): Promise<LyricResponse> {
  return invoke<LyricResponse>(COMMANDS.getLyric, { id });
}

export async function loadPlaylists(): Promise<Playlist[]> {
  return invoke<Playlist[]>(COMMANDS.loadPlaylists);
}

export async function savePlaylists(playlists: Playlist[]): Promise<Playlist[]> {
  return invoke<Playlist[]>(COMMANDS.savePlaylists, { playlists });
}

export async function startSystemAudioCapture(): Promise<SystemAudioCaptureResponse> {
  return invoke<SystemAudioCaptureResponse>(COMMANDS.startSystemAudioCapture);
}

export async function stopSystemAudioCapture(): Promise<void> {
  return invoke<void>(COMMANDS.stopSystemAudioCapture);
}
