# Workspace migration smoke (Forge AI-412)

- started: `20260620T054256Z`
- finished: `20260620T054301Z`
- elapsed: `2852.819 ms`

## ac1_dry_run_prints_accurate_preview

```json
{
  "exitCode": 0,
  "manifestUnchanged": true,
  "seedFileUnchanged": true,
  "stdoutContains": {
    "addStep": true,
    "manifestChange": true,
    "pendingCount": true,
    "target": true
  }
}
```

## ac2_apply_is_idempotent

```json
{
  "appliedExitCode": 0,
  "appliedMigrations": [
    "v2_onboarding"
  ],
  "fileBytes": 3032,
  "fileCreated": true,
  "reDryRunExitCode": 0,
  "reDryRunPending": true
}
```

## ac3_tenant_override_survives

```json
{
  "manifestLeak": [],
  "shadowHashAfter": "7e12ca2012ab9897daee6f625a17d289fc117c4085d6bae99c29cd9e56e8d964",
  "shadowHashBefore": "7e12ca2012ab9897daee6f625a17d289fc117c4085d6bae99c29cd9e56e8d964",
  "shadowNoticeInDryRun": true,
  "shadowUnchanged": true,
  "unrelatedHashAfter": "5ff6dd7d9cbce0131d3774a341fe468cbd11256b5d98783efbd2343e94542fd5",
  "unrelatedHashBefore": "5ff6dd7d9cbce0131d3774a341fe468cbd11256b5d98783efbd2343e94542fd5",
  "unrelatedUnchanged": true
}
```

## ac4_manifest_round_trip_with_applied_migrations

```json
{
  "appliedMigrationsLoaded": [
    "v2_onboarding"
  ],
  "manifestBytes": 111,
  "manifestStable": true
}
```

## ac5_failure_paths

```json
{
  "reApplyNoOpExitCode": 0,
  "unknownTargetExitCode": 1,
  "unknownTargetStderrMentions": true
}
```
