//go:build integration

package chat_test

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"msgnr/internal/chat"
	"msgnr/internal/events"
	packetspb "msgnr/internal/gen/proto"
	"msgnr/internal/testdb"
)

// seedUserAndChannel inserts a user, channel, and channel_member row and returns their IDs.
func seedUserAndChannel(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (userID uuid.UUID, channelID uuid.UUID) {
	t.Helper()

	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Test User', 'member')
		 RETURNING id`,
		"testuser_"+uuid.New().String()+"@example.com",
	).Scan(&userID)
	require.NoError(t, err)

	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'test', $1)
		 RETURNING id`,
		userID,
	).Scan(&channelID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`,
		channelID, userID,
	)
	require.NoError(t, err)

	return userID, channelID
}

func seedChannelForUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, name string) uuid.UUID {
	t.Helper()

	var channelID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', $1, $2)
		 RETURNING id`,
		name, userID,
	).Scan(&channelID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`,
		channelID, userID,
	)
	require.NoError(t, err)
	return channelID
}

func TestIntegration_SendMessage_Basic(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	result, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "hello world",
	})
	require.NoError(t, err)
	assert.False(t, result.Deduped)
	assert.NotEqual(t, uuid.Nil, result.MessageID)
	assert.Equal(t, int64(1), result.ChannelSeq)

	var evtType string
	err = pool.QueryRow(ctx,
		`SELECT event_type FROM workspace_events WHERE channel_id = $1 ORDER BY event_seq DESC LIMIT 1`,
		channelID,
	).Scan(&evtType)
	require.NoError(t, err)
	assert.Equal(t, "message_created", evtType)
}

func TestIntegration_SendMessage_Dedup(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)
	clientMsgID := uuid.New().String()

	r1, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: clientMsgID,
		Body:        "first send",
	})
	require.NoError(t, err)
	require.False(t, r1.Deduped)

	r2, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: clientMsgID,
		Body:        "first send",
	})
	require.NoError(t, err)
	assert.True(t, r2.Deduped)
	assert.Equal(t, r1.MessageID, r2.MessageID)

	var count int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM messages WHERE channel_id = $1 AND client_msg_id = $2`,
		channelID, clientMsgID,
	).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestIntegration_SendMessage_DedupScopedBySender(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	user1, channelID := seedUserAndChannel(t, ctx, pool)

	var user2 uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'User2', 'member')
		 RETURNING id`,
		"testuser_"+uuid.New().String()+"@example.com",
	).Scan(&user2)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, channelID, user2)
	require.NoError(t, err)

	clientMsgID := uuid.New().String()
	r1, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    user1,
		ClientMsgID: clientMsgID,
		Body:        "from user1",
	})
	require.NoError(t, err)
	require.False(t, r1.Deduped)

	r2, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    user2,
		ClientMsgID: clientMsgID,
		Body:        "from user2",
	})
	require.NoError(t, err)
	require.False(t, r2.Deduped)
	require.NotEqual(t, r1.MessageID, r2.MessageID)
}

func TestIntegration_SendMessage_ThreadSeqMonotonic(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	root, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "root",
	})
	require.NoError(t, err)

	for i := 0; i < 3; i++ {
		_, err := svc.SendMessage(ctx, chat.SendMessageParams{
			ChannelID:           channelID,
			SenderID:            userID,
			ClientMsgID:         uuid.New().String(),
			Body:                "reply",
			ThreadRootMessageID: root.MessageID,
		})
		require.NoError(t, err)
	}

	rows, err := pool.Query(ctx,
		`SELECT thread_seq FROM messages WHERE thread_root_id = $1 ORDER BY thread_seq ASC`,
		root.MessageID,
	)
	require.NoError(t, err)
	defer rows.Close()

	var threadSeqs []int64
	for rows.Next() {
		var s int64
		require.NoError(t, rows.Scan(&s))
		threadSeqs = append(threadSeqs, s)
	}
	require.NoError(t, rows.Err())

	require.Len(t, threadSeqs, 3)
	for i := 1; i < len(threadSeqs); i++ {
		assert.Greater(t, threadSeqs[i], threadSeqs[i-1])
	}
}

func TestIntegration_Reaction_Idempotent(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	msg, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "hello",
	})
	require.NoError(t, err)

	p := chat.ReactionParams{
		ChannelID:  channelID,
		MessageID:  msg.MessageID,
		UserID:     userID,
		Emoji:      "👍",
		ClientOpID: uuid.New().String(),
	}

	// First add — applied.
	r1, err := svc.AddReaction(ctx, p)
	require.NoError(t, err)
	assert.True(t, r1.Applied)

	// Second add — no-op.
	r2, err := svc.AddReaction(ctx, p)
	require.NoError(t, err)
	assert.False(t, r2.Applied)

	var count int
	err = pool.QueryRow(ctx,
		`SELECT count FROM reaction_counts WHERE message_id = $1 AND emoji = $2`,
		msg.MessageID, "👍",
	).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Remove — applied.
	r3, err := svc.RemoveReaction(ctx, p)
	require.NoError(t, err)
	assert.True(t, r3.Applied)

	// Remove again — no-op.
	r4, err := svc.RemoveReaction(ctx, p)
	require.NoError(t, err)
	assert.False(t, r4.Applied)

	// Count row should be gone.
	var countAfter int
	err = pool.QueryRow(ctx,
		`SELECT count FROM reaction_counts WHERE message_id = $1 AND emoji = $2`,
		msg.MessageID, "👍",
	).Scan(&countAfter)
	assert.Error(t, err, "reaction_counts row should have been deleted")
}

func TestIntegration_ListDMCandidates_ExcludesSelfAndBlockedUsers(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var selfID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Self', 'member')
		 RETURNING id`,
		"self_"+uuid.New().String()+"@example.com",
	).Scan(&selfID)
	require.NoError(t, err)

	var activeID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Active User', 'member')
		 RETURNING id`,
		"active_"+uuid.New().String()+"@example.com",
	).Scan(&activeID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO users (email, password_hash, display_name, role, status)
		 VALUES ($1, 'x', 'Blocked User', 'member', 'blocked')`,
		"blocked_"+uuid.New().String()+"@example.com",
	)
	require.NoError(t, err)

	candidates, err := svc.ListDMCandidates(ctx, selfID)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, activeID, candidates[0].UserID)
	assert.Equal(t, "Active User", candidates[0].DisplayName)
}

