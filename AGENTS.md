# Deployment

- Deploy application changes by committing and pushing to `main`. GitHub Actions
  in `.github/workflows/deploy.yml` owns network access, upload, migrations,
  build, process restart, health verification, and network cleanup.
- Monitor the matching GitHub Actions run and report its result. Do not deploy
  from a local machine with SSH, SCP, Azure Run Command, or a source tarball.
- To redeploy an existing commit, dispatch `deploy.yml` on `main` or rerun the
  GitHub Actions run. Do not bypass the active-scrape-job check.
- Troubleshoot deployment failures in the workflow. Routine deployments must not
  require a person to allowlist a GitHub runner IP.

# AI worker reliability

- Read `docs/incidents/2026-10-04-chatgpt-worker-timeouts.md` before changing the
  Codex integration, claim retries, or AI readiness indicators.
- Keep AI process lifetime bounded to its claim, propagate cancellation, and
  finish process-tree cleanup before releasing claim capacity or retrying.
- A web account check does not prove claim-worker readiness. Preserve worker
  heartbeat checks and the Linux AI recovery tests in the deployment workflow.
