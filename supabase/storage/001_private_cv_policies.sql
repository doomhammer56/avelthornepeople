BEGIN;

-- Restrictive guards also protect CVs if an unrelated permissive policy is
-- added later. Signed capabilities and server Storage credentials use the
-- provider's trusted paths; ordinary browser credentials cannot access CV rows.
DROP POLICY IF EXISTS cv_private_objects_guard ON storage.objects;
CREATE POLICY cv_private_objects_guard ON storage.objects
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id NOT IN ('cv-quarantine', 'cv-clean'))
WITH CHECK (bucket_id NOT IN ('cv-quarantine', 'cv-clean'));

DROP POLICY IF EXISTS cv_private_buckets_guard ON storage.buckets;
CREATE POLICY cv_private_buckets_guard ON storage.buckets
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (id NOT IN ('cv-quarantine', 'cv-clean'))
WITH CHECK (id NOT IN ('cv-quarantine', 'cv-clean'));

COMMIT;
