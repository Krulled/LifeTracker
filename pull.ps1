$PROJECT   = Split-Path -Parent $MyInvocation.MyCommand.Path
$dbPath    = Join-Path $PROJECT "backend\sleep_tracker.db"
$tokenFile = Join-Path $PROJECT ".sync_token"
$url       = "https://life-tracker-zach.fly.dev/api/sync/pull-db"

if (-not (Test-Path $tokenFile)) { Write-Host "[ERROR] Token file not found: $tokenFile"; exit 1 }

$token = (Get-Content $tokenFile -Raw).Trim()

Write-Host "  Downloading cloud DB..."
$r     = Invoke-WebRequest -Uri $url -Method GET -Headers @{"X-Sync-Token" = $token} -UseBasicParsing -TimeoutSec 60
$data  = $r.Content | ConvertFrom-Json
$bytes = [System.Convert]::FromBase64String($data.db_b64)
Write-Host "  Downloaded $($bytes.Length) bytes."

# Stop local servers so Flask releases the DB file lock
Write-Host "  Stopping local servers..."
$ports = @(3030, 9999)
foreach ($port in $ports) {
    $pids = (netstat -ano | Select-String ":$port\s") -replace '.*\s(\d+)$','$1' | Select-Object -Unique
    foreach ($p in $pids) {
        $p = $p.Trim()
        if ($p -match '^\d+$') { taskkill /F /PID $p 2>$null | Out-Null }
    }
}
Start-Sleep -Seconds 2

# Backup then replace
if (Test-Path $dbPath) {
    $backup = $dbPath + ".bak"
    Copy-Item $dbPath $backup -Force
    Write-Host "  Backed up local DB to sleep_tracker.db.bak"
}

[System.IO.File]::WriteAllBytes($dbPath, $bytes)
Write-Host "  Local DB replaced successfully."

# Restart local servers
Write-Host "  Restarting local servers..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$PROJECT\start.bat`"" -WindowStyle Normal
Write-Host "  Done. Servers restarting in background."
