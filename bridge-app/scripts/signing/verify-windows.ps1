param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$signature = Get-AuthenticodeSignature -LiteralPath $File
@{
  status = [string]$signature.Status
  subject = [string]$signature.SignerCertificate.Subject
  thumbprint = [string]$signature.SignerCertificate.Thumbprint
  timestamped = ($null -ne $signature.TimeStamperCertificate)
} | ConvertTo-Json -Compress
if ($signature.Status -ne 'Valid' -or $null -eq $signature.TimeStamperCertificate) { exit 1 }
