[CmdletBinding()]
param([ValidateSet('opera', 'chrome', 'edge')][string]$Browser = 'opera')
$ErrorActionPreference = 'Stop'
$waitRegistry = if ($Browser -in @('chrome','opera')) { 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.wait.companion' } else { 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.wait.companion' }
if (Test-Path -LiteralPath $waitRegistry) { Remove-Item -LiteralPath $waitRegistry }
Write-Output "Removed wAIt's $Browser native host registration. The installed helper files are retained."
