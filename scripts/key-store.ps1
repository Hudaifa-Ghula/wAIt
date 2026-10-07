[CmdletBinding()]
param([ValidateSet('import','load')][string]$Mode,[Parameter(Mandatory=$true)][string]$StoreFile,[string]$SourceFile)
$ErrorActionPreference='Stop'
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Security')
$waitScope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser
if($Mode -eq 'import') {
  $waitPlain=[System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($SourceFile)).Trim()
  if($waitPlain -notmatch '^gsk_[A-Za-z0-9]+$') { throw 'The file does not contain a Groq API key.' }
  $waitBytes=[System.Text.Encoding]::UTF8.GetBytes($waitPlain)
  $waitProtected=[System.Security.Cryptography.ProtectedData]::Protect($waitBytes,$null,$waitScope)
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($StoreFile))) | Out-Null
  [System.IO.File]::WriteAllText($StoreFile,[Convert]::ToBase64String($waitProtected))
  [Array]::Clear($waitBytes,0,$waitBytes.Length)
  Write-Output 'Groq key saved with Windows user encryption.'
} else {
  $waitProtected=[Convert]::FromBase64String([System.IO.File]::ReadAllText($StoreFile))
  $waitBytes=[System.Security.Cryptography.ProtectedData]::Unprotect($waitProtected,$null,$waitScope)
  try { [Console]::Write([System.Text.Encoding]::UTF8.GetString($waitBytes)) }
  finally { [Array]::Clear($waitBytes,0,$waitBytes.Length) }
}
