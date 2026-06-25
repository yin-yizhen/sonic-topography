package sonicserver

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const qqMusicCookieHeader = "x-qq-music-cookie"

var baseQqMusicHeaders = map[string]string{
	"Referer":    "https://y.qq.com/",
	"Origin":     "https://y.qq.com",
	"User-Agent": "Mozilla/5.0",
	"Accept":     "application/json, text/plain, */*",
	"Connection": "close",
}

type Config struct {
	PlaylistsPath string
	StaticFS      fs.FS
	Client        *http.Client
}

type Server struct {
	playlistsPath string
	staticFS      fs.FS
	client        *http.Client

	mu                   sync.RWMutex
	browserQqMusicCookie string
	playableURLCache     map[string]cachedURL
	searchCache          map[string]cachedSearch
}

type Playlist struct {
	ID    string           `json:"id"`
	Name  string           `json:"name"`
	Songs []map[string]any `json:"songs"`
}

type QqMusicSong struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Duration int    `json:"duration"`
	Fee      int    `json:"fee"`
}

type QqMusicPlaylistSummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
	Cover string `json:"cover"`
}

type cachedURL struct {
	URL       string
	ExpiresAt time.Time
}

type cachedSearch struct {
	Payload   searchPayload
	ExpiresAt time.Time
}

type searchPayload struct {
	Songs         []QqMusicSong  `json:"songs"`
	RawCount      int            `json:"rawCount"`
	FilteredCount int            `json:"filteredCount"`
	Debug         map[string]any `json:"debug,omitempty"`
	Cached        bool           `json:"cached,omitempty"`
}

func New(config Config) *Server {
	client := config.Client
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second}
	}
	playlistsPath := config.PlaylistsPath
	if playlistsPath == "" {
		playlistsPath = DefaultPlaylistsPath()
	}
	return &Server{
		playlistsPath:    playlistsPath,
		staticFS:         config.StaticFS,
		client:           client,
		playableURLCache: make(map[string]cachedURL),
		searchCache:      make(map[string]cachedSearch),
	}
}

func DefaultPlaylistsPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		configDir = "."
	}
	return filepath.Join(configDir, "SonicTopography", "playlists.json")
}

func NormalizeQqMusicCookie(value string) string {
	lines := strings.FieldsFunc(value, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		item := strings.TrimSpace(line)
		item = strings.TrimRight(item, ";")
		item = strings.TrimSpace(item)
		if item != "" {
			parts = append(parts, item)
		}
	}
	return strings.Join(parts, "; ")
}

func DefaultPlaylists() []Playlist {
	return []Playlist{
		{ID: "favorites", Name: "Favorites", Songs: []map[string]any{}},
		{ID: "visual-set", Name: "Visual Set", Songs: []map[string]any{}},
	}
}

func NormalizePlaylists(value []Playlist) []Playlist {
	if len(value) == 0 {
		return DefaultPlaylists()
	}
	normalized := make([]Playlist, 0, len(value))
	for index, playlist := range value {
		id := strings.TrimSpace(playlist.ID)
		if id == "" {
			id = fmt.Sprintf("playlist-%d", index)
		}
		name := strings.TrimSpace(playlist.Name)
		if name == "" {
			name = "Playlist"
		}
		songs := playlist.Songs
		if songs == nil {
			songs = []map[string]any{}
		}
		normalized = append(normalized, Playlist{ID: id, Name: name, Songs: songs})
	}
	return normalized
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/playlists":
		s.handlePlaylists(w, r)
	case "/api/qqmusic/cookie":
		s.handleQqMusicCookie(w, r)
	case "/api/qqmusic/search":
		s.handleQqMusicSearch(w, r)
	case "/api/qqmusic/daily-recommend":
		s.handleQqMusicDailyRecommend(w, r)
	case "/api/qqmusic/liked":
		s.handleQqMusicLiked(w, r)
	case "/api/qqmusic/playlists":
		s.handleQqMusicCloudPlaylists(w, r)
	case "/api/qqmusic/playlist":
		s.handleQqMusicCloudPlaylist(w, r)
	case "/api/qqmusic/lyric":
		s.handleQqMusicLyric(w, r)
	case "/api/qqmusic/url":
		s.handleQqMusicURL(w, r)
	case "/api/qqmusic/audio":
		s.handleQqMusicAudio(w, r)
	default:
		s.serveStatic(w, r)
	}
}

