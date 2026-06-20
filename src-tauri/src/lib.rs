use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

mod audio_capture;

// -----------------------------------------------------------------------------
// Static state
// -----------------------------------------------------------------------------

const URL_CACHE_TTL: Duration = Duration::from_secs(600);
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(300);

static CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
});

static URL_CACHE: Lazy<Mutex<HashMap<u64, (Option<String>, Instant)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static SEARCH_CACHE: Lazy<Mutex<HashMap<String, SearchCacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// -----------------------------------------------------------------------------
// Data types
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub songs: Vec<Song>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub id: u64,
    pub name: String,
    /// Joined artist names, e.g. "Artist A / Artist B".
    pub artists: String,
    pub album: String,
    pub duration: u64,
    #[serde(rename = "picUrl")]
    pub pic_url: Option<String>,
    /// Best/preferred source name for this song.
    pub source: String,
    /// All source names that returned this song.
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub songs: Vec<Song>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricResponse {
    pub lyric: String,
    #[serde(rename = "translatedLyric")]
    pub translated_lyric: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchArgs {
    pub keywords: String,
    pub limit: Option<u32>,
    pub preferred_source: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UrlArgs {
    pub id: u64,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LyricArgs {
    pub id: u64,
}

struct SearchCacheEntry {
    response: SearchResponse,
    expires_at: Instant,
}

// -----------------------------------------------------------------------------
// Netease source configuration
// -----------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct NeteaseSource {
    name: &'static str,
    base_url: &'static str,
    search_method: &'static str,
    search_path: &'static str,
    search_body_type: Option<&'static str>,
    url_path: &'static str,
    url_params: fn(u64) -> String,
    enabled: bool,
}

static NETEASE_SOURCES: Lazy<Vec<NeteaseSource>> = Lazy::new(|| {
    vec![
        NeteaseSource {
            name: "official",
            base_url: "https://music.163.com",
            search_method: "POST",
            search_path: "/api/search/get/web",
            search_body_type: Some("form"),
            url_path: "/api/song/enhance/player/url",
            url_params: |id| format!("?id={id}&ids=%5B{id}%5D&br=320000"),
            enabled: true,
        },
        NeteaseSource {
            name: "qijieya",
            base_url: "https://163api.qijieya.cn",
            search_method: "GET",
            search_path: "/search",
            search_body_type: None,
            url_path: "/song/url",
            url_params: |id| format!("?id={id}&br=320000"),
            enabled: true,
        },
        NeteaseSource {
            name: "focalors",
            base_url: "https://music-api.focalors.ltd",
            search_method: "GET",
            search_path: "/search",
            search_body_type: None,
            url_path: "/song/url",
            url_params: |id| format!("?id={id}&br=320000"),
            enabled: true,
        },
        NeteaseSource {
            name: "zm-armoe",
            base_url: "https://zm.armoe.cn",
            search_method: "GET",
            search_path: "/search",
            search_body_type: None,
            url_path: "/song/url",
            url_params: |id| format!("?id={id}&br=320000"),
            enabled: true,
        },
    ]
});

// -----------------------------------------------------------------------------
// HTTP helpers
// -----------------------------------------------------------------------------

fn header_map() -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::REFERER,
        "https://music.163.com/".parse().unwrap(),
    );
    headers.insert(
        reqwest::header::USER_AGENT,
        "Mozilla/5.0".parse().unwrap(),
    );
    headers
}

// -----------------------------------------------------------------------------
// Song normalization
// -----------------------------------------------------------------------------

