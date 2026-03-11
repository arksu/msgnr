//go:build integration

package ws

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"msgnr/internal/config"
	"msgnr/internal/database"
	"msgnr/internal/testdb"
)

func TestIntegration_ExpireTyping_RechecksCurrentMembership(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	var senderID, remainingID, removedID, channelID uuid.UUID
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, 'x', 'sender', 'member') RETURNING id`,
		"sender_"+uuid.NewString()+"@example.com",
	).Scan(&senderID))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, 'x', 'remaining', 'member') RETURNING id`,
		"remaining_"+uuid.NewString()+"@example.com",
	).Scan(&remainingID))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, 'x', 'removed', 'member') RETURNING id`,
		"removed_"+uuid.NewString()+"@example.com",
	).Scan(&removedID))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by) VALUES ('channel', 'public', 'typing', $1) RETURNING id`,
		senderID,
	).Scan(&channelID))
	_, err := pool.Exec(ctx,
		`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3), ($1, $4)`,
		channelID, senderID, remainingID, removedID,
	)
	require.NoError(t, err)

	srv := &Server{
		db:             &database.DB{Pool: pool},
		config:         &config.Config{WsOutboundQueueMax: 8},
		log:            zap.NewNop(),
		sessionsByUser: make(map[string]map[chan outboundMsg]struct{}),
		typingExpiry:   make(map[string]time.Time),
	}

	remainingCh := make(chan outboundMsg, 1)
	removedCh := make(chan outboundMsg, 1)
	unregisterRemaining := srv.registerUserSession(remainingID.String(), remainingCh)
	defer unregisterRemaining()
	unregisterRemoved := srv.registerUserSession(removedID.String(), removedCh)
	defer unregisterRemoved()

	key := channelID.String() + "||" + senderID.String()
	expiresAt := time.Now().Add(40 * time.Millisecond)
	srv.typingMu.Lock()
	srv.typingExpiry[key] = expiresAt
	srv.typingMu.Unlock()

	go srv.expireTyping(key, channelID.String(), "", senderID, expiresAt)

	time.Sleep(10 * time.Millisecond)
	_, err = pool.Exec(ctx, `DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`, channelID, removedID)
	require.NoError(t, err)

	select {
	case msg := <-remainingCh:
		require.NotNil(t, msg.env)
		require.NotNil(t, msg.env.GetTypingEvent())
		assert.False(t, msg.env.GetTypingEvent().GetIsTyping())
		assert.Equal(t, channelID.String(), msg.env.GetTypingEvent().GetConversationId())
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for typing expiry event")
	}

	select {
	case msg := <-removedCh:
		t.Fatalf("removed member received stale typing expiry event: %#v", msg.env)
	case <-time.After(120 * time.Millisecond):
	}
}
