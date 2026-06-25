import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 4173);
const dataDir = path.join(__dirname, 'data');
const playlistsPath = path.join(dataDir, 'playlists.json');

const qqMusicHeaders = {
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
  Connection: 'close',
};
const qqMusicCookieHeader = 'x-qq-music-cookie';

const playableUrlCache = new Map();
const searchCache = new Map();
const playableUrlCacheTtl = 1000 * 60 * 10;
const searchCacheTtl = 1000 * 60 * 5;
let browserQqMusicCookie = '';

function normalizeQqMusicCookie(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;+$/, ''))
    .filter(Boolean)
    .join('; ');
}

function readQqMusicCookie(req) {
  const raw = req.headers?.[qqMusicCookieHeader];
  const headerCookie = Array.isArray(raw) ? raw[0] : String(raw || '');
  return normalizeQqMusicCookie(headerCookie || browserQqMusicCookie);
}

function createQqMusicHeaders(cookie, extraHeaders = {}) {
  const normalizedCookie = normalizeQqMusicCookie(cookie);
  return {
    ...qqMusicHeaders,
    ...(normalizedCookie ? { Cookie: normalizedCookie } : {}),
    ...extraHeaders,
  };
}

function parseQqMusicCookie(cookie) {
  const entries = new Map();
  String(cookie || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (key) entries.set(key, value);
  });
  return entries;
}

function normalizeQqUin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || '0';
}

function extractUinFromCookie(cookie) {
  const entries = parseQqMusicCookie(cookie);
  return normalizeQqUin(entries.get('uin') || entries.get('qqmusic_uin') || entries.get('o_cookie') || entries.get('luin'));
}

function calculateQqGTK(seed) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash += (hash << 5) + seed.charCodeAt(i);
  }
  return String(hash & 0x7fffffff);
}