func (s *Server) handlePlaylists(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		playlists, err := s.readPlaylistsFile()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Unable to read playlists"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"playlists": playlists})
	case http.MethodPut:
		var payload struct {
			Playlists []Playlist `json:"playlists"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid playlist payload"})
			return
		}
		playlists, err := s.writePlaylistsFile(payload.Playlists)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Unable to save playlists"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"playlists": playlists})
	default:
		w.Header().Set("Allow", "GET, PUT")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "Method not allowed"})
	}
}

func (s *Server) handleQqMusicCookie(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cookie := s.currentCookie()
		writeJSON(w, http.StatusOK, s.validateQqMusicCookie(cookie))
	case http.MethodPut:
		var payload struct {
			Cookie string `json:"cookie"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid cookie payload"})
			return
		}
		normalized := NormalizeQqMusicCookie(payload.Cookie)
		s.mu.Lock()
		s.browserQqMusicCookie = normalized
		s.playableURLCache = make(map[string]cachedURL)
		s.searchCache = make(map[string]cachedSearch)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, s.validateQqMusicCookie(normalized))
	default:
		w.Header().Set("Allow", "GET, PUT")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "Method not allowed"})
	}
}

type qqMusicAuth struct {
	Cookie           string
	Uin              string
	GTK              string
	HasAuthToken     bool
	HasLoginIdentity bool
}

func parseQqMusicCookie(cookie string) map[string]string {
	entries := map[string]string{}
	for _, part := range strings.Split(cookie, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		index := strings.Index(part, "=")
		if index <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(part[:index]))
		value := strings.TrimSpace(part[index+1:])
		if key != "" {
			entries[key] = value
		}
	}
	return entries
}

func normalizeQqUin(value string) string {
	digits := strings.Builder{}
	for _, r := range value {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	result := digits.String()
	if result == "" {
		return "0"
	}
	return result
}

func extractUinFromCookie(cookie string) string {
	entries := parseQqMusicCookie(cookie)
	for _, key := range []string{"uin", "qqmusic_uin", "o_cookie", "luin"} {
		if uin := normalizeQqUin(entries[key]); uin != "0" {
			return uin
		}
	}
	return "0"
}

func calculateQqGTK(seed string) string {
	hash := int64(5381)
	for _, r := range seed {
		hash += (hash << 5) + int64(r)
	}
	return strconv.FormatInt(hash&0x7fffffff, 10)
}

func getQqMusicAuth(cookie string) qqMusicAuth {
	normalized := NormalizeQqMusicCookie(cookie)
	entries := parseQqMusicCookie(normalized)
	uin := extractUinFromCookie(normalized)
	gtkSeed := firstNonEmpty(entries["p_skey"], entries["skey"])
	hasAuthToken := false
	for _, key := range []string{"qqmusic_key", "qm_keyst", "music_key", "p_skey", "skey"} {
		if strings.TrimSpace(entries[key]) != "" {
			hasAuthToken = true
			break
		}
	}
	gtk := "5381"
	if gtkSeed != "" {
		gtk = calculateQqGTK(gtkSeed)
	}
	return qqMusicAuth{
		Cookie:           normalized,
		Uin:              uin,
		GTK:              gtk,
		HasAuthToken:     hasAuthToken,
		HasLoginIdentity: normalized != "" && uin != "0" && hasAuthToken,
	}
}

func (s *Server) validateQqMusicCookie(cookie string) map[string]any {
	auth := getQqMusicAuth(cookie)
	if auth.Cookie == "" {
		return map[string]any{"hasCookie": false, "valid": false, "uin": "0", "reason": "empty-cookie"}
	}
	if auth.Uin == "0" {
		return map[string]any{"hasCookie": true, "valid": false, "uin": "0", "reason": "missing-uin"}
	}
	if !auth.HasAuthToken {
		return map[string]any{"hasCookie": true, "valid": false, "uin": auth.Uin, "reason": "missing-login-token"}
	}

	data := map[string]any{
		"comm": map[string]any{"uin": auth.Uin, "format": "json", "ct": "19", "cv": "1859"},
		"req": map[string]any{
			"module": "music.UserInfo.userInfoServer",
			"method": "GetLoginUserInfo",
			"param":  map[string]any{},
		},
	}
	encoded, _ := json.Marshal(data)
	values := url.Values{}
	values.Set("data", string(encoded))
	endpoint := "https://u.y.qq.com/cgi-bin/musicu.fcg?" + values.Encode()
	response, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(auth.Cookie, nil), 1)
	if err != nil {
		return map[string]any{"hasCookie": true, "valid": false, "uin": auth.Uin, "reason": "login-check-error"}
	}
	code := intFrom(firstNonNil(mapFrom(response["req"])["code"], response["code"], -1))
	reason := "login-check-failed"
	if code == 0 {
		reason = "ok"
	}
	return map[string]any{"hasCookie": true, "valid": code == 0, "uin": auth.Uin, "reason": reason, "upstreamCode": code}
}

