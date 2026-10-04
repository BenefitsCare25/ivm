# ChatGPT worker timeouts on 4 October 2026

## Impact and confirmed evidence

STM - Outpatient session `cmuti8tab0021hy7un07g34ly` ran from 15:34:03 to
15:42:47 SGT on 4 October 2026. All 28 claims were marked ERROR before AI review.
Portal authentication and detail scraping succeeded for all 28 claims; 64 files
were downloaded. This was an AI infrastructure failure, not evidence of missing
submission documents.

The item-detail worker logged `Codex App Server request timed out: account/read`.
There were 99 such errors in the retained worker logs, from 14:55:47 to 15:42:45
SGT. The web process had no equivalent recorded errors. Both used the service
authentication directory `/var/lib/ivm/codex`, but separate Codex processes.
The installed CLI was `codex-cli 0.148.0`.

Follow-up inspection of the existing worker Codex process found approximately
3.7 GiB resident memory and more than 500 TCP connections. Over a five-second
sample its CPU usage was about 153% of one core and unread TCP data grew from
23.6 MB to 39.7 MB. The web Codex process used approximately 150 MiB, with one
TCP connection and no unread backlog. No kernel OOM kill was recorded during
the incident window.

A fresh process completed `account/read` with `refreshToken: true` in 543 ms.
An earlier probe used `refreshToken: false`; that earlier result was not an
equivalent test and must not be cited as proof that refresh worked.

## Cause, contributing defects, and confidence

**Confirmed failure:** the existing worker did not answer the account-status
request within IVM's 30-second deadline. The overload measurements strongly
support an unhealthy long-lived worker process. They were collected after the
failed session; they do not prove the precise initiating internal Codex bug.

The application had defects that allowed resource buildup and repeated failure:

- A single Codex process was reused indefinitely across claims and AI stages.
- Every AI call created a new ephemeral thread without releasing its subscription.
- A timeout rejected a local promise but did not interrupt the remote turn or
  terminate the process. Subsequent claims reused the same process.
- Claim concurrency limits did not bound parallel AI calls inside a claim.
- Account checks forced token refresh on every invocation.
- A healthy web account check drove the green badge even when the worker failed.
- Some infrastructure errors could become unreadable-document outcomes; failed
  worker results were returned normally and therefore bypassed BullMQ retries.
- Internal Codex stderr was logged only at debug level, so the exact underlying
  error was unavailable in production's info-level logs.

Do not describe a token-refresh race, expired login, memory leak, or specific
Codex deadlock as proven without additional evidence or a reproduction.

## Prevention implemented

- Each claim owns a lazy Codex process. AI calls within that claim are serialized.
  Existing queue leases cap active claims (default two). Other app AI calls use
  a process scoped to their call; status checks are short-lived and deduplicated.
- The client performs one initialization handshake before concurrent callers
  can send requests. Broken clients are terminal and cannot be reused.
- Turn cancellation sends `turn/interrupt` when its ID is available. Every exit
  path terminates and drains the entire owned process tree before releasing the
  claim slot. Linux escalation kills descendants that ignore SIGTERM.
- Completed threads are unsubscribed. Because unloading can be delayed or vary
  with CLI version, process exit is the definitive resource cleanup boundary.
- A five-second Linux watchdog measures the native child and wrapper together.
  `CODEX_MAX_RSS_MB` defaults to 1024 per claim process. This is a watchdog budget,
  not a kernel-enforced instantaneous memory ceiling. Claims also retain the
  existing ten-minute overall deadline and five-minute per-turn deadline.
- Routine account checks use managed authentication without forcing renewal.
- AI infrastructure failures preserve downloaded files and return the item to
  DISCOVERED. Automatic retries reuse that snapshot, use 30/60-second backoff,
  and stop after three actual attempts. Waiting for worker recovery does not
  consume the attempt budget. Manual retries start a fresh attempt budget.
- Worker recovery pauses admission of default ChatGPT claims. Recovery checks
  back off up to five minutes. Startup/recovery must pass a small real inference
  before admission resumes. API-provider selections remain independent.
- A worker heartbeat expires after 45 seconds; account/model verification older
  than two minutes also fails readiness. The badge, scrape/retry preflight and
  deployment health check use this worker readiness.
- Lifecycle logs retain sanitized error categories and periodic child-process
  resource metrics. Never log auth tokens, raw stderr, prompts, or documents.

## Operational response

1. Expand an affected claim and identify its failed stage. Count saved detail
   records and files before interpreting ERROR as a portal/document problem.
2. Inspect `ivm-detail-worker` logs, the actual native Codex child processes, and
   the Redis key `ivm:codex:detail-worker:health`. PM2's parent-process RSS alone
   can miss gigabytes held by child processes.
3. Distinguish a failed status request from a confirmed authentication failure.
   Compare like-for-like probes, including the `refreshToken` setting.
4. Let bounded recovery complete. A `reconnect` state requires restoring the
   server service account's login; local codex1/codex2 profiles are unrelated.
5. Deploy fixes only by committing and pushing main through `deploy.yml`.
   Preserve the active-scrape-job check. Do not kill active jobs to bypass it.
6. Verify worker readiness and one real claim before retrying a failed batch.
   Keep saved successful comparisons and avoid duplicate jobs/results.

## Verification and release record

The regression suite covers cold-start concurrency, stalled initialization and
account requests, process crashes, turn timeout/cancellation, failed turns hidden
by callers, serialization of parallel AI requests, repeated claim cleanup,
expired worker heartbeat, and bounded retry policy. A Linux-only case checks
that a descendant ignoring SIGTERM is killed. GitHub Actions runs this suite
before deployment. The repeated-claim test uses a fake protocol server: it proves
application ownership and cleanup, not production model quality or a 24-hour
live soak. Production verification results must be recorded after deployment.

Local verification on 4 October 2026: production build and TypeScript checks
passed; AI recovery tests passed (13 tests, with the Linux-only process-tree test
deferred to CI); eight existing timeout/comparison/model regression tests passed.

Official protocol references:

- [Interrupt a turn](https://learn.chatgpt.com/docs/app-server#interrupt-a-turn)
- [Unsubscribe from a loaded thread](https://learn.chatgpt.com/docs/app-server#unsubscribe-from-a-loaded-thread)
- [Check authentication state](https://learn.chatgpt.com/docs/app-server#1-check-auth-state)

## Follow-up checks

Review resource trends after a representative live batch and again after 24 hours.
Memory and connections must return near idle after claims finish. Repeated
recovery, rising descriptors, or stale readiness is an operational failure even
if the web application remains reachable. Tune concurrency and memory budgets
only with workload measurements, and pin/test CLI upgrades before rollout.