fn parse_artist_list(song: &Value) -> Vec<String> {
    song.get("artists")
        .or_else(|| song.get("ar"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()).map(String::from))
                .filter(|n| !n.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn parse_album_name(song: &Value) -> String {
    song.get("album")
        .or_else(|| song.get("al"))
        .and_then(|a| a.get("name"))
        .and_then(|n| n.as_str())
        .map(String::from)
        .unwrap_or_default()
}

fn parse_pic_url(song: &Value) -> Option<String> {
    song.get("album")
        .or_else(|| song.get("al"))
        .and_then(|a| a.get("picUrl"))
        .and_then(|p| p.as_str())
        .map(String::from)
        .or_else(|| {
            song.get("artists")
                .or_else(|| song.get("ar"))
                .and_then(|a| a.as_array())
                .and_then(|arr| arr.first())
                .and_then(|a| a.get("picUrl"))
                .and_then(|p| p.as_str())
                .map(String::from)
        })
}

fn normalize_netease_song(song: &Value) -> Option<Song> {
    let id = song.get("id").and_then(|v| v.as_u64())?;
    let name = song
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let artist_list = parse_artist_list(song);
    let artists = if artist_list.is_empty() {
        "Unknown artist".to_string()
    } else {
        artist_list.join(" / ")
    };
    let album = parse_album_name(song);
    let duration = song
        .get("duration")
        .or_else(|| song.get("dt"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let pic_url = parse_pic_url(song);

    Some(Song {
        id,
        name,
        artists,
        album,
        duration,
        pic_url,
        source: String::new(),
        sources: Vec::new(),
    })
}

// -----------------------------------------------------------------------------
// Netease network requests
// -----------------------------------------------------------------------------

async fn fetch_netease_search(
    source: &NeteaseSource,
    keywords: &str,
    limit: u32,
) -> Result<Vec<Value>, String> {
    let url = format!("{}{}", source.base_url, source.search_path);

    let response = if source.search_method == "POST" && source.search_body_type == Some("form") {
        let form = [
            ("s", keywords),
            ("type", "1"),
            ("offset", "0"),
            ("total", "true"),
            ("limit", &limit.to_string()),
        ];
        CLIENT
            .post(&url)
            .headers(header_map())
            .form(&form)
            .send()
            .await
    } else {
        CLIENT
            .get(&url)
            .headers(header_map())
            .query(&[
                ("keywords", keywords),
                ("type", "1"),
                ("offset", "0"),
                ("limit", &limit.to_string()),
            ])
            .send()
            .await
    }
    .map_err(|e| format!("{} request failed: {}", source.name, e))?;

    if !response.status().is_success() {
        return Err(format!("{} HTTP {}", source.name, response.status()));
    }

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("{} JSON parse failed: {}", source.name, e))?;

    Ok(data
        .get("result")
        .and_then(|r| r.get("songs"))
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default())
}

async fn fetch_netease_url(source: &NeteaseSource, id: u64) -> Result<Option<String>, String> {
    let suffix = (source.url_params)(id);
    let url = format!("{}{}{}", source.base_url, source.url_path, suffix);

    let response = CLIENT
        .get(&url)
        .headers(header_map())
        .send()
        .await
        .map_err(|e| format!("{} request failed: {}", source.name, e))?;

    if !response.status().is_success() {
        return Err(format!("{} HTTP {}", source.name, response.status()));
    }

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("{} JSON parse failed: {}", source.name, e))?;

    Ok(data
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("url"))
        .and_then(|u| u.as_str())
        .map(String::from)
        .filter(|u| !u.is_empty()))
}

fn order_sources<'a>(
    sources: &'a [NeteaseSource],
    preferred_source_name: Option<&str>,
) -> Vec<&'a NeteaseSource> {
    let enabled: Vec<&NeteaseSource> = sources.iter().filter(|s| s.enabled).collect();
    if let Some(preferred) = preferred_source_name {
        if let Some(pos) = enabled.iter().position(|s| s.name == preferred) {
            let mut ordered = Vec::with_capacity(enabled.len());
            ordered.push(enabled[pos]);
            ordered.extend(enabled.iter().take(pos).copied());
            ordered.extend(enabled.iter().skip(pos + 1).copied());
            return ordered;
        }
    }
    enabled
}

