CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Workspace  (singleton; drives first-page-only fields in BootstrapResponse)
-- ---------------------------------------------------------------------------

-- P2 fix: singleton enforced via a dummy column with UNIQUE + CHECK.
-- Only one row is ever allowed.
CREATE TABLE IF NOT EXISTS workspace (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- singleton guard: only one row allowed
  singleton  BOOLEAN     NOT NULL DEFAULT true UNIQUE CHECK (singleton = true)
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  display_name  TEXT        NOT NULL DEFAULT '',
  avatar_url    TEXT        NOT NULL DEFAULT '',
  -- mirrors WorkspaceRole enum: owner | admin | member
  role                TEXT        NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status              TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  need_change_password BOOLEAN    NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL,
  user_agent TEXT,
  ip_addr    TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id    ON refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_expires_at ON refresh_sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Channels (conversations)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS channels (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- kind:       dm | channel
  -- visibility: dm | public | private  (mirrors ConversationType)
  kind             TEXT        NOT NULL CHECK (kind IN ('dm', 'channel')),
  visibility       TEXT        NOT NULL CHECK (visibility IN ('dm', 'public', 'private')),
  name             TEXT,
  topic            TEXT        NOT NULL DEFAULT '',
  is_archived      BOOLEAN     NOT NULL DEFAULT false,
  created_by       UUID        NOT NULL REFERENCES users(id),
  -- monotonic per-channel counter; incremented atomically on each new message
  next_seq         BIGINT      NOT NULL DEFAULT 0,
  -- updated on every new message; drives sidebar sort (last_activity_at DESC)
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id         UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id            UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  -- per-member notification level: 0=ALL, 1=MENTIONS_ONLY, 2=NOTHING
  notification_level SMALLINT    NOT NULL DEFAULT 0,
  -- soft leave flag: archived members keep history but lose active access
  is_archived        BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_members_user_id ON channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_active_user
  ON channel_members(user_id, channel_id)
  WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_channel_members_active_channel
  ON channel_members(channel_id, user_id)
  WHERE is_archived = false;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id       UUID    NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  channel_seq      BIGINT  NOT NULL,
  sender_id        UUID    NOT NULL REFERENCES users(id),
  client_msg_id    TEXT    NOT NULL,
  body             TEXT    NOT NULL,
  -- NULL for channel-level messages; FK to root message for thread replies
  thread_root_id   UUID    REFERENCES messages(id) ON DELETE CASCADE,
  -- monotonic within a thread; 0 for non-thread messages
  thread_seq       BIGINT  NOT NULL DEFAULT 0,
  -- true when body contains @everyone / @channel mention
  mention_everyone BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (channel_id, channel_seq),

  -- thread consistency invariant:
  --   non-thread messages → thread_root_id IS NULL     AND thread_seq = 0
  --   thread replies      → thread_root_id IS NOT NULL AND thread_seq > 0
  CONSTRAINT chk_thread_consistency CHECK (
    (thread_root_id IS NULL     AND thread_seq = 0) OR
    (thread_root_id IS NOT NULL AND thread_seq > 0)
  )
);

-- channel timeline lookup
CREATE INDEX IF NOT EXISTS idx_messages_channel_seq
  ON messages(channel_id, channel_seq);

-- thread timeline lookup
CREATE INDEX IF NOT EXISTS idx_messages_thread_root
  ON messages(thread_root_id)
  WHERE thread_root_id IS NOT NULL;

-- monotonic thread_seq uniqueness within a thread
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_seq
  ON messages(thread_root_id, thread_seq)
  WHERE thread_root_id IS NOT NULL;

-- idempotency: dedup SendMessageRequest by (channel, sender, client_msg_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_msg_id
  ON messages(channel_id, sender_id, client_msg_id);

-- ---------------------------------------------------------------------------
-- Message attachments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS message_attachment (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID          NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id      UUID          REFERENCES messages(id) ON DELETE CASCADE,
  file_name       VARCHAR(1024) NOT NULL,
  file_size       BIGINT        NOT NULL,
  mime_type       VARCHAR(255)  NOT NULL,
  storage_key     VARCHAR(2048) NOT NULL,
  uploaded_by     UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_message_attachment_file_size CHECK (file_size >= 0),
  CONSTRAINT chk_message_attachment_file_name CHECK (btrim(file_name) <> ''),
  CONSTRAINT chk_message_attachment_storage_key CHECK (btrim(storage_key) <> '')
);

-- message render query path
CREATE INDEX IF NOT EXISTS idx_message_attachment_message_id
  ON message_attachment (message_id, created_at ASC)
  WHERE message_id IS NOT NULL;

-- staged attachment lookup path (pre-send)
CREATE INDEX IF NOT EXISTS idx_message_attachment_staged
  ON message_attachment (conversation_id, uploaded_by, created_at ASC)
  WHERE message_id IS NULL;

-- Enforce linked attachment message/channel consistency at the DB layer.
-- CHECK constraints cannot reference other tables, so this uses a trigger.
CREATE OR REPLACE FUNCTION check_message_attachment_same_conversation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.message_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.id = NEW.message_id
        AND m.channel_id = NEW.conversation_id
    ) THEN
      RAISE EXCEPTION
        'attachment % message % does not belong to conversation %',
        NEW.id, NEW.message_id, NEW.conversation_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_attachment_same_conversation ON message_attachment;
CREATE TRIGGER trg_message_attachment_same_conversation
  BEFORE INSERT OR UPDATE OF message_id, conversation_id ON message_attachment
  FOR EACH ROW
  WHEN (NEW.message_id IS NOT NULL)
  EXECUTE FUNCTION check_message_attachment_same_conversation();

-- P1 fix: enforce that thread replies belong to the same channel as their root.
-- CHECK cannot reference another table, so a trigger is required.
CREATE OR REPLACE FUNCTION check_thread_same_channel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.thread_root_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM messages
       WHERE id = NEW.thread_root_id
         AND channel_id = NEW.channel_id
    ) THEN
      RAISE EXCEPTION
        'thread_root_id % does not belong to channel %',
        NEW.thread_root_id, NEW.channel_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_thread_same_channel
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW
  WHEN (NEW.thread_root_id IS NOT NULL)
  EXECUTE FUNCTION check_thread_same_channel();