func TestIntegration_CreateOrOpenDirectMessage_ReusesExistingPair(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var selfID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Ada', 'member')
		 RETURNING id`,
		"ada_"+uuid.New().String()+"@example.com",
	).Scan(&selfID)
	require.NoError(t, err)

	var otherID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Bob', 'member')
		 RETURNING id`,
		"bob_"+uuid.New().String()+"@example.com",
	).Scan(&otherID)
	require.NoError(t, err)

	first, err := svc.CreateOrOpenDirectMessage(ctx, selfID, otherID)
	require.NoError(t, err)
	assert.Equal(t, otherID, first.DM.UserID)
	assert.Equal(t, "Bob", first.DM.DisplayName)
	assert.Equal(t, "dm", first.DM.Visibility)

	second, err := svc.CreateOrOpenDirectMessage(ctx, selfID, otherID)
	require.NoError(t, err)
	assert.Equal(t, first.DM.ConversationID, second.DM.ConversationID)

	var memberCount int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM channel_members WHERE channel_id = $1`,
		first.DM.ConversationID,
	).Scan(&memberCount)
	require.NoError(t, err)
	assert.Equal(t, 2, memberCount)
}

func TestIntegration_CreateOrOpenDirectMessage_ReopensArchivedPair(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var selfID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Ada', 'member')
		 RETURNING id`,
		"ada_"+uuid.New().String()+"@example.com",
	).Scan(&selfID)
	require.NoError(t, err)

	var otherID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Bob', 'member')
		 RETURNING id`,
		"bob_"+uuid.New().String()+"@example.com",
	).Scan(&otherID)
	require.NoError(t, err)

	created, err := svc.CreateOrOpenDirectMessage(ctx, selfID, otherID)
	require.NoError(t, err)
	require.Len(t, created.DirectDeliveries, 2)

	_, err = svc.LeaveConversation(ctx, selfID, created.DM.ConversationID)
	require.NoError(t, err)

	reopened, err := svc.CreateOrOpenDirectMessage(ctx, selfID, otherID)
	require.NoError(t, err)
	assert.Equal(t, created.DM.ConversationID, reopened.DM.ConversationID)
	require.Len(t, reopened.DirectDeliveries, 2)

	var archivedCount int
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM channel_members
		 WHERE channel_id = $1
		   AND is_archived = true`,
		reopened.DM.ConversationID,
	).Scan(&archivedCount)
	require.NoError(t, err)
	assert.Equal(t, 0, archivedCount)
}