func (s *Server) handleQqMusicSearch(w http.ResponseWriter, r *http.Request) {
	keywords := strings.TrimSpace(r.URL.Query().Get("keywords"))
	if keywords == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Missing keywords"})
		return
	}
	limit := clamp(parseIntDefault(r.URL.Query().Get("limit"), 30), 1, 40)
	cookie := s.readQqMusicCookie(r)
	cacheKey := strings.ToLower(keywords) + "::" + strconv.Itoa(limit) + "::" + NormalizeQqMusicCookie(cookie)
	if cached, ok := s.getCachedSearch(cacheKey); ok {
		cached.Cached = true
		writeJSON(w, http.StatusOK, cached)
		return
	}

	rawMaps, err := s.fetchQqMusicSearchSongs(keywords, limit, cookie)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "QQ Music search failed"})
		return
	}
	rawSongs := make([]QqMusicSong, 0, len(rawMaps))
	for _, item := range rawMaps {
		if song, ok := mapQqMusicSong(item); ok {
			rawSongs = append(rawSongs, song)
		}
	}
	songs := rawSongs
	if len(songs) > limit {
		songs = songs[:limit]
	}
	payload := searchPayload{Songs: songs, RawCount: len(rawSongs), FilteredCount: len(songs)}
	if len(rawSongs) > 0 || len(songs) > 0 {
		s.setCachedSearch(cacheKey, payload)
	}
	if r.URL.Query().Get("debug") == "1" {
		payload.Debug = map[string]any{"rawCount": len(rawSongs)}
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleQqMusicDailyRecommend(w http.ResponseWriter, r *http.Request) {
	cookie := s.readQqMusicCookie(r)
	limit := clampQqLimit(r.URL.Query().Get("limit"), 50)
	songs, errPayload := s.fetchQqMusicDailyRecommendations(cookie, limit)
	if errPayload != nil {
		writeJSON(w, http.StatusUnauthorized, errPayload)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"songs": songs})
}

func (s *Server) handleQqMusicLiked(w http.ResponseWriter, r *http.Request) {
	cookie := s.readQqMusicCookie(r)
	limit := clampQqLimit(r.URL.Query().Get("limit"), 50)
	songs, errPayload := s.fetchQqMusicLikedSongs(cookie, limit)
	if errPayload != nil {
		writeJSON(w, http.StatusUnauthorized, errPayload)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"songs": songs})
}

func (s *Server) handleQqMusicCloudPlaylists(w http.ResponseWriter, r *http.Request) {
	cookie := s.readQqMusicCookie(r)
	limit := clampQqLimit(r.URL.Query().Get("limit"), 80)
	playlists, errPayload := s.fetchQqMusicPlaylists(cookie, limit)
	if errPayload != nil {
		writeJSON(w, http.StatusUnauthorized, errPayload)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"playlists": playlists})
}

func (s *Server) handleQqMusicCloudPlaylist(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Missing id"})
		return
	}
	cookie := s.readQqMusicCookie(r)
	if _, errPayload := s.ensureQqMusicLogin(cookie); errPayload != nil {
		writeJSON(w, http.StatusUnauthorized, errPayload)
		return
	}
	limit := clampQqLimit(r.URL.Query().Get("limit"), 50)
	songs, err := s.fetchQqMusicPlaylistSongs(id, cookie, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "QQ Music playlist songs failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"songs": songs})
}

func (s *Server) handleQqMusicLyric(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Missing id"})
		return
	}
	lyric, translated, err := s.getQqMusicLyric(id, s.readQqMusicCookie(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "QQ Music lyric failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lyric": lyric, "translatedLyric": translated})
}

func (s *Server) handleQqMusicURL(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Missing id"})
		return
	}
	playableURL, err := s.getQqMusicPlayableURL(id, s.readQqMusicCookie(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "QQ Music url failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": nullableString(playableURL)})
}

