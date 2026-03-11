# msgnr - Corporate Messenger

A Slack-like internal messenger built with Go, implementing a modular monolith architecture.

## Architecture

- **Control Plane**: Go modular monolith (auth, chat, sequencing, bootstrap, sync, notifications, invites)
- **Media Plane**: LiveKit SFU for audio/video/screen sharing

## Technology Stack

- **Web Framework**: Custom HTTP server with `github.com/gobwas/ws` for WebSocket
- **Database**: PostgreSQL with `github.com/jackc/pgx/v5` driver
- **Configuration**: `github.com/spf13/viper` for environment-based config
- **Logging**: `go.uber.org/zap` for structured logging
- **Metrics**: `github.com/prometheus/client_golang` for monitoring
- **Testing**: `github.com/stretchr/testify` for test utilities
- **Cryptography**: `golang.org/x/crypto` for JWT and password hashing
- **Protobuf**: `google.golang.org/protobuf` for message serialization
- **SQL Types**: `github.com/sqlc-dev/pqtype` for PostgreSQL-specific types

## Quick Start

1. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   make deps
   ```

3. Run the server:
   ```bash
   make run
   ```

## Development

### Build
```bash
make build
```

### Run Tests
```bash
make test
```

### Generate Protocol Buffers
```bash
make proto
```

## Configuration

The application uses Viper for configuration management. Configuration can be set via:

- `.env` file (see `.env.example`)
- Environment variables

Key configuration options:
- `PORT`: Server port (default: 8080)
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: JWT signing secret
- `LIVEKIT_URL`: LiveKit server URL
- `LIVEKIT_API_KEY`: LiveKit API key
- `LIVEKIT_API_SECRET`: LiveKit API secret

## Project Structure

```
cmd/server/          # Main application entry point
internal/
  auth/              # Authentication and JWT handling
  bootstrap/         # Bootstrap service
  calls/             # Call management
  chat/              # Chat functionality
  config/            # Configuration management
  database/          # Database connections
  invites/           # Invite management
  logger/            # Structured logging
  metrics/           # Prometheus metrics
  notifications/     # Notification service
  presence/          # Presence management
  sync/              # Event synchronization
  ws/                # WebSocket gateway
api/proto/           # Protocol buffer definitions
migrations/          # Database migrations
```

## Monitoring

The application exposes Prometheus metrics on `/metrics` endpoint (when configured).

Key metrics:
- `websocket_connections_total`: Total WebSocket connections
- `websocket_connections_active`: Active WebSocket connections
- `messages_received_total`: Total messages received
- `messages_sent_total`: Total messages sent
- `database_connections_active`: Active database connections
- `http_requests_total`: HTTP request count
- `http_request_duration_seconds`: HTTP request latency