func TestIntegration_CreateOrOpenDirectMessage_ReusesArchivedDMChannel(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var selfID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Ada', 'member')
		 RETURNING id`,
		"ada_"+uuid.New().String()+"@example.com",
	).Scan(&selfID)
	require.NoError(t, err)

	var otherID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Bob', 'member')
		 RETURNING id`,
		"bob_"+uuid.New().String()+"@example.com",
	).Scan(&otherID)
	require.NoError(t, err)

	created, err := svc.CreateOrOpenDirectMessage(ctx, selfID, otherID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `UPDATE channels SET is_archived = true WHERE id = $1`, created.DM.ConversationID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		UPDATE channel_members
		   SET is_archived = true
		 WHERE channel_id = $1
		   AND user_id = $2`,
		created.DM.ConversationID, selfID,
	)
	require.NoError(t, err)

	reopened, err := svc.CreateOrOpenDirectMessage(ctx, selfID, otherID)
	require.NoError(t, err)
	assert.Equal(t, created.DM.ConversationID, reopened.DM.ConversationID)

	var dmChannelCount int
	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM channels WHERE kind = 'dm'`).Scan(&dmChannelCount)
	require.NoError(t, err)
	assert.Equal(t, 1, dmChannelCount)
}

func TestIntegration_SendMessage_ReopensArchivedDMPeerWithUnread(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var userA uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'User A', 'member')
		 RETURNING id`,
		"usera_"+uuid.New().String()+"@example.com",
	).Scan(&userA)
	require.NoError(t, err)

	var userB uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'User B', 'member')
		 RETURNING id`,
		"userb_"+uuid.New().String()+"@example.com",
	).Scan(&userB)
	require.NoError(t, err)

	dm, err := svc.CreateOrOpenDirectMessage(ctx, userA, userB)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO user_presence (user_id, status) VALUES ($1, 'online')
		 ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status`,
		userB,
	)
	require.NoError(t, err)

	_, err = svc.LeaveConversation(ctx, userA, dm.DM.ConversationID)
	require.NoError(t, err)

	sendResult, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   dm.DM.ConversationID,
		SenderID:    userB,
		ClientMsgID: uuid.New().String(),
		Body:        "hello after leave",
	})
	require.NoError(t, err)

	var isArchived bool
	err = pool.QueryRow(ctx,
		`SELECT is_archived FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
		dm.DM.ConversationID, userA,
	).Scan(&isArchived)
	require.NoError(t, err)
	assert.False(t, isArchived)

	var sawUpsert bool
	var upsertPresence packetspb.PresenceStatus
	for _, delivery := range sendResult.DirectDeliveries {
		if delivery.UserID != userA.String() || delivery.Event == nil {
			continue
		}
		switch delivery.Event.GetEventType() {
		case packetspb.EventType_EVENT_TYPE_CONVERSATION_UPSERTED:
			sawUpsert = true
			upsertPresence = delivery.Event.GetConversationUpserted().GetConversation().GetPresence()
		}
	}
	assert.True(t, sawUpsert)
	assert.Equal(t, packetspb.PresenceStatus_PRESENCE_STATUS_ONLINE, upsertPresence)

	messages, _, err := svc.ListMessagePage(ctx, userA, dm.DM.ConversationID, nil, 20)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, "hello after leave", messages[0].Body)
}

func TestIntegration_LeaveConversation_ArchivesMembershipAndIsIdempotent(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	_, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "history should remain",
	})
	require.NoError(t, err)

	first, err := svc.LeaveConversation(ctx, userID, channelID)
	require.NoError(t, err)
	require.Len(t, first.DirectDeliveries, 1)
	require.NotNil(t, first.DirectDeliveries[0].Event)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_CONVERSATION_REMOVED, first.DirectDeliveries[0].Event.GetEventType())

	second, err := svc.LeaveConversation(ctx, userID, channelID)
	require.NoError(t, err)
	require.Len(t, second.DirectDeliveries, 0)

	var isArchived bool
	err = pool.QueryRow(ctx,
		`SELECT is_archived FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID,
	).Scan(&isArchived)
	require.NoError(t, err)
	assert.True(t, isArchived)

	var msgCount int
	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM messages WHERE channel_id = $1`, channelID).Scan(&msgCount)
	require.NoError(t, err)
	assert.Equal(t, 1, msgCount)

	_, _, err = svc.ListMessagePage(ctx, userID, channelID, nil, 20)
	require.Error(t, err)
	assert.True(t, errors.Is(err, chat.ErrNotMember))
}