async fn try_sources_for_url(
    id: u64,
    preferred_source_name: Option<&str>,
) -> Result<(String, String), String> {
    let ordered = order_sources(&NETEASE_SOURCES, preferred_source_name);
    let mut errors = Vec::new();

    for source in ordered {
        match fetch_netease_url(source, id).await {
            Ok(Some(url)) => return Ok((source.name.to_string(), url)),
            Ok(None) => errors.push(format!("{}: empty or unplayable result", source.name)),
            Err(e) => errors.push(e),
        }
    }

    Err(format!(
        "All Netease sources failed ({})",
        errors.join("; ")
    ))
}

async fn get_netease_playable_url(
    id: u64,
    preferred_source_name: Option<&str>,
) -> Result<(String, String), String> {
    {
        let cache = URL_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some((url, expires_at)) = cache.get(&id) {
            if *expires_at > Instant::now() {
                return match url {
                    Some(url) => Ok(("cached".to_string(), url.clone())),
                    None => Err("No playable url for this song".to_string()),
                };
            }
        }
    }

    let result = try_sources_for_url(id, preferred_source_name).await;
    let mut cache = URL_CACHE.lock().map_err(|e| e.to_string())?;
    match &result {
        Ok((source, url)) => {
            cache.insert(id, (Some(url.clone()), Instant::now() + URL_CACHE_TTL));
            Ok((source.clone(), url.clone()))
        }
        Err(_) => {
            cache.insert(id, (None, Instant::now() + URL_CACHE_TTL));
            result
        }
    }
}

#[derive(Debug)]
struct MergedEntry {
    song: Song,
    positions: HashMap<String, usize>,
}

async fn search_all_sources(
    keywords: &str,
    limit: u32,
    preferred_source_name: Option<&str>,
) -> Result<SearchResponse, String> {
    let enabled_indices: Vec<usize> = NETEASE_SOURCES
        .iter()
        .enumerate()
        .filter(|(_, s)| s.enabled)
        .map(|(i, _)| i)
        .collect();

    let mut handles = Vec::new();
    for idx in enabled_indices {
        let keywords = keywords.to_string();
        let limit = limit;
        handles.push(tokio::spawn(async move {
            let source = &NETEASE_SOURCES[idx];
            match fetch_netease_search(source, &keywords, limit).await {
                Ok(songs) if !songs.is_empty() => Some((source.name.to_string(), songs)),
                _ => None,
            }
        }));
    }

    let mut successful = Vec::new();
    for handle in handles {
        if let Ok(Some((source_name, songs))) = handle.await {
            successful.push((source_name, songs));
        }
    }

    if successful.is_empty() {
        return Ok(SearchResponse {
            songs: Vec::new(),
            source: "merged".to_string(),
        });
    }

    let preferred = preferred_source_name
        .filter(|s| !s.is_empty() && *s != "auto")
        .map(String::from);

    let mut song_map: HashMap<u64, MergedEntry> = HashMap::new();
    for (source_name, songs) in &successful {
        for (position, song_value) in songs.iter().enumerate() {
            if let Some(normalized) = normalize_netease_song(song_value) {
                let entry = song_map.entry(normalized.id).or_insert(MergedEntry {
                    song: normalized,
                    positions: HashMap::new(),
                });
                if !entry.song.sources.contains(source_name) {
                    entry.song.sources.push(source_name.clone());
                }
                entry
                    .positions
                    .entry(source_name.clone())
                    .and_modify(|p| {
                        if position < *p {
                            *p = position;
                        }
                    })
                    .or_insert(position);
            }
        }
    }

    let mut merged: Vec<MergedEntry> = song_map.into_values().collect();
    for entry in &mut merged {
        entry.song.source = entry
            .song
            .sources
            .first()
            .cloned()
            .unwrap_or_default();
        if let Some(ref pref) = preferred {
            if entry.song.sources.contains(pref) {
                entry.song.source = pref.clone();
            }
        }
    }

    merged.sort_by(|a, b| {
        let a_has_preferred = preferred
            .as_ref()
            .map_or(false, |p| a.song.sources.contains(p));
        let b_has_preferred = preferred
            .as_ref()
            .map_or(false, |p| b.song.sources.contains(p));
        match (a_has_preferred, b_has_preferred) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                let by_sources = b.song.sources.len().cmp(&a.song.sources.len());
                if by_sources != std::cmp::Ordering::Equal {
                    return by_sources;
                }
                let a_best = *a.positions.values().min().unwrap_or(&usize::MAX);
                let b_best = *b.positions.values().min().unwrap_or(&usize::MAX);
                a_best.cmp(&b_best)
            }
        }
    });

    Ok(SearchResponse {
        songs: merged.into_iter().map(|e| e.song).collect(),
        source: "merged".to_string(),
    })
}

