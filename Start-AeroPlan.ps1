[CmdletBinding()]
param([switch]$Build,[switch]$Recreate)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
 $AeroFiles=@('-f','compose.yaml')
 if(Test-Path -LiteralPath './compose.production.yaml'){$AeroFiles=@('-f','compose.production.yaml')}
 foreach($AeroOptional in @('compose.backup.yaml','compose.services.yaml')){if(Test-Path -LiteralPath $AeroOptional){$AeroFiles+=@('-f',$AeroOptional)}}
 $AeroArgs=@('compose')+$AeroFiles+@('up','-d','--wait')
 if($Build){$AeroArgs+='--build'}
 if($Recreate){$AeroArgs+='--force-recreate'}
 & docker @AeroArgs
 if($LASTEXITCODE -ne 0){throw 'AeroPlan startup failed; inspect Docker logs.'}
} finally {Pop-Location}
