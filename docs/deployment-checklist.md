# Firebase deployment checklist

Local emulator is the only supported environment until this checklist is
reviewed with a real Firebase project.

- Create separate staging/production Firebase projects and configure secrets
  outside this repository.
- Deploy Firestore Rules/indexes, Storage Rules, and 2nd gen Functions through
  CI/CD. Never use local emulator bypass variables in staging/production.
- Confirm `APP_CHECK_MODE` is not `bypass`; register App Check providers and
  verify missing/invalid tokens fail closed.
- Deploy Pub/Sub-backed `onSchedule` functions and confirm triggers:
  recovery every 5 minutes, staging cleanup hourly, finalized orphan cleanup
  hourly. Review `*_SCHEDULE`, `*_TTL_MS`, and grace-period values.
- Confirm recovery state filter/index, 100-record cursor continuation, replay
  wait 750ms, maintenance cursor persistence, and cleanup batch/concurrency
  limits (100 / 8).
- Configure structured-log alerts for cleanup failures, compensation failures,
  active lease age, orphan deletion count, and repeated retries.
- Run staging tests for active/inactive membership, cross-user replay,
  sender-only tombstones, original-only thumbnail contract, and media grace
  period before enabling clients.
- Verify Storage lifecycle/TTL policy agrees with staging cleanup. Do not delete
  finalized media without message-reference and grace-period checks.
