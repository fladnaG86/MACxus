# Contributing

Use feature/fix branches and PRs targeting `main` in this macOS fork. Pushes
and green source checks are not releases.

Keep user documentation concise and current. README and wiki explain setup,
usage and limitations; release notes describe changes. Do not publish internal
work logs or debugging narratives in user guides.

The launcher uses semantic versioning (`major.minor.patch`), starting at `0.1.0`.
Use patch releases for compatible fixes and minor releases for new features;
before `1.0.0`, breaking changes may arrive in a minor release. Runtime builds
are versioned separately. Keep `package.json` and `package-lock.json` in sync.

On macOS, install GNU tar for the archive-safety fixtures (`brew install
gnu-tar`). Tests use a canonical temporary directory so macOS `/var` aliases do
not turn ordinary fixtures into deliberately rejected symlink paths. Linux-only
`/proc`, process-group and ELF runtime contracts run on the Linux CI lane;
portable checks and macOS behavior run on both lanes. The archived upstream
workflows in `.github/workflows-upstream` stay inactive. The active
`.github/workflows/checks.yml` runs source checks on macOS and Linux without
packaging or publishing a release.

```sh
npm ci
npm run build
npm run test:runtime-tools
npm run test:ci-tools
```

Keep one shared runtime. Use disposable test directories, never a user's active
game installation, saves or Xodus checkout. Keep credentials, raw diagnostics,
prefixes and agent handoffs outside Git. Include redacted reproduction steps,
versions and actual test results in bug reports and PRs.

Active CI runs source checks without distribution builds. The retained upstream
distribution and promotion workflows are archived and inactive in this fork.
When a maintainer prepares a release, promotion reuses the exact validated
candidate files without rebuilding.
Stable publication requires explicit maintainer approval
for the exact tested artifact, with no rebuild after validation. The approval
record is [release-validation.json](.github/release-validation.json).

Detailed guides are prepared for the [wiki](https://github.com/domsvoboda/xodus-nexus/wiki)
(currently pending). Runtime reconstruction instructions and source/license
locks remain alongside the [build scripts](scripts/SHARED_RUNTIME.md).