-- ---------------------------------------------------------------------------
-- Thread summaries
-- ---------------------------------------------------------------------------

-- One row per thread root; updated atomically when a reply is inserted.
-- next_thread_seq is the counter used to assign thread_seq to new replies,
-- analogous to channels.next_seq for channel-level messages.
CREATE TABLE IF NOT EXISTS thread_summaries (
  root_message_id    UUID    PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  channel_id         UUID    NOT NULL    REFERENCES channels(id) ON DELETE CASCADE,
  reply_count        INT     NOT NULL DEFAULT 0,
  next_thread_seq    BIGINT  NOT NULL DEFAULT 1,
  last_reply_at      TIMESTAMPTZ,
  last_reply_user_id UUID    REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- Mentions
-- ---------------------------------------------------------------------------

-- P1 fix: channel_id removed; always derived via JOIN messages to prevent
-- divergence between mention.channel_id and message.channel_id.
--
-- One row per (message, mentioned user). @everyone is NOT stored here;
-- signalled by messages.mention_everyone = true.
--
-- unread_mentions query:
--   SELECT COUNT(*) FROM message_mentions mm
--   JOIN messages m ON m.id = mm.message_id
--   JOIN message_reads mr ON mr.channel_id = m.channel_id
--                        AND mr.user_id    = mm.user_id
--   WHERE mm.user_id = $1
--     AND m.channel_id = $2
--     AND m.channel_seq > mr.last_read_seq
CREATE TABLE IF NOT EXISTS message_mentions (
  message_id UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- lookup mentions per user; channel resolved via messages join
CREATE INDEX IF NOT EXISTS idx_message_mentions_user
  ON message_mentions(user_id);

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

-- One row per (message, user, emoji); source of truth for reaction ownership.
CREATE TABLE IF NOT EXISTS reactions (
  message_id UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Materialized aggregate; updated atomically with reactions in the same transaction.
-- Drives ReactionAggregate{emoji, count} in MessageEvent and ReactionUpdatedEvent.
CREATE TABLE IF NOT EXISTS reaction_counts (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  count      INT  NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (message_id, emoji)
);

-- ---------------------------------------------------------------------------
-- Read cursors
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS message_reads (
  channel_id    UUID    NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       UUID    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  last_read_seq BIGINT  NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS thread_reads (
  root_message_id      UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  last_read_thread_seq BIGINT      NOT NULL DEFAULT 0 CHECK (last_read_thread_seq >= 0),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_message_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- mirrors NotificationType enum
  type        TEXT        NOT NULL CHECK (type IN (
                'mention', 'thread_reply', 'call_invite', 'call_missed', 'system'
              )),
  title       TEXT        NOT NULL DEFAULT '',
  body        TEXT        NOT NULL DEFAULT '',
  channel_id  UUID        REFERENCES channels(id) ON DELETE SET NULL,
  is_read     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unresolved
  ON notifications(user_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calls (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL CHECK (status IN ('active', 'ended')),
  livekit_room TEXT        NOT NULL,
  created_by   UUID        NOT NULL REFERENCES users(id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ
);

-- at most one active call per channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_one_active_per_channel
  ON calls(channel_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS call_participants (
  call_id   UUID        NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  PRIMARY KEY (call_id, user_id)
);

-- mirrors CallInviteSummary / InviteState
CREATE TABLE IF NOT EXISTS call_invites (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID        NOT NULL REFERENCES calls(id)    ON DELETE CASCADE,
  channel_id      UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  inviter_id      UUID        NOT NULL REFERENCES users(id),
  invitee_id      UUID        NOT NULL REFERENCES users(id),
  -- mirrors InviteState enum
  state           TEXT        NOT NULL DEFAULT 'created'
                    CHECK (state IN ('created', 'accepted', 'rejected', 'cancelled', 'expired')),
  -- mirrors InviteCancelReason enum
  cancel_reason   TEXT        CHECK (cancel_reason IN ('cancelled', 'expired', 'rejected')),
  cancelled_by_id UUID        REFERENCES users(id),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- P2 fix: enforce valid state/reason/cancelled_by combinations from protocol state machine:
  --   created | accepted | rejected → no cancel fields
  --   cancelled                     → reason='cancelled', cancelled_by required
  --   expired                       → reason='expired',   no cancelled_by
  CONSTRAINT chk_invite_state_reason CHECK (
    (state IN ('created', 'accepted', 'rejected')
      AND cancel_reason    IS NULL
      AND cancelled_by_id  IS NULL)
    OR
    (state = 'cancelled'
      AND cancel_reason    = 'cancelled'
      AND cancelled_by_id  IS NOT NULL)
    OR
    (state = 'expired'
      AND cancel_reason    = 'expired'
      AND cancelled_by_id  IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_call_invites_invitee_active
  ON call_invites(invitee_id)
  WHERE state = 'created';

-- ---------------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------------

-- Durable last_active_at for "last seen" UI.
-- Hot online/away state lives in Redis; this table is updated on
-- disconnect or periodic heartbeat.
CREATE TABLE IF NOT EXISTS user_presence (
  user_id        UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'offline'
                   CHECK (status IN ('online', 'away', 'offline')),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Bootstrap sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bootstrap_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_instance_id TEXT        NOT NULL,
  snapshot_seq       BIGINT      NOT NULL,
  include_archived   BOOLEAN     NOT NULL DEFAULT false,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bootstrap_sessions_user
  ON bootstrap_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS bootstrap_session_items (
  session_id       UUID        NOT NULL REFERENCES bootstrap_sessions(id) ON DELETE CASCADE,
  page_index       INT         NOT NULL CHECK (page_index >= 0),
  conversation_id  UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  ordinal          INT         NOT NULL CHECK (ordinal >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_bootstrap_session_items_page
  ON bootstrap_session_items(session_id, page_index, ordinal);

CREATE TABLE IF NOT EXISTS user_sync_cursors (
  user_id              UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  persisted_event_seq  BIGINT      NOT NULL DEFAULT 0 CHECK (persisted_event_seq >= 0),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Global event log  (enables SyncSinceRequest; acts as transactional outbox)
-- ---------------------------------------------------------------------------

-- Append-only. event_seq is the globally monotonic counter referenced by
-- ServerEvent.event_seq. pg_notify is called in the same transaction so
-- the listener never receives a seq before the row is committed.
--
-- Coherence between event_type and payload is enforced at the application
-- layer via a single AppendEvent(ctx, tx, evt) function.
CREATE SEQUENCE IF NOT EXISTS workspace_event_seq_seq START 1;

CREATE TABLE IF NOT EXISTS workspace_events (
  event_seq   BIGINT      PRIMARY KEY DEFAULT nextval('workspace_event_seq_seq'),
  event_id    UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  -- constrained to the exact set of EventType values (mirrors proto enum)
  event_type  TEXT        NOT NULL CHECK (event_type IN (
                'conversation_upserted',
                'conversation_removed',
                'membership_changed',
                'message_created',
                'read_counter_updated',
                'notification_added',
                'notification_resolved',
                'call_invite_created',
                'call_invite_cancelled',
                'call_state_changed',
                'thread_summary_updated',
                'reaction_updated',
                'user_identity_updated'
              )),
  channel_id  UUID        REFERENCES channels(id) ON DELETE SET NULL,
  payload     JSONB       NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_events_seq
  ON workspace_events(event_seq);
CREATE INDEX IF NOT EXISTS idx_workspace_events_channel
  ON workspace_events(channel_id, event_seq);
CREATE INDEX IF NOT EXISTS idx_workspace_events_occurred
  ON workspace_events(occurred_at);

-- ---------------------------------------------------------------------------
-- Task Tracker — Phase 1
-- (DDL kept here for sqlc schema awareness; applied via task_tracker_phase1.sql)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_template (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix      varchar(32) NOT NULL,
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz NULL,
    created_by  uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by  uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    CONSTRAINT uq_task_template_prefix        UNIQUE (prefix),
    CONSTRAINT chk_task_template_prefix_nonempty CHECK (btrim(prefix) <> ''),
    CONSTRAINT chk_task_template_prefix_az    CHECK (prefix ~ '^[A-Z]+$')
);

CREATE TABLE IF NOT EXISTS task_template_sequence (
    template_id uuid    PRIMARY KEY REFERENCES task_template(id) ON DELETE RESTRICT,
    last_value  bigint  NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_status (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        varchar(64) NOT NULL,
    name        varchar(255) NOT NULL,
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz NULL,
    created_by  uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    CONSTRAINT uq_task_status_code           UNIQUE (code),
    CONSTRAINT chk_task_status_code_nonempty  CHECK (btrim(code) <> ''),
    CONSTRAINT chk_task_status_name_nonempty  CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS enum_dictionary (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code            varchar(64) NOT NULL,
    name            varchar(255) NOT NULL,
    current_version integer     NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_enum_dictionary_code            UNIQUE (code),
    CONSTRAINT chk_enum_dictionary_code_nonempty  CHECK (btrim(code) <> ''),
    CONSTRAINT chk_enum_dictionary_name_nonempty  CHECK (btrim(name) <> ''),
    CONSTRAINT chk_enum_dictionary_version_pos    CHECK (current_version > 0)
);

CREATE TABLE IF NOT EXISTS enum_dictionary_version (
    id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    dictionary_id uuid    NOT NULL REFERENCES enum_dictionary(id) ON DELETE RESTRICT,
    version       integer NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    CONSTRAINT uq_enum_dictionary_version UNIQUE (dictionary_id, version),
    CONSTRAINT chk_enum_dictionary_version_pos CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS enum_dictionary_version_item (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    dictionary_version_id uuid        NOT NULL REFERENCES enum_dictionary_version(id) ON DELETE RESTRICT,
    value_code            varchar(64) NOT NULL,
    value_name            varchar(255) NOT NULL,
    sort_order            integer     NOT NULL DEFAULT 0,
    is_active             boolean     NOT NULL DEFAULT true,

    CONSTRAINT uq_enum_version_item_code UNIQUE (dictionary_version_id, value_code),
    CONSTRAINT chk_enum_item_code_nonempty CHECK (btrim(value_code) <> ''),
    CONSTRAINT chk_enum_item_name_nonempty CHECK (btrim(value_name) <> '')
);

-- ---------------------------------------------------------------------------
-- Task Tracker — Phase 2
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_field_definition (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         uuid        NOT NULL REFERENCES task_template(id) ON DELETE RESTRICT,
    code                varchar(64) NOT NULL,
    name                varchar(255) NOT NULL,
    type                varchar(32) NOT NULL,
    required            boolean     NOT NULL DEFAULT false,
    sort_order          integer     NOT NULL DEFAULT 0,
    enum_dictionary_id  uuid        NULL REFERENCES enum_dictionary(id) ON DELETE RESTRICT,
    field_role          varchar(32) NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz NULL,

    CONSTRAINT chk_task_field_code_nonempty
        CHECK (btrim(code) <> ''),
    CONSTRAINT chk_task_field_code_identifier
        CHECK (code ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT chk_task_field_name_nonempty
        CHECK (btrim(name) <> ''),
    CONSTRAINT chk_task_field_type
        CHECK (type IN ('text','number','user','users','enum','multi_enum','date','datetime')),
    CONSTRAINT chk_task_field_role
        CHECK (field_role IS NULL OR field_role IN ('assignee')),
    CONSTRAINT chk_task_field_assignee_type
        CHECK (
            field_role IS NULL
            OR (field_role = 'assignee' AND type IN ('user','users'))
        ),
    CONSTRAINT chk_task_field_enum_dict
        CHECK (
            (type IN ('enum','multi_enum') AND enum_dictionary_id IS NOT NULL)
            OR (type NOT IN ('enum','multi_enum') AND enum_dictionary_id IS NULL)
        )
);

-- Active code must be unique within a template (allows reuse after soft-delete)
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_field_definition_template_code_active
    ON task_field_definition (template_id, code)
    WHERE deleted_at IS NULL;

-- At most one active assignee field per template
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_field_definition_one_assignee
    ON task_field_definition (template_id)
    WHERE field_role = 'assignee' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_field_definition_template_sort
    ON task_field_definition (template_id, sort_order, code);

-- ---------------------------------------------------------------------------
-- Task Tracker — Phase 3: task instances + field values
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generic trigger function that sets updated_at = now() on any UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Prevent changing prefix once tasks exist for that template.
CREATE OR REPLACE FUNCTION prevent_template_prefix_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.prefix IS DISTINCT FROM OLD.prefix THEN
        IF EXISTS (SELECT 1 FROM task WHERE template_id = OLD.id LIMIT 1) THEN
            RAISE EXCEPTION 'cannot change template prefix: tasks already exist for template %', OLD.id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    CREATE TRIGGER trg_task_template_prevent_prefix_change
    BEFORE UPDATE OF prefix ON task_template
    FOR EACH ROW EXECUTE FUNCTION prevent_template_prefix_change();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS task (
    id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id                varchar(64) NOT NULL,
    template_id              uuid        NOT NULL REFERENCES task_template(id) ON DELETE RESTRICT,
    template_snapshot_prefix varchar(32) NOT NULL,
    sequence_number          bigint      NOT NULL,
    title                    text        NOT NULL,
    description              text        NULL,
    status_id                uuid        NOT NULL REFERENCES task_status(id) ON DELETE RESTRICT,
    parent_task_id           uuid        NULL REFERENCES task(id) ON DELETE RESTRICT,
    created_by               uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by               uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_public_id           UNIQUE (public_id),
    CONSTRAINT uq_task_template_sequence   UNIQUE (template_id, sequence_number),
    CONSTRAINT chk_task_title_nonempty     CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS idx_task_template_id              ON task (template_id);
CREATE INDEX IF NOT EXISTS idx_task_status_id                ON task (status_id);
CREATE INDEX IF NOT EXISTS idx_task_parent_task_id           ON task (parent_task_id);
CREATE INDEX IF NOT EXISTS idx_task_created_at               ON task (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_updated_at               ON task (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_template_snapshot_prefix ON task (template_snapshot_prefix);
CREATE INDEX IF NOT EXISTS idx_task_title_trgm               ON task USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_task_description_trgm         ON task USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_task_public_id_trgm           ON task USING gin (public_id gin_trgm_ops);

-- Atomically allocate the next sequence number for a template and set public_id.
-- Also blocks inserts against a soft-deleted template.
CREATE OR REPLACE FUNCTION assign_task_public_id()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_prefix     varchar(32);
    v_deleted_at timestamptz;
    v_next_seq   bigint;
BEGIN
    SELECT prefix, deleted_at INTO v_prefix, v_deleted_at
    FROM task_template WHERE id = NEW.template_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'template not found: %', NEW.template_id USING ERRCODE = '23503';
    END IF;
    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'cannot create task: template % has been deleted', NEW.template_id
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO task_template_sequence (template_id, last_value)
    VALUES (NEW.template_id, 1)
    ON CONFLICT (template_id) DO UPDATE
        SET last_value = task_template_sequence.last_value + 1,
            updated_at = now()
    RETURNING last_value INTO v_next_seq;

    NEW.sequence_number          := v_next_seq;
    NEW.template_snapshot_prefix := v_prefix;
    NEW.public_id                := v_prefix || '-' || v_next_seq;
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    CREATE TRIGGER trg_task_assign_public_id
    BEFORE INSERT ON task
    FOR EACH ROW EXECUTE FUNCTION assign_task_public_id();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reject inserts/updates that reference a soft-deleted status.
CREATE OR REPLACE FUNCTION validate_task_status_not_deleted()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_deleted_at timestamptz;
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status_id IS DISTINCT FROM OLD.status_id) THEN
        SELECT deleted_at INTO v_deleted_at FROM task_status WHERE id = NEW.status_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'status not found: %', NEW.status_id USING ERRCODE = '23503';
        END IF;
        IF v_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'cannot use deleted status: %', NEW.status_id USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    CREATE TRIGGER trg_task_validate_status
    BEFORE INSERT OR UPDATE OF status_id ON task
    FOR EACH ROW EXECUTE FUNCTION validate_task_status_not_deleted();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enforce max one level of subtask nesting.
CREATE OR REPLACE FUNCTION validate_task_parent_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parent_parent_id uuid;
BEGIN
    IF NEW.parent_task_id IS NULL THEN RETURN NEW; END IF;
    IF NEW.parent_task_id = NEW.id THEN
        RAISE EXCEPTION 'task cannot be its own parent' USING ERRCODE = '23514';
    END IF;
    SELECT parent_task_id INTO v_parent_parent_id FROM task WHERE id = NEW.parent_task_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'parent task not found: %', NEW.parent_task_id USING ERRCODE = '23503';
    END IF;
    IF v_parent_parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'subtasks cannot be nested deeper than one level' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    CREATE TRIGGER trg_task_validate_parent
    BEFORE INSERT OR UPDATE OF parent_task_id ON task
    FOR EACH ROW EXECUTE FUNCTION validate_task_parent_rules();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_task_set_updated_at
    BEFORE UPDATE ON task
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS task_field_value (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             uuid         NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    field_definition_id uuid         NOT NULL REFERENCES task_field_definition(id) ON DELETE RESTRICT,
    value_text          text         NULL,
    value_number        numeric(20,6) NULL,
    value_user_id       uuid         NULL,
    value_date          date         NULL,
    value_datetime      timestamptz  NULL,
    value_json          jsonb        NULL,
    enum_dictionary_id  uuid         NULL REFERENCES enum_dictionary(id) ON DELETE RESTRICT,
    enum_version        integer      NULL,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_field_value_task_field      UNIQUE (task_id, field_definition_id),
    CONSTRAINT chk_task_field_value_enum_version   CHECK (enum_version IS NULL OR enum_version > 0),
    CONSTRAINT fk_task_field_value_enum_version
        FOREIGN KEY (enum_dictionary_id, enum_version)
        REFERENCES enum_dictionary_version (dictionary_id, version)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_task_field_value_task_id             ON task_field_value (task_id);
CREATE INDEX IF NOT EXISTS idx_task_field_value_field_definition_id ON task_field_value (field_definition_id);
CREATE INDEX IF NOT EXISTS idx_task_field_value_value_user_id       ON task_field_value (value_user_id);
CREATE INDEX IF NOT EXISTS idx_task_field_value_value_json_gin      ON task_field_value USING gin (value_json);

DO $$ BEGIN
    CREATE TRIGGER trg_task_field_value_set_updated_at
    BEFORE UPDATE ON task_field_value
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Task Tracker — Phase 6: attachments + comments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_attachment (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      uuid          NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    file_name    varchar(1024) NOT NULL,
    file_size    bigint        NOT NULL,
    mime_type    varchar(255)  NOT NULL,
    storage_key  varchar(2048) NOT NULL,
    uploaded_by  uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at   timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT chk_task_attachment_file_size    CHECK (file_size >= 0),
    CONSTRAINT chk_task_attachment_file_name    CHECK (btrim(file_name) <> ''),
    CONSTRAINT chk_task_attachment_storage_key  CHECK (btrim(storage_key) <> '')
);

CREATE INDEX IF NOT EXISTS idx_task_attachment_task_id
    ON task_attachment (task_id, created_at ASC);

CREATE TABLE IF NOT EXISTS task_comment (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    uuid        NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    author_id  uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Allow attachment-only comments (body may be empty string).
ALTER TABLE task_comment DROP CONSTRAINT IF EXISTS chk_task_comment_body;

CREATE INDEX IF NOT EXISTS idx_task_comment_task_created_at
    ON task_comment (task_id, created_at ASC);

CREATE TABLE IF NOT EXISTS task_comment_attachment (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      uuid          NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    comment_id   uuid          NULL REFERENCES task_comment(id) ON DELETE CASCADE,
    file_name    varchar(1024) NOT NULL,
    file_size    bigint        NOT NULL,
    mime_type    varchar(255)  NOT NULL,
    storage_key  varchar(2048) NOT NULL,
    uploaded_by  uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at   timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT chk_task_comment_attachment_file_size    CHECK (file_size >= 0),
    CONSTRAINT chk_task_comment_attachment_file_name    CHECK (btrim(file_name) <> ''),
    CONSTRAINT chk_task_comment_attachment_storage_key  CHECK (btrim(storage_key) <> '')
);

CREATE INDEX IF NOT EXISTS idx_task_comment_attachment_staged
    ON task_comment_attachment (task_id, uploaded_by, created_at ASC)
    WHERE comment_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_comment_attachment_comment_id
    ON task_comment_attachment (comment_id, created_at ASC)
    WHERE comment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION check_task_comment_attachment_task_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.comment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM task_comment c
            WHERE c.id = NEW.comment_id
              AND c.task_id = NEW.task_id
        ) THEN
            RAISE EXCEPTION
                'task comment attachment % comment % does not belong to task %',
                NEW.id, NEW.comment_id, NEW.task_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_comment_attachment_task_match ON task_comment_attachment;
CREATE TRIGGER trg_task_comment_attachment_task_match
    BEFORE INSERT OR UPDATE OF comment_id, task_id ON task_comment_attachment
    FOR EACH ROW
    WHEN (NEW.comment_id IS NOT NULL)
    EXECUTE FUNCTION check_task_comment_attachment_task_match();

-- Prevent editing comment body after creation.
CREATE OR REPLACE FUNCTION prevent_task_comment_body_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.body IS DISTINCT FROM OLD.body THEN
        RAISE EXCEPTION 'task comment editing is not allowed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    CREATE TRIGGER trg_task_comment_prevent_body_update
    BEFORE UPDATE OF body ON task_comment
    FOR EACH ROW EXECUTE FUNCTION prevent_task_comment_body_update();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_task_comment_set_updated_at
    BEFORE UPDATE ON task_comment
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Push Subscriptions (Web Push / VAPID)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT        NOT NULL UNIQUE,
  key_p256dh  TEXT        NOT NULL,
  key_auth    TEXT        NOT NULL,
  user_agent  TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_last_used
  ON push_subscriptions(last_used);