func TestIntegration_ListAvailablePublicChannels_ExcludesJoinedPrivateArchivedAndDM(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var userID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Self', 'member')
		 RETURNING id`,
		"self_"+uuid.New().String()+"@example.com",
	).Scan(&userID)
	require.NoError(t, err)

	var publicJoinedID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'Joined', $1)
		 RETURNING id`,
		userID,
	).Scan(&publicJoinedID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, publicJoinedID, userID)
	require.NoError(t, err)

	var publicAvailableOne uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'Alpha', $1)
		 RETURNING id`,
		userID,
	).Scan(&publicAvailableOne)
	require.NoError(t, err)

	var publicAvailableTwo uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'Zulu', $1)
		 RETURNING id`,
		userID,
	).Scan(&publicAvailableTwo)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'private', 'Private', $1),
		        ('dm', 'dm', '', $1),
		        ('channel', 'public', 'Archived', $1)`,
		userID,
	)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE channels SET is_archived = true WHERE name = 'Archived'`)
	require.NoError(t, err)

	channels, err := svc.ListAvailablePublicChannels(ctx, userID)
	require.NoError(t, err)
	require.Len(t, channels, 2)
	assert.Equal(t, publicAvailableOne, channels[0].ID)
	assert.Equal(t, publicAvailableTwo, channels[1].ID)
}

func TestIntegration_JoinPublicChannels_JoinsInRequestedOrder(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var userID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Self', 'member')
		 RETURNING id`,
		"self_"+uuid.New().String()+"@example.com",
	).Scan(&userID)
	require.NoError(t, err)

	var channelA uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'Alpha', $1)
		 RETURNING id`,
		userID,
	).Scan(&channelA)
	require.NoError(t, err)

	var channelB uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'Beta', $1)
		 RETURNING id`,
		userID,
	).Scan(&channelB)
	require.NoError(t, err)

	joined, err := svc.JoinPublicChannels(ctx, userID, []uuid.UUID{channelB, channelA, channelB})
	require.NoError(t, err)
	require.Len(t, joined, 2)
	assert.Equal(t, channelB, joined[0].ID)
	assert.Equal(t, channelA, joined[1].ID)

	var memberCount int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM channel_members
		  WHERE user_id = $1 AND channel_id IN ($2, $3)`,
		userID, channelA, channelB,
	).Scan(&memberCount)
	require.NoError(t, err)
	assert.Equal(t, 2, memberCount)
}

func TestIntegration_JoinPublicChannels_RestoresArchivedMembership(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var userID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Self', 'member')
		 RETURNING id`,
		"self_"+uuid.New().String()+"@example.com",
	).Scan(&userID)
	require.NoError(t, err)

	var channelID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'public', 'Alpha', $1)
		 RETURNING id`,
		userID,
	).Scan(&channelID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO channel_members (channel_id, user_id, is_archived) VALUES ($1, $2, true)`,
		channelID, userID,
	)
	require.NoError(t, err)

	joined, err := svc.JoinPublicChannels(ctx, userID, []uuid.UUID{channelID})
	require.NoError(t, err)
	require.Len(t, joined, 1)
	assert.Equal(t, channelID, joined[0].ID)

	var isArchived bool
	err = pool.QueryRow(ctx,
		`SELECT is_archived FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID,
	).Scan(&isArchived)
	require.NoError(t, err)
	assert.False(t, isArchived)
}

