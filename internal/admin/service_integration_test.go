//go:build integration

package admin_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"msgnr/internal/admin"
	"msgnr/internal/testdb"
)

func seedAdminUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, role string) uuid.UUID {
	t.Helper()

	var userID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role)
		 VALUES ($1, 'x', $2, $3)
		 RETURNING id`,
		"admin_test_"+uuid.NewString()+"@example.com",
		"User "+role,
		role,
	).Scan(&userID)
	require.NoError(t, err)
	return userID
}

func TestIntegration_CreateChannel_AddAllUsers(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	adminID := seedAdminUser(t, ctx, pool, "admin")
	memberOne := seedAdminUser(t, ctx, pool, "member")
	memberTwo := seedAdminUser(t, ctx, pool, "member")

	svc := admin.NewService(pool)

	channel, err := svc.CreateChannel(ctx, admin.CreateChannelParams{
		Name:        "all-hands",
		Visibility:  "public",
		CreatedBy:   adminID,
		AddAllUsers: true,
	})
	require.NoError(t, err)

	members, err := svc.ListChannelMembers(ctx, channel.ID)
	require.NoError(t, err)
	require.Len(t, members, 3)

	memberIDs := []uuid.UUID{members[0].ID, members[1].ID, members[2].ID}
	assert.ElementsMatch(t, []uuid.UUID{adminID, memberOne, memberTwo}, memberIDs)

	var eventType string
	err = pool.QueryRow(ctx,
		`SELECT event_type FROM workspace_events WHERE channel_id = $1 ORDER BY event_seq DESC LIMIT 1`,
		channel.ID,
	).Scan(&eventType)
	require.NoError(t, err)
	assert.Equal(t, "conversation_upserted", eventType)
}

func TestIntegration_CreateChannel_AddsCreatorMembership(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	adminID := seedAdminUser(t, ctx, pool, "admin")
	memberID := seedAdminUser(t, ctx, pool, "member")
	svc := admin.NewService(pool)

	channel, err := svc.CreateChannel(ctx, admin.CreateChannelParams{
		Name:       "ops",
		Visibility: "private",
		CreatedBy:  adminID,
		MemberIDs:  []uuid.UUID{memberID},
	})
	require.NoError(t, err)

	members, err := svc.ListChannelMembers(ctx, channel.ID)
	require.NoError(t, err)
	require.Len(t, members, 2)
	memberIDs := []uuid.UUID{members[0].ID, members[1].ID}
	assert.ElementsMatch(t, []uuid.UUID{adminID, memberID}, memberIDs)
}

func TestIntegration_CreateChannel_PrivateRequiresMemberIds(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	adminID := seedAdminUser(t, ctx, pool, "admin")
	svc := admin.NewService(pool)

	_, err := svc.CreateChannel(ctx, admin.CreateChannelParams{
		Name:       "ops-no-members",
		Visibility: "private",
		CreatedBy:  adminID,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, admin.ErrBadRequest)
}

func TestIntegration_CreateChannel_CreatesInviteNotificationForAddedMember(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	adminID := seedAdminUser(t, ctx, pool, "admin")
	memberID := seedAdminUser(t, ctx, pool, "member")
	svc := admin.NewService(pool)

	channel, err := svc.CreateChannel(ctx, admin.CreateChannelParams{
		Name:       "secret",
		Visibility: "public",
		CreatedBy:  adminID,
		MemberIDs:  []uuid.UUID{memberID},
	})
	require.NoError(t, err)

	members, err := svc.ListChannelMembers(ctx, channel.ID)
	require.NoError(t, err)
	require.Len(t, members, 2)
	memberIDs := []uuid.UUID{members[0].ID, members[1].ID}
	assert.ElementsMatch(t, []uuid.UUID{adminID, memberID}, memberIDs)

	var notificationCount int
	err = pool.QueryRow(ctx,
		`SELECT COUNT(*)::int
		   FROM notifications
		  WHERE user_id = $1
		    AND channel_id = $2
		    AND type = 'system'`,
		memberID, channel.ID,
	).Scan(&notificationCount)
	require.NoError(t, err)
	assert.Equal(t, 1, notificationCount)
}
