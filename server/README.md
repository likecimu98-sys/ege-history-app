# VPS migration runbook

This directory contains the first-party PostgreSQL API and the operational
scripts for moving `reshay-istoriyu.ru` away from Firebase without changing the
learning UI.

## Current phases

1. **Shadow (safe now):** the public client and bot still use Firebase. The
   `hist-firebase-ingest` process copies Firebase changes exactly into
   PostgreSQL, and `hist-api` is available behind `/api/`.
2. **Cutover:** the committed client and the staged bot switch together after
   the resource and Google OAuth gates pass. PostgreSQL becomes authoritative
   and changes are mirrored back to Firebase for 14 days.
3. **Archive:** stop the reverse mirror after 14 stable days. Keep the closed
   Firebase project for 60 days, then export and delete it only after an
   explicit administrator decision.

Do not manually start the reverse mirror while the Firebase client is still in
production. That would create two writers.

## Production prerequisites

- at least 2 vCPU, 4 GiB RAM and 20 GiB free disk space;
- Google OAuth client ID and secret in `/etc/ege-history/api.env`;
- authorized callback
  `https://reshay-istoriyu.ru/api/v1/auth/google/callback`;
- a clean Git commit containing `vps-sync-compat.js` and the client changes;
- the staged bot files in `/root/bot/vps-stage`;
- a successful Firebase/PostgreSQL comparison and API smoke test.

The preflight refuses the cutover if any prerequisite is missing.

## Cutover from Windows

Prepare the committed client archive, upload it with strict SSH host checking,
and run all non-destructive checks:

```powershell
.\deploy-vps.ps1
```

After the preflight succeeds and the short duel search pause is announced:

```powershell
.\deploy-vps.ps1 -Cutover -ConfirmCutover RESHAY_HISTORY_VPS
```

The server creates a backup, performs the final idempotent import and checksum
comparison, saves rollback copies of the client and bot, enables the 14-day
reverse mirror, then atomically activates the new client.

## Rollback and deadlines

Within the mirror window, return to the Firebase client and bot with:

```bash
CONFIRM_ROLLBACK=RESHAY_HISTORY_FIREBASE /usr/local/sbin/ege-history-rollback
```

After 14 stable days, create another backup and stop the mirror with:

```bash
CONFIRM_STOP_MIRROR=RESHAY_HISTORY_STABLE /usr/local/sbin/ege-history-stop-firebase-mirror
```

The daily migration reminder sends the administrator a Telegram message at the
14-day and 60-day deadlines. It never deletes Firebase automatically.

## Backups

- six-hour encrypted snapshots:
  `/var/backups/ege-history/snapshots/six-hour` (last 28);
- nightly encrypted Telegram snapshots:
  `/var/backups/ege-history/snapshots/nightly`;
- weekly encrypted snapshots:
  `/var/backups/ege-history/weekly` (last 8);
- Firebase source archive:
  `/var/backups/ege-history/firebase-source`.

Every archive includes a PostgreSQL custom dump, an online SQLite backup of the
bot database, the schema version, sizes and SHA-256 checksums. The age private
key must remain outside the VPS. The weekly restore job recreates a temporary
database, reads student state counts and runs SQLite `integrity_check`.

Manual checks:

```bash
/usr/local/sbin/ege-history-smoke-api
/usr/local/sbin/ege-history-backup local
/usr/local/sbin/ege-history-restore-check
```

No `.env`, service-account file, bot token or database password belongs in Git
or in the Telegram backup archive.
