# Launch a local preview of Universal Beam.
# Runs the dev server in the foreground — press Ctrl-C to stop.
# Windows equivalent of preview.sh.
#
#   Usage:  .\scripts\preview.ps1 [port]     (default 5197)
#
# 5197 is this app's port in the registry (Docs_UNI_SIM/dev-preview.md).
# --strictPort means a port clash fails loudly instead of silently serving
# this app on another app's port.
# First run installs deps if node_modules is missing.
#
# NOTE — pairing needs the internet even locally. The dev server serves the UI,
# but two tabs still find each other through the rendezvous Worker at
# opensource.unisim.co.uk/rtc/room. Point that elsewhere by setting
# VITE_RENDEZVOUS_ORIGIN (e.g. a local `wrangler dev` of opensource-portal).

$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $port = if ($args.Count -ge 1) { $args[0] } else { '5197' }

    if (-not (Test-Path 'node_modules')) {
        Write-Host "Installing dependencies (first run)..." -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }

    Write-Host "Universal Beam -> http://localhost:$port" -ForegroundColor Green
    npm run dev -- --port $port --strictPort
} finally {
    Pop-Location
}
