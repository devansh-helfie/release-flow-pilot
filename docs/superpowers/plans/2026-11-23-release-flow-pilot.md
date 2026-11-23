# Release Flow Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public demo repo where merges to `main` deploy DEV, Release Please prepares versions, and TEST and PROD deploy only frozen tags behind short, readable promotion gates.

**Architecture:** A zero-dependency Node 22 app, built into an image on GitHub-hosted runners, pushed to GHCR and run with Docker Compose on the Mac runner (one Compose project per environment). Six thin workflows plus two reusable ones (`deploy.yml`, `create-tag.yml`). Release Please only computes versions and changelogs. Tags are created by `create-tag.yml`.

**Tech Stack:** Node.js 22 (`node:http`, `node:test`), Docker and Compose, GitHub Actions, `googleapis/release-please-action@v4`, `gh`, `jq`, GHCR.

**Spec:** `docs/superpowers/specs/2026-11-23-release-flow-pilot-design.md`

## Global Constraints

- Repo `devansh-helfie/release-flow-pilot`, public. Local checkout `~/Projects/release-flow-pilot`.
- DEV `http://dev.localhost:4101`, TEST `http://test.localhost:4102`, PROD `http://prod.localhost:4103`. The container always listens on 3000.
- No npm dependencies. `package.json` has no `dependencies` or `devDependencies`.
- `GITHUB_TOKEN` only. No PAT. No secret values are ever printed, committed or typed in chat.
- Mac runner jobs use `runs-on: [self-hosted, release-pilot-deploy]`. Everything else uses `ubuntu-latest`.
- Tag regex: `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.[1-9][0-9]*)?$`. Tags are never moved or deleted.
- Commit subjects and PR titles: Conventional Commit plus `PLT-1652`, one line, no co-author trailer. Every commit and push waits for the user's review (user rule).
- No `terraform`, no composite actions, no JS release scripts. Bash steps stay short and named.
- English everywhere, no em dashes.
- Each gate takes the newest relevant run first (ordered by `startedAt`, which reflects the latest attempt) and only then checks `status == completed` and `conclusion == success`.

## Review Focus

1. Re-running a partly finished tag job (tag created, label flip failed) must reuse the RC tag on the same SHA, not create `rc.N+1`. Owned by Task 5, verification step 7.
2. An older Deploy TEST run re-run after a newer failure: the gate must judge by latest attempt (`startedAt`). Owned by Task 8, verification step 5.
3. Tag input with spaces or wrong shape (` v0.2.0 `, `0.2.0`, `v0.2.0-rc1`) is trimmed or rejected with a clear message. Owned by Tasks 7 and 8.
4. Bad `qty` (`0`, `-1`, `abc`, `1.5`, `100001`) returns 400 with a message, never a `NaN` total. Owned by Task 1.
5. A missing or corrupt `flags.json` falls back to the env default instead of crashing. Owned by Task 2.

---

### Task 1: Pricing logic

**Files:**
- Create: `package.json`, `src/pricing.js`, `test/pricing.test.js`, `.gitignore`

**Interfaces:**
- Produces: `priceFor(qty: number, opts: {bulkDiscount: boolean, qaDefect: boolean}) -> {qty, unitPrice: 10, discountPercent, total}`. It throws `RangeError` when qty is not an integer in 1..100000.
- Produces: `parseQty(raw: string) -> number`, which throws `RangeError` with a human-readable message.

- [ ] **Step 1: Create `package.json`**: name `release-flow-pilot`, version `0.1.0`, `"type": "module"`, scripts `{"test": "node --test", "start": "node src/server.js"}`, `"engines": {"node": ">=22"}`.
- [ ] **Step 2: Write failing tests** in `test/pricing.test.js`:

