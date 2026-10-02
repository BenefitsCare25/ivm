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
