# AI Agent Instructions

These instructions are intended for AI tools and agents working on this
repository.

## Dependency vulnerability scanning

Every pull request runs `.github/workflows/osv-scanner.yml`, which scans **every** dependency in the repository with [OSV-Scanner](https://google.github.io/osv-scanner/), not just the ones the pull request changes. It fails on any known vulnerability of **any severity** that is not listed in `osv-scanner.toml`.

A pull request that never touched a dependency can still fail this check: it means a new advisory was published against something already in use. Treat it as this pull request's to deal with. It is not a flake, and re-running will not clear it.

### When the scan fails

1. **Investigate every finding.** Record the package, the installed version, the advisory ID and severity, the first fixed version, whether it is a direct or a transitive dependency, and whether it ships at runtime or is dev/build tooling only.
2. **Fix it where you can without changing functionality.** Upgrade within the existing semver range, bump the direct dependency that pulls it in, or force a patched transitive version with `overrides` (npm) / `pnpm.overrides` (pnpm). Then run this repo's full checks (`npm run typecheck`, `npm run build`, `npm test`) and confirm behaviour is unchanged. Put the fix in its own commit and say in the pull request what was fixed and how.
3. **Otherwise, stop and flag it to the user for a decision.** That covers: no fixed version exists; the fix needs a major/breaking upgrade; or the fix needs changes beyond the dependency bump. Leave the check red. Report the advisory ID and severity, what is affected and whether the vulnerable code is reachable in this project, and the options (wait for a fix, take the breaking upgrade, replace the package, or accept the risk for now).

### The allowlist (`osv-scanner.toml`) is the user's decision, never yours

- **Never add, extend or renew an `[[IgnoredVulns]]` entry unattended.** Do it only when the user has explicitly decided to accept that specific advisory, and say so in the pull request.
- Every entry needs `id`, a `reason` (why the risk is accepted, who decided it and when) and an `ignoreUntil` date no more than six months ahead.
- When an entry expires and the scan fails again, investigate again from step 1. Do not just move the date.
- Remove an entry as soon as the vulnerability is fixed.
- Do not weaken the scan to get a green check: no `continue-on-error`, no excluded paths or lockfiles, no `--no-resolve`, no dropping `--all-vulns`, no changing when it runs.

Dependabot security-update pull requests (`.github/dependabot.yml`) are reviewed and verified like any other dependency change.

## Before you start: look at the open pull requests

List the open pull requests and check whether one already touches the file or
symbol you are about to change. If it does, work on something else.

Several agents run against this repository independently and cannot see each
other's work, so they converge on the same target often. One review across these
repositories found three byte-identical pull requests renaming a single import,
three separate attempts at splitting one function, and three sets of tests for
one endpoint — eleven of the thirty rejected pull requests were duplicates of
another open one.

`.github/workflows/overlapping-pr-check.yml` comments on a pull request when
another open one edits the same files. It does not block anything; overlap is
normal on a busy branch. Treat it as a prompt to check whether the two are doing
the same work, and to close the weaker one before both reach review.

## Reporting "no change needed"

Finding that a task needs no code change is a complete result. Report it and
stop. Do not open a pull request, and do not add an unrelated edit so that a
pull request has something to carry.

This used to be enforced the other way round. A CI gate (`empty-commit-check`)
failed any branch whose diff was empty. It did stop empty pull requests, and it
started a worse habit: agents began manufacturing a change to get the gate
green. One wrote the tactic into its own journal — *"apply a completely safe,
trivial code health cleanup ... to satisfy the CI file modification
requirement"* — directly beneath an older entry telling the same agent not to
introduce unnecessary modifications.

The filler was not always safe. Across one review of the open pull requests in
these repositories it suppressed worker error reporting in production builds,
made a failed upload report the wrong reason, and moved a content-type check to
after the response had been buffered into memory.
