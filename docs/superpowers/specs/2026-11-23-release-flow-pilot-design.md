# Release Flow Pilot: Design

Ticket: PLT-1652. Date: 2026-11-23.

## Intent

A small, working demonstration of trunk-based development and release engineering for the team.
It uses real GitHub Actions and real Docker containers on a laptop. It shows how a production
pilot would look: merges to `main` deploy DEV, Release Please calculates versions and changelogs,
TEST and PROD deploy only explicit, frozen release tags, and PROD waits for a human approval.

The deliverable is the workflow files. They must be easy to read during a demo. The application
exists only to make deployments, versions, changelogs, feature flags and QA visible.

## Goals

- A complete, repeatable flow from a merged PR to an approved PROD deployment.
- Two release paths, both required:
  - Path A (RC): `v0.2.0-rc.1` is tested, then promoted to `v0.2.0` on the same commit.
  - Path B (stable): `v0.2.0` is tested and promoted as is.
  - RC re-cut: after `v0.2.0-rc.1` fails QA, the fix merges to `main` and becomes
    `v0.2.0-rc.2` on that `main` commit. No release branches: every tag sits on a `main` commit.
- Each environment shows its own deployed version, release tag, source SHA and changelog.
- QA in TEST detects a real, intentional pricing defect when the demo asks for it.
- Promotion gates that a newer failure always blocks.

## Non-goals

- Build once, deploy many. Each environment rebuilds the selected source.
- ZIP deploys, cloud infrastructure, VMs, Kubernetes, Terraform, automatic rollback.
- An authentication platform, database service or a real frontend.
- Changes to the existing POC repo `trunk-based-development-lab`.

## Anti-goals (failure even if it technically works)

- Workflow logic hidden in custom JS scripts, composite actions or helper files.
- TEST or PROD silently deploying newer `main` code than the selected tag.
- A QA switch that forces a pass instead of detecting a defect.
- The TEST defect reaching DEV or PROD.
- A tag being moved, or a stable tag treated as permission to deploy PROD.
- Tests that only inspect YAML strings.

## Constraints

- Repo `devansh-helfie/release-flow-pilot`, public. Public is required: on GitHub Free,
  environment required reviewers only exist for public repos.
- GitHub Free only. `GITHUB_TOKEN` everywhere, no personal access token.
- GitHub-hosted runners for PR checks and image builds. The personal Mac runner runs only trusted
  deploy and QA jobs (triggered by `push` to `main` or `workflow_dispatch`, never by PRs).
- Docker Desktop on the Mac:
  - DEV `http://dev.localhost:4101`
  - TEST `http://test.localhost:4102`
  - PROD `http://prod.localhost:4103`
- English everywhere. Commit and PR titles contain PLT-1652. No AI co-author trailers.
- No secrets in the repo, logs or chat.

## Approaches considered

1. **Release Please computes versions only, a short bash step publishes tags (chosen).**
   Release Please runs with `skip-github-release: true`. It owns the version bump and the
   changelog in the release PR. After the release PR merge passes DEV, a short bash step creates
   `vX.Y.Z-rc.N` or `vX.Y.Z` on the frozen source SHA.
   Needed because native Release Please always tags its own release PR merge commit, so it cannot
   tag an older `source-ref`, and its RC support (approach 3) cannot share one commit with stable.
2. **Native Release Please publication.** The least custom code, but it cannot support RC tags
   or an older source-ref, both of which are required. Rejected.
3. **Prerelease versioning inside Release Please (`versioning: prerelease`, `prerelease-type: rc`).**
   It writes RC versions into `package.json` and needs a second release PR to go stable, so stable
   and RC would not share one commit. Rejected.

## Release identity rules

- Tag format: `vX.Y.Z` and `vX.Y.Z-rc.N` (dot before N, so semver sorts `rc.10` after `rc.9`).
- Package version (from `package.json` in the deployed source) and release tag are shown
  separately. They differ when an older `source-ref` is selected: that source still has the old
  `package.json` and `CHANGELOG.md`. The page shows both values honestly.
- Tags are immutable: an existing tag is reused only if it points to the expected SHA. Otherwise
  the workflow fails with a clear message. Tags are never moved or deleted by workflows.

## Repository layout

```
.github/workflows/
  pr-checks.yml
  deploy.yml            (reusable)
  deploy-dev.yml
  prepare-release.yml
  deploy-test.yml
  promote-prod.yml
.github/pull_request_template.md
config/dev.env  config/test.env  config/prod.env
release-please-config.json  .release-please-manifest.json
compose.yaml  Dockerfile
src/server.js  src/pricing.js
test/pricing.test.js        (unit, node:test)
qa/qa.mjs                   (live QA against TEST)
CHANGELOG.md  package.json  README.md
```

## Application

- Node.js 22, `node:22-alpine`, zero npm dependencies (`node:http`, `node:test`). No `npm install`,
  so builds stay fast.
