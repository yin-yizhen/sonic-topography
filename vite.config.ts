import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'path';
import { defineConfig } from 'vite';
import { QQ_MUSIC_COOKIE_HEADER, normalizeQqMusicCookie } from './src/lib/qqMusicCookie';

const qqMusicHeaders = {
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
  Connection: 'close',
};

const playableUrlCache = new Map<string, { url: string | null; expiresAt: number }>();
const searchCache = new Map<string, { payload: { songs: QqMusicSong[]; rawCount: number; filteredCount: number }; expiresAt: number }>();
const playableUrlCacheTtl = 1000 * 60 * 10;
const searchCacheTtl = 1000 * 60 * 5;
const dataDir = path.resolve(__dirname, 'data');
const playlistsPath = path.join(dataDir, 'playlists.json');
let browserQqMusicCookie = '';

interface QqMusicSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  fee: number;
}

interface QqMusicPlaylistSummary {
  id: string;
  name: string;
  count: number;
  cover: string;
}

function writeJson(res: any, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function createDefaultPlaylists() {
  return [
    { id: 'favorites', name: 'Favorites', songs: [] },
    { id: 'visual-set', name: 'Visual Set', songs: [] },
  ];
}

function normalizePlaylists(value: any) {
  if (!Array.isArray(value) || value.length === 0) return createDefaultPlaylists();
  return value.map((playlist: any) => ({
    id: String(playlist.id || `playlist-${Date.now()}`),
    name: String(playlist.name || 'Playlist'),
    songs: Array.isArray(playlist.songs) ? playlist.songs : [],
  }));
}

async function readPlaylistsFile() {
  try {
    const raw = await fs.readFile(playlistsPath, 'utf8');
    return normalizePlaylists(JSON.parse(raw));
  } catch (error) {
    return createDefaultPlaylists();
  }
}

async function writePlaylistsFile(playlists: any) {
  await fs.mkdir(dataDir, { recursive: true });
  const normalized = normalizePlaylists(playlists);
  await fs.writeFile(playlistsPath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function readRequestBody(req: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url: string | URL, options: RequestInit = {}, retries = 2) {
  let lastData: any = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, options);
    const text = await response.text();
    lastData = parseJsonLike(text);
    if (response.ok && lastData?.code !== 400) return lastData;
    if (attempt < retries) await wait(180 * (attempt + 1));
  }
  return lastData || {};
}

function parseJsonLike(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const jsonp = trimmed.match(/^[\w$.]+\((.*)\);?$/s);
    if (jsonp) return JSON.parse(jsonp[1]);
    throw error;
  }
}

function readQqMusicCookie(req: any) {
  const raw = req.headers?.[QQ_MUSIC_COOKIE_HEADER.toLowerCase()];
  const headerCookie = Array.isArray(raw) ? raw[0] : String(raw || '');
  return normalizeQqMusicCookie(headerCookie || browserQqMusicCookie);
}

function createQqMusicHeaders(cookie: string, extraHeaders: Record<string, string> = {}) {
  const normalizedCookie = normalizeQqMusicCookie(cookie);
  return {
    ...qqMusicHeaders,
    ...(normalizedCookie ? { Cookie: normalizedCookie } : {}),
    ...extraHeaders,
  };
}

function pickQqSip(value: unknown) {
  const sip = Array.isArray(value) ? value.find((item) => typeof item === 'string' && item.startsWith('http')) : '';
  return sip || 'https://isure.stream.qqmusic.qq.com/';
}

function parseQqMusicCookie(cookie: string) {
  const entries = new Map<string, string>();
  String(cookie || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (key) entries.set(key, value);
  });
  return entries;
}

function normalizeQqUin(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || '0';
}

function extractUinFromCookie(cookie: string) {
  const entries = parseQqMusicCookie(cookie);
  return normalizeQqUin(entries.get('uin') || entries.get('qqmusic_uin') || entries.get('o_cookie') || entries.get('luin'));
}

function calculateQqGTK(seed: string) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash += (hash << 5) + seed.charCodeAt(i);
  }
  return String(hash & 0x7fffffff);
}