func (s *Server) handleQqMusicAudio(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Missing id"})
		return
	}
	cookie := s.readQqMusicCookie(r)
	playableURL, err := s.getQqMusicPlayableURL(id, cookie)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "QQ Music audio proxy failed"})
		return
	}
	if playableURL == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "No playable url for this song"})
		return
	}

	req, err := http.NewRequest(http.MethodGet, playableURL, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Invalid audio url"})
		return
	}
	req.Header = createQqMusicHeaders(cookie, nil)
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Unable to fetch audio"})
		return
	}
	defer resp.Body.Close()
	for _, header := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
		if value := resp.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "audio/mpeg")
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (s *Server) readPlaylistsFile() ([]Playlist, error) {
	raw, err := os.ReadFile(s.playlistsPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultPlaylists(), nil
		}
		return nil, err
	}
	var playlists []Playlist
	if err := json.Unmarshal(raw, &playlists); err != nil {
		return DefaultPlaylists(), nil
	}
	return NormalizePlaylists(playlists), nil
}

func (s *Server) writePlaylistsFile(playlists []Playlist) ([]Playlist, error) {
	normalized := NormalizePlaylists(playlists)
	if err := os.MkdirAll(filepath.Dir(s.playlistsPath), 0o755); err != nil {
		return nil, err
	}
	raw, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return nil, err
	}
	return normalized, os.WriteFile(s.playlistsPath, raw, 0o644)
}

func (s *Server) currentCookie() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.browserQqMusicCookie
}

func (s *Server) readQqMusicCookie(r *http.Request) string {
	headerCookie := r.Header.Get(qqMusicCookieHeader)
	if strings.TrimSpace(headerCookie) == "" {
		headerCookie = s.currentCookie()
	}
	return NormalizeQqMusicCookie(headerCookie)
}

func (s *Server) getQqMusicPlayableURL(id string, cookie string) (string, error) {
	auth := getQqMusicAuth(cookie)
	normalized := auth.Cookie
	uin := auth.Uin
	cacheKey := id + "::" + normalized
	s.mu.RLock()
	cached, ok := s.playableURLCache[cacheKey]
	s.mu.RUnlock()
	if ok && cached.ExpiresAt.After(time.Now()) {
		return cached.URL, nil
	}

	guid := strconv.FormatInt(time.Now().UnixNano()%9000000000+1000000000, 10)
	data := map[string]any{
		"req_0": map[string]any{
			"module": "vkey.GetVkeyServer",
			"method": "CgiGetVkey",
			"param": map[string]any{
				"guid":      guid,
				"songmid":   []string{id},
				"songtype":  []int{0},
				"uin":       uin,
				"loginflag": 1,
				"platform":  "20",
			},
		},
		"comm": map[string]any{"uin": uin, "format": "json", "ct": "19", "cv": "1859"},
	}
	encoded, _ := json.Marshal(data)
	values := url.Values{}
	values.Set("data", string(encoded))
	endpoint := "https://u.y.qq.com/cgi-bin/musicu.fcg?" + values.Encode()

	result, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(normalized, nil), 2)
	if err != nil {
		return "", err
	}
	vkeyData := mapFrom(mapFrom(result["req_0"])["data"])
	infos := mapsFrom(sliceFrom(vkeyData["midurlinfo"]))
	purl := ""
	if len(infos) > 0 {
		purl = stringFrom(infos[0]["purl"])
	}
	playableURL := ""
	if purl != "" {
		if strings.HasPrefix(purl, "http") {
			playableURL = purl
		} else {
			playableURL = pickQqSip(sliceFrom(vkeyData["sip"])) + purl
		}
	}

	s.mu.Lock()
	s.playableURLCache[cacheKey] = cachedURL{URL: playableURL, ExpiresAt: time.Now().Add(10 * time.Minute)}
	s.mu.Unlock()
	return playableURL, nil
}

func (s *Server) fetchQqMusicSearchSongs(keywords string, resultLimit int, cookie string) ([]map[string]any, error) {
	auth := getQqMusicAuth(cookie)
	data := map[string]any{
		"comm": map[string]any{"ct": "19", "cv": "1859", "uin": auth.Uin, "format": "json"},
		"req": map[string]any{
			"method": "DoSearchForQQMusicDesktop",
			"module": "music.search.SearchCgiService",
			"param": map[string]any{
				"num_per_page": minInt(resultLimit*2, 60),
				"page_num":     1,
				"query":        keywords,
				"search_type":  0,
			},
		},
	}
	encoded, _ := json.Marshal(data)
	values := url.Values{}
	values.Set("data", string(encoded))
	endpoint := "https://u.y.qq.com/cgi-bin/musicu.fcg?" + values.Encode()
	response, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(cookie, nil), 2)
	if err != nil {
		return nil, err
	}
	list := sliceFrom(mapFrom(mapFrom(mapFrom(mapFrom(response["req"])["data"])["body"])["song"])["list"])
	items := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if mapped := mapFrom(item); len(mapped) > 0 {
			items = append(items, mapped)
		}
	}
	return items, nil
}
func (s *Server) filterPlayableSongs(rawSongs []QqMusicSong, resultLimit int, cookie string) []QqMusicSong {
	playable := make([]QqMusicSong, 0, minInt(resultLimit, len(rawSongs)))
	for _, song := range rawSongs {
		if len(playable) >= resultLimit {
			break
		}
		playableURL, err := s.getQqMusicPlayableURL(song.ID, cookie)
		if err == nil && playableURL != "" {
			playable = append(playable, song)
		}
	}
	return playable
}

