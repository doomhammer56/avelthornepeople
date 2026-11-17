BEGIN;

CREATE TABLE "portal"."audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "object_type" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "safe_changes" JSONB NOT NULL DEFAULT '{}',
    "request_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal"."outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "delivery_key" TEXT NOT NULL,
    "safe_references" JSONB NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_object_idx" ON "portal"."audit_logs"("object_type", "object_id", "created_at");

CREATE INDEX "audit_logs_actor_idx" ON "portal"."audit_logs"("actor_id", "created_at");

CREATE UNIQUE INDEX "outbox_events_delivery_key_key" ON "portal"."outbox_events"("delivery_key");

ALTER TABLE "portal"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "portal"."staff_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE portal.audit_logs
    ADD CONSTRAINT audit_logs_object_type_check CHECK (btrim(object_type) <> ''),
    ADD CONSTRAINT audit_logs_action_check CHECK (btrim(action) <> ''),
    ADD CONSTRAINT audit_logs_safe_changes_check CHECK (jsonb_typeof(safe_changes) = 'object');

ALTER TABLE portal.outbox_events
    ADD CONSTRAINT outbox_events_event_type_check CHECK (btrim(event_type) <> ''),
    ADD CONSTRAINT outbox_events_delivery_key_check CHECK (btrim(delivery_key) <> ''),
    ADD CONSTRAINT outbox_events_safe_references_check CHECK (jsonb_typeof(safe_references) = 'object'),
    ADD CONSTRAINT outbox_events_state_check CHECK (state IN ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD')),
    ADD CONSTRAINT outbox_events_attempts_check CHECK (attempts >= 0),
    ADD CONSTRAINT outbox_events_processing_lease_check CHECK ((state = 'PROCESSING') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
    ADD CONSTRAINT outbox_events_lease_pair_check CHECK ((lease_token IS NULL) = (lease_until IS NULL));

CREATE INDEX outbox_events_due_idx ON portal.outbox_events(available_at) WHERE state = 'PENDING';
CREATE INDEX outbox_events_lease_idx ON portal.outbox_events(lease_until) WHERE state = 'PROCESSING';

ALTER TABLE portal.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.outbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE portal.audit_logs, portal.outbox_events FROM PUBLIC;

DO $$
DECLARE target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE portal.audit_logs, portal.outbox_events FROM %I', target_role);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