function getQqMusicAuth(cookie: string) {
  const normalizedCookie = normalizeQqMusicCookie(cookie);
  const entries = parseQqMusicCookie(normalizedCookie);
  const uin = extractUinFromCookie(normalizedCookie);
  const gtkSeed = entries.get('p_skey') || entries.get('skey') || '';
  const hasAuthToken = ['qqmusic_key', 'qm_keyst', 'music_key', 'p_skey', 'skey'].some((key) => Boolean(entries.get(key)));
  return {
    cookie: normalizedCookie,
    uin,
    gtk: gtkSeed ? calculateQqGTK(gtkSeed) : '5381',
    hasAuthToken,
    hasLoginIdentity: normalizedCookie !== '' && uin !== '0' && hasAuthToken,
  };
}

async function validateQqMusicCookie(cookie: string) {
  const auth = getQqMusicAuth(cookie);
  if (!auth.cookie) {
    return { hasCookie: false, valid: false, uin: '0', reason: 'empty-cookie' };
  }
  if (auth.uin === '0') {
    return { hasCookie: true, valid: false, uin: '0', reason: 'missing-uin' };
  }
  if (!auth.hasAuthToken) {
    return { hasCookie: true, valid: false, uin: auth.uin, reason: 'missing-login-token' };
  }

  const data = {
    comm: { uin: auth.uin, format: 'json', ct: '19', cv: '1859' },
    req: {
      module: 'music.UserInfo.userInfoServer',
      method: 'GetLoginUserInfo',
      param: {},
    },
  };
  const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
  url.searchParams.set('data', JSON.stringify(data));

  try {
    const response = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(auth.cookie) }, 1);
    const code = Number(response?.req?.code ?? response?.code ?? -1);
    return {
      hasCookie: true,
      valid: code === 0,
      uin: auth.uin,
      reason: code === 0 ? 'ok' : 'login-check-failed',
      upstreamCode: code,
    };
  } catch (error) {
    return { hasCookie: true, valid: false, uin: auth.uin, reason: 'login-check-error' };
  }
}

async function getQqMusicPlayableUrl(id: string, cookie: string) {
  const auth = getQqMusicAuth(cookie);
  const normalizedCookie = auth.cookie;
  const uin = auth.uin;
  const cacheKey = `${id}::${normalizedCookie}`;
  const cached = playableUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const data = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid: String(Math.floor(1000000000 + Math.random() * 9000000000)),
        songmid: [id],
        songtype: [0],
        uin,
        loginflag: 1,
        platform: '20',
      },
    },
    comm: { uin, format: 'json', ct: '19', cv: '1859' },
  };
  const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
  url.searchParams.set('data', JSON.stringify(data));

  const response = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(normalizedCookie) });
  const vkeyData = response?.req_0?.data || {};
  const info = vkeyData?.midurlinfo?.[0] || {};
  const purl = String(info?.purl || '');
  const playableUrl = purl ? (purl.startsWith('http') ? purl : `${pickQqSip(vkeyData.sip)}${purl}`) : null;
  playableUrlCache.set(cacheKey, { url: playableUrl, expiresAt: Date.now() + playableUrlCacheTtl });
  return playableUrl;
}

function mapQqMusicSong(song: any): QqMusicSong | null {
  const id = String(song?.mid || song?.songmid || song?.songMid || song?.file?.media_mid || '').trim();
  const name = String(song?.title || song?.name || song?.songname || '').trim();
  if (!id || !name) return null;

  const singers = song?.singer || song?.singers || [];
  const artist = Array.isArray(singers)
    ? singers.map((artist: any) => artist?.name).filter(Boolean).join(' / ')
    : '';
  const album = song?.album || {};
  const durationSeconds = Number(song?.interval || song?.duration || 0);
  const pay = song?.pay || {};

  return {
    id,
    name,
    artist,
    album: String(album?.name || album?.title || song?.albumname || ''),
    duration: Number.isFinite(durationSeconds) ? durationSeconds * 1000 : 0,
    fee: (pay?.pay_play || pay?.payplay) ? 1 : 0,
  };
}

