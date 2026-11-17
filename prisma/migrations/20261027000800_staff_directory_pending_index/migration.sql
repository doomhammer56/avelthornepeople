CREATE INDEX CONCURRENTLY staff_provider_operations_pending_profile_idx
  ON portal_private.staff_provider_operations(profile_id,created_at,id)
  WHERE completed_at IS NULL;