func TestIntegration_InviteToChannel_PrivateRestoresArchivedMembership(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	var requesterID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Requester', 'member')
		 RETURNING id`,
		"requester_"+uuid.New().String()+"@example.com",
	).Scan(&requesterID)
	require.NoError(t, err)

	var targetID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Target', 'member')
		 RETURNING id`,
		"target_"+uuid.New().String()+"@example.com",
	).Scan(&targetID)
	require.NoError(t, err)

	var channelID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO channels (kind, visibility, name, created_by)
		 VALUES ('channel', 'private', 'Private', $1)
		 RETURNING id`,
		requesterID,
	).Scan(&channelID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO channel_members (channel_id, user_id, is_archived)
		 VALUES ($1, $2, false), ($1, $3, true)`,
		channelID, requesterID, targetID,
	)
	require.NoError(t, err)

	result, err := svc.InviteToChannel(ctx, requesterID, channelID, targetID)
	require.NoError(t, err)
	require.Len(t, result.DirectDeliveries, 1)
	require.NotNil(t, result.DirectDeliveries[0].Event)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_CONVERSATION_UPSERTED, result.DirectDeliveries[0].Event.GetEventType())

	var isArchived bool
	err = pool.QueryRow(ctx,
		`SELECT is_archived FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
		channelID, targetID,
	).Scan(&isArchived)
	require.NoError(t, err)
	assert.False(t, isArchived)
}

func TestIntegration_AddReaction_RejectsChannelMismatch(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channel1 := seedUserAndChannel(t, ctx, pool)
	channel2 := seedChannelForUser(t, ctx, pool, userID, "second")

	msg, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channel1,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "hello",
	})
	require.NoError(t, err)

	_, err = svc.AddReaction(ctx, chat.ReactionParams{
		ChannelID:  channel2,
		MessageID:  msg.MessageID,
		UserID:     userID,
		Emoji:      "👍",
		ClientOpID: uuid.New().String(),
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, chat.ErrMessageNotFound))
}

func TestIntegration_SubscribeThread_RejectsChannelMismatch(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channel1 := seedUserAndChannel(t, ctx, pool)
	channel2 := seedChannelForUser(t, ctx, pool, userID, "other")

	root, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channel1,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "root",
	})
	require.NoError(t, err)

	_, err = svc.SubscribeThread(ctx, chat.SubscribeThreadParams{
		ChannelID:           channel2,
		ThreadRootMessageID: root.MessageID,
		RequesterID:         userID,
		LastThreadSeq:       0,
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, chat.ErrInvalidThread))
}

func TestIntegration_SendMessage_EmitsWorkspaceEvent(t *testing.T) {
	pool, connStr := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	bus := events.NewBus(zap.NewNop())
	svc := chat.NewService(pool, store)

	l := events.NewListener(events.ListenerConfig{
		DSN:             connStr,
		CatchUpBatch:    100,
		RetryBackoff:    100 * time.Millisecond,
		RetryBackoffMax: 500 * time.Millisecond,
	}, store, bus, zap.NewNop())
	lctx, lcancel := context.WithCancel(ctx)
	stopped := make(chan struct{})
	go func() { defer close(stopped); l.Run(lctx) }()
	t.Cleanup(func() { lcancel(); <-stopped })

	time.Sleep(300 * time.Millisecond)

	_, evtCh, unsub := bus.Subscribe(nil, 32)
	t.Cleanup(unsub)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	_, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "event test",
	})
	require.NoError(t, err)

	select {
	case evt := <-evtCh:
		assert.Equal(t, packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED, evt.GetEventType())
		assert.Equal(t, channelID.String(), evt.GetConversationId())
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for message_created event")
	}
}

func TestIntegration_UpdateReadCursor_ResolvesMentionNotifications(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	authorID, channelID := seedUserAndChannel(t, ctx, pool)

	var mentionedUserID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Mentioned', 'member')
		 RETURNING id`,
		"mentioned_"+uuid.New().String()+"@example.com",
	).Scan(&mentionedUserID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, channelID, mentionedUserID)
	require.NoError(t, err)

	msg, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    authorID,
		ClientMsgID: uuid.New().String(),
		Body:        "hello @" + mentionedUserID.String(),
	})
	require.NoError(t, err)
	require.Len(t, msg.DirectDeliveries, 1)
	assert.Equal(t, mentionedUserID.String(), msg.DirectDeliveries[0].UserID)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_NOTIFICATION_ADDED, msg.DirectDeliveries[0].Event.GetEventType())

	var unresolvedBefore int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND resolved_at IS NULL`,
		mentionedUserID,
	).Scan(&unresolvedBefore)
	require.NoError(t, err)
	require.Equal(t, 1, unresolvedBefore)

	ack, err := svc.UpdateReadCursor(ctx, chat.UpdateReadCursorParams{
		ChannelID:   channelID,
		UserID:      mentionedUserID,
		LastReadSeq: msg.ChannelSeq,
	})
	require.NoError(t, err)
	assert.Equal(t, channelID, ack.ChannelID)
	assert.Equal(t, msg.ChannelSeq, ack.LastReadSeq)
	assert.Equal(t, int32(0), ack.Counter.UnreadMessages)
	assert.Equal(t, int32(0), ack.Counter.UnreadMentions)
	require.Len(t, ack.DirectDeliveries, 2)

	var unresolvedAfter int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND resolved_at IS NULL`,
		mentionedUserID,
	).Scan(&unresolvedAfter)
	require.NoError(t, err)
	assert.Equal(t, 0, unresolvedAfter)

	var resolvedEvents int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM workspace_events WHERE event_type = 'notification_resolved' AND channel_id = $1`,
		channelID,
	).Scan(&resolvedEvents)
	require.NoError(t, err)
	assert.Equal(t, 0, resolvedEvents)

	var addedEvents int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM workspace_events WHERE event_type = 'notification_added' AND channel_id = $1`,
		channelID,
	).Scan(&addedEvents)
	require.NoError(t, err)
	assert.Equal(t, 0, addedEvents)

	var readCounterEvents int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM workspace_events WHERE event_type = 'read_counter_updated' AND channel_id = $1`,
		channelID,
	).Scan(&readCounterEvents)
	require.NoError(t, err)
	assert.Equal(t, 0, readCounterEvents)
}

func TestIntegration_SubscribeThread_AdvancesThreadReadState(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	root, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "root",
	})
	require.NoError(t, err)

	for i := 0; i < 2; i++ {
		_, err := svc.SendMessage(ctx, chat.SendMessageParams{
			ChannelID:           channelID,
			SenderID:            userID,
			ClientMsgID:         uuid.New().String(),
			Body:                "reply",
			ThreadRootMessageID: root.MessageID,
		})
		require.NoError(t, err)
	}

	resp, err := svc.SubscribeThread(ctx, chat.SubscribeThreadParams{
		ChannelID:           channelID,
		ThreadRootMessageID: root.MessageID,
		RequesterID:         userID,
		LastThreadSeq:       0,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(2), resp.CurrentThreadSeq)
	require.Len(t, resp.DirectDeliveries, 1)
	assert.Equal(t, userID.String(), resp.DirectDeliveries[0].UserID)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_READ_COUNTER_UPDATED, resp.DirectDeliveries[0].Event.GetEventType())
	readCounter := resp.DirectDeliveries[0].Event.GetReadCounterUpdated()
	require.NotNil(t, readCounter)
	require.NotNil(t, readCounter.Counter)
	assert.Equal(t, int32(0), readCounter.Counter.UnreadMessages)
	assert.False(t, readCounter.Counter.HasUnreadThreadReplies)

	var lastReadThreadSeq int64
	err = pool.QueryRow(ctx,
		`SELECT last_read_thread_seq FROM thread_reads WHERE root_message_id = $1 AND user_id = $2`,
		root.MessageID, userID,
	).Scan(&lastReadThreadSeq)
	require.NoError(t, err)
	assert.Equal(t, int64(2), lastReadThreadSeq)
}

func TestIntegration_SubscribeThread_WithZeroReplies_ReturnsEmptyReplayAndNoError(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	root, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "root without replies",
	})
	require.NoError(t, err)

	resp, err := svc.SubscribeThread(ctx, chat.SubscribeThreadParams{
		ChannelID:           channelID,
		ThreadRootMessageID: root.MessageID,
		RequesterID:         userID,
		LastThreadSeq:       0,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(0), resp.CurrentThreadSeq)
	assert.Len(t, resp.Replay, 0)
	require.Len(t, resp.DirectDeliveries, 1)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_READ_COUNTER_UPDATED, resp.DirectDeliveries[0].Event.GetEventType())
}

func TestIntegration_ThreadReplies_DoNotIncreaseUnreadMessages_AndSubscribeClearsThreadUnread(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	authorID, channelID := seedUserAndChannel(t, ctx, pool)

	var replierID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Replier', 'member')
		 RETURNING id`,
		"replier_"+uuid.New().String()+"@example.com",
	).Scan(&replierID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, channelID, replierID)
	require.NoError(t, err)

	root, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    authorID,
		ClientMsgID: uuid.New().String(),
		Body:        "root",
	})
	require.NoError(t, err)

	_, err = svc.UpdateReadCursor(ctx, chat.UpdateReadCursorParams{
		ChannelID:   channelID,
		UserID:      authorID,
		LastReadSeq: root.ChannelSeq,
	})
	require.NoError(t, err)

	_, err = svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:           channelID,
		SenderID:            replierID,
		ClientMsgID:         uuid.New().String(),
		Body:                "thread reply",
		ThreadRootMessageID: root.MessageID,
	})
	require.NoError(t, err)

	ackBeforeSubscribe, err := svc.UpdateReadCursor(ctx, chat.UpdateReadCursorParams{
		ChannelID:   channelID,
		UserID:      authorID,
		LastReadSeq: root.ChannelSeq,
	})
	require.NoError(t, err)
	assert.Equal(t, int32(0), ackBeforeSubscribe.Counter.UnreadMessages)
	assert.True(t, ackBeforeSubscribe.Counter.HasUnreadThreadReplies)

	subscribeResp, err := svc.SubscribeThread(ctx, chat.SubscribeThreadParams{
		ChannelID:           channelID,
		ThreadRootMessageID: root.MessageID,
		RequesterID:         authorID,
		LastThreadSeq:       0,
	})
	require.NoError(t, err)
	require.Len(t, subscribeResp.DirectDeliveries, 1)
	assert.Equal(t, packetspb.EventType_EVENT_TYPE_READ_COUNTER_UPDATED, subscribeResp.DirectDeliveries[0].Event.GetEventType())
	updated := subscribeResp.DirectDeliveries[0].Event.GetReadCounterUpdated()
	require.NotNil(t, updated)
	require.NotNil(t, updated.Counter)
	assert.Equal(t, int32(0), updated.Counter.UnreadMessages)
	assert.False(t, updated.Counter.HasUnreadThreadReplies)
}