async function fetchQqMusicSearchSongs(keywords: string, resultLimit: number, cookie: string) {
  const data = {
    comm: { ct: '19', cv: '1859', uin: getQqMusicAuth(cookie).uin, format: 'json' },
    req: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: {
        num_per_page: Math.min(resultLimit * 2, 60),
        page_num: 1,
        query: keywords,
        search_type: 0,
      },
    },
  };
  const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
  url.searchParams.set('data', JSON.stringify(data));

  const response = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(cookie) });
  return response?.req?.data?.body?.song?.list || [];
}
async function filterPlayableSongs(rawSongs: QqMusicSong[], resultLimit: number, cookie: string) {
  const playableSongs: QqMusicSong[] = [];
  const batchSize = 6;

  for (let i = 0; i < rawSongs.length && playableSongs.length < resultLimit; i += batchSize) {
    const batch = rawSongs.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (song) => ({
      song,
      playableUrl: await getQqMusicPlayableUrl(song.id, cookie),
    })));

    for (const result of results) {
      if (result.playableUrl) playableSongs.push(result.song);
      if (playableSongs.length >= resultLimit) break;
    }
  }

  return playableSongs;
}

function decodeMaybeBase64(value: unknown) {
  const text = String(value || '');
  if (!text) return '';
  if (text.includes('[')) return text;
  try {
    return Buffer.from(text, 'base64').toString('utf8');
  } catch (error) {
    return text;
  }
}

function clampQqLimit(value: unknown, fallback = 50) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : fallback;
}

async function ensureQqMusicLogin(cookie: string) {
  const result = await validateQqMusicCookie(cookie);
  if (!result.valid) {
    const error = new Error('QQ Music cookie is not valid');
    (error as any).status = 401;
    (error as any).payload = { error: 'QQ Music cookie is not valid', ...result };
    throw error;
  }
  return getQqMusicAuth(cookie);
}

function mapQqMusicPlaylist(playlist: any): QqMusicPlaylistSummary | null {
  const id = String(playlist?.disstid || playlist?.tid || playlist?.dissid || playlist?.id || playlist?.dirid || '').trim();
  const name = String(playlist?.dissname || playlist?.diss_name || playlist?.title || playlist?.name || playlist?.dirname || '').trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    count: Number(playlist?.song_cnt || playlist?.songnum || playlist?.total_song_num || playlist?.song_count || playlist?.count || 0),
    cover: String(playlist?.logo || playlist?.diss_cover || playlist?.cover || playlist?.picurl || playlist?.dir_pic_url2 || ''),
  };
}

function uniquePlaylists(playlists: QqMusicPlaylistSummary[]) {
  const seen = new Set();
  return playlists.filter((playlist) => {
    if (!playlist || seen.has(playlist.id)) return false;
    seen.add(playlist.id);
    return true;
  });
}

async function fetchQqMusicCreatedPlaylists(cookie: string, limit: number) {
  const auth = getQqMusicAuth(cookie);
  const url = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss');
  url.searchParams.set('hostuin', auth.uin);
  url.searchParams.set('sin', '0');
  url.searchParams.set('size', String(limit));
  url.searchParams.set('format', 'json');
  url.searchParams.set('g_tk', auth.gtk);
  url.searchParams.set('loginUin', auth.uin);
  url.searchParams.set('hostUin', auth.uin);
  url.searchParams.set('platform', 'yqq.json');
  url.searchParams.set('needNewCode', '0');
  const data = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(cookie) });
  const list = data?.data?.disslist || data?.disslist || data?.data?.list || [];
  return Array.isArray(list) ? list.map(mapQqMusicPlaylist).filter(Boolean) : [];
}

async function fetchQqMusicFavoritePlaylists(cookie: string, limit: number) {
  const auth = getQqMusicAuth(cookie);
  const url = new URL('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg');
  url.searchParams.set('ct', '20');
  url.searchParams.set('cid', '205360956');
  url.searchParams.set('userid', auth.uin);
  url.searchParams.set('reqtype', '3');
  url.searchParams.set('sin', '0');
  url.searchParams.set('ein', String(Math.max(0, limit - 1)));
  url.searchParams.set('format', 'json');
  url.searchParams.set('g_tk', auth.gtk);
  url.searchParams.set('loginUin', auth.uin);
  url.searchParams.set('hostUin', auth.uin);
  url.searchParams.set('platform', 'yqq.json');
  url.searchParams.set('needNewCode', '0');
  const data = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(cookie) });
  const list = data?.data?.cdlist || data?.data?.list || data?.data?.v_list || data?.cdlist || data?.list || [];
  return Array.isArray(list) ? list.map(mapQqMusicPlaylist).filter(Boolean) : [];
}

