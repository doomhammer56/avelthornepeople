BEGIN;

CREATE SCHEMA IF NOT EXISTS portal;
REVOKE ALL ON SCHEMA portal FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal REVOKE ALL ON SEQUENCES FROM PUBLIC;

CREATE TABLE portal.staff_profiles (
    id uuid PRIMARY KEY,
    display_name text NOT NULL,
    role text NOT NULL DEFAULT 'READ_ONLY',
    active boolean NOT NULL DEFAULT false,
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT staff_profiles_display_name_check CHECK (btrim(display_name) <> ''),
    CONSTRAINT staff_profiles_role_check CHECK (role IN ('ADMIN', 'HR', 'READ_ONLY')),
    CONSTRAINT staff_profiles_auth_user_fk
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE portal.departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL,
    name_zh text NOT NULL,
    name_en text,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT departments_code_check CHECK (btrim(code) <> ''),
    CONSTRAINT departments_name_zh_check CHECK (btrim(name_zh) <> '')
);

CREATE UNIQUE INDEX departments_code_key ON portal.departments(code);

CREATE FUNCTION portal.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, portal AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON portal.staff_profiles
FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

ALTER TABLE portal.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.departments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA portal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA portal FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal FROM PUBLIC;

DO $$
DECLARE target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role) THEN
            EXECUTE format('REVOKE ALL ON SCHEMA portal FROM %I', target_role);
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA portal FROM %I', target_role);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA portal FROM %I', target_role);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal FROM %I', target_role);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
