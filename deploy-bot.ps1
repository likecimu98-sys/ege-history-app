# deploy-bot.ps1 - deploy the Telegram bot (server/bot) to prod (/root/bot).
#
# Third sibling of deploy-static.ps1 (web client) and deploy-api.ps1 (Node API).
# Until this script existed the bot was the only component shipped BY HAND, and it
# showed: on 13.08.2026 the live engage.js turned out to be from 20.07 - a fix that
# stopped the bot from nagging about REVOKED homework had been sitting unreleased in
# the repository for three weeks, and nobody knew. Worse, vps-firestore-compat.js -
# which bot.js requires and cannot start without - was not in the repository at all.
#
# Safety model, same as deploy-api.ps1: strict host key + ed25519 pinning, DOS 8.3
# short paths (a profile name with a space breaks ssh UserKnownHostsFile), ASCII-only
# source (PowerShell 5.1 reads scripts as ANSI; the deploy scripts carry no BOM, so
# Cyrillic here would be read as mojibake).
#
# Drift guard. Every successful deploy writes /root/bot/RELEASE-MANIFEST with a
# sha256 per shipped file. The next deploy refuses to swap when a live file no longer
# matches that record: somebody edited prod by hand and the edit would be lost.
# -Force overrides. On the very first run there is no manifest, so the script instead
# demands that every live file already equals the incoming one - which is exactly the
# state right after a manual sync, and any difference is reported by name.
#
# Does NOT touch: .env, users.db, serviceAccount.json, node_modules, package.json.
# Dependencies stay manual on purpose - changing them needs npm install ON the box.
param(
    [string]$Vps = 'root@5.35.94.238',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$KnownHostsPath = (Join-Path $env:USERPROFILE '.ssh\known_hosts'),
    [switch]$SkipDirtyCheck,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path

# repo path (in HEAD) -> file name under /root/bot.
# Keep in sync with tools-and-docs/bot-deploy-manifest.selftest.js, which fails when
# bot.js or engage.js starts requiring a local module that is not listed here.
$FILES = [ordered]@{
    'server/bot/src/bot.js'                  = 'bot.js'
    'server/bot/src/engage.js'               = 'engage.js'
    'server/bot/src/vps-firestore-compat.js' = 'vps-firestore-compat.js'
    'server/bot/src/token-endpoint.js'       = 'token-endpoint.js'
    'server/bot/src/initdata.js'             = 'initdata.js'
    'server/bot/src/_repair-merged.js'       = '_repair-merged.js'
    'server/api/bot-client.js'               = 'bot-client.js'
    'server/vps-main.js'                     = 'vps-main.js'
}
# Which pm2 app each file belongs to, so an untouched process is not restarted.
$OWNER = @{
    'bot.js' = 'hist-bot'; 'engage.js' = 'hist-bot'
    'vps-firestore-compat.js' = 'hist-bot'; 'bot-client.js' = 'hist-bot'
    '_repair-merged.js' = 'none'
    'vps-main.js' = 'hist-token'; 'token-endpoint.js' = 'hist-token'; 'initdata.js' = 'hist-token'
}

function Invoke-Native([scriptblock]$Command, [string]$Failure) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw $Failure }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key not found: $KeyPath" }
if (-not (Test-Path -LiteralPath $KnownHostsPath -PathType Leaf)) { throw "known_hosts not found: $KnownHostsPath" }

$fso = New-Object -ComObject Scripting.FileSystemObject
$keyShort = $fso.GetFile((Resolve-Path -LiteralPath $KeyPath).Path).ShortPath
$knownHostsShort = $fso.GetFile((Resolve-Path -LiteralPath $KnownHostsPath).Path).ShortPath
$sshOptions = @(
    '-i', $keyShort,
    '-o', "UserKnownHostsFile=$knownHostsShort",
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'HostKeyAlgorithms=ssh-ed25519',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=30',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=12'
)

$stage = Join-Path ([IO.Path]::GetTempPath()) ("ege-bot-" + [guid]::NewGuid().ToString('N'))
$archive = "$stage.tar.gz"
$runner = "$stage.sh"

