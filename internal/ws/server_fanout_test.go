package ws

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"msgnr/internal/auth"
	"msgnr/internal/config"
	"msgnr/internal/events"
	packetspb "msgnr/internal/gen/proto"
)

// newTestServer builds a minimal Server wired to the given Bus.
func newTestServer(bus *events.Bus) *Server {
	cfg := &config.Config{
		WsOutboundQueueMax:       64,
		EventBusSubscriberBuffer: 16,
		MaxSyncBatch:             500,
	}
	return &Server{
		config: cfg,
		bus:    bus,
		log:    zap.NewNop(),
		authorizeEvent: func(_ context.Context, _ auth.Principal, _ *packetspb.ServerEvent) bool {
			return true
		},
	}
}

// testPrincipal returns an auth.Principal with deterministic non-zero UUIDs.
func testPrincipal() auth.Principal {
	return auth.Principal{
		UserID:    uuid.MustParse("00000000-0000-0000-0000-000000000001"),
		SessionID: uuid.MustParse("00000000-0000-0000-0000-000000000002"),
		Role:      "member",
	}
}

func testPrincipalWithUser(userID, sessionID string) auth.Principal {
	return auth.Principal{
		UserID:    uuid.MustParse(userID),
		SessionID: uuid.MustParse(sessionID),
		Role:      "member",
	}
}

// pipeConn returns a pair of connected net.Conn backed by net.Pipe.
func pipeConn(t *testing.T) (client, server net.Conn) {
	t.Helper()
	client, server = net.Pipe()
	t.Cleanup(func() {
		client.Close()
		server.Close()
	})
	return client, server
}

// TestFanout_AuthenticatedSessionReceivesServerEvent verifies that after
// startEventFanout is called, a published ServerEvent reaches the outboundCh.
func TestFanout_AuthenticatedSessionReceivesServerEvent(t *testing.T) {
	bus := events.NewBus(zap.NewNop())
	srv := newTestServer(bus)

	_, serverConn := pipeConn(t)

	outboundCh := make(chan outboundMsg, srv.config.WsOutboundQueueMax+4)

	unsubscribe, done := srv.startEventFanout(serverConn, testPrincipal(), outboundCh, srv.config.WsOutboundQueueMax)
	defer func() {
		unsubscribe()
		<-done
	}()

	evt := &packetspb.ServerEvent{
		EventSeq:  42,
		EventType: packetspb.EventType_EVENT_TYPE_MESSAGE_CREATED,
	}
	bus.Publish(evt)

	select {
	case msg := <-outboundCh:
		require.NotNil(t, msg.env)
		se := msg.env.GetServerEvent()
		require.NotNil(t, se, "expected ServerEvent payload in envelope")
		assert.Equal(t, int64(42), se.GetEventSeq())
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for ServerEvent on outboundCh")
	}
}

// TestFanout_OverflowClosesConn verifies the overflow path: when the outbound
// channel is full, the fanout goroutine closes the connection.
func TestFanout_OverflowClosesConn(t *testing.T) {
	bus := events.NewBus(zap.NewNop())
	srv := newTestServer(bus)

	clientConn, serverConn := pipeConn(t)

	// Queue capacity = headroom only, so it fills immediately.
	const headroom = 4
	outboundCh := make(chan outboundMsg, headroom)

	unsubscribe, done := srv.startEventFanout(serverConn, testPrincipal(), outboundCh, 0)
	defer func() {
		unsubscribe()
		<-done
	}()

	// Fill the channel so the very next send overflows.
	for i := 0; i < headroom; i++ {
		outboundCh <- outboundMsg{env: &packetspb.Envelope{}}
	}

	// Trigger overflow.
	bus.Publish(&packetspb.ServerEvent{EventSeq: 1})

	// serverConn.Close() causes clientConn reads to fail.
	clientConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 1)
	_, err := clientConn.Read(buf)
	assert.Error(t, err, "expected connection closed after overflow")
}

func TestFanout_StopCompletesBeforeQueueClose(t *testing.T) {
	bus := events.NewBus(zap.NewNop())
	srv := newTestServer(bus)
	_, serverConn := pipeConn(t)

	outboundCh := make(chan outboundMsg, 8)
	unsubscribe, done := srv.startEventFanout(serverConn, testPrincipal(), outboundCh, srv.config.WsOutboundQueueMax)

	unsubscribe()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("fanout goroutine did not stop after unsubscribe")
	}

	close(outboundCh)
}

func TestFanout_CallStateChangedDeliveredOnlyToAuthorizedMembers(t *testing.T) {
	bus := events.NewBus(zap.NewNop())
	srv := newTestServer(bus)
	memberID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	nonMemberID := uuid.MustParse("00000000-0000-0000-0000-000000000003")
	targetConversation := "00000000-0000-0000-0000-0000000000aa"

	srv.authorizeEvent = func(_ context.Context, principal auth.Principal, evt *packetspb.ServerEvent) bool {
		if evt.GetConversationId() != targetConversation {
			return false
		}
		return principal.UserID == memberID
	}

	_, memberServerConn := pipeConn(t)
	_, nonMemberServerConn := pipeConn(t)

	memberOutbound := make(chan outboundMsg, srv.config.WsOutboundQueueMax+4)
	nonMemberOutbound := make(chan outboundMsg, srv.config.WsOutboundQueueMax+4)

	memberUnsubscribe, memberDone := srv.startEventFanout(
		memberServerConn,
		testPrincipalWithUser(memberID.String(), "00000000-0000-0000-0000-00000000000a"),
		memberOutbound,
		srv.config.WsOutboundQueueMax,
	)
	defer func() {
		memberUnsubscribe()
		<-memberDone
	}()
	nonMemberUnsubscribe, nonMemberDone := srv.startEventFanout(
		nonMemberServerConn,
		testPrincipalWithUser(nonMemberID.String(), "00000000-0000-0000-0000-00000000000b"),
		nonMemberOutbound,
		srv.config.WsOutboundQueueMax,
	)
	defer func() {
		nonMemberUnsubscribe()
		<-nonMemberDone
	}()

	bus.Publish(&packetspb.ServerEvent{
		EventSeq:       7,
		EventType:      packetspb.EventType_EVENT_TYPE_CALL_STATE_CHANGED,
		ConversationId: targetConversation,
		Payload: &packetspb.ServerEvent_CallStateChanged{
			CallStateChanged: &packetspb.CallStateChangedEvent{
				CallId:         "call-1",
				ConversationId: targetConversation,
				Status:         packetspb.CallStatus_CALL_STATUS_ACTIVE,
			},
		},
	})

	select {
	case msg := <-memberOutbound:
		require.NotNil(t, msg.env)
		se := msg.env.GetServerEvent()
		require.NotNil(t, se)
		require.NotNil(t, se.GetCallStateChanged())
		assert.Equal(t, targetConversation, se.GetConversationId())
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for member call_state_changed event")
	}

	select {
	case <-nonMemberOutbound:
		t.Fatal("non-member unexpectedly received call_state_changed event")
	case <-time.After(200 * time.Millisecond):
	}
}
