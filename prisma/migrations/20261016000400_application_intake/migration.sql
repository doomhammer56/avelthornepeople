BEGIN;

CREATE TABLE "portal"."candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name_encrypted" BYTEA NOT NULL,
    "email_encrypted" BYTEA NOT NULL,
    "phone_encrypted" BYTEA NOT NULL,
    "email_hmac" BYTEA NOT NULL,
    "phone_hmac" BYTEA NOT NULL,
    "hmac_key_version" INTEGER NOT NULL,
    "deletion_requested_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal"."uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_provider" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "declared_size_bytes" BIGINT NOT NULL,
    "size_bytes" BIGINT,
    "detected_type" TEXT,
    "sha256" BYTEA,
    "scan_state" TEXT NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(6),
    "capability_hash" BYTEA NOT NULL,
    "capability_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal"."applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "candidate_id" UUID,
    "cv_upload_id" UUID NOT NULL,
    "cv_scan_state" TEXT,
    "intake_state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "profile_encrypted" BYTEA NOT NULL,
    "cover_letter_encrypted" BYTEA,
    "consent_at" TIMESTAMPTZ(6) NOT NULL,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "duplicate_candidate_match" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" UUID NOT NULL,
    "payload_digest" BYTEA NOT NULL,
    "receipt_hash" BYTEA NOT NULL,
    "receipt_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "candidates_email_idx" ON "portal"."candidates"("email_hmac", "hmac_key_version");

CREATE INDEX "candidates_phone_idx" ON "portal"."candidates"("phone_hmac", "hmac_key_version");

CREATE UNIQUE INDEX "uploads_capability_hash_key" ON "portal"."uploads"("capability_hash");

CREATE INDEX "uploads_scan_idx" ON "portal"."uploads"("scan_state", "created_at");

CREATE UNIQUE INDEX "uploads_storage_provider_bucket_object_key_key" ON "portal"."uploads"("storage_provider", "bucket", "object_key");

CREATE UNIQUE INDEX "uploads_id_scan_state_key" ON "portal"."uploads"("id", "scan_state");

CREATE UNIQUE INDEX "applications_cv_upload_id_key" ON "portal"."applications"("cv_upload_id");

CREATE UNIQUE INDEX "applications_receipt_hash_key" ON "portal"."applications"("receipt_hash");

CREATE INDEX "applications_job_status_idx" ON "portal"."applications"("job_id", "status", "submitted_at");

CREATE INDEX "applications_candidate_idx" ON "portal"."applications"("candidate_id", "submitted_at");

CREATE INDEX "applications_intake_idx" ON "portal"."applications"("intake_state", "submitted_at");

CREATE UNIQUE INDEX "applications_job_id_idempotency_key_key" ON "portal"."applications"("job_id", "idempotency_key");

ALTER TABLE "portal"."applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "portal"."jobs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "portal"."applications" ADD CONSTRAINT "applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "portal"."candidates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "portal"."applications" ADD CONSTRAINT "applications_cv_upload_id_fkey" FOREIGN KEY ("cv_upload_id") REFERENCES "portal"."uploads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "portal"."applications" ADD CONSTRAINT "applications_cv_upload_id_cv_scan_state_fkey" FOREIGN KEY ("cv_upload_id", "cv_scan_state") REFERENCES "portal"."uploads"("id", "scan_state") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE portal.candidates
    ADD CONSTRAINT candidates_name_encrypted_check CHECK (octet_length(name_encrypted) > 0),
    ADD CONSTRAINT candidates_email_encrypted_check CHECK (octet_length(email_encrypted) > 0),
    ADD CONSTRAINT candidates_phone_encrypted_check CHECK (octet_length(phone_encrypted) > 0),
    ADD CONSTRAINT candidates_email_hmac_check CHECK (octet_length(email_hmac) = 32),
    ADD CONSTRAINT candidates_phone_hmac_check CHECK (octet_length(phone_hmac) = 32),
    ADD CONSTRAINT candidates_hmac_key_version_check CHECK (hmac_key_version > 0);

ALTER TABLE portal.uploads
    ADD CONSTRAINT uploads_storage_provider_check CHECK (storage_provider IN ('SUPABASE', 'S3')),
    ADD CONSTRAINT uploads_bucket_check CHECK (btrim(bucket) <> ''),
    ADD CONSTRAINT uploads_object_key_check CHECK (btrim(object_key) <> ''),
    ADD CONSTRAINT uploads_declared_size_check CHECK (declared_size_bytes BETWEEN 1 AND 10000000),
    ADD CONSTRAINT uploads_size_check CHECK (size_bytes BETWEEN 1 AND 10000000),
    ADD CONSTRAINT uploads_sha256_check CHECK (octet_length(sha256) = 32),
    ADD CONSTRAINT uploads_scan_state_check CHECK (scan_state IN ('PENDING', 'CLEAN', 'INFECTED', 'ERROR')),
    ADD CONSTRAINT uploads_capability_hash_check CHECK (octet_length(capability_hash) = 32),
    ADD CONSTRAINT uploads_capability_expiry_check CHECK (capability_expires_at > created_at),
    ADD CONSTRAINT uploads_clean_check CHECK (scan_state <> 'CLEAN' OR (
        size_bytes IS NOT NULL AND size_bytes = declared_size_bytes AND sha256 IS NOT NULL
        AND scanned_at IS NOT NULL AND detected_type IS NOT NULL
        AND detected_type IN ('application/pdf', 'application/msword')
    ));

ALTER TABLE portal.applications
    ADD CONSTRAINT applications_cv_scan_state_check CHECK (cv_scan_state = 'CLEAN'),
    ADD CONSTRAINT applications_intake_state_check CHECK (intake_state IN ('RECEIVED', 'SCANNING', 'NEEDS_REVIEW', 'REJECTED_FILE', 'UNAVAILABLE', 'CONFIRMED')),
    ADD CONSTRAINT applications_status_check CHECK (status IN ('NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED')),
    ADD CONSTRAINT applications_profile_encrypted_check CHECK (octet_length(profile_encrypted) > 0),
    ADD CONSTRAINT applications_cover_letter_encrypted_check CHECK (octet_length(cover_letter_encrypted) > 0),
    ADD CONSTRAINT applications_policy_version_check CHECK (btrim(policy_version) <> ''),
    ADD CONSTRAINT applications_source_check CHECK (btrim(source) <> ''),
    ADD CONSTRAINT applications_locale_check CHECK (locale IN ('zh', 'en')),
    ADD CONSTRAINT applications_payload_digest_check CHECK (octet_length(payload_digest) = 32),
    ADD CONSTRAINT applications_receipt_hash_check CHECK (octet_length(receipt_hash) = 32),
    ADD CONSTRAINT applications_receipt_expiry_check CHECK (receipt_expires_at > submitted_at),
    ADD CONSTRAINT applications_version_check CHECK (version > 0),
    ADD CONSTRAINT applications_confirmation_time_check CHECK ((intake_state = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
    ADD CONSTRAINT applications_confirmation_check CHECK (intake_state <> 'CONFIRMED' OR (
        candidate_id IS NOT NULL AND cv_scan_state IS NOT NULL AND cv_scan_state = 'CLEAN'
    ));

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON portal.candidates
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON portal.uploads
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON portal.applications
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

ALTER TABLE portal.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE portal.candidates, portal.uploads, portal.applications FROM PUBLIC;

DO $$
DECLARE target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE portal.candidates, portal.uploads, portal.applications FROM %I', target_role);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
