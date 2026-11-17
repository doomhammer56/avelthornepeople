BEGIN;

DO $$ BEGIN EXECUTE format('GRANT portal_recruitment_owner TO %I',current_user); END $$;
GRANT CREATE ON SCHEMA portal_private TO portal_recruitment_owner;

-- Keep the shared row first in the lock order and check its capacity before
-- creating a caller bucket. Only calls admitted by both limits spend shared
-- quota; a blocked caller cannot exhaust everybody else's daily allowance.
CREATE OR REPLACE FUNCTION portal_private.consume_intake_traffic(p_key uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  global_key constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  shared portal_private.intake_traffic%ROWTYPE;
  caller portal_private.intake_traffic%ROWTYPE;
  moment timestamptz;
BEGIN
  IF p_key IS NULL OR p_key=global_key THEN
    RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';
  END IF;

  INSERT INTO portal_private.intake_traffic
    VALUES(global_key,statement_timestamp(),statement_timestamp(),0,0)
    ON CONFLICT(key) DO NOTHING;
  SELECT * INTO shared FROM portal_private.intake_traffic
    WHERE key=global_key FOR UPDATE;
  -- Use the time after acquiring the lock, including any wait for another call.
  moment := clock_timestamp();
  IF shared.minute_start<=moment-interval '1 minute' THEN
    shared.minute_start:=moment;
    shared.minute_count:=0;
  END IF;
  IF shared.day_start<=moment-interval '1 day' THEN
    shared.day_start:=moment;
    shared.day_count:=0;
  END IF;
  IF shared.day_count>=2000 THEN
    RETURN greatest(1,ceil(extract(epoch FROM shared.day_start+interval '1 day'-moment))::integer);
  END IF;
  IF shared.minute_count>=120 THEN
    RETURN greatest(1,ceil(extract(epoch FROM shared.minute_start+interval '1 minute'-moment))::integer);
  END IF;

  -- Preserve per-caller attempt accounting, including denied attempts. This row
  -- is created only while shared capacity exists; a new caller's first call
  -- always passes its own limits, bounding bucket growth by the shared budget.
  INSERT INTO portal_private.intake_traffic AS r VALUES(p_key,moment,moment,1,1)
    ON CONFLICT(key) DO UPDATE SET
      minute_count=CASE WHEN r.minute_start<=moment-interval '1 minute' THEN 1 ELSE least(r.minute_count+1,121) END,
      minute_start=CASE WHEN r.minute_start<=moment-interval '1 minute' THEN moment ELSE r.minute_start END,
      day_count=CASE WHEN r.day_start<=moment-interval '1 day' THEN 1 ELSE least(r.day_count+1,2001) END,
      day_start=CASE WHEN r.day_start<=moment-interval '1 day' THEN moment ELSE r.day_start END
    RETURNING * INTO caller;
  IF caller.day_count>100 THEN
    RETURN greatest(1,ceil(extract(epoch FROM caller.day_start+interval '1 day'-moment))::integer);
  END IF;
  IF caller.minute_count>12 THEN
    RETURN greatest(1,ceil(extract(epoch FROM caller.minute_start+interval '1 minute'-moment))::integer);
  END IF;

  UPDATE portal_private.intake_traffic SET
    minute_start=shared.minute_start,minute_count=shared.minute_count+1,
    day_start=shared.day_start,day_count=shared.day_count+1
    WHERE key=global_key;
  DELETE FROM portal_private.intake_traffic WHERE day_start<moment-interval '2 days';
  RETURN 0;
END $$;

ALTER FUNCTION portal_private.consume_intake_traffic(uuid) OWNER TO portal_recruitment_owner;
REVOKE ALL ON FUNCTION portal_private.consume_intake_traffic(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_private.consume_intake_traffic(uuid) TO portal_runtime;
REVOKE CREATE ON SCHEMA portal_private FROM portal_recruitment_owner;
DO $$ BEGIN EXECUTE format('REVOKE portal_recruitment_owner FROM %I',current_user); END $$;

COMMIT;
