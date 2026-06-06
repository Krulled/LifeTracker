$PROJECT    = Split-Path -Parent $MyInvocation.MyCommand.Path
$dbPath     = Join-Path $PROJECT "backend\sleep_tracker.db"
$tokenFile  = Join-Path $PROJECT ".sync_token"
$url        = "https://life-tracker-zach.fly.dev/api/sync/push-db"

if (-not (Test-Path $dbPath))    { Write-Host "[ERROR] DB not found: $dbPath"; exit 1 }
if (-not (Test-Path $tokenFile)) { Write-Host "[ERROR] Token file not found: $tokenFile"; exit 1 }

$token  = (Get-Content $tokenFile -Raw).Trim()
$stream = [System.IO.File]::Open($dbPath, 'Open', 'Read', 'ReadWrite')
$bytes  = New-Object byte[] $stream.Length
$stream.Read($bytes, 0, $stream.Length) | Out-Null
$stream.Close()

$b64  = [System.Convert]::ToBase64String($bytes)
$body = '{"db_b64":"' + $b64 + '"}'

Write-Host "  Uploading $($bytes.Length) bytes to cloud..."
$r = Invoke-WebRequest -Uri $url -Method POST -Body $body -ContentType "application/json" -Headers @{"X-Sync-Token" = $token} -UseBasicParsing -TimeoutSec 60
$result = $r.Content | ConvertFrom-Json
Write-Host "  Done - $($result.bytes) bytes written to cloud DB."
