# deploy-api.ps1 - deploy the Node API (server/api) to prod (/opt/ege-history-api).
#
# Counterpart of deploy-static.ps1, which ships ONLY the web client. Until this
# script existed there was no way to release server changes at all, so the API was
# patched by hand on the box - that is how src/auth.js drifted away from the
# repository (sameSite Lax vs None) and stayed undetected for a day.
#
# Safety model, same as deploy-static.ps1: strict host key + ed25519 pinning, DOS
# 8.3 short paths (a profile name with a space breaks ssh UserKnownHostsFile), and
# ASCII-only source (PowerShell 5.1 reads scripts as ANSI - Cyrillic breaks parsing).
#
# Unlike the static deploy this one runs `npm ci` and the test suite ON the server
# BEFORE swapping, and rolls back automatically if /api/v1/health does not answer.
#
# Does NOT touch: the database, migrations, /etc/ege-history/api.env, nginx, the bot.
# Migrations stay manual on purpose - see `npm run migrate` in server/api.
param(
    [string]$Vps = 'root@185.198.152.200',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$KnownHostsPath = (Join-Path $env:USERPROFILE '.ssh\known_hosts'),
    [switch]$SkipDirtyCheck
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$archive = Join-Path ([IO.Path]::GetTempPath()) ("ege-api-$([guid]::NewGuid().ToString('N')).tar.gz")
$remoteUploading = '/root/ege-history-api.tar.gz.uploading'
$remoteArchive = '/root/ege-history-api.tar.gz'
$remoteRunnerUploading = '/root/ege-history-api-deploy.sh.uploading'
$remoteRunner = '/root/ege-history-api-deploy.sh'

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
    '-o', 'BatchMode=yes'
)