async fn filter_playable_songs(
    songs: Vec<Song>,
    result_limit: usize,
    preferred_source_name: Option<&str>,
) -> Vec<Song> {
    let preferred = preferred_source_name.map(String::from);
    let mut playable = Vec::new();

    for chunk in songs.chunks(8) {
        if playable.len() >= result_limit {
            break;
        }

        let mut handles = Vec::new();
        for song in chunk {
            let song = song.clone();
            let preferred = preferred.clone();
            handles.push(tokio::spawn(async move {
                match get_netease_playable_url(song.id, preferred.as_deref()).await {
                    Ok(_) => Some(song),
                    Err(_) => None,
                }
            }));
        }

        for handle in handles {
            if playable.len() >= result_limit {
                break;
            }
            if let Ok(Some(song)) = handle.await {
                playable.push(song);
            }
        }
    }

    playable
}

// -----------------------------------------------------------------------------
// Tauri commands
// -----------------------------------------------------------------------------

#[tauri::command]
async fn search_songs(args: SearchArgs) -> Result<SearchResponse, String> {
    let keywords = args.keywords.trim().to_string();
    if keywords.is_empty() {
        return Err("Missing keywords".to_string());
    }

    let requested_limit = args.limit.unwrap_or(12);
    let result_limit = requested_limit.clamp(1, 20) as usize;
    let preferred = args
        .preferred_source
        .as_deref()
        .filter(|s| !s.is_empty() && *s != "auto");

    let cache_key = format!(
        "{}::{}::{}",
        keywords.to_lowercase(),
        result_limit,
        preferred.unwrap_or("auto")
    );
    {
        let cache = SEARCH_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.expires_at > Instant::now() {
                return Ok(entry.response.clone());
            }
        }
    }

    let fetch_limit = (result_limit * 3).min(60) as u32;
    let raw_result = search_all_sources(&keywords, fetch_limit, preferred).await?;

    if raw_result.songs.is_empty() {
        return Err("Netease search failed: all sources unavailable".to_string());
    }

    let playable_songs = filter_playable_songs(raw_result.songs, result_limit, preferred).await;

    if playable_songs.is_empty() {
        return Err("No playable songs found".to_string());
    }

    let response = SearchResponse {
        songs: playable_songs,
        source: "merged".to_string(),
    };

    {
        let mut cache = SEARCH_CACHE.lock().map_err(|e| e.to_string())?;
        cache.insert(
            cache_key,
            SearchCacheEntry {
                response: response.clone(),
                expires_at: Instant::now() + SEARCH_CACHE_TTL,
            },
        );
    }

    Ok(response)
}

#[tauri::command]
async fn get_song_url(args: UrlArgs) -> Result<String, String> {
    let preferred = args
        .source
        .as_deref()
        .filter(|s| !s.is_empty() && *s != "auto");
    let (_source, url) = get_netease_playable_url(args.id, preferred).await?;
    Ok(url)
}

