param(
    [switch]$Cutover,
    [string]$ConfirmCutover = '',
    [string]$Vps = 'root@185.198.152.200',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$KnownHostsPath = (Join-Path $env:USERPROFILE '.ssh\known_hosts')
)

$ErrorActionPreference = 'Stop'
$requiredConfirmation = 'RESHAY_HISTORY_VPS'
$remoteArchive = '/root/ege-app-cutover.tar.gz'
$remoteUploading = '/root/ege-app-cutover.tar.gz.uploading'
$archive = Join-Path ([IO.Path]::GetTempPath()) ("ege-app-cutover-$([guid]::NewGuid().ToString('N')).tar.gz")
$repoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path

function Invoke-Native([scriptblock]$Command, [string]$Failure) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw $Failure }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key not found: $KeyPath" }
if (-not (Test-Path -LiteralPath $KnownHostsPath -PathType Leaf)) { throw "known_hosts not found: $KnownHostsPath" }
if ($Cutover -and $ConfirmCutover -ne $requiredConfirmation) {
    throw "For the production switch add -ConfirmCutover $requiredConfirmation"
}

# Use DOS 8.3 short paths (no spaces). A profile whose name contains a space (e.g. a
# Cyrillic account) otherwise makes ssh split UserKnownHostsFile on the space ->
# "No ED25519 host key is known". PowerShell 5.1 also mangles embedded quotes when
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
    $dirty = & git -C $repoRoot -c "safe.directory=$repoRoot" status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
    if ($dirty) { throw 'Commit all migration changes before preparing the production archive.' }

    Invoke-Native { git -C $repoRoot -c "safe.directory=$repoRoot" cat-file -e 'HEAD:vps-sync-compat.js' } 'vps-sync-compat.js is not committed.'
    Invoke-Native { git -C $repoRoot -c "safe.directory=$repoRoot" archive --format=tar.gz -o $archive HEAD } 'git archive failed'

    $entries = & tar -tzf $archive
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect client archive.' }
    if (-not ($entries -match '(^|/)index\.html$')) { throw 'index.html is missing from the archive.' }
    if (-not ($entries -match '(^|/)vps-sync-compat\.js$')) { throw 'vps-sync-compat.js is missing from the archive.' }
    if (-not ($entries -match '(^|/)cloud-sync\.js$')) { throw 'cloud-sync.js is missing from the archive.' }
    if ($entries -match '(^|/)firebase-sync\.js$') { throw 'Legacy Firebase client module must not be published.' }
    if ($entries -match '(^|/)server/') { throw 'Server sources must not be published with the client.' }

    Write-Host 'Uploading the signed-off client archive...'
    Invoke-Native { & scp @sshOptions $archive "${Vps}:$remoteUploading" } 'Client archive upload failed'
    Invoke-Native { & ssh @sshOptions $Vps "mv -- '$remoteUploading' '$remoteArchive'" } 'Atomic archive placement failed'

    Write-Host 'Running the full server preflight...'
    Invoke-Native { & ssh @sshOptions $Vps /usr/local/sbin/ege-history-preflight-cutover } 'Cutover preflight failed. Production was not changed.'

    if (-not $Cutover) {
        Write-Host 'Preflight passed. Production was not changed. Re-run with -Cutover and the confirmation value when ready.'
        exit 0
    }

    Write-Host 'Switching the site and bot to PostgreSQL...'
    Invoke-Native { & ssh @sshOptions $Vps "env CONFIRM_CUTOVER=$requiredConfirmation /usr/local/sbin/ege-history-cutover" } 'Production cutover failed. Inspect the preserved rollback state before retrying.'
    Write-Host 'Cutover completed. Keep Firebase closed but intact for the 60-day rollback window.'
}
finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
