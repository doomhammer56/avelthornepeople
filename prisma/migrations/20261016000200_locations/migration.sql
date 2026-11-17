BEGIN;

CREATE TABLE portal.locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL,
    name_zh text NOT NULL,
    name_en text,
    address_zh text,
    address_en text,
    country_code text NOT NULL,
    timezone text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT locations_code_check CHECK (btrim(code) <> ''),
    CONSTRAINT locations_name_zh_check CHECK (btrim(name_zh) <> ''),
    CONSTRAINT locations_country_code_check CHECK (country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT locations_timezone_check CHECK (btrim(timezone) <> '')
);

CREATE UNIQUE INDEX locations_code_key ON portal.locations(code);

ALTER TABLE portal.locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE portal.locations FROM PUBLIC;

DO $$
DECLARE target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE portal.locations FROM %I', target_role);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
