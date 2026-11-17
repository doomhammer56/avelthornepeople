BEGIN;

CREATE TABLE "portal"."content_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "draft_content" JSONB NOT NULL,
    "published_content" JSONB,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal"."contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_encrypted" BYTEA NOT NULL,
    "body_encrypted" BYTEA NOT NULL,
    "locale" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NEW',
    "assigned_to" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal"."daily_metrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "metric_date" DATE NOT NULL,
    "job_id" UUID,
    "page_key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "page_views" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal"."deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID,
    "verified_requester_ref" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reason_code" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "cleanup_progress" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_blocks_order_idx" ON "portal"."content_blocks"("type", "sort_order", "id");

CREATE INDEX "content_blocks_publisher_idx" ON "portal"."content_blocks"("published_by");

CREATE INDEX "contact_messages_inbox_idx" ON "portal"."contact_messages"("state", "created_at");

CREATE INDEX "contact_messages_assignee_idx" ON "portal"."contact_messages"("assigned_to");

CREATE INDEX "daily_metrics_job_idx" ON "portal"."daily_metrics"("job_id", "metric_date");

CREATE UNIQUE INDEX "daily_metrics_dimensions_key" ON "portal"."daily_metrics"("metric_date", "job_id", "page_key", "locale", "source") NULLS NOT DISTINCT;

CREATE INDEX "deletion_requests_queue_idx" ON "portal"."deletion_requests"("state", "due_at");

CREATE INDEX "deletion_requests_candidate_idx" ON "portal"."deletion_requests"("candidate_id");

CREATE INDEX "deletion_requests_verifier_idx" ON "portal"."deletion_requests"("verified_by");

ALTER TABLE "portal"."content_blocks" ADD CONSTRAINT "content_blocks_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "portal"."staff_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "portal"."contact_messages" ADD CONSTRAINT "contact_messages_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "portal"."staff_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "portal"."daily_metrics" ADD CONSTRAINT "daily_metrics_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "portal"."jobs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "portal"."deletion_requests" ADD CONSTRAINT "deletion_requests_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "portal"."candidates"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "portal"."deletion_requests" ADD CONSTRAINT "deletion_requests_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "portal"."staff_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE portal.content_blocks
    ADD CONSTRAINT content_blocks_type_check CHECK (type IN ('BANNER', 'PROFILE', 'CULTURE', 'BENEFIT', 'LOCATION', 'TEAM')),
    ADD CONSTRAINT content_blocks_sort_order_check CHECK (sort_order >= 0),
    ADD CONSTRAINT content_blocks_draft_content_check CHECK (jsonb_typeof(draft_content) = 'object'),
    ADD CONSTRAINT content_blocks_published_content_check CHECK (jsonb_typeof(published_content) = 'object'),
    ADD CONSTRAINT content_blocks_version_check CHECK (version > 0),
    ADD CONSTRAINT content_blocks_publication_check CHECK (
        (published_content IS NULL AND published_at IS NULL AND published_by IS NULL) OR
        (published_content IS NOT NULL AND published_at IS NOT NULL AND published_by IS NOT NULL)
    );

ALTER TABLE portal.contact_messages
    ADD CONSTRAINT contact_messages_sender_check CHECK (octet_length(sender_encrypted) > 0),
    ADD CONSTRAINT contact_messages_body_check CHECK (octet_length(body_encrypted) > 0),
    ADD CONSTRAINT contact_messages_locale_check CHECK (locale IN ('zh', 'en')),
    ADD CONSTRAINT contact_messages_state_check CHECK (state IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'SPAM'));

ALTER TABLE portal.daily_metrics
    ADD CONSTRAINT daily_metrics_page_key_check CHECK (btrim(page_key) <> ''),
    ADD CONSTRAINT daily_metrics_source_check CHECK (btrim(source) <> ''),
    ADD CONSTRAINT daily_metrics_locale_check CHECK (locale IN ('zh', 'en')),
    ADD CONSTRAINT daily_metrics_page_views_check CHECK (page_views >= 0);

ALTER TABLE portal.deletion_requests
    ADD CONSTRAINT deletion_requests_state_check CHECK (state IN ('REQUESTED', 'VERIFIED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'ON_HOLD')),
    ADD CONSTRAINT deletion_requests_reason_code_check CHECK (btrim(reason_code) <> ''),
    ADD CONSTRAINT deletion_requests_cleanup_progress_check CHECK (jsonb_typeof(cleanup_progress) = 'object'),
    ADD CONSTRAINT deletion_requests_due_at_check CHECK (due_at >= requested_at),
    ADD CONSTRAINT deletion_requests_verification_time_check CHECK (verified_at >= requested_at),
    ADD CONSTRAINT deletion_requests_completion_time_check CHECK (completed_at >= COALESCE(verified_at, requested_at)),
    ADD CONSTRAINT deletion_requests_completed_check CHECK ((state = 'COMPLETED') = (completed_at IS NOT NULL)),
    ADD CONSTRAINT deletion_requests_verification_check CHECK (
        state NOT IN ('VERIFIED', 'PROCESSING', 'COMPLETED') OR
        (verified_at IS NOT NULL AND verified_by IS NOT NULL)
    );

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON portal.content_blocks
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON portal.contact_messages
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON portal.daily_metrics
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON portal.deletion_requests
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

ALTER TABLE portal.content_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE portal.content_blocks, portal.contact_messages, portal.daily_metrics, portal.deletion_requests FROM PUBLIC;

DO $$
DECLARE target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE portal.content_blocks, portal.contact_messages, portal.daily_metrics, portal.deletion_requests FROM %I', target_role);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
