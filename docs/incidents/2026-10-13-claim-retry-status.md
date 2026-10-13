# Claim retry visibility and extended deadlines

## Confirmed behavior

The affected claim downloaded three documents and completed extraction of two.
The third AI turn exceeded its five-minute deadline. Its owned AI process was
drained, worker admission recovered, and the claim was queued for another attempt.
The old worker changed the claim back to DISCOVERED with a recovery message.
The expanded row hid that message and continued showing historical extraction
events with “All clean so far,” although no comparison result existed.

The session was subsequently stopped by an operator. Deployment diagnostics
found eight finished claims and no active claim jobs. A stopped session must
remain stopped during deployment and startup recovery.

## Changes

- Persist RETRYING, the automatic retry counter, and its earliest eligible time.
  Emit attempt, scheduled-retry and exhausted-retry events. A timeout is never
  presented as a completed or clean review.
- Poll and count retrying claims as unfinished work. Show the reason and next
  attempt, with extraction progress scoped to the latest attempt. Earliest
  eligibility is not a promise of immediate execution: worker recovery and
  claim capacity still apply.
- Display unfinished claims in stopped sessions as “Review paused,” with the
  existing Continue unprocessed action. Do not restart cancelled sessions.
- Recover orphaned queued claims even when no claim is PROCESSING. Preserve
  retry budgets and downloaded files. Include retries in final-failure updates.
- Reactivate a manually resumed session before making its jobs eligible, so a
  fast worker cannot discard a new job as cancelled.
- Raise the default AI-turn deadline from five to ten minutes and the overall
  claim deadline from ten to twenty minutes. A protected, atomic one-time env
  migration raises existing production values and preserves larger custom ones.
  Claim cancellation and process-tree draining remain in place.
- Check actual active BullMQ jobs in the deployment gate as well as database
  statuses. Stopping a session does not relabel a still-running claim as idle.

Retries reuse downloaded documents; they still repeat AI extraction. There is
no persistent per-document extraction checkpoint. Three actual AI attempts
remain the limit; capacity/recovery deferrals do not spend that budget.

## Release verification

The release must pass TypeScript, production build, schema validation, retry and
configuration tests, and browser checks for retry, paused, active and exhausted
states. GitHub Actions retains the Linux process-tree cleanup test, actual
Astra/Fast synthetic-invoice preflight, migrations and worker health check.

The schema migration adds the enum and fields separately from the data migration.
The data migration classifies legacy DISCOVERED rows carrying the AI-recovery
message, including stopped sessions, without activating sessions or changing
saved documents/comparisons. Before running older application code, use a forward
data migration to map RETRYING back to DISCOVERED; retain the extra enum and fields.
The protected env backup is `/etc/ivm/.env.before-claim-reliability`.

Local verification: production build, TypeScript and schema validation passed.
The recovery suite passed 21 tests with the Linux-only process-tree case deferred
to CI. All seven configuration tests passed. Browser checks at 1440, 768 and
375 pixels verified retry reasons/attempts, paused sessions, fresh attempt
progress and exhausted-result display with no browser errors.
