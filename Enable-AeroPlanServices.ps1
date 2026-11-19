[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ConnectionsFile)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$AeroConnectionPath=(Resolve-Path -LiteralPath $ConnectionsFile).Path
$AeroConnectionObject=Get-Content -Raw -LiteralPath $AeroConnectionPath | ConvertFrom-Json
if($null -eq $AeroConnectionObject){throw 'Invalid connections JSON.'}
$AeroConnectionYaml=($AeroConnectionPath | ConvertTo-Json -Compress)
$AeroYaml=@"
services:
  app:
    environment:
      AEROPLAN_CONNECTIONS_FILE: /run/secrets/aeroplan_connections
    secrets:
      - aeroplan_connections
secrets:
  aeroplan_connections:
    file: $AeroConnectionYaml
"@
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'compose.services.yaml'),$AeroYaml,[System.Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot 'Start-AeroPlan.ps1') -Build -Recreate
Write-Host 'Review connection status in Integrations and Operations Monitoring. Scheduling remains controlled by the owner.'