```js
test('no discount below 10', () => assert.deepEqual(priceFor(9, {bulkDiscount: true, qaDefect: false}), {qty: 9, unitPrice: 10, discountPercent: 0, total: 90}));
test('10% bulk discount at 10', () => assert.equal(priceFor(10, {bulkDiscount: true, qaDefect: false}).total, 90));
test('flag off means no discount', () => assert.equal(priceFor(10, {bulkDiscount: false, qaDefect: false}).total, 100));
test('qa defect gives 1% instead of 10%', () => assert.equal(priceFor(10, {bulkDiscount: true, qaDefect: true}).total, 99));
test('rejects bad qty', () => { for (const raw of ['0', '-1', 'abc', '1.5', '100001', '']) assert.throws(() => parseQty(raw), RangeError); });
```

- [ ] **Step 3: Run** `node --test`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `src/pricing.js`. Learning-mode candidate: offer the user the `priceFor` body as a `TODO(human)`. Round `total` to 2 decimals.
- [ ] **Step 5: Run** `node --test`. Expected: 5 pass.
- [ ] **Step 6: Show the diff and wait for review**, then commit: `feat: add pricing with bulk discount PLT-1652`.

### Task 2: HTTP server, flags and admin panel

**Files:**
- Create: `src/flags.js`, `src/server.js`, `test/server.test.js`, `CHANGELOG.md` (one line: `# Changelog`)

**Interfaces:**
- Consumes: `priceFor`, `parseQty` from Task 1.
- Produces: `readFlags(file: string, defaults: object) -> object` (missing or corrupt file returns `defaults`), `writeFlags(file, flags) -> void` (write to temp file, then rename).
- Produces: `createServer(cfg) -> http.Server` where `cfg = {env, qaDemo, flagsFile, flagDefaults, identity: {packageVersion, releaseTag, sha, commitSubject, buildTime, runUrl, changelog}}`.
- Produces: when run directly, the server reads `APP_ENV`, `QA_DEMO`, `BULK_DISCOUNT_DEFAULT`, `GIT_SHA`, `COMMIT_SUBJECT`, `BUILD_TIME`, `RUN_URL`, `RELEASE_TAG` (default `unreleased`), `FLAGS_FILE` (default `/data/flags.json`), reads `package.json` and `CHANGELOG.md` from the app root, and listens on 3000.
- Routes (consumed by Tasks 4, 6, 7):
  - `GET /health` → `{"status":"ok"}`
  - `GET /version` → `{environment, packageVersion, releaseTag, sha}`
  - `GET /api/flags` → `{"bulk-discount": bool}`
  - `GET /api/price?qty=N` → the `priceFor` result, or 400 `{error}`
  - `GET` and `POST /admin/flags` → HTML form, no authentication (user decision, local only)
  - `GET /` → HTML with environment, package version, release tag, SHA and an escaped changelog in `<pre>`
- `qaDefect` is true only when `env === 'test' && qaDemo === 'fail'`.

- [ ] **Step 1: Write failing tests** in `test/server.test.js`. Each test starts `createServer` on port 0 with a temp `flagsFile` and fetches:
  - `/version` returns the identity fields given in `cfg`.
  - `/api/price?qty=10` returns `total` 90 with the default flag on. With `{env:'test', qaDemo:'fail'}` it returns 99. With `{env:'dev', qaDemo:'fail'}` it returns 90 (the defect never leaves TEST).
  - `/api/price?qty=abc` returns 400 and a body with `error`.
  - A POST to `/admin/flags` with `bulk-discount=off` makes `/api/flags` return false and `/api/price?qty=10` return total 100.
  - A `flagsFile` containing `not json` falls back to `flagDefaults`, so `/api/flags` returns the default.
  - `/` contains the release tag, the commit subject, the build time, the run URL and the env colour class.
  - `/` escapes `<script>` when the changelog or the commit subject contains it.
  - `/version` also returns `commitSubject`, `buildTime`, `runUrl`.
  - GitHub links are built from the constant `https://github.com/devansh-helfie/release-flow-pilot`: `/commit/<sha>` and `/releases/tag/<tag>` (no tag link when `unreleased`).
- [ ] **Step 2: Run** `node --test`. Expected: the new tests fail.
- [ ] **Step 3: Implement** `src/flags.js` and `src/server.js`. The POST body is `application/x-www-form-urlencoded`, parsed with `URLSearchParams`.
- [ ] **Step 4: Run** `node --test`. Expected: all pass.
- [ ] **Step 5: Show the diff and wait for review**, then commit: `feat: add server with version page and flag panel PLT-1652`.