async function fetchQqMusicPlaylists(cookie: string, limit: number) {
  await ensureQqMusicLogin(cookie);
  const [created, favorites] = await Promise.all([
    fetchQqMusicCreatedPlaylists(cookie, limit),
    fetchQqMusicFavoritePlaylists(cookie, limit),
  ]);
  return uniquePlaylists([...created, ...favorites]).slice(0, limit);
}

async function fetchQqMusicPlaylistSongs(id: string, cookie: string, limit: number) {
  const auth = getQqMusicAuth(cookie);
  const url = new URL('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg');
  url.searchParams.set('type', '1');
  url.searchParams.set('json', '1');
  url.searchParams.set('utf8', '1');
  url.searchParams.set('onlysong', '0');
  url.searchParams.set('disstid', id);
  url.searchParams.set('format', 'json');
  url.searchParams.set('g_tk', auth.gtk);
  url.searchParams.set('loginUin', auth.uin);
  url.searchParams.set('hostUin', auth.uin);
  url.searchParams.set('platform', 'yqq.json');
  url.searchParams.set('needNewCode', '0');
  const data = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(cookie) });
  const cd = Array.isArray(data?.cdlist) ? data.cdlist[0] : null;
  const list = Array.isArray(cd?.songlist) ? cd.songlist : [];
  return list.map(mapQqMusicSong).filter(Boolean).slice(0, limit);
}

async function fetchQqMusicFavoriteSongs(cookie: string, limit: number) {
  const auth = getQqMusicAuth(cookie);
  const collected = [];
  for (const reqtype of ['0', '1', '2']) {
    const url = new URL('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg');
    url.searchParams.set('ct', '20');
    url.searchParams.set('cid', '205360956');
    url.searchParams.set('userid', auth.uin);
    url.searchParams.set('reqtype', reqtype);
    url.searchParams.set('sin', '0');
    url.searchParams.set('ein', String(Math.max(0, limit - 1)));
    url.searchParams.set('format', 'json');
    url.searchParams.set('g_tk', auth.gtk);
    url.searchParams.set('loginUin', auth.uin);
    url.searchParams.set('hostUin', auth.uin);
    url.searchParams.set('platform', 'yqq.json');
    url.searchParams.set('needNewCode', '0');
    const data = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(cookie) });
    const list = data?.data?.list || data?.data?.songlist || data?.list || [];
    if (Array.isArray(list)) {
      collected.push(...list.map((item) => item?.song || item?.musicData || item).map(mapQqMusicSong).filter(Boolean));
    }
    if (collected.length > 0) break;
  }
  return collected.slice(0, limit);
}

async function fetchQqMusicLikedSongs(cookie: string, limit: number) {
  await ensureQqMusicLogin(cookie);
  const directSongs = await fetchQqMusicFavoriteSongs(cookie, limit);
  if (directSongs.length > 0) return directSongs;

  const playlists = await fetchQqMusicPlaylists(cookie, 100);
  const likedPlaylist = playlists.find((playlist) => ['\u6211\u559c\u6b22', '\u559c\u6b61', 'liked', 'favorite', 'love'].some((token) => playlist.name.toLowerCase().includes(token.toLowerCase())));
  return likedPlaylist ? fetchQqMusicPlaylistSongs(likedPlaylist.id, cookie, limit) : [];
}

function collectRecommendPlaylistIds(value: any, output: string[] = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecommendPlaylistIds(item, output));
    return output;
  }
  if (typeof value !== 'object') return output;
  const id = String(value.id || value.disstid || '').trim();
  const jumpType = Number(value.jumptype || 0);
  const type = Number(value.type || 0);
  if (id && (jumpType === 10014 || type === 500) && !output.includes(id)) output.push(id);
  Object.values(value).forEach((item) => collectRecommendPlaylistIds(item, output));
  return output;
}