function getQqMusicAuth(cookie) {
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

async function validateQqMusicCookie(cookie) {
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonLike(text) {
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

async function fetchJsonWithRetry(url, options = {}, retries = 2) {
  let lastData = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, options);
    const text = await response.text();
    lastData = parseJsonLike(text);
    if (response.ok && lastData?.code !== 400) return lastData;
    if (attempt < retries) await wait(180 * (attempt + 1));
  }
  return lastData || {};
}

function pickQqSip(value) {
  const sip = Array.isArray(value) ? value.find((item) => typeof item === 'string' && item.startsWith('http')) : '';
  return sip || 'https://isure.stream.qqmusic.qq.com/';
}

async function getQqMusicPlayableUrl(id, cookie = '', debug = false) {
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
  if (debug) return response;
  const vkeyData = response?.req_0?.data || {};
  const info = vkeyData?.midurlinfo?.[0] || {};
  const purl = String(info?.purl || '');
  const playableUrl = purl ? (purl.startsWith('http') ? purl : `${pickQqSip(vkeyData.sip)}${purl}`) : null;
  playableUrlCache.set(cacheKey, { url: playableUrl, expiresAt: Date.now() + playableUrlCacheTtl });
  return playableUrl;
}

function mapQqMusicSong(song) {
  const id = String(song?.mid || song?.songmid || song?.songMid || song?.file?.media_mid || '').trim();
  const name = String(song?.title || song?.name || song?.songname || '').trim();
  if (!id || !name) return null;

  const singers = song?.singer || song?.singers || [];
  const artist = Array.isArray(singers)
    ? singers.map((artist) => artist?.name).filter(Boolean).join(' / ')
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

async function fetchQqMusicSearchSongs(keywords, resultLimit, cookie) {
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
async function filterPlayableSongs(rawSongs, resultLimit, cookie) {
  const playableSongs = [];
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

function decodeMaybeBase64(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.includes('[')) return text;
  try {
    return Buffer.from(text, 'base64').toString('utf8');
  } catch (error) {
    return text;
  }
}

function clampQqLimit(value, fallback = 50) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : fallback;
}

async function ensureQqMusicLogin(cookie) {
  const result = await validateQqMusicCookie(cookie);
  if (!result.valid) {
    const error = new Error('QQ Music cookie is not valid');
    error.status = 401;
    error.payload = { error: 'QQ Music cookie is not valid', ...result };
    throw error;
  }
  return getQqMusicAuth(cookie);
}

function mapQqMusicPlaylist(playlist) {
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

function uniquePlaylists(playlists) {
  const seen = new Set();
  return playlists.filter((playlist) => {
    if (!playlist || seen.has(playlist.id)) return false;
    seen.add(playlist.id);
    return true;
  });
}

async function fetchQqMusicCreatedPlaylists(cookie, limit) {
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

async function fetchQqMusicFavoritePlaylists(cookie, limit) {
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

async function fetchQqMusicPlaylists(cookie, limit) {
  await ensureQqMusicLogin(cookie);
  const [created, favorites] = await Promise.all([
    fetchQqMusicCreatedPlaylists(cookie, limit),
    fetchQqMusicFavoritePlaylists(cookie, limit),
  ]);
  return uniquePlaylists([...created, ...favorites]).slice(0, limit);
}

async function fetchQqMusicPlaylistSongs(id, cookie, limit) {
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

async function fetchQqMusicFavoriteSongs(cookie, limit) {
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

async function fetchQqMusicLikedSongs(cookie, limit) {
  await ensureQqMusicLogin(cookie);
  const directSongs = await fetchQqMusicFavoriteSongs(cookie, limit);
  if (directSongs.length > 0) return directSongs;

  const playlists = await fetchQqMusicPlaylists(cookie, 100);
  const likedPlaylist = playlists.find((playlist) => ['\u6211\u559c\u6b22', '\u559c\u6b61', 'liked', 'favorite', 'love'].some((token) => playlist.name.toLowerCase().includes(token.toLowerCase())));
  return likedPlaylist ? fetchQqMusicPlaylistSongs(likedPlaylist.id, cookie, limit) : [];
}

function collectRecommendPlaylistIds(value, output = []) {
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

async function fetchQqMusicDailyRecommendations(cookie, limit) {
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

async function getQqMusicLyric(id, cookie) {
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

const app = express();
app.use(express.json({ limit: '1mb' }));

function createDefaultPlaylists() {
  return [
    { id: 'favorites', name: 'Favorites', songs: [] },
    { id: 'visual-set', name: 'Visual Set', songs: [] },
  ];
}

function normalizePlaylists(value) {
  if (!Array.isArray(value) || value.length === 0) return createDefaultPlaylists();
  return value.map((playlist) => ({
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

async function writePlaylistsFile(playlists) {
  await fs.mkdir(dataDir, { recursive: true });
  const normalized = normalizePlaylists(playlists);
  await fs.writeFile(playlistsPath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

app.get('/api/playlists', async (_req, res) => {
  res.json({ playlists: await readPlaylistsFile() });
});

app.put('/api/playlists', async (req, res) => {
  try {
    const playlists = await writePlaylistsFile(req.body?.playlists);
    res.json({ playlists });
  } catch (error) {
    res.status(500).json({ error: 'Unable to save playlists' });
  }
});

app.get('/api/qqmusic/cookie', async (_req, res) => {
  res.json(await validateQqMusicCookie(browserQqMusicCookie));
});

app.put('/api/qqmusic/cookie', async (req, res) => {
  try {
    browserQqMusicCookie = normalizeQqMusicCookie(req.body?.cookie);
    playableUrlCache.clear();
    searchCache.clear();
    res.json(await validateQqMusicCookie(browserQqMusicCookie));
  } catch (error) {
    res.status(500).json({ error: 'Unable to save QQ Music cookie' });
  }
});

function sendQqMusicError(res, error, fallbackMessage) {
  const status = Number(error?.status || 500);
  res.status(status).json(error?.payload || { error: fallbackMessage });
}

app.get('/api/qqmusic/daily-recommend', async (req, res) => {
  try {
    const cookie = readQqMusicCookie(req);
    const limit = clampQqLimit(req.query.limit, 50);
    res.json({ songs: await fetchQqMusicDailyRecommendations(cookie, limit) });
  } catch (error) {
    sendQqMusicError(res, error, 'QQ Music daily recommendations failed');
  }
});

app.get('/api/qqmusic/liked', async (req, res) => {
  try {
    const cookie = readQqMusicCookie(req);
    const limit = clampQqLimit(req.query.limit, 50);
    res.json({ songs: await fetchQqMusicLikedSongs(cookie, limit) });
  } catch (error) {
    sendQqMusicError(res, error, 'QQ Music liked songs failed');
  }
});

app.get('/api/qqmusic/playlists', async (req, res) => {
  try {
    const cookie = readQqMusicCookie(req);
    const limit = clampQqLimit(req.query.limit, 80);
    res.json({ playlists: await fetchQqMusicPlaylists(cookie, limit) });
  } catch (error) {
    sendQqMusicError(res, error, 'QQ Music playlists failed');
  }
});

app.get('/api/qqmusic/playlist', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }
    const cookie = readQqMusicCookie(req);
    await ensureQqMusicLogin(cookie);
    const limit = clampQqLimit(req.query.limit, 50);
    res.json({ songs: await fetchQqMusicPlaylistSongs(id, cookie, limit) });
  } catch (error) {
    sendQqMusicError(res, error, 'QQ Music playlist songs failed');
  }
});

app.get('/api/qqmusic/search', async (req, res) => {
  try {
    const keywords = String(req.query.keywords || '').trim();
    const requestedLimit = Number(req.query.limit || '30');
    const resultLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 40)) : 30;
    const cookie = readQqMusicCookie(req);
    const includeDebug = String(req.query.debug || '') === '1';

    if (!keywords) {
      res.status(400).json({ error: 'Missing keywords' });
      return;
    }

    const cacheKey = `${keywords.toLowerCase()}::${resultLimit}::${normalizeQqMusicCookie(cookie)}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ ...cached.payload, cached: true });
      return;
    }

    const raw = await fetchQqMusicSearchSongs(keywords, resultLimit, cookie);
    const rawSongs = raw.map(mapQqMusicSong).filter(Boolean);
    const songs = rawSongs.slice(0, resultLimit);
    const payload = { songs, rawCount: rawSongs.length, filteredCount: songs.length };
    if (rawSongs.length > 0 || songs.length > 0) {
      searchCache.set(cacheKey, { payload, expiresAt: Date.now() + searchCacheTtl });
    }

    res.json(includeDebug ? { ...payload, debug: { rawCount: rawSongs.length } } : payload);
  } catch (error) {
    res.status(500).json({ error: 'QQ Music search failed' });
  }
});

app.get('/api/qqmusic/lyric', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const cookie = readQqMusicCookie(req);
    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }

    res.json(await getQqMusicLyric(id, cookie));
  } catch (error) {
    res.status(500).json({ error: 'QQ Music lyric failed' });
  }
});

app.get('/api/qqmusic/url', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const cookie = readQqMusicCookie(req);
    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }

    const includeDebug = String(req.query.debug || '') === '1';
    if (includeDebug) {
      res.json({ _raw: await getQqMusicPlayableUrl(id, cookie, true) });
      return;
    }
    res.json({ url: await getQqMusicPlayableUrl(id, cookie) });
  } catch (error) {
    res.status(500).json({ error: 'QQ Music url failed' });
  }
});

app.get('/api/qqmusic/audio', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const cookie = readQqMusicCookie(req);
    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }

    const playableUrl = await getQqMusicPlayableUrl(id, cookie);
    if (!playableUrl) {
      res.status(404).json({ error: 'No playable url for this song' });
      return;
    }

    const headers = createQqMusicHeaders(cookie);
    if (req.headers.range) headers.Range = req.headers.range;

    const audioResponse = await fetch(playableUrl, { headers });
    res.status(audioResponse.status);
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
    res.status(500).json({ error: 'QQ Music audio proxy failed' });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Sonic Topography is running at http://127.0.0.1:${port}`);
});