### Task 3: Container, environment config and QA script

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `compose.yaml`, `config/dev.env`, `config/test.env`, `config/prod.env`, `qa/qa.mjs`

**Interfaces:**
- Produces: image build args `GIT_SHA`, `RELEASE_TAG`, `COMMIT_SUBJECT`, `BUILD_TIME`, `RUN_URL`. Compose reads `IMAGE`, `PORT`, `APP_ENV` from the environment and `--env-file`.
- Produces: `node qa/qa.mjs <baseUrl> <expectedTag> <expectedSha>` exits 0 or 1, printing one `PASS` or `FAIL` line per assertion.

- [ ] **Step 1: Write the files.**
  - Dockerfile: `node:22-alpine`. Copy only `package.json`, `CHANGELOG.md` and `src/`. `ARG`/`ENV` for the five identity build args. `USER node`. `CMD ["node","src/server.js"]`.
  - Env files:
    - `config/dev.env`: `APP_ENV=dev`, `PORT=4101`, `BULK_DISCOUNT_DEFAULT=on`
    - `config/test.env`: `APP_ENV=test`, `PORT=4102`, `BULK_DISCOUNT_DEFAULT=on`, `QA_DEMO=pass`
    - `config/prod.env`: `APP_ENV=prod`, `PORT=4103`, `BULK_DISCOUNT_DEFAULT=on`
  - `compose.yaml`: one service `app`, `image: ${IMAGE}`, `ports: ["${PORT}:3000"]`, `env_file` taken from the `--env-file` path, volume `${HOME}/release-flow-pilot-data/${APP_ENV}:/data`, `restart: unless-stopped`.
- [ ] **Step 2: Write `qa/qa.mjs`** with three assertions:
  - `/api/price?qty=10` total is 90, with a message like `expected 90, got 99`.
  - `/api/flags` reports `bulk-discount` as true.
  - `/version` `releaseTag` and `sha` equal the arguments.
- [ ] **Step 3: Verify locally on a spare port** with QA failing:
  - Run `docker build --build-arg GIT_SHA=abc123 --build-arg RELEASE_TAG=v0.0.0-rc.1 -t rfp:local .`
  - Start it with `docker run -d --name rfp-local -p 4199:3000 -e APP_ENV=test -e QA_DEMO=fail rfp:local`
  - Run `node qa/qa.mjs http://localhost:4199 v0.0.0-rc.1 abc123`
  - Expected: exit 1, `FAIL price: expected 90, got 99`, and the other two `PASS`.
- [ ] **Step 4: Re-run with QA passing.** Replace the container with `QA_DEMO=pass` and run the same command. Expected: 3 `PASS`, exit 0. Then `docker rm -f rfp-local`.
- [ ] **Step 5: Show the diff and wait for review**, then commit: `feat: add container, env config and QA checks PLT-1652`.

### Task 4: Repository, runner, PR checks and settings

