//go:build integration

package sync_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"

	"msgnr/internal/auth"
	"msgnr/internal/config"
	"msgnr/internal/events"
	packetspb "msgnr/internal/gen/proto"
	syncsvc "msgnr/internal/sync"
	"msgnr/internal/testdb"
)

func seedSyncUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Sync User', 'member')
		 RETURNING id`,
		"sync_"+uuid.NewString()+"@example.com",
	).Scan(&userID)
	require.NoError(t, err)
	return userID
}

func seedSyncChannel(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) uuid.UUID {
	t.Helper()
	var channelID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'sync', $1)
		 RETURNING id`,
		userID,
	).Scan(&channelID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, channelID, userID)
	require.NoError(t, err)
	return channelID
}

func appendStoredEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, store *events.Store, channelID uuid.UUID, body string, occurredAt time.Time) int64 {
	t.Helper()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx) //nolint:errcheck

	msg := &packetspb.MessageEvent{
		ConversationId: channelID.String(),
		MessageId:      uuid.NewString(),
		SenderId:       uuid.NewString(),
		Body:           body,
		ChannelSeq:     1,
	}
	payload, err := protojson.Marshal(msg)
	require.NoError(t, err)

	stored, err := store.AppendEventTx(ctx, tx, events.AppendParams{
		EventID:     uuid.NewString(),
		EventType:   "message_created",
		ChannelID:   channelID.String(),
		PayloadJSON: payload,
		OccurredAt:  occurredAt,
	})
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
	return stored.Seq
}

func TestIntegration_SyncSince_ContiguousGap(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	cfg := &config.Config{MaxSyncBatch: 10, SyncEventLimit: 10, SyncRetentionWindow: 72}
	svc := syncsvc.NewService(pool, cfg, store)
	userID := seedSyncUser(t, ctx, pool)
	channelID := seedSyncChannel(t, ctx, pool, userID)

	appendStoredEvent(t, ctx, pool, store, channelID, "one", time.Now().Add(-2*time.Minute))
	appendStoredEvent(t, ctx, pool, store, channelID, "two", time.Now().Add(-1*time.Minute))

	resp, err := svc.SyncSince(ctx, auth.Principal{UserID: userID}, &packetspb.SyncSinceRequest{
		AfterSeq:  0,
		MaxEvents: 10,
	})
	require.NoError(t, err)
	require.False(t, resp.GetNeedFullBootstrap())
	require.Len(t, resp.GetEvents(), 2)
	assert.Equal(t, int64(1), resp.GetFromSeq())
	assert.Equal(t, int64(2), resp.GetToSeq())
}

func TestIntegration_SyncSince_GapTooLarge(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	cfg := &config.Config{MaxSyncBatch: 10, SyncEventLimit: 1, SyncRetentionWindow: 72}
	svc := syncsvc.NewService(pool, cfg, store)
	userID := seedSyncUser(t, ctx, pool)
	channelID := seedSyncChannel(t, ctx, pool, userID)

	appendStoredEvent(t, ctx, pool, store, channelID, "one", time.Now().Add(-2*time.Minute))
	appendStoredEvent(t, ctx, pool, store, channelID, "two", time.Now().Add(-1*time.Minute))

	resp, err := svc.SyncSince(ctx, auth.Principal{UserID: userID}, &packetspb.SyncSinceRequest{
		AfterSeq:  0,
		MaxEvents: 10,
	})
	require.NoError(t, err)
	require.True(t, resp.GetNeedFullBootstrap())
	assert.Equal(t, packetspb.SyncBootstrapReason_SYNC_BOOTSTRAP_REASON_GAP_TOO_LARGE, resp.GetNeedFullBootstrapReason())
}

func TestIntegration_SyncSince_GapOutOfRetention(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	cfg := &config.Config{MaxSyncBatch: 10, SyncEventLimit: 10, SyncRetentionWindow: 1}
	svc := syncsvc.NewService(pool, cfg, store)
	userID := seedSyncUser(t, ctx, pool)
	channelID := seedSyncChannel(t, ctx, pool, userID)

	appendStoredEvent(t, ctx, pool, store, channelID, "old", time.Now().Add(-3*time.Hour))
	appendStoredEvent(t, ctx, pool, store, channelID, "new", time.Now())

	resp, err := svc.SyncSince(ctx, auth.Principal{UserID: userID}, &packetspb.SyncSinceRequest{
		AfterSeq:  0,
		MaxEvents: 10,
	})
	require.NoError(t, err)
	require.True(t, resp.GetNeedFullBootstrap())
	assert.Equal(t, packetspb.SyncBootstrapReason_SYNC_BOOTSTRAP_REASON_GAP_OUT_OF_RETENTION, resp.GetNeedFullBootstrapReason())
}

func TestIntegration_Ack_IsMonotonic(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	cfg := &config.Config{MaxSyncBatch: 10, SyncEventLimit: 10, SyncRetentionWindow: 72}
	svc := syncsvc.NewService(pool, cfg, store)
	userID := seedSyncUser(t, ctx, pool)

	first, err := svc.Ack(ctx, auth.Principal{UserID: userID}, &packetspb.AckRequest{LastAppliedEventSeq: 10})
	require.NoError(t, err)
	second, err := svc.Ack(ctx, auth.Principal{UserID: userID}, &packetspb.AckRequest{LastAppliedEventSeq: 5})
	require.NoError(t, err)

	assert.Equal(t, int64(10), first.GetPersistedEventSeq())
	assert.Equal(t, int64(10), second.GetPersistedEventSeq())
	persisted, err := svc.GetPersistedCursor(ctx, userID)
	require.NoError(t, err)
	assert.Equal(t, int64(10), persisted)
}

func TestIntegration_SyncSince_EmptyTableAfterPruneRequiresBootstrap(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	cfg := &config.Config{MaxSyncBatch: 10, SyncEventLimit: 10, SyncRetentionWindow: 1}
	svc := syncsvc.NewService(pool, cfg, store)
	userID := seedSyncUser(t, ctx, pool)
	channelID := seedSyncChannel(t, ctx, pool, userID)

	appendStoredEvent(t, ctx, pool, store, channelID, "old", time.Now().Add(-3*time.Hour))

	resp, err := svc.SyncSince(ctx, auth.Principal{UserID: userID}, &packetspb.SyncSinceRequest{
		AfterSeq:  1,
		MaxEvents: 10,
	})
	require.NoError(t, err)
	require.True(t, resp.GetNeedFullBootstrap())
	assert.Equal(t, packetspb.SyncBootstrapReason_SYNC_BOOTSTRAP_REASON_GAP_OUT_OF_RETENTION, resp.GetNeedFullBootstrapReason())
}
