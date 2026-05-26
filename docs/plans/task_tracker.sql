-- =========================================================
-- Task Tracker DDL for PostgreSQL
-- Soft delete model: deleted_at only
-- prefix: uppercase Latin letters only
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =========================================================
-- Utility: updated_at trigger
-- =========================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- =========================================================
-- task_template
-- =========================================================

CREATE TABLE task_template (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix          varchar(32) NOT NULL,
    sort_order      integer NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz NULL,
    created_by      uuid NOT NULL,
    updated_by      uuid NOT NULL,

    CONSTRAINT uq_task_template_prefix UNIQUE (prefix),
    CONSTRAINT chk_task_template_prefix_not_empty CHECK (btrim(prefix) <> ''),
    CONSTRAINT chk_task_template_prefix_upper_latin CHECK (prefix ~ '^[A-Z]+$')
);

CREATE INDEX idx_task_template_active_sort
    ON task_template (sort_order, prefix)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_task_template_set_updated_at
BEFORE UPDATE ON task_template
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- task_template_sequence
-- =========================================================

CREATE TABLE task_template_sequence (
    template_id      uuid PRIMARY KEY,
    last_value       bigint NOT NULL DEFAULT 0,
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_task_template_sequence_template
        FOREIGN KEY (template_id) REFERENCES task_template(id)
        ON DELETE RESTRICT
);

CREATE TRIGGER trg_task_template_sequence_set_updated_at
BEFORE UPDATE ON task_template_sequence
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- enum_dictionary
-- =========================================================

CREATE TABLE enum_dictionary (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code             varchar(64) NOT NULL,
    name             varchar(255) NOT NULL,
    is_public        boolean NOT NULL DEFAULT false,
    participates_in_filtration boolean NOT NULL DEFAULT false,
    current_version  integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_enum_dictionary_code UNIQUE (code),
    CONSTRAINT chk_enum_dictionary_code_not_empty CHECK (btrim(code) <> ''),
    CONSTRAINT chk_enum_dictionary_name_not_empty CHECK (btrim(name) <> ''),
    CONSTRAINT chk_enum_dictionary_current_version_positive CHECK (current_version > 0)
);