- Identity is baked into the image at build time as env vars: `GIT_SHA`, `COMMIT_SUBJECT`,
  `BUILD_TIME`, `RUN_URL`, `RELEASE_TAG`
  (default `unreleased`). `package.json` and `CHANGELOG.md` are copied into the image from the
  built source, so each environment shows its own changelog.
- Routes:
  - `GET /` HTML: a coloured environment bar (DEV blue, TEST amber, PROD green), environment,
    release tag or "unreleased" (linked to the GitHub tag), package version, short SHA (linked to the
    GitHub commit) with its commit subject, build time (UTC), a link to the workflow run that built
    it, and the changelog. This is the demo view for comparing environments side by side.
  - `GET /health` returns `{"status":"ok"}`.
  - `GET /version` returns `{environment, packageVersion, releaseTag, sha}`.
  - `GET /api/price?qty=N` returns unit price 10, total, and whether a discount applied. With the
    `bulk-discount` flag on, `qty >= 10` gets 10% off.
  - `GET /admin/flags` plus `POST /admin/flags` is a tiny form to toggle flags. No authentication
    (user decision: keep the demo minimal). It is acceptable because each environment is only
    reachable on the Mac's localhost.
- Flag state lives in `flags.json` in a per-environment data folder on the Mac
  (`~/release-flow-pilot-data/<env>/`), mounted into the container. The default comes from the env
  config file if the file does not exist yet.
- QA defect: when `APP_ENV=test` and `QA_DEMO=fail`, the bulk discount is 1% instead of 10%. The
  check requires both values, and only `config/test.env` sets `QA_DEMO`, so DEV and PROD cannot
  get the defect.

## Environment config

- `config/<env>.env` (committed, non-secret): `APP_ENV`, `PORT`, `BULK_DISCOUNT_DEFAULT`, and
  `QA_DEMO` in `test.env` only.
- Trade-off agreed with the user: flipping the QA demo between pass and fail is a PR that changes
  `config/test.env`, not a UI toggle.
- Docker Compose project per environment (`rfp-dev`, `rfp-test`, `rfp-prod`), one `compose.yaml`,
  driven by `--env-file config/<env>.env`.

## Workflows

None of the manual workflows asks for an environment. Each one hard-codes its own.

### pr-checks.yml (pull_request, hosted)
- Validate the PR title with one regex: `^(feat|fix|docs|ci|chore|refactor|test)(\(.+\))?!?: .*PLT-1652`.
- Run `node --test` and `docker build`.
- Job name `pr-checks` is the required status check in the `main` ruleset.

### deploy.yml (workflow_call, internal)
Inputs from the caller: `environment` (dev|test|prod), `sha`, `release-tag`.
- `build` job (hosted): check out `sha`, build with `GIT_SHA`, `RELEASE_TAG`, `COMMIT_SUBJECT`, `BUILD_TIME` and `RUN_URL` build args, push to
  `ghcr.io/devansh-helfie/release-flow-pilot:<env>-<sha7>-<run_id>`.
- Revisions: application source (Dockerfile, `src/`, `package.json`, `CHANGELOG.md`) comes from
  `sha`. Deployment configuration (`config/<env>.env`, `compose.yaml`) comes from the workflow's own
  ref, `main`. Evidence records `workflow_sha` as the configuration identity. This is why the QA
  demo flip in `config/test.env` takes effect on an existing tag. (Builder-check call.)
- `deploy` job (Mac runner, `environment: <env>`, so GitHub records a deployment and PROD waits for
  approval): `docker login ghcr.io` with `GITHUB_TOKEN`, pull, `docker compose up -d`, then verify that
  `/health` is ok and that `/version` matches `sha` and `release-tag`.
- Concurrency group per environment, no cancel-in-progress.

### deploy-dev.yml (push to main)
- Run name: `Deploy DEV <sha7>`.
- Calls `deploy.yml` for dev with `github.sha` and `release-tag: unreleased`.
- `publish-tag` job, after a successful deploy, runs only when the pushed commit is a merged Release
  Please PR (found via `gh api repos/.../commits/<sha>/pulls`, label `autorelease: pending`):
  1. Read the latest selection comment on that PR.
  2. Require that the latest DEV run for `source_sha` succeeded (when source_sha is the current commit,
     the deploy job in this run is that evidence).
  3. Version from `.release-please-manifest.json` at the merge commit.
  4. rc: next `N` = highest existing `vX.Y.Z-rc.*` + 1. stable: `vX.Y.Z`.
  5. If the tag exists and points to `source_sha`, reuse it. If it points elsewhere, fail.
     Otherwise create it with `gh api` (annotated tag message includes the PR number).
  6. Change the label to `autorelease: tagged`.
  7. Write a job summary: tag, SHA, channel, and "next: run Deploy TEST with <tag>".
- Resume: if publishing failed, re-running the failed job of that DEV run finishes publication.

### prepare-release.yml (workflow_dispatch, hosted)
Inputs: `mode` (new-release | recut-rc), `channel` (rc|stable), `source-ref` (optional).

