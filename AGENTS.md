# AI Agent Instructions

These instructions are intended for AI tools and agents working on this
repository.

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

In its place, `.github/workflows/no-op-pr.yml` closes a pull request whose diff
is empty or touches only `.jules/**`, with a comment saying why. A close is not
a failure — it is the same finding, recorded without costing anyone a review.

A journal entry is not a change either. It records a lesson learned from work;
it belongs in the pull request carrying that work, or committed straight to the
default branch. On its own it is filler.