async function fetchQqMusicDailyRecommendations(cookie: string, limit: number) {
  await ensureQqMusicLogin(cookie);
  const auth = getQqMusicAuth(cookie);
  const data = {
    comm: { ct: '19', cv: '1859', uin: auth.uin, format: 'json' },
    req: {
      module: 'music.recommend.RecommendFeed',
      method: 'get_recommend_feed',
      param: { page: 1, direction: 0, last_id: '0' },
    },
  };
  const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
  url.searchParams.set('data', JSON.stringify(data));
  const response = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(cookie) });
  const playlistIds = collectRecommendPlaylistIds(response?.req?.data).slice(0, 8);
  for (const playlistId of playlistIds) {
    const songs = await fetchQqMusicPlaylistSongs(playlistId, cookie, limit);
    if (songs.length > 0) return songs;
  }
  return [];
}

async function getQqMusicLyric(id: string, cookie: string) {
  const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
  url.searchParams.set('songmid', id);
  url.searchParams.set('pcachetime', String(Date.now()));
  const auth = getQqMusicAuth(cookie);
  url.searchParams.set('g_tk', auth.gtk);
  url.searchParams.set('loginUin', auth.uin);
  url.searchParams.set('hostUin', auth.uin);
  url.searchParams.set('format', 'json');
  url.searchParams.set('inCharset', 'utf8');
  url.searchParams.set('outCharset', 'utf-8');
  url.searchParams.set('notice', '0');
  url.searchParams.set('platform', 'yqq.json');
  url.searchParams.set('needNewCode', '0');
  url.searchParams.set('nobase64', '1');

  const data = await fetchJsonWithRetry(url, { headers: createQqMusicHeaders(cookie) });
  return {
    lyric: decodeMaybeBase64(data?.lyric),
    translatedLyric: decodeMaybeBase64(data?.trans),
  };
}

