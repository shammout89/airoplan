[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$BackupPath,
 [ValidateSet('off_host','external_disk','local_only')][string]$DestinationClass='off_host',
 [ValidateRange(1,168)][int]$IntervalHours=24,
 [ValidateRange(2,365)][int]$KeepLast=30
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Invoke-AeroDocker { param([string[]]$Arguments) & docker @Arguments; if($LASTEXITCODE -ne 0){throw 'Docker command failed. No successful backup is being asserted.'} }
$AeroProjectRoot=$PSScriptRoot
Push-Location $AeroProjectRoot
try {
 if(-not(Test-Path -LiteralPath (Join-Path $AeroProjectRoot 'compose.yaml'))){throw 'Run this script from the extracted AeroPlan project.'}
 New-Item -ItemType Directory -Force -Path $BackupPath | Out-Null
 $AeroBackupRoot=(Resolve-Path -LiteralPath $BackupPath).Path
 if($AeroBackupRoot.StartsWith((Join-Path $AeroProjectRoot 'data'),[System.StringComparison]::OrdinalIgnoreCase)){throw 'Choose a destination outside the application data directory.'}
 Invoke-AeroDocker -Arguments @('compose','build','app')
 $AeroConfig=(& docker compose config --format json | ConvertFrom-Json)
 if($LASTEXITCODE -ne 0){throw 'Unable to resolve Compose configuration.'}
 $AeroImage=[string]$AeroConfig.services.app.image
 Invoke-AeroDocker -Arguments @('run','--rm','--mount',"type=bind,source=$AeroProjectRoot,target=/bootstrap",'--entrypoint','node',$AeroImage,'selfhost/full-backup-cli.mjs','init-key','--key-file','/bootstrap/secrets/backup.key')
 $AeroMarkerOutput=& docker run --rm --mount "type=bind,source=$AeroBackupRoot,target=/backup" --entrypoint node $AeroImage selfhost/full-backup-cli.mjs init-destination --destination /backup
 if($LASTEXITCODE -ne 0){throw 'The external destination could not be initialized.'}
 $AeroMarker=($AeroMarkerOutput | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1 | ConvertFrom-Json)
 if([string]$AeroMarker.id -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid destination marker.'}
 $AeroPolicy=@{enabled=$true;intervalHours=$IntervalHours;keepLast=$KeepLast;destinationClass=$DestinationClass;destinationConfirmed=$true;label='Operator configured backup destination'}
 [System.IO.File]::WriteAllText((Join-Path $AeroProjectRoot 'backup-policy.json'),($AeroPolicy | ConvertTo-Json -Compress),[System.Text.UTF8Encoding]::new($false))
 Invoke-AeroDocker -Arguments @('compose','run','--rm','--no-deps','--mount',"type=bind,source=$AeroProjectRoot,target=/bootstrap,readonly",'--entrypoint','node','app','selfhost/full-backup-cli.mjs','configure','--policy','/bootstrap/backup-policy.json')
 $AeroYamlPath=($AeroBackupRoot | ConvertTo-Json -Compress)
 $AeroYaml=@"
services:
  app:
    environment:
      FULL_BACKUP_DESTINATION: /var/backups/aeroplan
      FULL_BACKUP_DESTINATION_ID: "$($AeroMarker.id)"
      FULL_BACKUP_KEY_FILE: /run/secrets/aeroplan_backup_key
    volumes:
      - type: bind
        source: $AeroYamlPath
        target: /var/backups/aeroplan
    secrets:
      - aeroplan_backup_key
secrets:
  aeroplan_backup_key:
    file: ./secrets/backup.key
"@
 [System.IO.File]::WriteAllText((Join-Path $AeroProjectRoot 'compose.backup.yaml'),$AeroYaml,[System.Text.UTF8Encoding]::new($false))
 & (Join-Path $AeroProjectRoot 'Start-AeroPlan.ps1') -Recreate
 Write-Host 'Backup scheduling configured. Review the first verified run under Backup and Recovery.'
 Write-Host 'Keep secrets/backup.key in a separate secure location. The key value was not printed.'
 Write-Host 'Use Start-AeroPlan.ps1 for subsequent starts so all configured Compose files remain active.'
} finally { Pop-Location }
