package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_Defaults(t *testing.T) {
	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "8080", cfg.Port)
	assert.Equal(t, "postgres://msgnr:msgnr@localhost/msgnr?sslmode=disable", cfg.DatabaseURL)
	assert.Equal(t, "change-me-in-production", cfg.JWTSecret)
	assert.Equal(t, int32(20), cfg.DBMaxConns)
	assert.Equal(t, int32(2), cfg.DBMinConns)
	assert.Equal(t, 1000, cfg.SyncEventLimit)
	assert.Equal(t, 500, cfg.MaxSyncBatch)
	assert.Equal(t, 100, cfg.BootstrapDefaultPageSize)
	assert.Equal(t, 50, cfg.ChatHistoryPageSize)
	assert.Equal(t, "9090", cfg.MetricsPort)
	assert.Equal(t, "*", cfg.CORSAllowedOrigins)
}

func TestLoad_EnvOverrides(t *testing.T) {
	os.Setenv("PORT", "9000")
	os.Setenv("DATABASE_URL", "postgres://test:123@localhost/testdb?sslmode=disable")
	os.Setenv("JWT_SECRET", "test-secret")
	os.Setenv("SYNC_EVENT_LIMIT", "500")
	os.Setenv("CHAT_HISTORY_PAGE_SIZE", "80")
	defer func() {
		os.Unsetenv("PORT")
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("JWT_SECRET")
		os.Unsetenv("SYNC_EVENT_LIMIT")
		os.Unsetenv("CHAT_HISTORY_PAGE_SIZE")
	}()

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "9000", cfg.Port)
	assert.Equal(t, "postgres://test:123@localhost/testdb?sslmode=disable", cfg.DatabaseURL)
	assert.Equal(t, "test-secret", cfg.JWTSecret)
	assert.Equal(t, 500, cfg.SyncEventLimit)
	assert.Equal(t, 80, cfg.ChatHistoryPageSize)
}

func TestIsDev(t *testing.T) {
	os.Setenv("ENV", "dev")
	defer os.Unsetenv("ENV")

	cfg, err := Load()
	require.NoError(t, err)
	assert.True(t, cfg.IsDev())
}
