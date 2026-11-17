// Where public vacancies come from. Sample (preview) vacancies are for local
// development only: a production deployment with no source configured must fail
// visibly instead of quietly advertising dummy jobs to real candidates.
export function publicJobsSource() {
  const configured = process.env.PUBLIC_JOBS_SOURCE;
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "unconfigured" : "preview";
}
