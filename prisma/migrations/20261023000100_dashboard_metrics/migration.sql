BEGIN;

-- Historical acquisition labels cannot prove where a submission was made.
-- Existing rows remain explicitly unattributed; intake must set this field.
ALTER TABLE portal.applications ADD COLUMN submission_channel text
  CHECK (submission_channel IN ('PUBLIC_SITE','IMPORT'));

CREATE ROLE portal_metrics_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_metrics_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA portal_private TO portal_metrics_writer, portal_metrics_owner;
GRANT USAGE ON SCHEMA portal TO portal_metrics_owner;
GRANT SELECT ON portal.visible_jobs TO portal_metrics_owner;

CREATE TABLE portal_private.analytics_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at timestamptz CHECK (started_at IS NULL OR isfinite(started_at))
);
INSERT INTO portal_private.analytics_state VALUES (true, NULL);
ALTER TABLE portal_private.analytics_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_private.analytics_state FROM PUBLIC;
GRANT SELECT ON portal_private.analytics_state TO portal_metrics_owner, portal_runtime;
CREATE POLICY metrics_state_owner ON portal_private.analytics_state FOR SELECT TO portal_metrics_owner USING (true);
CREATE POLICY metrics_state_staff ON portal_private.analytics_state FOR SELECT TO portal_runtime
  USING (portal_private.current_staff_role() IN ('ADMIN','HR'));

CREATE TABLE portal_private.metric_traffic (
  key uuid PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE INDEX metric_traffic_expiry_idx ON portal_private.metric_traffic (window_start);
ALTER TABLE portal_private.metric_traffic ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_private.metric_traffic FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_private.metric_traffic TO portal_metrics_owner;
CREATE POLICY metrics_traffic_owner ON portal_private.metric_traffic TO portal_metrics_owner USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON portal.daily_metrics TO portal_metrics_owner;
CREATE POLICY metrics_counter_owner ON portal.daily_metrics TO portal_metrics_owner
  USING (page_key='job_detail' AND job_id IS NOT NULL AND locale IN ('en','zh')
    AND source IN ('direct','linkedin','jobstreet','referral','other'))
  WITH CHECK (page_key='job_detail' AND job_id IS NOT NULL AND locale IN ('en','zh')
    AND source IN ('direct','linkedin','jobstreet','referral','other'));

CREATE FUNCTION portal_private.record_job_detail_view(p_job uuid, p_locale text, p_source text, p_key uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_start timestamptz;
  v_attempts integer;
  v_key uuid;
  v_limit integer;
BEGIN
  IF p_job IS NULL OR p_key IS NULL OR p_key='00000000-0000-0000-0000-000000000000'::uuid
    OR p_locale IS NULL OR p_locale NOT IN ('en','zh')
    OR p_source IS NULL OR p_source NOT IN ('direct','linkedin','jobstreet','referral','other') THEN
    RAISE EXCEPTION 'Invalid view dimensions' USING ERRCODE='22023';
  END IF;
  SELECT started_at INTO v_start FROM portal_private.analytics_state WHERE singleton;
  IF v_start IS NULL OR v_start > v_now THEN RETURN -1; END IF;
  -- Global first: bounds the maximum number of per-IP buckets created per minute.
  FOREACH v_key IN ARRAY ARRAY['00000000-0000-0000-0000-000000000000'::uuid,p_key] LOOP
    v_limit := CASE WHEN v_key='00000000-0000-0000-0000-000000000000'::uuid THEN 3000 ELSE 100 END;
    INSERT INTO portal_private.metric_traffic AS t (key,window_start,attempts)
      VALUES (v_key,v_now,1)
      ON CONFLICT (key) DO UPDATE SET
        window_start=CASE WHEN t.window_start <= v_now-interval '1 minute' THEN v_now ELSE t.window_start END,
        attempts=CASE WHEN t.window_start <= v_now-interval '1 minute' THEN 1 ELSE LEAST(t.attempts+1,3001) END
      RETURNING attempts,window_start INTO v_attempts,v_start;
    IF v_attempts > v_limit THEN
      RETURN GREATEST(1,ceil(extract(epoch FROM v_start+interval '1 minute'-v_now))::integer);
    END IF;
  END LOOP;
  DELETE FROM portal_private.metric_traffic WHERE window_start < v_now-interval '1 hour';
  IF NOT EXISTS (SELECT 1 FROM portal.visible_jobs WHERE id=p_job) THEN RETURN 0; END IF;
  INSERT INTO portal.daily_metrics (metric_date,job_id,page_key,locale,source,page_views)
    VALUES ((v_now AT TIME ZONE 'UTC')::date,p_job,'job_detail',p_locale,p_source,1)
    ON CONFLICT (metric_date,job_id,page_key,locale,source)
      DO UPDATE SET page_views=portal.daily_metrics.page_views+1, updated_at=v_now;
  RETURN 0;
END $$;
REVOKE ALL ON FUNCTION portal_private.record_job_detail_view(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.record_job_detail_view(uuid,text,text,uuid) TO portal_metrics_writer;
-- The definer owns no table, has no BYPASSRLS and can only see eligible public jobs.
GRANT portal_metrics_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA portal_private TO portal_metrics_owner;
ALTER FUNCTION portal_private.record_job_detail_view(uuid,text,text,uuid) OWNER TO portal_metrics_owner;
REVOKE CREATE ON SCHEMA portal_private FROM portal_metrics_owner;
REVOKE portal_metrics_owner FROM CURRENT_USER;

COMMIT;