`mode: recut-rc` (user decision: a fix after a failed RC keeps the same version):
- Version = `.release-please-manifest.json` on `main`. No release PR is created.
- Refuses if stable `vX.Y.Z` already exists (it is immutable, so the fix needs a new version via
  `new-release`). Refuses `channel: stable`, because a re-cut stable tag would mean a second
  `vX.Y.Z` on a different SHA.
- `source-ref` blank means `main` HEAD. Resolve and freeze it as a SHA, require it to be an ancestor
  of `main`, and require that the latest DEV run for it succeeded.
- Create the next `vX.Y.Z-rc.N` directly with the same immutable-tag rules as `publish-tag`.
- Known limitation: the re-cut source's `CHANGELOG.md` still describes `X.Y.Z` as first prepared.
  The fix shows up in the next release's changelog.

`mode: new-release`:
1. If a merged release PR still has `autorelease: pending`, stop with a clear message: which PR, and
   "re-run the failed publish-tag job in its Deploy DEV run". Nothing new is created.
2. Run `googleapis/release-please-action` with `skip-github-release: true`. It opens or updates one
   release PR. If there is nothing releasable, say so and stop.
3. Resolve `source-ref` (blank means "the release PR merge commit", stored as `merge`), or else
   `git rev-parse` it and require it to be an ancestor of `main`. Freeze it as a full SHA.
4. Post or update a PR comment, marked `<!-- release-selection -->`, containing a small JSON block:
   `{channel, source_ref, source_sha, prepared_run}`. It's visible to reviewers.
5. Run the unit tests on the release PR head and set commit status `pr-checks` on it, because PRs
   opened with `GITHUB_TOKEN` do not trigger `pr-checks.yml`.
- Release Please PR title pattern includes PLT-1652 so the squash commit follows the rules.

### deploy-test.yml (workflow_dispatch)
Input: `release-tag` only. Run name: `Deploy TEST <tag>` (a run name cannot contain a value
resolved during the run, so the tag is the searchable key).
1. Trim whitespace, validate the format, and resolve the tag to its SHA (it must already exist).
2. DEV gate: take the latest `deploy-dev.yml` run whose head SHA equals that SHA, then require
   that its conclusion is success.
3. Call `deploy.yml` for test.
4. QA job (Mac runner): `node qa/qa.mjs http://test.localhost:4102 <tag> <sha>`. Three assertions:
   - price for qty 10 equals 90
   - the `bulk-discount` flag is on
   - `/version` tag and SHA match
5. On success, upload artifact `qa-evidence` with `{tag, sha, run_id, run_attempt, workflow_sha}`.

### promote-prod.yml (workflow_dispatch)
Input: `tested-tag` only. Run name: `Promote PROD <tag>`.
1. Trim, validate and resolve the SHA.
2. TEST gate, keyed by source SHA (not tag name), because `v0.2.0-rc.1` and `v0.2.0` share a
   SHA and a newer failure on either must block: list every tag pointing at that SHA, take the
   latest `deploy-test.yml` run titled `Deploy TEST <any of those tags>`, then require success, then download its `qa-evidence` and require the SHA
   matches. If there is no artifact (older run), say "re-run Deploy TEST for this tag".
   (Builder-check call.)
3. Stable identity: for an RC, create `vX.Y.Z` on the same SHA (or reuse it if it exists there, and
   fail if it exists elsewhere). For a stable tag, reuse it.
4. Call `deploy.yml` for prod. The `prod` environment requires reviewer `devansh-helfie`,
   self-review allowed, and deployments from `main` only. Approval and deployment are recorded in
   GitHub.
5. Verification in `deploy.yml` checks health, the SHA and the stable tag.

## Gate rule

Every gate lists runs for the relevant key (SHA for DEV, tag for TEST), takes the newest one first,
and only then checks its conclusion. A re-run attempt updates that run's conclusion, so the latest
attempt counts. Runs for unrelated SHAs or tags are never looked at.

## Repo settings

- Squash merge only, commit title = PR title.
- Ruleset on `main`: require a PR, require status check `pr-checks`, no force push.
- Environments: `dev`, `test` (no reviewers), `prod` (required reviewer, branch policy `main`).
- Actions: fork PR workflows require approval for **all outside collaborators** (not the
  first-time default). On a public repo a fork PR can edit `runs-on` to target the Mac runner, and
  GitHub Free cannot restrict a runner to specific workflows, so this approval is the real control.
- Required check `pr-checks` is configured with "any source", so the commit status posted by
  Prepare Release counts. Verify early.
- Mac runner: a second runner in `~/actions-runner-release-pilot`, label `release-pilot-deploy`,
  installed as a service. The existing `trunk-lab-mac` runner is untouched.

## Known limitations

- An older `source-ref` gets Release Please's new version as its tag, but its own `package.json`
  and changelog are older. The page shows both.
- Open risk to verify early: with `skip-github-release`, how Release Please finds the previous
  release when only an RC tag exists for a version. If it misreads history, the fix is to create
  the GitHub Release object at stable promotion time. Verify this before building the rest.

## Left to the builder

- Exact HTML styling, which stays minimal.
- Wording of job summaries.
- The exact `jq` and `gh` expressions, as long as each gate stays a few readable lines.
