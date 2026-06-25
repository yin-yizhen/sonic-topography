export const QQ_MUSIC_COOKIE_STORAGE_KEY = 'sonic-topography-qq-music-cookie-v1';
export const QQ_MUSIC_COOKIE_HEADER = 'X-QQ-Music-Cookie';

export function normalizeQqMusicCookie(value: unknown): string {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;+$/, ''))
    .filter(Boolean)
    .join('; ');
}

export function createQqMusicCookieHeaders(cookie: string): Record<string, string> {
  const normalized = normalizeQqMusicCookie(cookie);
  return normalized ? { [QQ_MUSIC_COOKIE_HEADER]: normalized } : {};
}

export function readQqMusicCookieStorage(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(QQ_MUSIC_COOKIE_STORAGE_KEY) || '';
}

export function writeQqMusicCookieStorage(cookie: string) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeQqMusicCookie(cookie);
  if (normalized) {
    window.localStorage.setItem(QQ_MUSIC_COOKIE_STORAGE_KEY, normalized);
  } else {
    window.localStorage.removeItem(QQ_MUSIC_COOKIE_STORAGE_KEY);
  }
}