function qqMusicApiPlugin() {
  return {
    name: 'qqmusic-api-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/playlists', async (req: any, res: any, next: any) => {
        try {
          if (req.method === 'GET') {
            writeJson(res, 200, { playlists: await readPlaylistsFile() });
            return;
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req);
            const parsed = body ? JSON.parse(body) : {};
            const playlists = await writePlaylistsFile(parsed.playlists);
            writeJson(res, 200, { playlists });
            return;
          }
        } catch (error) {
          writeJson(res, 500, { error: 'Unable to save playlists' });
          return;
        }

        next();
      });

      server.middlewares.use('/api/qqmusic/cookie', async (req: any, res: any, next: any) => {
        try {
          if (req.method === 'GET') {
            writeJson(res, 200, await validateQqMusicCookie(browserQqMusicCookie));
            return;
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req);
            const parsed = body ? JSON.parse(body) : {};
            browserQqMusicCookie = normalizeQqMusicCookie(parsed.cookie);
            playableUrlCache.clear();
            searchCache.clear();
            writeJson(res, 200, await validateQqMusicCookie(browserQqMusicCookie));
            return;
          }
        } catch (error) {
          writeJson(res, 500, { error: 'Unable to save QQ Music cookie' });
          return;
        }

        next();
      });

      const writeQqMusicError = (res: any, error: any, fallbackMessage: string) => {
        writeJson(res, Number(error?.status || 500), error?.payload || { error: fallbackMessage });
      };

      server.middlewares.use('/api/qqmusic/daily-recommend', async (req: any, res: any) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const cookie = readQqMusicCookie(req);
          const limit = clampQqLimit(requestUrl.searchParams.get('limit'), 50);
          writeJson(res, 200, { songs: await fetchQqMusicDailyRecommendations(cookie, limit) });
        } catch (error) {
          writeQqMusicError(res, error, 'QQ Music daily recommendations failed');
        }
      });

      server.middlewares.use('/api/qqmusic/liked', async (req: any, res: any) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const cookie = readQqMusicCookie(req);
          const limit = clampQqLimit(requestUrl.searchParams.get('limit'), 50);
          writeJson(res, 200, { songs: await fetchQqMusicLikedSongs(cookie, limit) });
        } catch (error) {
          writeQqMusicError(res, error, 'QQ Music liked songs failed');
        }
      });

      server.middlewares.use('/api/qqmusic/playlists', async (req: any, res: any) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const cookie = readQqMusicCookie(req);
          const limit = clampQqLimit(requestUrl.searchParams.get('limit'), 80);
          writeJson(res, 200, { playlists: await fetchQqMusicPlaylists(cookie, limit) });
        } catch (error) {
          writeQqMusicError(res, error, 'QQ Music playlists failed');
        }
      });

      server.middlewares.use('/api/qqmusic/playlist', async (req: any, res: any) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const id = requestUrl.searchParams.get('id')?.trim();
          if (!id) {
            writeJson(res, 400, { error: 'Missing id' });
            return;
          }
          const cookie = readQqMusicCookie(req);
          await ensureQqMusicLogin(cookie);
          const limit = clampQqLimit(requestUrl.searchParams.get('limit'), 50);
          writeJson(res, 200, { songs: await fetchQqMusicPlaylistSongs(id, cookie, limit) });
        } catch (error) {
          writeQqMusicError(res, error, 'QQ Music playlist songs failed');
        }
      });

      server.middlewares.use('/api/qqmusic/search', async (req: any, res: any) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const keywords = requestUrl.searchParams.get('keywords')?.trim();
          const requestedLimit = Number(requestUrl.searchParams.get('limit') || '30');
          const resultLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 40)) : 30;
          const cookie = readQqMusicCookie(req);
          const includeDebug = requestUrl.searchParams.get('debug') === '1';

          if (!keywords) {
            writeJson(res, 400, { error: 'Missing keywords' });
            return;
          }

          const cacheKey = `${keywords.toLowerCase()}::${resultLimit}::${normalizeQqMusicCookie(cookie)}`;
          const cached = searchCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            writeJson(res, 200, { ...cached.payload, cached: true });
            return;
          }

          const raw = await fetchQqMusicSearchSongs(keywords, resultLimit, cookie);
          const rawSongs = raw.map(mapQqMusicSong).filter(Boolean) as QqMusicSong[];
          const songs = rawSongs.slice(0, resultLimit);
          const payload = { songs, rawCount: rawSongs.length, filteredCount: songs.length };
          if (rawSongs.length > 0 || songs.length > 0) {
            searchCache.set(cacheKey, { payload, expiresAt: Date.now() + searchCacheTtl });
          }

          writeJson(res, 200, includeDebug ? { ...payload, debug: { rawCount: rawSongs.length } } : payload);
        } catch (error) {
          writeJson(res, 500, { error: 'QQ Music search failed' });
        }
      });

      server.middlewares.use('/api/qqmusic/lyric', async (req: any, res: any) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const id = requestUrl.searchParams.get('id');
          const cookie = readQqMusicCookie(req);

          if (!id) {
            writeJson(res, 400, { error: 'Missing id' });
            return;
          }

          writeJson(res, 200, await getQqMusicLyric(id, cookie));
        } catch (error) {
          writeJson(res, 500, { error: 'QQ Music lyric failed' });
        }
      });

      server.middlewares.use('/api/qqmusic/url', async (req: any, res: any) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const id = requestUrl.searchParams.get('id');
          const cookie = readQqMusicCookie(req);

          if (!id) {
            writeJson(res, 400, { error: 'Missing id' });
            return;
          }

          writeJson(res, 200, { url: await getQqMusicPlayableUrl(id, cookie) });
        } catch (error) {
          writeJson(res, 500, { error: 'QQ Music url failed' });
        }
      });

      server.middlewares.use('/api/qqmusic/audio', async (req: any, res: any) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const id = requestUrl.searchParams.get('id');
          const cookie = readQqMusicCookie(req);

          if (!id) {
            writeJson(res, 400, { error: 'Missing id' });
            return;
          }

          const playableUrl = await getQqMusicPlayableUrl(id, cookie);
          if (!playableUrl) {
            writeJson(res, 404, { error: 'No playable url for this song' });
            return;
          }

          const headers: Record<string, string> = createQqMusicHeaders(cookie);
          if (req.headers.range) headers.Range = req.headers.range;

          const audioResponse = await fetch(playableUrl, { headers });
          res.statusCode = audioResponse.status;
          ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((header) => {
            const value = audioResponse.headers.get(header);
            if (value) res.setHeader(header, value);
          });

          if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'audio/mpeg');
          if (audioResponse.body) {
            const reader = audioResponse.body.getReader();
            const pump = async () => {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                return;
              }
              res.write(Buffer.from(value), pump);
            };
            pump();
          } else {
            res.end();
          }
        } catch (error) {
          writeJson(res, 500, { error: 'QQ Music audio proxy failed' });
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), qqMusicApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
