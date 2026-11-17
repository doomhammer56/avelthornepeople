CREATE INDEX CONCURRENTLY uploads_intake_expiry_idx
  ON portal.uploads(provider_upload_expires_at,id)
  WHERE intake_job_id IS NOT NULL AND scan_state='PENDING'
    AND storage_provider='SUPABASE' AND bucket='cv-quarantine';
