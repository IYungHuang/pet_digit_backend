# Firebase deployment checklist

Local emulator is the only supported environment until this checklist is
reviewed with a real Firebase project.

Staging project:

- Firebase project ID: `pet-digit-backend` (`staging` alias in `.firebaserc`).
- Firestore `(default)`: Native, Standard, `asia-east1`.
- Storage default bucket: `pet-digit-backend.firebasestorage.app`, regional
  `asia-east1`.
- All HTTP, callable, and scheduled Functions are pinned to `asia-east1`.
- `functions/.env.pet-digit-backend` sets `APP_ENV=staging` and
  `APP_CHECK_MODE=enforce`; it contains no secrets.

- Keep staging/production Firebase projects separate and configure secrets
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

## AI pet sprite generation prerequisites

`generatePetSprites` and `regeneratePetSpriteFrame` have two deploy-time
prerequisites that are easy to miss because nothing fails until the functions
are invoked:

- **Signed URL IAM permission.** Both functions call `file.getSignedUrl(...)`
  to hand back a download URL for each generated frame. Application Default
  Credentials have no private key to sign with, so the Cloud Functions
  runtime service account must be granted the **Service Account Token
  Creator** role (`roles/iam.serviceAccountTokenCreator`) on itself. This is a
  one-time per-project setup step; without it, every call fails on the first
  frame with a `signBlob` permission error.

  Gen2 Cloud Functions run as the **default Compute Engine service account**
  (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`), not the App
  Engine default (`<PROJECT_ID>@appspot.gserviceaccount.com`) — grant the
  role to the compute one:

  ```
  gcloud projects add-iam-policy-binding <PROJECT_ID> \
    --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
    --role="roles/iam.serviceAccountTokenCreator"
  ```

- **`GEMINI_API_KEY` secret.** Both functions read a `GEMINI_API_KEY` secret
  via `defineSecret('GEMINI_API_KEY')`. Set it once per environment before
  deploying:

  ```
  firebase functions:secrets:set GEMINI_API_KEY
  ```

  Paste a real Gemini API key (obtainable from
  https://aistudio.google.com/apikey) at the prompt.

  For local emulator development, create `functions/.secret.local`
  containing `GEMINI_API_KEY=<your-key>`. This file is covered by
  `.gitignore` and must never be committed.

- **Storage bucket CORS.** The frontend's zip export does a browser
  `fetch()` on signed download URLs from the sprite generation Storage
  bucket. GCS buckets have no CORS policy by default, so this fails
  until one is applied. `cors.json` at the repo root lists the allowed
  origins (currently local dev only — add the production domain when
  the studio frontend gets deployed). Apply it with `gsutil` (available
  in Cloud Shell at https://console.cloud.google.com/ without any local
  install):

  ```
  gsutil cors set cors.json gs://pet-digit-backend.firebasestorage.app
  ```

  Verify with `gsutil cors get gs://pet-digit-backend.firebasestorage.app`.
