import "server-only";
import type pg from "pg";
import { withPublicReader } from "../database/public.ts";
import {
  publicJobDto,
  publicJobSummaryDtos,
  type PublicJobRow,
} from "./public-dto.ts";
import {
  publicJobQuery,
  publicFacetPageSize,
  type PublicJobQuery,
  type PublicJobPage,
  type PublicJobFacets,
} from "../../lib/publicJobQuery.ts";

// The same reference visibility and label rules apply to summaries and details.
// These fragments are constant SQL; all request values stay parameterized.
const referenceProjection = `
      d.name_en AS department_en,d.name_zh AS department_zh,
      jsonb_build_object('en',jt.name_en,'zh',jt.name_zh) type_label,
      CASE WHEN ex.code IS NULL THEN NULL ELSE jsonb_build_object('en',ex.name_en,'zh',ex.name_zh) END experience_label,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('en',l.name_en,'zh',l.name_zh) ORDER BY l.code)
        FROM portal.visible_job_locations jl JOIN portal.public_locations l ON l.id=jl.location_id
        WHERE jl.job_id=j.id),'[]') AS locations`;
const referenceJoins = `
      FROM portal.visible_jobs j JOIN portal.public_departments d ON d.id=j.department_id
      JOIN portal.public_job_options jt ON jt.kind='jobType' AND jt.code=j.job_type
      LEFT JOIN portal.public_job_options ex ON ex.kind='experience' AND ex.code=j.experience`;
const hasVisibleLocation = `EXISTS(SELECT 1 FROM portal.visible_job_locations jl
      JOIN portal.public_locations l ON l.id=jl.location_id WHERE jl.job_id=j.id)`;
// Exact ECMAScript trim characters, matching the public DTO parser. These are
// constant code points (no quotes or request input), including Unicode spaces.
const trimCharactersSql = `'${String.fromCodePoint(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)}'`;

const summarySource = `SELECT j.id,j.canonical_slug,j.created_at,j.publish_at,j.close_at,
      j.published_content->'en'->'title' AS title_en,
      j.published_content->'zh'->'title' AS title_zh,
      COALESCE(j.published_content->'englishFallback'='true'::jsonb,false) AS english_fallback,
      ${referenceProjection} ${referenceJoins} WHERE ${hasVisibleLocation}`;
const filterSource = `WITH summaries AS (${summarySource}), labels AS (
    SELECT s.*,
      COALESCE(NULLIF(department_en,''),CASE WHEN english_fallback THEN department_zh END) department_value,
      (SELECT CASE WHEN bool_and(COALESCE(NULLIF(l->>'en',''),'')<>'' OR english_fallback)
        THEN string_agg(COALESCE(NULLIF(l->>'en',''),l->>'zh'),', ' ORDER BY n) ELSE '' END
        FROM jsonb_array_elements(locations) WITH ORDINALITY v(l,n)) location_value
    FROM summaries s)`;

