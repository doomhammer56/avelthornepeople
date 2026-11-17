import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import type { StaffIdentity } from "../auth/identity.ts";
import { staffRead } from "./read.ts";
import { selectAdminJobs } from "../jobs/management-read.ts";
import { safeCount } from "../dashboard/contract.ts";
import { referenceDto } from "../settings/dto.ts";

export const adminReferenceSql = `SELECT
      coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY code) FROM (SELECT id,code,name_en,name_zh,active,version FROM portal.departments) d),'[]') departments,
      coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY code) FROM (SELECT id,code,name_en,name_zh,active,version,country_code,timezone,address_en,address_zh FROM portal.locations) l),'[]') locations,
      coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY code) FROM (SELECT id,kind,code,name_en,name_zh,active,version FROM portal.job_options) o),'[]') options`;

export function readAdminJobs(identity: StaffIdentity, id?: string) {
  return staffRead(identity, rolesFor("jobs.read"), async (db, staff) => {
    if (
      id &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return [];
    return selectAdminJobs(db, staff.role, id ? [id] : null);
  });
}
export function readAdminSettings(identity: StaffIdentity) {
  return staffRead(identity, rolesFor("lookups.read"), async (db) => {
    const {
      rows: [data],
    } = await db.query(adminReferenceSql);
    const departments = data.departments as Record<string, unknown>[];
    const locations = data.locations as Record<string, unknown>[];
    const options = data.options as Record<string, unknown>[];
    return {
      departments: departments.map(referenceDto),
      locations: locations.map(referenceDto),
      jobTypes: options
        .filter((row) => row.kind === "jobType")
        .map(referenceDto),
      experienceLevels: options
        .filter((row) => row.kind === "experience")
        .map(referenceDto),
    };
  });
}
export function readNewApplicationCount(identity: StaffIdentity) {
  return staffRead(identity, rolesFor("applications.read"), async (db) =>
    safeCount(
      (
        await db.query(
          "SELECT count(*)::text AS n FROM portal.applications WHERE intake_state='CONFIRMED' AND status='NEW'",
        )
      ).rows[0].n,
    ),
  );
}