func clampQqLimit(raw string, fallback int) int {
	return clamp(parseIntDefault(raw, fallback), 1, 100)
}

func (s *Server) ensureQqMusicLogin(cookie string) (qqMusicAuth, map[string]any) {
	result := s.validateQqMusicCookie(cookie)
	if valid, _ := result["valid"].(bool); valid {
		return getQqMusicAuth(cookie), nil
	}
	payload := map[string]any{"error": "QQ Music cookie is not valid"}
	for key, value := range result {
		payload[key] = value
	}
	return qqMusicAuth{}, payload
}

func (s *Server) fetchQqMusicCreatedPlaylists(cookie string, limit int) ([]QqMusicPlaylistSummary, error) {
	auth := getQqMusicAuth(cookie)
	values := url.Values{}
	values.Set("hostuin", auth.Uin)
	values.Set("sin", "0")
	values.Set("size", strconv.Itoa(limit))
	values.Set("format", "json")
	values.Set("g_tk", auth.GTK)
	values.Set("loginUin", auth.Uin)
	values.Set("hostUin", auth.Uin)
	values.Set("platform", "yqq.json")
	values.Set("needNewCode", "0")
	endpoint := "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?" + values.Encode()
	data, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(cookie, nil), 2)
	if err != nil {
		return nil, err
	}
	list := firstNonNil(mapFrom(data["data"])["disslist"], data["disslist"], mapFrom(data["data"])["list"])
	return mapQqMusicPlaylists(sliceFrom(list)), nil
}

func (s *Server) fetchQqMusicFavoritePlaylists(cookie string, limit int) ([]QqMusicPlaylistSummary, error) {
	auth := getQqMusicAuth(cookie)
	values := url.Values{}
	values.Set("ct", "20")
	values.Set("cid", "205360956")
	values.Set("userid", auth.Uin)
	values.Set("reqtype", "3")
	values.Set("sin", "0")
	values.Set("ein", strconv.Itoa(maxInt(0, limit-1)))
	values.Set("format", "json")
	values.Set("g_tk", auth.GTK)
	values.Set("loginUin", auth.Uin)
	values.Set("hostUin", auth.Uin)
	values.Set("platform", "yqq.json")
	values.Set("needNewCode", "0")
	endpoint := "https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?" + values.Encode()
	data, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(cookie, nil), 2)
	if err != nil {
		return nil, err
	}
	list := firstNonNil(mapFrom(data["data"])["cdlist"], mapFrom(data["data"])["list"], mapFrom(data["data"])["v_list"], data["cdlist"], data["list"])
	return mapQqMusicPlaylists(sliceFrom(list)), nil
}

func (s *Server) fetchQqMusicPlaylists(cookie string, limit int) ([]QqMusicPlaylistSummary, map[string]any) {
	if _, errPayload := s.ensureQqMusicLogin(cookie); errPayload != nil {
		return nil, errPayload
	}
	created, _ := s.fetchQqMusicCreatedPlaylists(cookie, limit)
	favorites, _ := s.fetchQqMusicFavoritePlaylists(cookie, limit)
	playlists := uniqueQqMusicPlaylists(append(created, favorites...))
	return playlists[:minInt(len(playlists), limit)], nil
}

func (s *Server) fetchQqMusicPlaylistSongs(id string, cookie string, limit int) ([]QqMusicSong, error) {
	auth := getQqMusicAuth(cookie)
	values := url.Values{}
	values.Set("type", "1")
	values.Set("json", "1")
	values.Set("utf8", "1")
	values.Set("onlysong", "0")
	values.Set("disstid", id)
	values.Set("format", "json")
	values.Set("g_tk", auth.GTK)
	values.Set("loginUin", auth.Uin)
	values.Set("hostUin", auth.Uin)
	values.Set("platform", "yqq.json")
	values.Set("needNewCode", "0")
	endpoint := "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?" + values.Encode()
	data, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(cookie, nil), 2)
	if err != nil {
		return nil, err
	}
	cdList := mapsFrom(sliceFrom(data["cdlist"]))
	if len(cdList) == 0 {
		return []QqMusicSong{}, nil
	}
	return mapQqMusicSongs(sliceFrom(cdList[0]["songlist"]), limit), nil
}