func TestIntegration_ListRecentMessages_ReturnsConversationHistory(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	first, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "first",
	})
	require.NoError(t, err)

	_, err = svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "second",
	})
	require.NoError(t, err)

	history, err := svc.ListRecentMessages(ctx, userID, channelID, 50)
	require.NoError(t, err)
	require.Len(t, history, 2)
	assert.Equal(t, "first", history[0].Body)
	assert.Equal(t, "second", history[1].Body)
	assert.Equal(t, first.ChannelSeq, history[0].ChannelSeq)
	assert.Equal(t, "Test User", history[0].SenderName)
}

func TestIntegration_ListRecentMessages_IncludesReactions(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	var peerID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', 'Peer User', 'member')
		 RETURNING id`,
		"peer_"+uuid.New().String()+"@example.com",
	).Scan(&peerID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, channelID, peerID)
	require.NoError(t, err)

	msg, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    peerID,
		ClientMsgID: uuid.New().String(),
		Body:        "with reaction",
	})
	require.NoError(t, err)

	_, err = svc.AddReaction(ctx, chat.ReactionParams{
		ChannelID:  channelID,
		MessageID:  msg.MessageID,
		UserID:     userID,
		Emoji:      ":+1:",
		ClientOpID: uuid.New().String(),
	})
	require.NoError(t, err)

	history, err := svc.ListRecentMessages(ctx, userID, channelID, 50)
	require.NoError(t, err)
	require.Len(t, history, 1)
	require.Equal(t, "with reaction", history[0].Body)
	require.Equal(t, []string{":+1:"}, history[0].MyReactions)
	require.Len(t, history[0].Reactions, 1)
	assert.Equal(t, ":+1:", history[0].Reactions[0].Emoji)
	assert.Equal(t, int32(1), history[0].Reactions[0].Count)
}

func TestIntegration_ListMessagePage_PaginatesByCursor(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	for _, body := range []string{"one", "two", "three", "four", "five"} {
		_, err := svc.SendMessage(ctx, chat.SendMessageParams{
			ChannelID:   channelID,
			SenderID:    userID,
			ClientMsgID: uuid.New().String(),
			Body:        body,
		})
		require.NoError(t, err)
	}

	firstPage, hasMore, err := svc.ListMessagePage(ctx, userID, channelID, nil, 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, firstPage, 2)
	assert.Equal(t, "four", firstPage[0].Body)
	assert.Equal(t, "five", firstPage[1].Body)

	before := firstPage[0].ChannelSeq
	secondPage, hasMore, err := svc.ListMessagePage(ctx, userID, channelID, &before, 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, secondPage, 2)
	assert.Equal(t, "two", secondPage[0].Body)
	assert.Equal(t, "three", secondPage[1].Body)

	before = secondPage[0].ChannelSeq
	lastPage, hasMore, err := svc.ListMessagePage(ctx, userID, channelID, &before, 2)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, lastPage, 1)
	assert.Equal(t, "one", lastPage[0].Body)
}

func TestIntegration_ListMessagePage_RejectsNonMember(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)
	otherUserID, _ := seedUserAndChannel(t, ctx, pool)

	_, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "visible to members only",
	})
	require.NoError(t, err)

	_, _, err = svc.ListMessagePage(ctx, otherUserID, channelID, nil, 20)
	require.Error(t, err)
	assert.True(t, errors.Is(err, chat.ErrNotMember))
}

func TestIntegration_ListMessagePage_IncludesThreadReplyCountForRoots(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	root, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "root message",
	})
	require.NoError(t, err)

	_, err = svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:           channelID,
		SenderID:            userID,
		ClientMsgID:         uuid.New().String(),
		Body:                "reply message",
		ThreadRootMessageID: root.MessageID,
	})
	require.NoError(t, err)

	page, hasMore, err := svc.ListMessagePage(ctx, userID, channelID, nil, 50)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, page, 1)
	assert.Equal(t, "root message", page[0].Body)
	assert.Equal(t, int32(1), page[0].ThreadReplyCount)
}

func TestIntegration_MessageAttachment_UploadAndLinkToMessage(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)
	minioClient := testdb.NewMinio(t)
	svc.ConfigureAttachments(minioClient, 50)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	uploaded, err := svc.UploadMessageAttachment(ctx, chat.UploadMessageAttachmentParams{
		ConversationID: channelID,
		ActorID:        userID,
		FileName:       "clip.mp4",
		MimeType:       "video/mp4",
		Size:           int64(len("video-bytes")),
		Body:           strings.NewReader("video-bytes"),
	}, nil)
	require.NoError(t, err)
	require.NotEqual(t, uuid.Nil, uploaded.ID)

	sent, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:     channelID,
		SenderID:      userID,
		ClientMsgID:   uuid.New().String(),
		Body:          "",
		AttachmentIDs: []uuid.UUID{uploaded.ID},
	})
	require.NoError(t, err)

	page, hasMore, err := svc.ListMessagePage(ctx, userID, channelID, nil, 50)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, page, 1)
	require.Len(t, page[0].Attachments, 1)
	assert.Equal(t, uploaded.ID, page[0].Attachments[0].ID)
	assert.Equal(t, "clip.mp4", page[0].Attachments[0].FileName)
	assert.Equal(t, sent.MessageID, page[0].ID)

	body, _, _, fileName, err := svc.DownloadMessageAttachment(ctx, userID, sent.MessageID, uploaded.ID)
	require.NoError(t, err)
	defer body.Close()
	raw, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, "video-bytes", string(raw))
	assert.Equal(t, "clip.mp4", fileName)
}

func TestIntegration_MessageAttachment_ThreadReplayIncludesAttachments(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)
	minioClient := testdb.NewMinio(t)
	svc.ConfigureAttachments(minioClient, 50)

	userID, channelID := seedUserAndChannel(t, ctx, pool)

	root, err := svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:   channelID,
		SenderID:    userID,
		ClientMsgID: uuid.New().String(),
		Body:        "root",
	})
	require.NoError(t, err)

	uploaded, err := svc.UploadMessageAttachment(ctx, chat.UploadMessageAttachmentParams{
		ConversationID: channelID,
		ActorID:        userID,
		FileName:       "voice.ogg",
		MimeType:       "audio/ogg",
		Size:           int64(len("audio")),
		Body:           strings.NewReader("audio"),
	}, nil)
	require.NoError(t, err)

	_, err = svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:           channelID,
		SenderID:            userID,
		ClientMsgID:         uuid.New().String(),
		Body:                "",
		ThreadRootMessageID: root.MessageID,
		AttachmentIDs:       []uuid.UUID{uploaded.ID},
	})
	require.NoError(t, err)

	resp, err := svc.SubscribeThread(ctx, chat.SubscribeThreadParams{
		ChannelID:           channelID,
		ThreadRootMessageID: root.MessageID,
		RequesterID:         userID,
		LastThreadSeq:       0,
	})
	require.NoError(t, err)
	require.Len(t, resp.Replay, 1)
	require.Len(t, resp.Replay[0].Attachments, 1)
	assert.Equal(t, uploaded.ID.String(), resp.Replay[0].Attachments[0].AttachmentId)
	assert.Equal(t, "voice.ogg", resp.Replay[0].Attachments[0].FileName)
}

func TestIntegration_MessageAttachment_SendRejectsWrongOwner(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	store := events.NewStore(pool)
	svc := chat.NewService(pool, store)
	minioClient := testdb.NewMinio(t)
	svc.ConfigureAttachments(minioClient, 50)

	userID, channelID := seedUserAndChannel(t, ctx, pool)
	otherUserID, _ := seedUserAndChannel(t, ctx, pool)
	_, err := pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, channelID, otherUserID)
	require.NoError(t, err)

	uploaded, err := svc.UploadMessageAttachment(ctx, chat.UploadMessageAttachmentParams{
		ConversationID: channelID,
		ActorID:        userID,
		FileName:       "doc.txt",
		MimeType:       "text/plain",
		Size:           int64(len("doc")),
		Body:           strings.NewReader("doc"),
	}, nil)
	require.NoError(t, err)

	_, err = svc.SendMessage(ctx, chat.SendMessageParams{
		ChannelID:     channelID,
		SenderID:      otherUserID,
		ClientMsgID:   uuid.New().String(),
		Body:          "steal",
		AttachmentIDs: []uuid.UUID{uploaded.ID},
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, chat.ErrAttachmentOwnership))
}