**Files:**
- Create: `.github/workflows/pr-checks.yml`, `.github/pull_request_template.md` (the spec's template verbatim), `release-please-config.json`, `.release-please-manifest.json` (`{".": "0.1.0"}`), `README.md` (a stub that links the spec)

**Interfaces:**
- Produces: check name `pr-checks` (job id and name), runner label `release-pilot-deploy`, environments `dev`, `test`, `prod`.
- Release Please config:
  - `release-type: node`, `include-v-in-tag: true`
  - `pull-request-title-pattern: "chore${scope}: release${component} ${version} PLT-1652"`
  - changelog sections show `feat` and `fix` and hide `docs`, `ci`, `chore`, `refactor`, `test`

- [ ] **Step 1: Write `pr-checks.yml`** (`on: pull_request`, `permissions: contents: read`). One job `pr-checks` on `ubuntu-latest` with these steps:
  - "Check PR title": a bash `[[ =~ ]]` against `^(feat|fix|docs|ci|chore|refactor|test)(\(.+\))?!?: .*PLT-1652`, with the title passed through `env:`, never interpolated.
  - `actions/setup-node` with Node 22, then `node --test`.
  - `docker build .`
- [ ] **Step 2: Lint.** Run `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`. Expected: no output.
- [ ] **Step 3: Show the diff and wait for review**, then commit: `ci: add PR checks and release-please config PLT-1652`.
- [ ] **Step 4: Create and push** after the user says go: `gh repo create devansh-helfie/release-flow-pilot --public --source . --push`. No deploy workflow exists yet, so nothing deploys.
- [ ] **Step 5: Repo settings** with `gh api`:
  - Allow squash merge only, with `squash_merge_commit_title=PR_TITLE` and `squash_merge_commit_message=PR_BODY`.
  - Delete branches after merge.
  - Fork PR workflow approval set to all outside collaborators, if the API offers it. Otherwise tell the user the settings page path.
- [ ] **Step 6: Environments.**
  - Create `dev`, `test` and `prod` with deployment branch policy `main` only.
  - `prod` gets the required reviewer `devansh-helfie` and `prevent_self_review: false`.
  - Read back with `gh api repos/.../environments --jq '.environments[]|{name,protection_rules}'`.
- [ ] **Step 7: Register the runner.**
  - Download the latest `actions-runner-osx-arm64` release (version from `gh api repos/actions/runner/releases/latest --jq .tag_name`) into `~/actions-runner-release-pilot`.
  - Run `./config.sh --unattended --url https://github.com/devansh-helfie/release-flow-pilot --name release-pilot-mac --labels release-pilot-deploy --token "$(gh api -X POST repos/devansh-helfie/release-flow-pilot/actions/runners/registration-token --jq .token)"`, which keeps the token out of the output.
  - Run `./svc.sh install && ./svc.sh start`.
  - Verify: `gh api repos/devansh-helfie/release-flow-pilot/actions/runners --jq '.runners[]|{name,status}'` shows `online`. `trunk-lab-mac` is untouched.
- [ ] **Step 8: Ruleset on `main`.** Require a PR, the status check `pr-checks` with no integration pinned ("any source"), and block force push and deletion. Read it back. From here on, every change goes through a branch and a PR that the user merges.

### Task 5: Deploy DEV and tag creation

**Files:**
- Create: `.github/workflows/deploy.yml`, `.github/workflows/create-tag.yml`, `.github/workflows/deploy-dev.yml`

**Interfaces:**
- `deploy.yml` (`workflow_call`):
  - Inputs: `environment` (string), `sha` (string), `release-tag` (string).
  - Jobs: `build` (hosted, `packages: write`), then `deploy` (Mac runner, `environment: ${{ inputs.environment }}`, concurrency `deploy-${{ inputs.environment }}`, no cancel-in-progress).
- `create-tag.yml` (`workflow_call`):
  - Inputs: `version` (`X.Y.Z`), `channel` (`rc`|`stable`), `sha`.
  - Output: `tag`.
  - Permissions needed: `contents: write`.
- `deploy-dev.yml`: `on: push: branches: [main]`, `run-name: Deploy DEV ${{ github.sha }}`.
  - Jobs: `dev` (calls `deploy.yml`), `find-release` (outputs `pr`, `channel`, `source_sha`, `version`, empty when this commit is not a pending release), `publish` (calls `create-tag.yml`), `mark-tagged`.

- [ ] **Step 1: Write `deploy.yml`.**
  - Build job:
    - `actions/checkout` with `ref: inputs.sha`.
    - `docker/login-action` for GHCR.
    - `docker/build-push-action` with build args `GIT_SHA=inputs.sha`, `RELEASE_TAG=inputs.release-tag`, `COMMIT_SUBJECT` (from `git log -1 --format=%s`), `BUILD_TIME` (`date -u +%FT%TZ`), `RUN_URL` (`$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID`), tag `ghcr.io/devansh-helfie/release-flow-pilot:<env>-<sha7>-<run_id>`.
  - Deploy job steps:
    - "Checkout deploy config from main": `actions/checkout`, default ref, sparse `config/` and `compose.yaml`.
    - "Pull image": `docker login ghcr.io --password-stdin`, then `docker pull`, then `docker logout ghcr.io`.
    - "Start": `docker compose -p rfp-<env> --env-file config/<env>.env up -d`, with `IMAGE` set in the step env.
    - "Verify": poll `/health` for up to 30s, then compare `/version` `.sha` and `.releaseTag` to the inputs with `jq -e`.
    - Write the environment, URL, tag and SHA to `$GITHUB_STEP_SUMMARY`.
- [ ] **Step 2: Write `create-tag.yml`** as one job (`ubuntu-latest`, checkout with `fetch-depth: 0`) and one step, "Create or reuse tag". The algorithm:

```bash
if [ "$CHANNEL" = stable ]; then
  TAG="v$VERSION"
  EXISTING=$(git rev-list -n1 "$TAG" 2>/dev/null || true)
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "$SHA" ]; then echo "::error::$TAG already exists on $EXISTING, tags are never moved"; exit 1; fi
else
  TAG=$(git tag --points-at "$SHA" --list "v$VERSION-rc.*" | sort -V | tail -1)   # rerun: reuse
  if [ -z "$TAG" ]; then
    LAST=$(git tag --list "v$VERSION-rc.*" | sed 's/.*-rc\.//' | sort -n | tail -1)
    TAG="v$VERSION-rc.$(( ${LAST:-0} + 1 ))"
  fi
fi
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || gh api "repos/$GITHUB_REPOSITORY/git/refs" -f ref="refs/tags/$TAG" -f sha="$SHA" >/dev/null
echo "tag=$TAG" >> "$GITHUB_OUTPUT"
```

  The job summary states either "RC published, stable not yet released" or "stable tag published".
- [ ] **Step 3: Write `deploy-dev.yml`.**
  - `dev` job: `uses: ./.github/workflows/deploy.yml` with `environment: dev`, `sha: github.sha`, `release-tag: unreleased`.
  - `find-release` job, after `dev` succeeds:
    - Find the PR with `gh api repos/$R/commits/$SHA/pulls --jq '.[0]'`.
    - Continue only if its labels contain `autorelease: pending`.
    - Read the newest comment containing `<!-- release-selection -->` and parse its JSON with `jq`. `source_sha: "merge"` means `github.sha`.
    - Read the version with `jq -r '."."' .release-please-manifest.json`.
    - If `source_sha` is not `github.sha`, apply the DEV gate (Task 7, Step 1) to `source_sha`.
  - `publish` job: calls `create-tag.yml`.
  - `mark-tagged` job: `gh pr edit --remove-label "autorelease: pending" --add-label "autorelease: tagged"`, then a summary saying "next: run Deploy TEST with <tag>".
- [ ] **Step 4: Lint** with actionlint. Expected: no output.
- [ ] **Step 5: Branch `plt-1652-deploy-dev`.** Show the diff and wait for review, then commit `ci: add DEV deploy and tag creation PLT-1652`, push, and open a PR with the template filled in.
- [ ] **Step 6: The user merges.** Expected: Deploy DEV runs, `http://dev.localhost:4101` shows `unreleased` and the merge SHA, and the `find-release` job ends with "not a release commit". Take one status snapshot only.
- [ ] **Step 7: Rerun reuse check (Review Focus 1).** Done during Task 6 verification: re-run the `publish` job of a release commit's DEV run. Expected: the summary shows the same `rc.1` tag and no `rc.2` exists.

### Task 6: Prepare Release

**Files:**
- Create: `.github/workflows/prepare-release.yml`

**Interfaces:**
- Inputs:
  - `mode`: choice `new-release` | `recut-rc`, default `new-release`
  - `channel`: choice `rc` | `stable`, default `rc`
  - `source-ref`: string, optional
- Consumes: `create-tag.yml` (recut path), the DEV gate snippet (Task 7, Step 1), and the selection comment format `<!-- release-selection -->` followed by a JSON code block `{channel, source_ref, source_sha, prepared_run}`.
- Concurrency: `prepare-release`, no cancel-in-progress.

- [ ] **Step 1: Job `check-pending`.** If `gh pr list --state merged --label "autorelease: pending"` is non-empty, fail with `::error::Release PR #N is merged but not tagged. Re-run the failed jobs of its Deploy DEV run: <url>`.
- [ ] **Step 2: Job `resolve-source`.**
  - Trim `source-ref`. Blank resolves to `merge` for new-release and to `origin/main` HEAD for recut.
  - Otherwise run `git rev-parse --verify "$REF^{commit}"` and `git merge-base --is-ancestor "$SHA" origin/main`.
  - Output a full SHA or `merge`.
- [ ] **Step 3: new-release path.**
  - `googleapis/release-please-action@v4` with `skip-github-release: true`, then find the open PR with `gh pr list --state open --label "autorelease: pending"`. If there is none, the summary says "Nothing releasable since the last release" and the job stops.
  - Post the selection comment, or edit the existing one, with `gh pr comment --edit-last` falling back to `gh pr comment`.
  - Check out the PR head, run `node --test`, then `gh api repos/$R/statuses/$HEAD -f state=success|failure -f context=pr-checks`.
- [ ] **Step 4: recut-rc path.**
  - Refuse `channel: stable` with a message that says why.
  - Read the version from `main`'s manifest. Refuse if `v$VERSION` exists.
  - Apply the DEV gate to the SHA, then call `create-tag.yml` with channel `rc`.
- [ ] **Step 5: Lint**, then follow the same branch, review, PR and user-merge process as Task 5, with commit `ci: add Prepare Release workflow PLT-1652`.
- [ ] **Step 6: Early verification (the user runs it; this settles the spec's open risk and the "any source" check).**
  1. Merge a small `feat` PR, then run Prepare Release (`new-release`, `rc`).
     - Expected: the release PR proposes 0.2.0.
     - Expected: it has a selection comment.
     - Expected: `pr-checks` is green and the PR is mergeable.
  2. Merge the release PR. Expected: Deploy DEV creates `v0.2.0-rc.1` on the merge SHA, and the label becomes `autorelease: tagged`.
  3. Merge another `fix` PR and run Prepare again. Expected: the release PR proposes 0.2.1 and its changelog lists only the new fix.
  - If step 3 shows the wrong range, stop and report to the user before changing anything. The fallback in the spec is to create a GitHub Release object at publication time.

### Task 7: Deploy TEST

**Files:**
- Create: `.github/workflows/deploy-test.yml`

**Interfaces:**
- Input: `release-tag` (string, required). `run-name: Deploy TEST ${{ inputs.release-tag }}`. Run names are not trimmed, so Task 8 compares trimmed titles.
- Jobs:
  - `resolve`: outputs `tag` and `sha`.
  - `test`: calls `deploy.yml` with `environment: test`.
  - `qa`: Mac runner, checks out `main` for `qa/`.
- Artifact `qa-evidence` contains `qa-evidence.json` = `{tag, sha, run_id, run_attempt, workflow_sha, qa_demo}`.

- [ ] **Step 1: `resolve` job.**
  - Trim and check against the tag regex (Global Constraints). On mismatch, the error includes the expected examples `v1.2.0` and `v1.2.0-rc.1`.
  - Get the SHA with `git rev-list -n1 "refs/tags/$TAG"`. If the tag doesn't exist, the error says so.
  - DEV gate:

```bash
LATEST=$(gh run list --workflow deploy-dev.yml --commit "$SHA" --limit 20 --json databaseId,status,conclusion,startedAt \
  --jq 'sort_by(.startedAt) | last')
[ -n "$LATEST" ] || { echo "::error::No DEV run for $SHA"; exit 1; }
echo "$LATEST" | jq -e '.status == "completed" and .conclusion == "success"' >/dev/null \
  || { echo "::error::Latest DEV run for $SHA is not successful: $LATEST"; exit 1; }
```

- [ ] **Step 2: Wire `test` and `qa`.**
  - `test` calls `deploy.yml` with the resolved `sha` and `tag`.
  - `qa` runs `node qa/qa.mjs http://test.localhost:4102 "$TAG" "$SHA"`, writes the evidence JSON, and uploads it with `actions/upload-artifact`. Upload only on success, so a failed run has no artifact.
- [ ] **Step 3: Lint**, then branch, review, PR and user merge, with commit `ci: add Deploy TEST workflow PLT-1652`.
- [ ] **Step 4: Input handling (Review Focus 3).** The user runs ` v0.2.0-rc.1 ` (with spaces) and `v0.2.0-rc1`. Expected: the first deploys `v0.2.0-rc.1`, and the second fails in `resolve` with the format message.

### Task 8: Promote PROD

**Files:**
- Create: `.github/workflows/promote-prod.yml`

**Interfaces:**
- Input: `tested-tag`. `run-name: Promote PROD ${{ inputs.tested-tag }}`.
- Jobs:
  - `gate`: outputs `sha`, `version`, `channel`.
  - `stable-tag`: calls `create-tag.yml` with channel `stable`.
  - `prod`: calls `deploy.yml` with `environment: prod` and `release-tag` set to the stable tag.

- [ ] **Step 1: `gate` job.**
  - Trim, check the regex, resolve the SHA.
  - Run the TEST gate keyed by SHA:

```bash
TAGS=$(git tag --points-at "$SHA" | jq -R . | jq -sc .)
LATEST=$(gh run list --workflow deploy-test.yml --limit 100 --json databaseId,displayTitle,status,conclusion,startedAt \
  --jq "[.[] | select((.displayTitle | sub(\"^Deploy TEST\\\\s+\"; \"\") | gsub(\"\\\\s\"; \"\")) as \$t | $TAGS | index(\$t))] | sort_by(.startedAt) | last")
```

  - Then require completed and success, as in the DEV gate.
  - Run `gh run download <id> -n qa-evidence`. If it fails: `::error::Run <id> has no QA evidence (older or expired run). Re-run Deploy TEST for <tag>.`
  - Require that `jq -r .sha` of the evidence equals `$SHA`.
- [ ] **Step 2: `stable-tag` and `prod`.**
  - The stable version is the tag without `v` and `-rc.N`.
  - `create-tag.yml` reuses an existing stable tag on the same SHA, creates one if missing, and fails if it exists elsewhere.
  - `prod` waits for approval through the `prod` environment.
- [ ] **Step 3: Lint**, then branch, review, PR and user merge, with commit `ci: add Promote PROD workflow PLT-1652`.
- [ ] **Step 4: User checks.**
  - Promote `v0.2.0-rc.1` after QA passed. Expected: `v0.2.0` is created on the same SHA, the run waits for approval, and after approval PROD shows `v0.2.0` with that SHA.
  - Promote an RC whose latest TEST run failed. Expected: the gate blocks it, even if an older successful run exists.
- [ ] **Step 5: Rerun ordering (Review Focus 2).**
  - Deploy TEST `rc.1` with `QA_DEMO=pass` (run A), then with `fail` (run B).
  - Re-run A after restoring `pass`.
  - Expected: Promote sees A as latest by `startedAt` and passes.

### Task 9: README and demo checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README.**
  - What the pilot is, one paragraph.
  - Workflow file map, one line each.
  - The Release Please publication limitation and the older-`source-ref` version/changelog gap, both from the spec.
  - The demo checklist:
    - Path A: merge a feat, see DEV update, Prepare (rc), merge the release PR, see `v0.2.0-rc.1`, Deploy TEST with `QA_DEMO=fail` via a PR to `config/test.env` and see QA fail, restore `pass` and see QA succeed, Promote, approve, verify PROD, compare all three pages.
    - RC re-cut: fail `rc.1`, merge the fix, run `recut-rc`, get `rc.2`.
    - Path B: Prepare (stable), merge, `v0.3.0`, Deploy TEST, Promote reuses `v0.3.0`, approve.
- [ ] **Step 2: Branch, review, PR and user merge**, with commit `docs: add demo checklist PLT-1652`.