func (s *Server) fetchQqMusicFavoriteSongs(cookie string, limit int) []QqMusicSong {
	auth := getQqMusicAuth(cookie)
	for _, reqtype := range []string{"0", "1", "2"} {
		values := url.Values{}
		values.Set("ct", "20")
		values.Set("cid", "205360956")
		values.Set("userid", auth.Uin)
		values.Set("reqtype", reqtype)
		values.Set("sin", "0")
		values.Set("ein", strconv.Itoa(maxInt(0, limit-1)))
		values.Set("format", "json")
		values.Set("g_tk", auth.GTK)
		values.Set("loginUin", auth.Uin)
		values.Set("hostUin", auth.Uin)
		values.Set("platform", "yqq.json")
		values.Set("needNewCode", "0")
		endpoint := "https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?" + values.Encode()
		data, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(cookie, nil), 2)
		if err != nil {
			continue
		}
		list := firstNonNil(mapFrom(data["data"])["list"], mapFrom(data["data"])["songlist"], data["list"])
		songs := make([]QqMusicSong, 0)
		for _, item := range sliceFrom(list) {
			mapped := mapFrom(item)
			candidate := mapped
			if nested := mapFrom(firstNonNil(mapped["song"], mapped["musicData"])); len(nested) > 0 {
				candidate = nested
			}
			if song, ok := mapQqMusicSong(candidate); ok {
				songs = append(songs, song)
			}
		}
		if len(songs) > 0 {
			return songs[:minInt(len(songs), limit)]
		}
	}
	return []QqMusicSong{}
}

func (s *Server) fetchQqMusicLikedSongs(cookie string, limit int) ([]QqMusicSong, map[string]any) {
	if _, errPayload := s.ensureQqMusicLogin(cookie); errPayload != nil {
		return nil, errPayload
	}
	if songs := s.fetchQqMusicFavoriteSongs(cookie, limit); len(songs) > 0 {
		return songs, nil
	}
	playlists, errPayload := s.fetchQqMusicPlaylists(cookie, 100)
	if errPayload != nil {
		return nil, errPayload
	}
	for _, playlist := range playlists {
		name := strings.ToLower(playlist.Name)
		if strings.Contains(name, "liked") || strings.Contains(name, "favorite") || strings.Contains(name, "love") || strings.Contains(playlist.Name, "\u6211\u559c\u6b22") || strings.Contains(playlist.Name, "\u559c\u6b61") {
			songs, _ := s.fetchQqMusicPlaylistSongs(playlist.ID, cookie, limit)
			return songs, nil
		}
	}
	return []QqMusicSong{}, nil
}

func collectRecommendPlaylistIDs(value any, output []string) []string {
	if output == nil {
		output = []string{}
	}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			output = collectRecommendPlaylistIDs(item, output)
		}
	case map[string]any:
		id := strings.TrimSpace(firstNonEmpty(stringFrom(typed["id"]), stringFrom(typed["disstid"])))
		jumpType := intFrom(typed["jumptype"])
		cardType := intFrom(typed["type"])
		if id != "" && (jumpType == 10014 || cardType == 500) && !stringSliceContains(output, id) {
			output = append(output, id)
		}
		for _, nested := range typed {
			output = collectRecommendPlaylistIDs(nested, output)
		}
	}
	return output
}

func (s *Server) fetchQqMusicDailyRecommendations(cookie string, limit int) ([]QqMusicSong, map[string]any) {
	if _, errPayload := s.ensureQqMusicLogin(cookie); errPayload != nil {
		return nil, errPayload
	}
	auth := getQqMusicAuth(cookie)
	data := map[string]any{
		"comm": map[string]any{"ct": "19", "cv": "1859", "uin": auth.Uin, "format": "json"},
		"req": map[string]any{
			"module": "music.recommend.RecommendFeed",
			"method": "get_recommend_feed",
			"param":  map[string]any{"page": 1, "direction": 0, "last_id": "0"},
		},
	}
	encoded, _ := json.Marshal(data)
	values := url.Values{}
	values.Set("data", string(encoded))
	endpoint := "https://u.y.qq.com/cgi-bin/musicu.fcg?" + values.Encode()
	response, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(cookie, nil), 2)
	if err != nil {
		return []QqMusicSong{}, nil
	}
	ids := collectRecommendPlaylistIDs(mapFrom(mapFrom(response["req"])["data"]), nil)
	for index, id := range ids {
		if index >= 8 {
			break
		}
		songs, err := s.fetchQqMusicPlaylistSongs(id, cookie, limit)
		if err == nil && len(songs) > 0 {
			return songs, nil
		}
	}
	return []QqMusicSong{}, nil
}