try {
    $gitTrust = "safe.directory=$($repoRoot -replace '\\', '/')"
    if (-not $SkipDirtyCheck) {
        $dirty = & git -c $gitTrust -C $repoRoot status --porcelain
        if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
        if ($dirty) { throw 'Commit changes before deploying the bot.' }
    }

    Write-Host 'Staging bot files from HEAD...'
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    foreach ($repoPath in $FILES.Keys) {
        $name = $FILES[$repoPath]
        # git show writes the blob exactly as stored (LF), which is what the box needs.
        $blob = & git -c $gitTrust -C $repoRoot show "HEAD:$repoPath"
        if ($LASTEXITCODE -ne 0) { throw "Missing in HEAD: $repoPath" }
        [IO.File]::WriteAllText((Join-Path $stage $name), ($blob -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
        Write-Host ("  {0,-26} <- {1}" -f $name, $repoPath)
    }

    Invoke-Native { & tar -czf $archive -C $stage . } 'Packing failed'

    $gitSha = (& git -C $repoRoot rev-parse --short HEAD)
    if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed' }
    $forceFlag = if ($Force) { '1' } else { '0' }
    $names = ($FILES.Values -join ' ')
    $botFiles = (($OWNER.GetEnumerator() | Where-Object { $_.Value -eq 'hist-bot' } | ForEach-Object { $_.Key }) -join ' ')
    $tokenFiles = (($OWNER.GetEnumerator() | Where-Object { $_.Value -eq 'hist-token' } | ForEach-Object { $_.Key }) -join ' ')

    # The remote half travels as a FILE: PowerShell 5.1 mangles embedded quotes when
    # handing a string to native ssh, and this script needs nested quoting.
    $remote = @'
set -Eeuo pipefail
STAMP="$(date +%Y%m%d-%H%M%S)"
LIVE=/root/bot
REL="$LIVE/.release-$STAMP"
MANIFEST="$LIVE/RELEASE-MANIFEST"
NAMES="@@NAMES@@"
BOT_FILES="@@BOT_FILES@@"
TOKEN_FILES="@@TOKEN_FILES@@"
FORCE="@@FORCE@@"
GIT_SHA="@@GIT_SHA@@"

rm -rf "$REL"; install -d -m 700 "$REL"
tar -xzf /root/ege-bot.tar.gz -C "$REL"

# 1. Nothing ships that node cannot even parse.
for n in $NAMES; do
  test -f "$REL/$n" || { echo "MISSING IN ARCHIVE: $n"; exit 2; }
  node --check "$REL/$n" || { echo "SYNTAX ERROR: $n"; exit 2; }
done
echo "all files parse"

# 2. Drift guard: has anybody edited prod by hand since the last deploy?
DRIFT=""
for n in $NAMES; do
  [ -f "$LIVE/$n" ] || continue
  cur="$(sha256sum "$LIVE/$n" | cut -d" " -f1)"
  if [ -f "$MANIFEST" ]; then
    want="$(awk -v f="$n" '$2==f{print $1}' "$MANIFEST")"
    [ -n "$want" ] || continue          # file added to the deploy set later - nothing to compare
  else
    want="$(sha256sum "$REL/$n" | cut -d" " -f1)"   # first run: prod must already match
  fi
  [ "$cur" = "$want" ] || DRIFT="$DRIFT $n"
done
if [ -n "$DRIFT" ]; then
  echo "!!! prod differs from the last known release:$DRIFT"
  if [ -f "$MANIFEST" ]; then
    echo "!!! somebody edited /root/bot by hand - that edit would be LOST."
  else
    echo "!!! no manifest yet, so prod had to match the incoming files exactly."
  fi
  echo "!!! commit the live version first, or re-run with -Force to overwrite."
  [ "$FORCE" = "1" ] || { rm -rf "$REL"; exit 3; }
  echo "!!! -Force given, overwriting anyway"
fi

# 3. What actually changes? An unchanged process is not restarted.
CHANGED=""
for n in $NAMES; do
  if [ ! -f "$LIVE/$n" ] || ! cmp -s "$LIVE/$n" "$REL/$n"; then CHANGED="$CHANGED $n"; fi
done
if [ -z "$CHANGED" ]; then
  echo "nothing changed - prod already runs HEAD"
else
  echo "changing:$CHANGED"
fi

# 4. Backup, then swap. Copies go to attic/ so /root/bot stays readable.
if [ -n "$CHANGED" ]; then
  install -d -m 700 "$LIVE/attic/$STAMP"
  for n in $CHANGED; do
    [ -f "$LIVE/$n" ] && cp -a "$LIVE/$n" "$LIVE/attic/$STAMP/$n"
  done
  for n in $CHANGED; do
    cat "$REL/$n" > "$LIVE/$n"
    chmod 600 "$LIVE/$n"
  done
  echo "swapped, rollback copies in $LIVE/attic/$STAMP"
fi

# 5. Restart only the processes whose files moved.
restart_needed() {
  for n in $CHANGED; do for m in $1; do [ "$n" = "$m" ] && return 0; done; done
  return 1
}
alive() {
  pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const p=JSON.parse(s).find(x=>x.name===process.argv[1]);
    console.log(p?p.pm2_env.status:"missing");});' "$1"
}
rollback() {
  echo "!!! $1 did not come back - rolling back"
  for n in $CHANGED; do
    [ -f "$LIVE/attic/$STAMP/$n" ] && cat "$LIVE/attic/$STAMP/$n" > "$LIVE/$n"
  done
  pm2 restart "$1" --update-env >/dev/null || true
  sleep 6
  echo "after rollback: $(alive "$1")"
  exit 1
}
for app in hist-bot hist-token; do
  case "$app" in
    hist-bot)   watch="$BOT_FILES" ;;
    hist-token) watch="$TOKEN_FILES" ;;
  esac
  if restart_needed "$watch"; then
    pm2 restart "$app" --update-env >/dev/null
    sleep 8
    st="$(alive "$app")"
    echo "$app: $st"
    [ "$st" = "online" ] || rollback "$app"
  else
    echo "$app: not touched"
  fi
