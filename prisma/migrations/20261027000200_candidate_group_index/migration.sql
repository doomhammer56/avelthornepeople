-- Build without blocking candidate writes. Keep this outside an explicit
-- transaction: PostgreSQL requires that for CREATE INDEX CONCURRENTLY.
CREATE INDEX CONCURRENTLY candidates_group_idx
  ON portal.candidates ((coalesce(merged_into_id,id)));