func (s *Server) getQqMusicLyric(id string, cookie string) (string, string, error) {
	values := url.Values{}
	values.Set("songmid", id)
	values.Set("pcachetime", strconv.FormatInt(time.Now().UnixMilli(), 10))
	auth := getQqMusicAuth(cookie)
	values.Set("g_tk", auth.GTK)
	values.Set("loginUin", auth.Uin)
	values.Set("hostUin", auth.Uin)
	values.Set("format", "json")
	values.Set("inCharset", "utf8")
	values.Set("outCharset", "utf-8")
	values.Set("notice", "0")
	values.Set("platform", "yqq.json")
	values.Set("needNewCode", "0")
	values.Set("nobase64", "1")
	endpoint := "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?" + values.Encode()
	data, err := s.fetchJSONWithRetry(endpoint, createQqMusicHeaders(cookie, nil), 2)
	if err != nil {
		return "", "", err
	}
	return decodeMaybeBase64(stringFrom(data["lyric"])), decodeMaybeBase64(stringFrom(data["trans"])), nil
}

func (s *Server) fetchJSONWithRetry(endpoint string, headers http.Header, retries int) (map[string]any, error) {
	var lastErr error
	for attempt := 0; attempt <= retries; attempt++ {
		data, err := s.fetchJSON(endpoint, headers)
		if err == nil {
			return data, nil
		}
		lastErr = err
		if attempt < retries {
			time.Sleep(time.Duration(180*(attempt+1)) * time.Millisecond)
		}
	}
	return nil, lastErr
}

func (s *Server) fetchJSON(endpoint string, headers http.Header) (map[string]any, error) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	for key, values := range headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	return parseJSONLike(raw)
}

func parseJSONLike(raw []byte) (map[string]any, error) {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return map[string]any{}, nil
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err == nil {
		return data, nil
	}
	start := strings.Index(text, "(")
	end := strings.LastIndex(text, ")")
	if start >= 0 && end > start {
		if err := json.Unmarshal([]byte(text[start+1:end]), &data); err == nil {
			return data, nil
		}
	}
	return nil, fmt.Errorf("invalid json response")
}

func (s *Server) getCachedSearch(key string) (searchPayload, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cached, ok := s.searchCache[key]
	if !ok || cached.ExpiresAt.Before(time.Now()) {
		return searchPayload{}, false
	}
	return cached.Payload, true
}

func (s *Server) setCachedSearch(key string, payload searchPayload) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.searchCache[key] = cachedSearch{Payload: payload, ExpiresAt: time.Now().Add(5 * time.Minute)}
}

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Not found"})
		return
	}
	if s.staticFS == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Static files are not embedded"})
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || strings.HasSuffix(r.URL.Path, "/") {
		name = path.Join(name, "index.html")
	}
	if s.tryServeStaticFile(w, r, name) {
		return
	}
	if !strings.Contains(path.Base(name), ".") && s.tryServeStaticFile(w, r, "index.html") {
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "Not found"})
}

