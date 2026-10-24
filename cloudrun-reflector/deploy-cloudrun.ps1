<#
.SYNOPSIS
  Deploys the scale-to-zero Google Cloud Run External Agent Reflector (Playwright Chromium + WebRTC + ML-KEM-768)
  using your Google Cloud credits.

.DESCRIPTION
  - Installs Google Cloud SDK via winget if `gcloud` is not yet on PATH
  - Authenticates and selects your GCP project
  - Enables Cloud Run & Cloud Build APIs
  - Builds and deploys `uat-agent-reflector` in `australia-southeast1` (Sydney) with `--min-instances=0` (scales to $0 when idle)
    and `--max-instances=20` (for multi-agent swarm runs).
#>

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = "australia-southeast1",
  [string]$ServiceName = "uat-agent-reflector",
  [int]$MaxInstances = 20
)

$ErrorActionPreference = "Stop"

function Resolve-Gcloud {
  $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
    "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
    "C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

$gcloud = Resolve-Gcloud
if (-not $gcloud) {
  Write-Host "[1/5] Installing Google Cloud SDK via winget..." -ForegroundColor Cyan
  winget install --id Google.CloudSDK --accept-package-agreements --accept-source-agreements
  $gcloud = Resolve-Gcloud
  if (-not $gcloud) {
    throw "gcloud installation completed, but binary was not found in standard paths. Open a new terminal and re-run."
  }
}

Write-Host "[2/5] Checking gcloud authentication..." -ForegroundColor Cyan
$activeAccount = & $gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null
if (-not $activeAccount) {
  Write-Host "No active GCP login found. Launching browser login..." -ForegroundColor Yellow
  & $gcloud auth login
}

if (-not $ProjectId) {
  $ProjectId = (& $gcloud config get-value project 2>$null).Trim()
}
if (-not $ProjectId -or $ProjectId -eq "(unset)") {
  Write-Host "Available GCP Projects:" -ForegroundColor Cyan
  & $gcloud projects list
  $ProjectId = Read-Host "Enter the GCP Project ID that has your credits"
}

& $gcloud config set project $ProjectId

Write-Host "[3/5] Enabling Cloud Run, Cloud Build, and Artifact Registry APIs on project '$ProjectId'..." -ForegroundColor Cyan
& $gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

$envVars = "CLOUD_RUN_REGION=$Region,GCP_PROJECT_ID=$ProjectId,SECRETSENDER_ORIGIN=https://secrets.bitbop.dev,BITBOP_API_BASE=https://api.bitbop.dev,VERTEX_AI_GLOBAL_BASE=https://aiplatform.googleapis.com/v1beta1/projects/$ProjectId/locations/global/publishers/google,GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta,GEMINI_OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai,HERMES_MODEL=gemini-3.8-flash,HERMES_FALLBACK_MODEL=gemini-3.5-flash-lite"
if ($env:GOOGLE_API_KEY) {
  $envVars = "$envVars,GOOGLE_API_KEY=$($env:GOOGLE_API_KEY)"
}

Write-Host "[4/5] Deploying '$ServiceName' to Google Cloud Run ($Region, IAM-locked to $activeAccount, scale-to-zero, max-instances=$MaxInstances)..." -ForegroundColor Cyan
Push-Location $PSScriptRoot
try {
  & $gcloud run deploy $ServiceName `
    --quiet `
    --source . `
    --region $Region `
    --platform managed `
    --memory 2Gi `
    --cpu 2 `
    --concurrency 10 `
    --timeout 300 `
    --min-instances 0 `
    --max-instances $MaxInstances `
    --set-env-vars $envVars `
    --no-allow-unauthenticated
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $gcloud run services remove-iam-policy-binding $ServiceName --region=$Region --member="allUsers" --role="roles/run.invoker" --quiet 2>$null | Out-Null
  } catch {}
  $ErrorActionPreference = $prevErr
  & $gcloud run services add-iam-policy-binding $ServiceName --region=$Region --member="user:$activeAccount" --role="roles/run.invoker" --quiet | Out-Null
} finally {
  Pop-Location
}

$serviceUrl = (& $gcloud run services describe $ServiceName --region $Region --format="value(status.url)").Trim()
Write-Host "`n[5/5] Deployed Google Cloud Run Reflector!" -ForegroundColor Green
Write-Host "  Service URL   : $serviceUrl"
Write-Host "  Reflector URL : $serviceUrl/reflect"
Write-Host "`nTo run the Split-Horizon S21 + GCP Multi-Agent Swarm UAT:" -ForegroundColor Yellow
Write-Host "  `$env:UAT_REFLECTOR_URL = '$serviceUrl/reflect'"
Write-Host "  npm run uat:external"