done

# 6. Record what is live now. Written LAST, so a failed deploy leaves the old record.
{
  echo "# release $STAMP git $GIT_SHA"
  for n in $NAMES; do printf '%s  %s\n' "$(sha256sum "$LIVE/$n" | cut -d" " -f1)" "$n"; done
} > "$MANIFEST"
chmod 600 "$MANIFEST"
rm -rf "$REL" /root/ege-bot.tar.gz

# Keep three attics, drop older ones. The pipeline runs under `set -o pipefail`,
# and on a deploy that changed nothing there is no attic/ at all: ls then exits 2
# and takes the whole script down AFTER a perfectly successful release. Swallow it.
{ ls -1dt "$LIVE"/attic/* 2>/dev/null || true; } | tail -n +4 | xargs -r rm -rf || true

echo "bot release $STAMP ($GIT_SHA) OK"
{ tail -n 4 /root/.pm2/logs/hist-bot-error.log 2>/dev/null || true; } | cut -c1-160 || true
exit 0
'@
    $remote = $remote.Replace('@@NAMES@@', $names).Replace('@@BOT_FILES@@', $botFiles).Replace('@@TOKEN_FILES@@', $tokenFiles).Replace('@@FORCE@@', $forceFlag).Replace('@@GIT_SHA@@', $gitSha)
    [IO.File]::WriteAllText($runner, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))

    Write-Host 'Uploading...'
    Invoke-Native { & scp @sshOptions $archive "${Vps}:/root/ege-bot.tar.gz.uploading" } 'Archive upload failed'
    Invoke-Native { & scp @sshOptions $runner "${Vps}:/root/ege-bot-deploy.sh.uploading" } 'Runner upload failed'
    Invoke-Native { & ssh @sshOptions $Vps "mv -- /root/ege-bot.tar.gz.uploading /root/ege-bot.tar.gz && mv -- /root/ege-bot-deploy.sh.uploading /root/ege-bot-deploy.sh" } 'Atomic placement failed'

    Write-Host 'Checking, swapping and restarting on the VPS...'
    Invoke-Native { & ssh @sshOptions $Vps "bash /root/ege-bot-deploy.sh" } 'Remote deploy failed'

    Write-Host 'Done. Remember: git push origin master.'
}
finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    foreach ($f in @($archive, $runner)) {
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
    }
}
