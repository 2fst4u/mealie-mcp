## 2026-06-23 - CI Workflow and Documentation Drift

**Learning:** Documentation for CI release processes often drifts from the actual workflow implementation. In this case, `README.md` stated that developers needed to manually bump the version in `package.json` in their PRs to trigger a release. However, the actual implementation in `.github/workflows/release.yml` used `npm version patch --no-git-tag-version` to automatically bump the version, commit, tag, and publish on every merge to `main`. This caused ambiguity about whether manual action was required.
**Action:** When updating instructions on how to cut a release, always verify the claims by directly inspecting the `.github/workflows/` files (or other CI configurations). Do not assume the documentation is accurate, even if it sounds authoritative. Ensure `README.md` and `CONTRIBUTING.md` accurately reflect the automated steps taken by the pipeline.
## 2025-02-27 - CI Triggers and Env Constraints Documentation Drift

**Learning:** Documentation can drift in two common ways here:
1. CI trigger instructions in README.md drifted from actual `.github/workflows/` configs (claims about running on non-main branch pushes when the workflow was explicitly `pull_request` only).
2. Over-constrained environment variables in `.env.example` and JSDocs (claiming `MEALIE_BASE_URL` requires "no trailing slash", while the actual implementation in `src/config.ts` successfully parses and strips trailing slashes via `replace(/\/+$/, "")`).

**Action:**
1. Always verify CI trigger claims against the actual `.github/workflows/*.yml` files.
2. When updating configuration documentation, check the parsing implementation (e.g., `src/config.ts`) to see if constraints claimed in documentation are actually enforced or if the code handles them gracefully. Remove unnecessary constraints to avoid confusing users.