#[tauri::command]
async fn get_lyric(args: LyricArgs) -> Result<LyricResponse, String> {
    let url = format!(
        "https://music.163.com/api/song/lyric?id={}&lv=-1&kv=-1&tv=-1",
        args.id
    );

    let response = CLIENT
        .get(&url)
        .headers(header_map())
        .send()
        .await
        .map_err(|e| format!("Lyric request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Lyric HTTP {}", response.status()));
    }

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("Lyric JSON parse failed: {}", e))?;

    let lyric = data
        .get("lrc")
        .and_then(|l| l.get("lyric"))
        .and_then(|l| l.as_str())
        .map(String::from)
        .unwrap_or_default();

    let translated = data
        .get("tlyric")
        .and_then(|l| l.get("lyric"))
        .and_then(|l| l.as_str())
        .map(String::from)
        .unwrap_or_default();

    Ok(LyricResponse {
        lyric,
        translated_lyric: translated,
    })
}

// -----------------------------------------------------------------------------
// Playlist persistence
// -----------------------------------------------------------------------------

fn playlists_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data dir: {}", e))?
        .join("data");
    fs::create_dir_all(&dir).map_err(|e| format!("Unable to create data dir: {}", e))?;
    Ok(dir)
}

fn playlists_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(playlists_dir(app)?.join("playlists.json"))
}

fn create_default_playlists() -> Vec<Playlist> {
    vec![
        Playlist {
            id: "favorites".to_string(),
            name: "Favorites".to_string(),
            songs: Vec::new(),
        },
        Playlist {
            id: "visual-set".to_string(),
            name: "Visual Set".to_string(),
            songs: Vec::new(),
        },
    ]
}

fn normalize_playlists(value: Vec<Playlist>) -> Vec<Playlist> {
    if value.is_empty() {
        return create_default_playlists();
    }
    value
        .into_iter()
        .map(|p| Playlist {
            id: if p.id.is_empty() {
                format!(
                    "playlist-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                )
            } else {
                p.id
            },
            name: if p.name.is_empty() {
                "Playlist".to_string()
            } else {
                p.name
            },
            songs: p.songs,
        })
        .collect()
}

fn save_playlists_impl(app: &AppHandle, playlists: Vec<Playlist>) -> Result<(), String> {
    let path = playlists_path(app)?;
    let temp_path = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(&playlists).map_err(|e| e.to_string())?;
    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("Unable to create temp file: {}", e))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Unable to write temp file: {}", e))?;
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("Unable to rename temp file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn load_playlists(app: AppHandle) -> Result<Vec<Playlist>, String> {
    let path = playlists_path(&app)?;
    let playlists = match fs::read_to_string(&path) {
        Ok(raw) => {
            let parsed: Result<Vec<Playlist>, _> = serde_json::from_str(&raw);
            match parsed {
                Ok(playlists) => normalize_playlists(playlists),
                Err(_) => {
                    let default = create_default_playlists();
                    save_playlists_impl(&app, default.clone())?;
                    default
                }
            }
        }
        Err(_) => {
            let default = create_default_playlists();
            save_playlists_impl(&app, default.clone())?;
            default
        }
    };
    Ok(playlists)
}

#[tauri::command]
async fn save_playlists(
    app: AppHandle,
    playlists: Vec<Playlist>,
) -> Result<Vec<Playlist>, String> {
    let normalized = normalize_playlists(playlists);
    save_playlists_impl(&app, normalized.clone())?;
    Ok(normalized)
}

// -----------------------------------------------------------------------------
// System audio capture
// -----------------------------------------------------------------------------

#[tauri::command]
async fn start_system_audio_capture() -> Result<serde_json::Value, String> {
    let url = audio_capture::start()?;
    Ok(serde_json::json!({ "url": url }))
}

#[tauri::command]
async fn stop_system_audio_capture() -> Result<(), String> {
    audio_capture::stop()
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            search_songs,
            get_song_url,
            get_lyric,
            load_playlists,
            save_playlists,
            start_system_audio_capture,
            stop_system_audio_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