export async function publishedJobPage(
  query: PublicJobQuery = publicJobQuery(),
  connectionPool?: pg.Pool,
): Promise<PublicJobPage> {
  return withPublicReader(async (db) => {
    const values = [
      query.filters.query.trim().normalize("NFKC").toLowerCase(),
      query.filters.department,
      query.filters.location,
      query.filters.type,
      query.filters.experience,
      query.page,
      query.pageSize,
    ];
    const {
      rows: [result],
    } = await db.query(
      `${filterSource}, filtered AS MATERIALIZED (
      SELECT id,created_at,publish_at FROM labels WHERE
        ($1='' OR strpos(lower(normalize(btrim(CASE WHEN english_fallback THEN title_zh ELSE title_en END #>> '{}',${trimCharactersSql})||' '||btrim(title_zh #>> '{}',${trimCharactersSql}),NFKC)),$1)>0)
        AND ($2='' OR btrim(department_value,${trimCharactersSql})=$2) AND ($3='' OR btrim(location_value,${trimCharactersSql})=$3)
        AND ($4='' OR btrim(type_label->>'en',${trimCharactersSql})=$4) AND ($5='' OR btrim(experience_label->>'en',${trimCharactersSql})=$5)
    ), totals AS (SELECT count(*)::integer total FROM filtered), bounds AS (
      SELECT total,greatest(1,ceil(total::numeric/$7::integer)::integer) total_pages FROM totals
    ), requested AS (SELECT *,least($6::integer,total_pages) page FROM bounds), page_ids AS (
      SELECT f.* FROM filtered f ORDER BY created_at DESC,publish_at DESC,id
      LIMIT $7::integer OFFSET (SELECT (page-1)*$7::integer FROM requested)
    ), page_rows AS (
      ${summarySource} AND j.id IN(SELECT id FROM page_ids)
    ) SELECT total,page,total_pages,COALESCE((SELECT jsonb_agg(to_jsonb(p)-'created_at' ORDER BY created_at DESC,publish_at DESC,id) FROM page_rows p),'[]') jobs FROM requested`,
      values,
    );
    let facets: PublicJobFacets | null = null;
    if (query.includeFacets) {
      const facetRows = (
        await db.query(
          `${filterSource}, options AS (
        SELECT DISTINCT ON(v.field,v.en) v.field,v.en,v.zh FROM labels l CROSS JOIN LATERAL (VALUES
          ('department',btrim(department_value,${trimCharactersSql}),btrim(department_zh,${trimCharactersSql})),('location',btrim(location_value,${trimCharactersSql}),btrim((SELECT string_agg(x->>'zh','、' ORDER BY n) FROM jsonb_array_elements(locations) WITH ORDINALITY a(x,n)),${trimCharactersSql})),
          ('type',btrim(type_label->>'en',${trimCharactersSql}),btrim(type_label->>'zh',${trimCharactersSql})),('experience',btrim(experience_label->>'en',${trimCharactersSql}),btrim(experience_label->>'zh',${trimCharactersSql}))
        ) v(field,en,zh) WHERE v.en IS NOT NULL AND v.en<>'' AND v.zh IS NOT NULL AND v.zh<>''
        ORDER BY v.field,v.en,l.publish_at ASC,l.id DESC
      ), ranked AS (SELECT *,row_number() OVER(PARTITION BY field ORDER BY en,zh) n FROM options), fields AS (
        SELECT * FROM (VALUES ('department',$1::integer),('location',$2::integer),('type',$3::integer),('experience',$4::integer)) f(field,requested)
      ), counts AS (SELECT f.field,f.requested,greatest(1,ceil(count(o.field)::numeric/$5::integer)::integer) total_pages FROM fields f LEFT JOIN options o USING(field) GROUP BY f.field,f.requested), bounds AS (
        SELECT field,total_pages,least(requested,total_pages) page FROM counts
      ) SELECT b.field,b.page,b.total_pages,COALESCE(jsonb_agg(jsonb_build_object('en',r.en,'zh',r.zh) ORDER BY r.en,r.zh) FILTER(WHERE r.n IS NOT NULL),'[]') options
      FROM bounds b LEFT JOIN ranked r ON r.field=b.field AND r.n>(b.page-1)*$5::integer AND r.n<=b.page*$5::integer GROUP BY b.field,b.page,b.total_pages`,
          [
            query.facetPages.department,
            query.facetPages.location,
            query.facetPages.type,
            query.facetPages.experience,
            publicFacetPageSize,
          ],
        )
      ).rows;
      facets = Object.fromEntries(
        facetRows.map((row) => [
          row.field,
          { options: row.options, page: row.page, totalPages: row.total_pages },
        ]),
      ) as PublicJobFacets;
    }
    return {
      jobs: publicJobSummaryDtos(result.jobs),
      total: result.total,
      page: result.page,
      totalPages: result.total_pages,
      pageSize: query.pageSize,
      facets,
    };
  }, connectionPool);
}

async function readJob(slug: string, connectionPool?: pg.Pool) {
  return withPublicReader(async (db) => {
    const { rows } = await db.query<PublicJobRow>(
      `SELECT j.id,j.canonical_slug,j.published_content,
      j.publish_at,j.close_at,j.job_type,j.experience,j.show_salary,
      j.salary_min,j.salary_max,j.salary_currency,j.salary_period,
      ${referenceProjection}
      ${referenceJoins}
      WHERE j.canonical_slug=$1 AND ${hasVisibleLocation}
      LIMIT 1`,
      [slug],
    );
    return rows;
  }, connectionPool);
}

export function publicJobAcceptsApplications(id: string) {
  return withPublicReader(
    async (db) =>
      (
        await db.query(
          `SELECT EXISTS(SELECT 1 FROM portal.visible_jobs j JOIN portal.public_departments d ON d.id=j.department_id
      WHERE j.id=$1 AND EXISTS(SELECT 1 FROM portal.visible_job_locations jl JOIN portal.public_locations l ON l.id=jl.location_id WHERE jl.job_id=j.id)) open`,
          [id],
        )
      ).rows[0].open === true,
  );
}

// Sitemap is an intentional complete export. Transfer only link metadata;
// ordinary pages must use publishedJobPage rather than loading all summaries.
export async function publishedJobLinks(connectionPool?: pg.Pool) {
  return withPublicReader(async (db) => {
    const { rows } =
      await db.query(`SELECT j.canonical_slug,j.publish_at ${referenceJoins}
      WHERE ${hasVisibleLocation} ORDER BY j.publish_at DESC,j.id`);
    return rows.map((row) => ({
      slug: row.canonical_slug as string,
      postedAt: new Date(row.publish_at).toISOString().slice(0, 10),
    }));
  }, connectionPool);
}

export async function findPublishedJob(slug: string, connectionPool?: pg.Pool) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 200)
    return null;
  const [row] = await readJob(slug, connectionPool);
  return row ? publicJobDto(row) : null;
}
