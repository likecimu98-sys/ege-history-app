# deploy-static.ps1 - simple client STATIC deploy to prod (reshay-istoriyu.ru).
# Web files only: unpack `git archive HEAD` into /var/www/ege-app with an atomic
# swap and a rollback snapshot. NO database / Firebase / pm2 migration - unlike
# deploy-vps.ps1 (that is the one-time Firebase->PostgreSQL cutover). Use THIS
# script for routine site changes. ASCII-only to stay codepage-independent.
param(
    [string]$Vps = 'root@185.198.152.200',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$KnownHostsPath = (Join-Path $env:USERPROFILE '.ssh\known_hosts')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$archive = Join-Path ([IO.Path]::GetTempPath()) ("ege-static-$([guid]::NewGuid().ToString('N')).tar.gz")
$remoteUploading = '/root/ege-app-static.tar.gz.uploading'
$remoteArchive = '/root/ege-app-static.tar.gz'
$remoteRunnerUploading = '/root/ege-app-static-deploy.sh.uploading'
$remoteRunner = '/root/ege-app-static-deploy.sh'

function Invoke-Native([scriptblock]$Command, [string]$Failure) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw $Failure }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key not found: $KeyPath" }
if (-not (Test-Path -LiteralPath $KnownHostsPath -PathType Leaf)) { throw "known_hosts not found: $KnownHostsPath" }

# Use DOS 8.3 short paths (no spaces): a profile whose name contains a space (e.g.
# a Cyrillic account) otherwise makes ssh split UserKnownHostsFile on the space
# -> "No ED25519 host key is known". PowerShell 5.1 mangles embedded quotes when
# calling native ssh/scp, so quoting the value does not survive; short paths do.
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
    $dirty = & git -C $repoRoot status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
    if ($dirty) { throw 'Commit changes before deploying static.' }

    Write-Host 'Packing HEAD...'
    Invoke-Native { git -C $repoRoot archive --format=tar.gz -o $archive HEAD } 'git archive failed'

    $entries = & tar -tzf $archive
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read archive.' }
    if (-not ($entries -match '(^|/)index\.html$')) { throw 'index.html missing from archive.' }
    if ($entries -match '(^|/)server/') { throw 'server/ must not be published.' }
    if ($entries -match '(^|/)firebase-sync\.js$') { throw 'firebase-sync.js must not be published.' }

    Write-Host 'Uploading to VPS...'
    Invoke-Native { & scp @sshOptions $archive "${Vps}:$remoteUploading" } 'Upload failed'
    Invoke-Native { & ssh @sshOptions $Vps "mv -- '$remoteUploading' '$remoteArchive'" } 'Atomic archive placement failed'

    Write-Host 'Unpacking and atomically swapping the webroot (with rollback snapshot)...'
    # Our snapshots are ege-app.prev-*; we DO NOT touch migration ege-app.rollback-* / *.client-rollback-*.
    $remote = @'
set -Eeuo pipefail
STAMP="$(date +%Y%m%d-%H%M%S)"
NEW="/var/www/ege-app.release-$STAMP"
rm -rf "$NEW"
install -d -m 755 "$NEW"
tar --warning=no-timestamp -xzf /root/ege-app-static.tar.gz -C "$NEW"
test -f "$NEW/index.html" && test -f "$NEW/service-worker.js"
find "$NEW" -type d -exec chmod 755 {} +
find "$NEW" -type f -exec chmod 644 {} +
# Git archive timestamps come from the workstation clock. Normalize them to the
# VPS clock so Nginx never emits future Last-Modified validators to browsers.
find "$NEW" -type f -exec touch -c {} +
LIVE="/var/www/ege-app"
# Swap the webroot by renaming a SYMLINK. There used to be two consecutive mv
# calls here, leaving a fraction of a second where /var/www/ege-app did not
# exist at all - a request landing in that window got an error. Renaming a
# symlink is a single atomic rename(2), so the window disappears.
# Bonus: rollback becomes instant too - just repoint the link at the previous
# release directory, no moving involved.
if [ -L "$LIVE" ]; then
    ln -sfn "$NEW" "$LIVE.swap"
    mv -Tf "$LIVE.swap" "$LIVE"
else
    # One-time migration from the old scheme, where the webroot was a real dir.
    mv "$LIVE" "/var/www/ege-app.prev-$STAMP"
    ln -s "$NEW" "$LIVE"
fi

# Keep the three most recent release directories - rollback points at them.
# Migration snapshots ege-app.rollback-* / *.client-rollback-* are NOT touched:
# they are the 60-day cutover insurance, different name and different lifetime.
ls -1dt /var/www/ege-app.release-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
ls -1dt /var/www/ege-app.prev-* 2>/dev/null | tail -n +3 | xargs -r rm -rf
echo "deployed release $STAMP -> $(readlink -f "$LIVE")"
'@
    # The remote script travels as a FILE, not as an ssh argument.
    # WARNING - learned the hard way on 2026-07-27: PowerShell 5.1 mangles nested quotes
    # when handing a string to native ssh. The line
    #     echo "... $(readlink -f "$LIVE")"
    # came out broken, bash executed readlink's OUTPUT as a command and the deploy
    # died with "Is a directory" - AFTER the webroot had already been swapped.
    # deploy-api.ps1 was written this way from the start; this script was not.
    # Written with explicit LF: CRLF would make bash choke on "\r" in every line.
    $remoteScript = Join-Path ([IO.Path]::GetTempPath()) ("ege-static-deploy-$([guid]::NewGuid().ToString('N')).sh")
    [IO.File]::WriteAllText($remoteScript, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
    try {
        Invoke-Native { & scp @sshOptions $remoteScript "${Vps}:$remoteRunnerUploading" } 'Runner upload failed'
        Invoke-Native { & ssh @sshOptions $Vps "mv -- '$remoteRunnerUploading' '$remoteRunner' && bash '$remoteRunner'" } 'Remote unpack/swap failed'
    }
    finally {
        Remove-Item -LiteralPath $remoteScript -Force -ErrorAction SilentlyContinue
    }

    Write-Host 'Verifying...'
    $cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $code = (& curl.exe -s -o /dev/null -w '%{http_code}' "https://reshay-istoriyu.ru/?cb=$cb")
    Write-Host "https://reshay-istoriyu.ru/ -> HTTP $code"
    Write-Host 'Done. Remember: git push origin master (GitHub is the backup mirror).'
}
finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
