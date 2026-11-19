[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$Archive,
 [Parameter(Mandatory=$true)][string]$KeyFile,
 [ValidateRange(1024,65535)][int]$RestorePort=8081,
 [string]$VolumeName=('aeroplan_restored_'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Invoke-AeroDocker { param([string[]]$Arguments) & docker @Arguments; if($LASTEXITCODE -ne 0){throw 'Docker command failed. The original installation was not switched.'} }
if($VolumeName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,80}$'){throw 'Invalid volume name.'}
$AeroProjectRoot=$PSScriptRoot
$AeroArchive=(Resolve-Path -LiteralPath $Archive).Path
$AeroKey=(Resolve-Path -LiteralPath $KeyFile).Path
Push-Location $AeroProjectRoot
$AeroOldPort=$env:APP_PORT
$AeroOldUrl=$env:PUBLIC_URL
$AeroOldBind=$env:BIND_ADDRESS
try {
 $AeroExisting=& docker volume ls --format '{{.Name}}'
 if($LASTEXITCODE -ne 0){throw 'Docker is unavailable.'}
 if($AeroExisting -contains $VolumeName){throw 'Select a new volume name; existing volumes will not be overwritten.'}
 Invoke-AeroDocker -Arguments @('compose','build','app')
 $AeroConfig=(& docker compose config --format json | ConvertFrom-Json)
 if($LASTEXITCODE -ne 0){throw 'Unable to resolve Compose configuration.'}
 $AeroImage=[string]$AeroConfig.services.app.image
 Invoke-AeroDocker -Arguments @('volume','create',$VolumeName)
 $AeroArchiveDir=Split-Path -Parent $AeroArchive
 $AeroArchiveName=Split-Path -Leaf $AeroArchive
 $AeroKeyDir=Split-Path -Parent $AeroKey
 $AeroKeyName=Split-Path -Leaf $AeroKey
 Invoke-AeroDocker -Arguments @('run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--volume',"${VolumeName}:/var/lib/aeroplan",'--mount',"type=bind,source=$AeroArchiveDir,target=/backup-input,readonly",'--mount',"type=bind,source=$AeroKeyDir,target=/restore-key,readonly",'--entrypoint','node',$AeroImage,'selfhost/full-backup-cli.mjs','restore','--archive',"/backup-input/$AeroArchiveName",'--key-file',"/restore-key/$AeroKeyName",'--target','/var/lib/aeroplan/installation')
 $AeroYaml=@"
services:
  app:
    environment:
      AEROPLAN_DATA_DIR: /var/lib/aeroplan/installation
    volumes:
      - type: volume
        source: restored_aeroplan
        target: /var/lib/aeroplan
volumes:
  restored_aeroplan:
    external: true
    name: "$VolumeName"
"@
 [System.IO.File]::WriteAllText((Join-Path $AeroProjectRoot 'compose.full-restore.yaml'),$AeroYaml,[System.Text.UTF8Encoding]::new($false))
 $env:APP_PORT=[string]$RestorePort
 $env:PUBLIC_URL="http://localhost:$RestorePort"
 $env:BIND_ADDRESS='127.0.0.1'
 $AeroProjectName=($VolumeName.ToLowerInvariant() -replace '[^a-z0-9_-]','-')
 Invoke-AeroDocker -Arguments @('compose','-p',$AeroProjectName,'-f','compose.yaml','-f','compose.full-restore.yaml','up','-d','--wait','app')
 $AeroRestartTemplate=@'
[CmdletBinding()]
param([switch]$Build)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$AeroSavedEnvironment=@{}
foreach($AeroName in @('APP_PORT','PUBLIC_URL','BIND_ADDRESS')){$AeroSavedEnvironment[$AeroName]=[Environment]::GetEnvironmentVariable($AeroName,'Process')}
Push-Location $PSScriptRoot
try {
 $env:APP_PORT='__PORT__'
 $env:PUBLIC_URL='http://localhost:__PORT__'
 $env:BIND_ADDRESS='127.0.0.1'
 $AeroArguments=@('compose','-p','__PROJECT__','-f','compose.yaml','-f','compose.full-restore.yaml','up','-d','--wait','app')
 if($Build){$AeroArguments+='--build'}
 & docker @AeroArguments
 if($LASTEXITCODE -ne 0){throw 'Restored installation startup failed.'}
} finally {
 foreach($AeroName in $AeroSavedEnvironment.Keys){[Environment]::SetEnvironmentVariable($AeroName,$AeroSavedEnvironment[$AeroName],'Process')}
 Pop-Location
}
'@
 $AeroRestart=$AeroRestartTemplate.Replace('__PORT__',[string]$RestorePort).Replace('__PROJECT__',$AeroProjectName)
 [System.IO.File]::WriteAllText((Join-Path $AeroProjectRoot 'Start-AeroPlan-Restored.ps1'),$AeroRestart,[System.Text.UTF8Encoding]::new($false))
 Write-Host "Isolated restored installation: http://localhost:$RestorePort"
 Write-Host 'Use the restored accounts to sign in. Previous sessions were revoked and business writes remain in maintenance mode.'
 Write-Host 'Compare company records before reopening writes. The original application and data volume remain in place.'
} finally {
 if($null -eq $AeroOldPort){Remove-Item Env:APP_PORT -ErrorAction SilentlyContinue}else{$env:APP_PORT=$AeroOldPort}
 if($null -eq $AeroOldUrl){Remove-Item Env:PUBLIC_URL -ErrorAction SilentlyContinue}else{$env:PUBLIC_URL=$AeroOldUrl}
 if($null -eq $AeroOldBind){Remove-Item Env:BIND_ADDRESS -ErrorAction SilentlyContinue}else{$env:BIND_ADDRESS=$AeroOldBind}
 Pop-Location
}
