# deploy-social-static.ps1 - standalone static deploy for obschestvo.reshay-istoriyu.ru.
# Publishes only HEAD:ege-social-app. It never touches the history webroot,
# database, API, bot or migrations. ASCII-only for Windows PowerShell 5.1.
param(
    [string]$Vps = 'root@5.35.94.238',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$KnownHostsPath = (Join-Path $env:USERPROFILE '.ssh\known_hosts')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$archive = Join-Path ([IO.Path]::GetTempPath()) ("ege-social-static-$([guid]::NewGuid().ToString('N')).tar.gz")
$remoteUploading = '/root/ege-social-static.tar.gz.uploading'
$remoteArchive = '/root/ege-social-static.tar.gz'
$remoteRunnerUploading = '/root/ege-social-static-deploy.sh.uploading'
$remoteRunner = '/root/ege-social-static-deploy.sh'

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
    $gitTrust = "safe.directory=$($repoRoot -replace '\\', '/')"
    $dirty = & git -c $gitTrust -C $repoRoot status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
    if ($dirty) { throw 'Commit changes before deploying social app.' }

    Write-Host 'Packing social app from HEAD...'
    Invoke-Native { git -c $gitTrust -C $repoRoot archive --format=tar.gz -o $archive HEAD:ege-social-app } 'git archive failed'

    $entries = & tar -tzf $archive
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read archive.' }
    foreach ($required in @('index.html', 'app.js', 'core.js', 'bank.js', 'service-worker.js', 'manifest.webmanifest')) {
        if (-not ($entries -contains $required)) { throw "Required social file missing: $required" }
    }
    if ($entries -match '(^|/)server/') { throw 'server/ must not be published.' }
    if ($entries -match '(^|/)firebase-sync\.js$') { throw 'firebase-sync.js must not be published.' }
    if ($entries -match '(^|/)ege-social-app/') { throw 'Archive must contain the social app at its root.' }

    Write-Host 'Uploading social release to VPS...'
    Invoke-Native { & scp @sshOptions $archive "${Vps}:$remoteUploading" } 'Upload failed'
    Invoke-Native { & ssh @sshOptions $Vps "mv -- '$remoteUploading' '$remoteArchive'" } 'Atomic archive placement failed'

    $remote = @'
set -Eeuo pipefail
STAMP="$(date +%Y%m%d-%H%M%S)"
NEW="/var/www/ege-social-app.release-$STAMP"
install -d -m 755 "$NEW"
tar --warning=no-timestamp -xzf /root/ege-social-static.tar.gz -C "$NEW"
test -f "$NEW/index.html"
test -f "$NEW/bank.js"
test -f "$NEW/service-worker.js"
find "$NEW" -type d -exec chmod 755 {} +
find "$NEW" -type f -exec chmod 644 {} +
find "$NEW" -type f -exec touch -c {} +
LIVE="/var/www/ege-social-app"
OLD=""
if [ -L "$LIVE" ]; then
    OLD="$(readlink -f "$LIVE")"
    ln -sfn "$NEW" "$LIVE.swap"
    mv -Tf "$LIVE.swap" "$LIVE"
elif [ -d "$LIVE" ]; then
    mv "$LIVE" "/var/www/ege-social-app.prev-$STAMP"
    OLD="/var/www/ege-social-app.prev-$STAMP"
    ln -s "$NEW" "$LIVE"
else
    ln -s "$NEW" "$LIVE"
fi

if [ -n "$OLD" ] && [ -d "$OLD" ]; then
    ROLLBACK="/root/ege-social-app-static-rollback.sh"
    {
        echo '#!/usr/bin/env bash'
        echo 'set -Eeuo pipefail'
        printf 'TARGET=%q\n' "$OLD"
        echo 'LIVE=/var/www/ege-social-app'
        echo 'test -d "$TARGET"'
        echo 'ln -sfn "$TARGET" "$LIVE.swap"'
        echo 'mv -Tf "$LIVE.swap" "$LIVE"'
        echo 'echo "rolled back -> $(readlink -f "$LIVE")"'
    } > "$ROLLBACK"
    chmod 700 "$ROLLBACK"
fi

ls -1dt /var/www/ege-social-app.release-* 2>/dev/null | tail -n +4 | xargs -r rm -rf || true
ls -1dt /var/www/ege-social-app.prev-* 2>/dev/null | tail -n +3 | xargs -r rm -rf || true
echo "deployed social release $STAMP -> $(readlink -f "$LIVE")"
if [ -n "$OLD" ]; then
    echo "rollback: bash /root/ege-social-app-static-rollback.sh -> $OLD"
fi
'@
    $remoteScript = Join-Path ([IO.Path]::GetTempPath()) ("ege-social-static-deploy-$([guid]::NewGuid().ToString('N')).sh")
    [IO.File]::WriteAllText($remoteScript, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
    try {
        Invoke-Native { & scp @sshOptions $remoteScript "${Vps}:$remoteRunnerUploading" } 'Runner upload failed'
        Invoke-Native { & ssh @sshOptions $Vps "mv -- '$remoteRunnerUploading' '$remoteRunner' && bash '$remoteRunner'" } 'Remote unpack/swap failed'
    }
    finally {
        Remove-Item -LiteralPath $remoteScript -Force -ErrorAction SilentlyContinue
    }

    Write-Host 'Verifying social app...'
    $cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $verifyUrl = "https://obschestvo.reshay-istoriyu.ru/?cb=$cb"
    $code = ''
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $code = (& curl.exe -4 -sS -o NUL -w '%{http_code}' --connect-timeout 8 --max-time 20 $verifyUrl)
        if ($LASTEXITCODE -eq 0 -and $code -eq '200') { break }
        Write-Warning "Verification attempt $attempt failed: HTTP $code"
        if ($attempt -lt 3) { Start-Sleep -Seconds (2 * $attempt) }
    }
    Write-Host "https://obschestvo.reshay-istoriyu.ru/ -> HTTP $code"
    if ($code -ne '200') {
        throw 'Social production verification failed. Rollback: bash /root/ege-social-app-static-rollback.sh'
    }
    Write-Host 'Done. History webroot was not changed.'
}
finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