func (s *Server) tryServeStaticFile(w http.ResponseWriter, r *http.Request, name string) bool {
	file, err := s.staticFS.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || stat.IsDir() {
		return false
	}
	if contentType := mime.TypeByExtension(path.Ext(name)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	reader, ok := file.(io.ReadSeeker)
	if !ok {
		data, err := io.ReadAll(file)
		if err != nil {
			return false
		}
		http.ServeContent(w, r, name, stat.ModTime(), strings.NewReader(string(data)))
		return true
	}
	http.ServeContent(w, r, name, stat.ModTime(), reader)
	return true
}

func createQqMusicHeaders(cookie string, extra http.Header) http.Header {
	headers := http.Header{}
	for key, value := range baseQqMusicHeaders {
		headers.Set(key, value)
	}
	if normalized := NormalizeQqMusicCookie(cookie); normalized != "" {
		headers.Set("Cookie", normalized)
	}
	for key, values := range extra {
		for _, value := range values {
			headers.Add(key, value)
		}
	}
	return headers
}

func mapQqMusicPlaylist(raw map[string]any) (QqMusicPlaylistSummary, bool) {
	id := strings.TrimSpace(firstNonEmpty(
		stringFrom(raw["disstid"]),
		stringFrom(raw["tid"]),
		stringFrom(raw["dissid"]),
		stringFrom(raw["id"]),
		stringFrom(raw["dirid"]),
	))
	name := strings.TrimSpace(firstNonEmpty(
		stringFrom(raw["dissname"]),
		stringFrom(raw["diss_name"]),
		stringFrom(raw["title"]),
		stringFrom(raw["name"]),
		stringFrom(raw["dirname"]),
	))
	if id == "" || name == "" {
		return QqMusicPlaylistSummary{}, false
	}
	return QqMusicPlaylistSummary{
		ID:    id,
		Name:  name,
		Count: intFrom(firstNonNil(raw["song_cnt"], raw["songnum"], raw["total_song_num"], raw["song_count"], raw["count"])),
		Cover: firstNonEmpty(stringFrom(raw["logo"]), stringFrom(raw["diss_cover"]), stringFrom(raw["cover"]), stringFrom(raw["picurl"]), stringFrom(raw["dir_pic_url2"])),
	}, true
}

func mapQqMusicPlaylists(values []any) []QqMusicPlaylistSummary {
	playlists := make([]QqMusicPlaylistSummary, 0, len(values))
	for _, value := range values {
		if playlist, ok := mapQqMusicPlaylist(mapFrom(value)); ok {
			playlists = append(playlists, playlist)
		}
	}
	return playlists
}

func uniqueQqMusicPlaylists(values []QqMusicPlaylistSummary) []QqMusicPlaylistSummary {
	seen := map[string]bool{}
	result := make([]QqMusicPlaylistSummary, 0, len(values))
	for _, playlist := range values {
		if playlist.ID == "" || seen[playlist.ID] {
			continue
		}
		seen[playlist.ID] = true
		result = append(result, playlist)
	}
	return result
}

func mapQqMusicSongs(values []any, limit int) []QqMusicSong {
	songs := make([]QqMusicSong, 0, minInt(len(values), limit))
	for _, value := range values {
		if len(songs) >= limit {
			break
		}
		if song, ok := mapQqMusicSong(mapFrom(value)); ok {
			songs = append(songs, song)
		}
	}
	return songs
}

func mapQqMusicSong(song map[string]any) (QqMusicSong, bool) {
	id := strings.TrimSpace(firstNonEmpty(
		stringFrom(song["mid"]),
		stringFrom(song["songmid"]),
		stringFrom(song["songMid"]),
		stringFrom(mapFrom(song["file"])["media_mid"]),
		stringFrom(song["strMediaMid"]),
	))
	name := strings.TrimSpace(firstNonEmpty(stringFrom(song["title"]), stringFrom(song["name"]), stringFrom(song["songname"])))
	if id == "" || name == "" {
		return QqMusicSong{}, false
	}
	singers := mapsFrom(sliceFrom(firstNonNil(song["singer"], song["singers"])))
	artistNames := make([]string, 0, len(singers))
	for _, singer := range singers {
		if name := stringFrom(singer["name"]); name != "" {
			artistNames = append(artistNames, name)
		}
	}
	album := mapFrom(song["album"])
	durationSeconds := intFrom(firstNonNil(song["interval"], song["duration"]))
	fee := 0
	if intFrom(firstNonNil(mapFrom(song["pay"])["pay_play"], mapFrom(song["pay"])["payplay"])) > 0 {
		fee = 1
	}
	return QqMusicSong{
		ID:       id,
		Name:     name,
		Artist:   strings.Join(artistNames, " / "),
		Album:    firstNonEmpty(stringFrom(album["name"]), stringFrom(album["title"]), stringFrom(song["albumname"])),
		Duration: durationSeconds * 1000,
		Fee:      fee,
	}, true
}

func pickQqSip(values []any) string {
	for _, value := range values {
		candidate := stringFrom(value)
		if strings.HasPrefix(candidate, "http") {
			return candidate
		}
	}
	return "https://isure.stream.qqmusic.qq.com/"
}

func decodeMaybeBase64(value string) string {
	if value == "" || strings.Contains(value, "[") {
		return value
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return value
	}
	return string(decoded)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func parseIntDefault(raw string, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func clamp(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func mapFrom(value any) map[string]any {
	if mapped, ok := value.(map[string]any); ok {
		return mapped
	}
	return map[string]any{}
}

func sliceFrom(value any) []any {
	if values, ok := value.([]any); ok {
		return values
	}
	return []any{}
}

func mapsFrom(values []any) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		if mapped := mapFrom(value); len(mapped) > 0 {
			result = append(result, mapped)
		}
	}
	return result
}

func stringFrom(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func intFrom(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	case string:
		parsed, _ := strconv.Atoi(typed)
		return parsed
	default:
		return 0
	}
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