CREATE TRIGGER trg_enum_dictionary_set_updated_at
BEFORE UPDATE ON enum_dictionary
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE enum_dictionary_version (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dictionary_id  uuid NOT NULL,
    version        integer NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid NOT NULL,

    CONSTRAINT fk_enum_dictionary_version_dictionary
        FOREIGN KEY (dictionary_id) REFERENCES enum_dictionary(id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_enum_dictionary_version UNIQUE (dictionary_id, version),
    CONSTRAINT chk_enum_dictionary_version_positive CHECK (version > 0)
);

CREATE INDEX idx_enum_dictionary_version_dictionary
    ON enum_dictionary_version (dictionary_id, version DESC);

CREATE TABLE enum_dictionary_version_item (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dictionary_version_id  uuid NOT NULL,
    value_code             varchar(64) NOT NULL,
    value_name             varchar(255) NOT NULL,
    sort_order             integer NOT NULL,
    is_active              boolean NOT NULL DEFAULT true,

    CONSTRAINT fk_enum_dictionary_version_item_version
        FOREIGN KEY (dictionary_version_id) REFERENCES enum_dictionary_version(id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_enum_dictionary_version_item_code
        UNIQUE (dictionary_version_id, value_code),
    CONSTRAINT chk_enum_dictionary_value_code_not_empty CHECK (btrim(value_code) <> ''),
    CONSTRAINT chk_enum_dictionary_value_name_not_empty CHECK (btrim(value_name) <> '')
);

CREATE INDEX idx_enum_dictionary_version_item_sort
    ON enum_dictionary_version_item (dictionary_version_id, sort_order, value_name);

-- =========================================================
-- task_status
-- =========================================================

CREATE TABLE task_status (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         varchar(64) NOT NULL,
    name         varchar(255) NOT NULL,
    sort_order   integer NOT NULL,
    created_by   uuid NOT NULL,
    deleted_at   timestamptz NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_status_code UNIQUE (code),
    CONSTRAINT chk_task_status_code_not_empty CHECK (btrim(code) <> ''),
    CONSTRAINT chk_task_status_name_not_empty CHECK (btrim(name) <> '')
);

CREATE INDEX idx_task_status_active_sort
    ON task_status (sort_order, name)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_task_status_set_updated_at
BEFORE UPDATE ON task_status
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- task_field_definition
-- =========================================================

CREATE TABLE task_field_definition (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         uuid NOT NULL,
    code                varchar(64) NOT NULL,
    name                varchar(255) NOT NULL,
    type                varchar(32) NOT NULL,
    required            boolean NOT NULL DEFAULT false,
    sort_order          integer NOT NULL,
    enum_dictionary_id  uuid NULL,
    field_role          varchar(32) NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz NULL,

    CONSTRAINT fk_task_field_definition_template
        FOREIGN KEY (template_id) REFERENCES task_template(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_task_field_definition_enum_dictionary
        FOREIGN KEY (enum_dictionary_id) REFERENCES enum_dictionary(id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_task_field_definition_code_not_empty
        CHECK (btrim(code) <> ''),

    CONSTRAINT chk_task_field_definition_name_not_empty
        CHECK (btrim(name) <> ''),

    CONSTRAINT chk_task_field_definition_type
        CHECK (type IN ('text', 'number', 'user', 'users', 'enum', 'multi_enum', 'date', 'datetime')),

    CONSTRAINT chk_task_field_definition_field_role
        CHECK (field_role IS NULL OR field_role IN ('assignee')),

    CONSTRAINT chk_task_field_definition_assignee_type
        CHECK (
            field_role IS NULL
            OR
            (field_role = 'assignee' AND type IN ('user', 'users'))
        ),

    CONSTRAINT chk_task_field_definition_enum_dictionary_required
        CHECK (
            (type IN ('enum', 'multi_enum') AND enum_dictionary_id IS NOT NULL)
            OR
            (type NOT IN ('enum', 'multi_enum') AND enum_dictionary_id IS NULL)
        )
);

CREATE INDEX idx_task_field_definition_template_sort
    ON task_field_definition (template_id, sort_order, code);

CREATE INDEX idx_task_field_definition_template_active_sort
    ON task_field_definition (template_id, sort_order, code)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_task_field_definition_one_assignee_per_template
    ON task_field_definition (template_id)
    WHERE field_role = 'assignee' AND deleted_at IS NULL;

CREATE TRIGGER trg_task_field_definition_set_updated_at
BEFORE UPDATE ON task_field_definition
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- task
-- =========================================================

CREATE TABLE task (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id                 varchar(64) NOT NULL,
    template_id               uuid NOT NULL,
    template_snapshot_prefix  varchar(32) NOT NULL,
    sequence_number           bigint NOT NULL,
    title                     text NOT NULL,
    description               text NULL,
    status_id                 uuid NOT NULL,
    parent_task_id            uuid NULL,
    created_by                uuid NOT NULL,
    updated_by                uuid NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_task_template
        FOREIGN KEY (template_id) REFERENCES task_template(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_task_status
        FOREIGN KEY (status_id) REFERENCES task_status(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_task_parent
        FOREIGN KEY (parent_task_id) REFERENCES task(id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_task_public_id UNIQUE (public_id),
    CONSTRAINT uq_task_template_sequence UNIQUE (template_id, sequence_number),
    CONSTRAINT chk_task_title_not_empty CHECK (btrim(title) <> '')
);

CREATE INDEX idx_task_template_id
    ON task (template_id);

CREATE INDEX idx_task_status_id
    ON task (status_id);

CREATE INDEX idx_task_parent_task_id
    ON task (parent_task_id);

CREATE INDEX idx_task_created_at
    ON task (created_at DESC);

CREATE INDEX idx_task_updated_at
    ON task (updated_at DESC);

CREATE INDEX idx_task_public_id
    ON task (public_id);

CREATE INDEX idx_task_title_trgm
    ON task USING gin (title gin_trgm_ops);

CREATE INDEX idx_task_description_trgm
    ON task USING gin (description gin_trgm_ops);

CREATE TRIGGER trg_task_set_updated_at
BEFORE UPDATE ON task
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- Triggers and validations depending on task
-- =========================================================

CREATE OR REPLACE FUNCTION prevent_template_prefix_change_if_tasks_exist()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.prefix IS DISTINCT FROM OLD.prefix THEN
        IF EXISTS (
            SELECT 1
            FROM task
            WHERE template_id = OLD.id
            LIMIT 1
        ) THEN
            RAISE EXCEPTION 'cannot change template prefix: tasks already exist for template %', OLD.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_template_prevent_prefix_change
BEFORE UPDATE OF prefix ON task_template
FOR EACH ROW
EXECUTE FUNCTION prevent_template_prefix_change_if_tasks_exist();

CREATE OR REPLACE FUNCTION assign_task_public_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix      varchar(32);
    v_deleted_at  timestamptz;
    v_next_seq    bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RETURN NEW;
    END IF;

    SELECT t.prefix, t.deleted_at
      INTO v_prefix, v_deleted_at
      FROM task_template t
     WHERE t.id = NEW.template_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'template not found: %', NEW.template_id
            USING ERRCODE = '23503';
    END IF;

    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'cannot create task with deleted template: %', NEW.template_id
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO task_template_sequence (template_id, last_value)
    VALUES (NEW.template_id, 1)
    ON CONFLICT (template_id)
    DO UPDATE SET last_value = task_template_sequence.last_value + 1,
                  updated_at = now()
    RETURNING last_value INTO v_next_seq;

    NEW.sequence_number := v_next_seq;
    NEW.template_snapshot_prefix := v_prefix;
    NEW.public_id := v_prefix || '-' || v_next_seq;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_assign_public_id
BEFORE INSERT ON task
FOR EACH ROW
EXECUTE FUNCTION assign_task_public_id();

CREATE OR REPLACE FUNCTION validate_task_status_not_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted_at timestamptz;
BEGIN
    IF TG_OP = 'INSERT'
       OR (TG_OP = 'UPDATE' AND NEW.status_id IS DISTINCT FROM OLD.status_id)
    THEN
        SELECT deleted_at
          INTO v_deleted_at
          FROM task_status
         WHERE id = NEW.status_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'status not found: %', NEW.status_id
                USING ERRCODE = '23503';
        END IF;

        IF v_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'cannot use deleted status: %', NEW.status_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_validate_status
BEFORE INSERT OR UPDATE OF status_id ON task
FOR EACH ROW
EXECUTE FUNCTION validate_task_status_not_deleted();

CREATE OR REPLACE FUNCTION validate_task_parent_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent_parent_id uuid;
BEGIN
    IF NEW.parent_task_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.parent_task_id = NEW.id THEN
        RAISE EXCEPTION 'task cannot be parent of itself'
            USING ERRCODE = '23514';
    END IF;

    SELECT parent_task_id
      INTO v_parent_parent_id
      FROM task
     WHERE id = NEW.parent_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'parent task not found: %', NEW.parent_task_id
            USING ERRCODE = '23503';
    END IF;

    IF v_parent_parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'nested subtasks deeper than one level are not allowed'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_validate_parent
BEFORE INSERT OR UPDATE OF parent_task_id ON task
FOR EACH ROW
EXECUTE FUNCTION validate_task_parent_rules();

-- =========================================================
-- task_field_value
-- =========================================================

CREATE TABLE task_field_value (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             uuid NOT NULL,
    field_definition_id uuid NOT NULL,
    value_text          text NULL,
    value_number        numeric(20,6) NULL,
    value_user_id       uuid NULL,
    value_date          date NULL,
    value_datetime      timestamptz NULL,
    value_json          jsonb NULL,
    enum_dictionary_id  uuid NULL,
    enum_version        integer NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_task_field_value_task
        FOREIGN KEY (task_id) REFERENCES task(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_task_field_value_field_definition
        FOREIGN KEY (field_definition_id) REFERENCES task_field_definition(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_task_field_value_enum_dictionary
        FOREIGN KEY (enum_dictionary_id) REFERENCES enum_dictionary(id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_task_field_value_task_field
        UNIQUE (task_id, field_definition_id),

    CONSTRAINT chk_task_field_value_enum_version_positive
        CHECK (enum_version IS NULL OR enum_version > 0)
);

CREATE INDEX idx_task_field_value_task_id
    ON task_field_value (task_id);

CREATE INDEX idx_task_field_value_field_definition_id
    ON task_field_value (field_definition_id);

CREATE INDEX idx_task_field_value_value_user_id
    ON task_field_value (value_user_id);

CREATE INDEX idx_task_field_value_value_date
    ON task_field_value (value_date);

CREATE INDEX idx_task_field_value_value_datetime
    ON task_field_value (value_datetime);

CREATE INDEX idx_task_field_value_value_json_gin
    ON task_field_value USING gin (value_json);

CREATE TRIGGER trg_task_field_value_set_updated_at
BEFORE UPDATE ON task_field_value
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- task_attachment
-- =========================================================

CREATE TABLE task_attachment (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      uuid NOT NULL,
    file_name    varchar(1024) NOT NULL,
    file_size    bigint NOT NULL,
    mime_type    varchar(255) NOT NULL,
    storage_key  varchar(2048) NOT NULL,
    uploaded_by  uuid NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_task_attachment_task
        FOREIGN KEY (task_id) REFERENCES task(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_task_attachment_file_size_non_negative
        CHECK (file_size >= 0),

    CONSTRAINT chk_task_attachment_file_name_not_empty
        CHECK (btrim(file_name) <> ''),

    CONSTRAINT chk_task_attachment_storage_key_not_empty
        CHECK (btrim(storage_key) <> '')
);

CREATE INDEX idx_task_attachment_task_id
    ON task_attachment (task_id);

-- =========================================================
-- task_comment
-- =========================================================

CREATE TABLE task_comment (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     uuid NOT NULL,
    author_id   uuid NOT NULL,
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_task_comment_task
        FOREIGN KEY (task_id) REFERENCES task(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_task_comment_body_not_empty
        CHECK (btrim(body) <> '')
);

CREATE INDEX idx_task_comment_task_created_at
    ON task_comment (task_id, created_at ASC);

CREATE TRIGGER trg_task_comment_set_updated_at
BEFORE UPDATE ON task_comment
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION prevent_task_comment_body_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.body IS DISTINCT FROM OLD.body THEN
        RAISE EXCEPTION 'task comment editing is not allowed'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_comment_prevent_body_update
BEFORE UPDATE OF body ON task_comment
FOR EACH ROW
EXECUTE FUNCTION prevent_task_comment_body_update();

-- =========================================================
-- task_history
-- =========================================================

CREATE TABLE task_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         uuid NOT NULL,
    actor_id        uuid NOT NULL,
    event_type      varchar(64) NOT NULL,
    entity_type     varchar(64) NOT NULL,
    entity_id       uuid NULL,
    field_code      varchar(64) NULL,
    old_value_json  jsonb NULL,
    new_value_json  jsonb NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_task_history_task
        FOREIGN KEY (task_id) REFERENCES task(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_task_history_event_type_not_empty
        CHECK (btrim(event_type) <> ''),

    CONSTRAINT chk_task_history_entity_type_not_empty
        CHECK (btrim(entity_type) <> '')
);

CREATE INDEX idx_task_history_task_created_at
    ON task_history (task_id, created_at DESC);

CREATE INDEX idx_task_history_event_type
    ON task_history (event_type);

CREATE INDEX idx_task_history_entity_type
    ON task_history (entity_type);

COMMENT ON TABLE task_template IS 'Task templates. Soft delete via deleted_at.';
COMMENT ON COLUMN task_template.prefix IS 'Public prefix used in task public_id. Uppercase Latin letters only.';
COMMENT ON TABLE task_status IS 'Task statuses. Soft delete via deleted_at.';
COMMENT ON TABLE task_field_definition IS 'Template field definitions. Soft delete via deleted_at.';
COMMENT ON COLUMN task_field_definition.field_role IS 'Currently supported: assignee.';
COMMENT ON TABLE task IS 'Main task entity. public_id is generated as <PREFIX>-<N>.';
COMMENT ON COLUMN task.parent_task_id IS 'One level of subtasks only; enforced by trigger.';
COMMENT ON TABLE task_field_value IS 'Universal storage for custom field values.';
COMMENT ON TABLE task_history IS 'Audit trail for task changes.';

-- =========================================================
-- DIFF: index for filtering tasks by template_snapshot_prefix
-- =========================================================

CREATE INDEX idx_task_template_snapshot_prefix
    ON task (template_snapshot_prefix);

-- =========================================================
-- DIFF: consistency FK for enum_dictionary_id + enum_version
-- =========================================================

ALTER TABLE task_field_value
    ADD CONSTRAINT fk_task_field_value_enum_version
    FOREIGN KEY (enum_dictionary_id, enum_version)
    REFERENCES enum_dictionary_version (dictionary_id, version)
    ON DELETE RESTRICT;

-- Добавляем partial unique index только для неудалённых полей
CREATE UNIQUE INDEX uq_task_field_definition_template_code_active
    ON task_field_definition (template_id, code)
    WHERE deleted_at IS NULL;
