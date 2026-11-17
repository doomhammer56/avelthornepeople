# Job Portal

Bilingual careers website and HR admin console built with Next.js, React,
TypeScript, PostgreSQL/Prisma, and Supabase Auth and Storage.

## Getting started

```sh
npm ci
cp .env.example .env
npm run dev
```

Configure the required values in `.env` before using backend features.
Open [localhost:3000](http://localhost:3000).

## Application

- Public site: `/en` and `/zh`, including company pages, careers and job details.
- Staff console: `/admin`, with authentication, role-based access and recruitment metrics.
- Backend: database migrations, private CV storage, staff APIs and page-view collection.

Public jobs use preview data by default. Use `PUBLIC_JOBS_SOURCE=database` for
database-backed jobs, or `api` with `PUBLIC_API_BASE_URL` for an external service.
Contact messages post to `/api/contact`. See [.env.example](.env.example) for
configuration options.

## Visual content editor

The Content screen previews Home, About, Services and Contact using the public
page components. Select an outlined section to edit its EN/ZH wording and images.
Desktop and mobile previews update from drafts without changing the public site.

Save Draft and Publish apply to the selected section in both languages. Shared
sections identify the pages they affect; unsaved changes survive preview switches
and trigger a warning before leaving. Existing permissions and versioned API
commands still control writes. Preview links, forms and automatic refresh are inactive.

Navigation, footer labels, contact details and typography have no editable fields
in the current content contract. Job content remains managed through Jobs.
Run `node --test tests/unit/content/preview.test.mjs` for draft projection checks.

Image uploads require the private Supabase Storage bucket `company-content`.
With the target environment's `SUPABASE_URL` and server-only
`SUPABASE_SECRET_KEY` configured, run:

```sh
npm run content:storage:setup
npm run content:storage:verify
```

These commands configure only image storage, preserve existing files and content,
and can be repeated. The general `storage:setup` and `storage:verify` commands
also include this bucket alongside the CV buckets. Run setup separately for each
Supabase project before using the content editor; it does not seed or publish content.

Admins can upload JPEG, PNG or WebP images up to 3 MB in Content. The server
validates and converts them to WebP before storage. Draft images require staff
access; public image URLs become available after publishing their section.
Keep the bucket private and use the app's image routes rather than Supabase public
URLs so unpublished images stay private. No browser Storage write policy is needed.

The six original company illustrations are also stored in that private bucket as
lossless WebP files under `illustrations/v1/`. The fixed
`/api/content/illustrations/{name}` routes serve only these public defaults;
uploaded replacements continue through the draft/publication image routes.
No company image files are bundled in `public/`.

When provisioning another Supabase project, copy these six objects from the
existing bucket through the Storage API, preserving their keys and MIME type
`image/webp`.

## Filtering

Admin Audit and Jobs filters apply dropdown changes immediately and debounce text
input by 350 ms. Applications combines job, source, pipeline and contact filters
through the existing private search endpoint; complete contact values apply after
500 ms and never enter URLs. Public careers filters operate immediately on the
loaded public summaries. Existing backend authorization and pagination still apply.

## Application exports

Applications exports include the current filtered page only. PDF reports use the
console palette, repeated headings, page numbers and embedded EN/ZH text. The
licensed export font is fetched on the first PDF request, rather than during page
loading. Excel workbooks include styled headings, frozen filter rows, wrapped
values, full identifiers and original submission timestamps. Both formats are
generated locally in the browser without an external export service.

## Dashboard and console preferences

Dashboard ranges use the existing rolling 7, 30 and 90-day UTC periods. Charts
show weekday or month labels; hover or keyboard focus reveals each day's exact
date and count. Tracking limitations remain available in a collapsed disclosure.

The console language switch uses client navigation, preserving the active theme,
sidebar state and URL filters while translated page content loads.

## Common commands

| Command                  | Purpose                       |
| ------------------------ | ----------------------------- |
| `npm run dev`            | Start the development server  |
| `npm run build`          | Create a production build     |
| `npm start`              | Serve the production build    |
| `npm run lint`           | Run ESLint                    |
| `npm run typecheck`      | Check TypeScript              |
| `npm test`               | Run public-site unit tests    |
| `npm run test:auth`      | Run authentication unit tests |
| `npm run test:dashboard` | Run dashboard unit tests      |
| `npm run db:generate`    | Generate the Prisma client    |