try {
    if (-not $SkipDirtyCheck) {
        # The workspace can be owned by another local Windows profile. Trust only
        # this resolved repository for these commands; keep global Git protection.
        $gitTrust = "safe.directory=$($repoRoot -replace '\\', '/')"
        $dirty = & git -c $gitTrust -C $repoRoot status --porcelain
        if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
        if ($dirty) { throw 'Commit changes before deploying the API.' }
    }

    # server/ is export-ignore in .gitattributes, so `git archive HEAD` skips it on
    # purpose (the client bundle must never carry server code). Archiving the
    # subtree directly makes server/api the archive root, so the ignore rule - which
    # is matched against the archive path - no longer applies.
    Write-Host 'Packing server/api from HEAD...'
    if (-not $gitTrust) { $gitTrust = "safe.directory=$($repoRoot -replace '\\', '/')" }
    Invoke-Native { git -c $gitTrust -C $repoRoot archive --format=tar.gz -o $archive 'HEAD:server/api' } 'git archive failed'

    $entries = & tar -tzf $archive
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read archive.' }
    if (-not ($entries -match '(^|/)src/server\.js$')) { throw 'src/server.js missing from archive.' }
    if (-not ($entries -match '(^|/)package-lock\.json$')) { throw 'package-lock.json missing - npm ci would fail.' }
    # Secrets live in /etc/ege-history/api.env on the box and must never be shipped.
    if ($entries -match '(^|/)\.env$') { throw '.env must not be published.' }

    Write-Host 'Uploading to VPS...'
    Invoke-Native { & scp @sshOptions $archive "${Vps}:$remoteUploading" } 'Upload failed'
    Invoke-Native { & ssh @sshOptions $Vps "mv -- '$remoteUploading' '$remoteArchive'" } 'Atomic archive placement failed'

    Write-Host 'Installing, testing and swapping on the VPS...'
    # The remote script travels as a FILE, not as an ssh argument. PowerShell 5.1
    # mangles embedded quotes when handing a string to native ssh, and this script
    # needs nested quoting (sed/tr/curl formats). Uploading sidesteps that entirely.
    # Written with explicit LF: CRLF would make bash choke on "\r" in every line.
    $remote = @'
set -Eeuo pipefail
STAMP="$(date +%Y%m%d-%H%M%S)"
LIVE="/opt/ege-history-api"
NEW="$LIVE.release-$STAMP"
PREV="$LIVE.prev-$STAMP"

# Port comes from the runtime env file; env.js falls back to 8792.
PORT="$(sed -n 's/^API_PORT=[^0-9]*\([0-9][0-9]*\).*/\1/p' /etc/ege-history/api.env 2>/dev/null | head -n1)"
PORT="${PORT:-8792}"

rm -rf "$NEW"
install -d -m 750 "$NEW"
tar --warning=no-timestamp -xzf /root/ege-history-api.tar.gz -C "$NEW"
test -f "$NEW/src/server.js"
test -f "$NEW/package-lock.json"

# Stamp the release so /api/v1/health can answer "which build is actually live".
# Without this the endpoint reported a hardcoded version and there was no way to
# tell whether a deploy of the API had landed - only the static client carried a
# visible version. GIT_SHA is substituted by the PowerShell side before upload.
printf '%s %s\n' "$STAMP" "@@GIT_SHA@@" > "$NEW/RELEASE"

cd "$NEW"
npm ci --omit=dev --no-audit --no-fund
# Tests are pure units: they set a dummy DATABASE_URL and never open a connection,
# so this cannot touch production data. Failing here aborts before any swap.
node --test test/*.test.js

# Match the ownership prod already uses: readable by the hist-api service user,
# writable by nobody. pm2 runs the process as uid/gid hist-api.
chown -R root:hist-api "$NEW"
find "$NEW" -type d -exec chmod 750 {} +
find "$NEW" -type f -exec chmod 640 {} +

mv "$LIVE" "$PREV"
mv "$NEW" "$LIVE"
pm2 restart hist-api --update-env >/dev/null

healthy=0
for _ in $(seq 1 20); do
  sleep 1
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/v1/health" || true)"
  if [ "$code" = "200" ]; then healthy=1; break; fi
done

if [ "$healthy" != "1" ]; then
  rm -rf "$LIVE"
  mv "$PREV" "$LIVE"
  pm2 restart hist-api --update-env >/dev/null
  echo "HEALTH CHECK FAILED after 20s - rolled back to the previous release"
  exit 1
fi

# Keep three snapshots for manual rollback, drop older ones.
ls -1dt "$LIVE".prev-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
echo "api release $STAMP healthy on port $PORT"
'@
    # Substitute the commit via a placeholder rather than interpolating into the
    # here-string: @'...'@ is literal on purpose, and switching it to @"..."@ would
    # expand every $VAR the bash script relies on.
    $gitSha = (& git -C $repoRoot rev-parse --short HEAD)
    if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed' }
    $remote = $remote -replace '@@GIT_SHA@@', $gitSha
    $remoteScript = Join-Path ([IO.Path]::GetTempPath()) ("ege-api-deploy-$([guid]::NewGuid().ToString('N')).sh")
    [IO.File]::WriteAllText($remoteScript, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
    try {
        Invoke-Native { & scp @sshOptions $remoteScript "${Vps}:$remoteRunnerUploading" } 'Runner upload failed'
        Invoke-Native { & ssh @sshOptions $Vps "mv -- '$remoteRunnerUploading' '$remoteRunner' && bash '$remoteRunner'" } 'Remote install/test/swap failed'
    }
    finally {
        Remove-Item -LiteralPath $remoteScript -Force -ErrorAction SilentlyContinue
    }

    Write-Host 'Verifying through the public origin...'
    $cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $code = (& curl.exe -s -o /dev/null -w '%{http_code}' "https://reshay-istoriyu.ru/api/v1/health?cb=$cb")
    Write-Host "https://reshay-istoriyu.ru/api/v1/health -> HTTP $code"
    if ($code -ne '200') { throw "Public health check returned $code - investigate before leaving." }
    Write-Host 'Done. Remember: git push origin master (GitHub is the backup mirror).'
}
finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
