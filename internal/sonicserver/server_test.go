package sonicserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestNormalizeQqMusicCookie(t *testing.T) {
	input := " a=1;; \n\n b=2; \r\n c=3;;; "
	got := NormalizeQqMusicCookie(input)
	want := "a=1; b=2; c=3"
	if got != want {
		t.Fatalf("NormalizeQqMusicCookie() = %q, want %q", got, want)
	}
}

func TestNormalizePlaylistsReturnsDefaultsForEmptyInput(t *testing.T) {
	got := NormalizePlaylists(nil)
	if len(got) != 2 {
		t.Fatalf("NormalizePlaylists(nil) returned %d playlists, want 2", len(got))
	}
	if got[0].ID != "favorites" || got[1].ID != "visual-set" {
		t.Fatalf("default playlist IDs = %q, %q", got[0].ID, got[1].ID)
	}
}

func TestPlaylistsAPIReadsAndWritesUserDataFile(t *testing.T) {
	dir := t.TempDir()
	server := New(Config{PlaylistsPath: filepath.Join(dir, "playlists.json")})

	body := bytes.NewBufferString(`{"playlists":[{"id":"mine","name":"我的歌单","songs":[{"id":"001ABC","name":"Song"}]}]}`)
	put := httptest.NewRequest(http.MethodPut, "/api/playlists", body)
	put.Header.Set("Content-Type", "application/json")
	putRecorder := httptest.NewRecorder()

	server.ServeHTTP(putRecorder, put)
	if putRecorder.Code != http.StatusOK {
		t.Fatalf("PUT /api/playlists status = %d, body = %s", putRecorder.Code, putRecorder.Body.String())
	}

	get := httptest.NewRequest(http.MethodGet, "/api/playlists", nil)
	getRecorder := httptest.NewRecorder()
	server.ServeHTTP(getRecorder, get)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("GET /api/playlists status = %d, body = %s", getRecorder.Code, getRecorder.Body.String())
	}

	var payload struct {
		Playlists []Playlist `json:"playlists"`
	}
	if err := json.Unmarshal(getRecorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(payload.Playlists) != 1 || payload.Playlists[0].ID != "mine" || payload.Playlists[0].Name != "我的歌单" {
		t.Fatalf("playlists response = %#v", payload.Playlists)
	}
}
