[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Domain)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$AeroDomain=$Domain.Trim().ToLowerInvariant()
if($AeroDomain -notmatch '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'){throw 'Enter a DNS hostname without scheme, path, or port.'}
Push-Location $PSScriptRoot
try {
 $AeroConfig=(& docker compose -f compose.yaml config --format json | ConvertFrom-Json)
 if($LASTEXITCODE -ne 0){throw 'Unable to resolve Compose configuration.'}
 $AeroVolumeName=[string]$AeroConfig.volumes.aeroplan_data.name
 $AeroImage=[string]$AeroConfig.services.app.image
 $AeroProjectName=[string]$AeroConfig.name
 if($AeroVolumeName -notmatch '^[a-zA-Z0-9_.-]+$' -or $AeroProjectName -notmatch '^[a-zA-Z0-9_.-]+$' -or $AeroImage -notmatch '^[a-zA-Z0-9_./:@-]+$'){throw 'Unexpected Compose identity.'}
 $AeroYaml=@"
name: $AeroProjectName
services:
  app:
    build:
      context: .
      target: runtime
    image: $AeroImage
    restart: unless-stopped
    init: true
    environment:
      PUBLIC_URL: https://$AeroDomain
      AEROPLAN_DATA_DIR: /var/lib/aeroplan
      AEROPLAN_REQUEST_LOG: 'true'
    expose:
      - '3000'
    volumes:
      - aeroplan_data:/var/lib/aeroplan
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    stop_grace_period: 60s
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '5'
  proxy:
    image: caddy:2
    restart: unless-stopped
    environment:
      AEROPLAN_DOMAIN: $AeroDomain
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./selfhost/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      app:
        condition: service_healthy
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges:true
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'
volumes:
  aeroplan_data:
    external: true
    name: $AeroVolumeName
  caddy_data:
  caddy_config:
"@
 [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'compose.production.yaml'),$AeroYaml,[System.Text.UTF8Encoding]::new($false))
 & (Join-Path $PSScriptRoot 'Start-AeroPlan.ps1') -Build
 Write-Host "Configured HTTPS origin: https://$AeroDomain"
 Write-Host 'Verify DNS, inbound ports 80/443, certificate issuance, sign-in, and POST forms from the actual browser.'
 Write-Host 'Caddy needs outbound access for certificate issuance. Preserve its data volume for renewals.'
} finally {Pop-Location}
