[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [ValidateSet('opera', 'chrome', 'edge')][string]$Browser = 'opera',
  [Parameter(Mandatory = $true)][string]$ConnectionFile,
  [string]$HostScript,
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'wAIt\native-host')
)

$ErrorActionPreference = 'Stop'
$waitConnection = (Resolve-Path -LiteralPath $ConnectionFile).Path
$waitConfig = Get-Content -Raw -LiteralPath $waitConnection | ConvertFrom-Json
if (-not $waitConfig.port -or -not $waitConfig.token) { throw 'Connection file must contain port and token. Start wAIt first.' }
if (-not $HostScript) {
  $waitSibling = Join-Path $PSScriptRoot 'native-host.cjs'
  $waitDevelopment = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\vscode\native-host.cjs'
  $HostScript = if (Test-Path -LiteralPath $waitSibling) { $waitSibling } else { $waitDevelopment }
}
$waitSource = (Resolve-Path -LiteralPath $HostScript).Path
$waitNode = (Get-Command node.exe -ErrorAction Stop).Source
foreach ($waitPath in @($waitConnection, $waitNode, $InstallDirectory)) {
  if ($waitPath -match '[%\r\n"&|<>^!]') { throw 'The native host paths contain unsupported Windows command characters.' }
}
$waitInstall = [System.IO.Path]::GetFullPath($InstallDirectory)
$waitBrowserDirectory = Join-Path $waitInstall $Browser
New-Item -ItemType Directory -Path $waitBrowserDirectory -Force | Out-Null
$waitHost = Join-Path $waitBrowserDirectory 'native-host.cjs'
Copy-Item -LiteralPath $waitSource -Destination $waitHost -Force
$waitLauncher = Join-Path $waitBrowserDirectory 'launch.cmd'
$waitLaunchText = '@echo off' + "`r`n" + '"' + $waitNode + '" "' + $waitHost + '" --connection-file "' + $waitConnection + '"' + "`r`n"
[System.IO.File]::WriteAllText($waitLauncher, $waitLaunchText, [System.Text.Encoding]::ASCII)
$waitManifest = Join-Path $waitBrowserDirectory 'com.wait.companion.json'
$waitManifestObject = @{
  name = 'com.wait.companion'
  description = 'wAIt local agent status bridge'
  path = $waitLauncher
  type = 'stdio'
  allowed_origins = @('chrome-extension://' + $ExtensionId + '/')
}
[System.IO.File]::WriteAllText($waitManifest, ($waitManifestObject | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))
$waitRegistry = if ($Browser -in @('chrome','opera')) { 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.wait.companion' } else { 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.wait.companion' }
New-Item -Path $waitRegistry -Force | Out-Null
Set-Item -LiteralPath $waitRegistry -Value $waitManifest
Write-Output "Registered wAIt for $Browser and extension $ExtensionId. Open the browser extension and choose Connect."
Write-Output 'This changes only the current user native-messaging registration. No browser or editor credentials are copied.'
