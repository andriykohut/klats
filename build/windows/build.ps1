<#
.SYNOPSIS
Builds the Windows installers dist\Klats-Setup.exe and
dist\Klats-Setup-Offline.exe.

.DESCRIPTION
Builds the web apps and klats.exe, then compiles klats.iss twice with Inno
Setup 6.3 or later. Needs Go and pnpm. It changes the current location to the
repository root, so it can be started from anywhere. The first run downloads
Microsoft's WebView2 runtime installer into dist\ for the offline installer;
every run stops unless that file carries a valid Microsoft signature.

.PARAMETER Version
The version without the leading "v", such as 1.2.3 or 0.1.0-rc.1. It is
stamped into klats.exe as main.version and shown by the installers.
#>
param([Parameter(Mandatory)][string]$Version)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

# Native programs, and .ps1 shims such as the one npm can install for pnpm,
# report failure only through $LASTEXITCODE, which $ErrorActionPreference
# does not watch.
function Invoke-Native([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE) { throw "exit code ${LASTEXITCODE}: $Command" }
}

New-Item -ItemType Directory -Force dist | Out-Null

Invoke-Native { pnpm -C web install }
Invoke-Native { pnpm -C web -r --if-present build }
Invoke-Native { go build -tags production -trimpath -ldflags "-H windowsgui -s -w -X main.version=$Version" -o dist/klats.exe ./cmd/klats }

# klats.iss bundles this file under this name into the offline installer.
$webView2 = 'dist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
if (-not (Test-Path $webView2)) {
    # A download cut short stays a .part file and is fetched again next run.
    Invoke-WebRequest 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile "$webView2.part"
    Move-Item "$webView2.part" $webView2
}
# The offline installer runs this file with admin rights on teachers' PCs.
$signature = Get-AuthenticodeSignature $webView2
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*O=Microsoft Corporation,*') {
    throw "$webView2 is not signed by Microsoft: $($signature.StatusMessage)"
}

$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { $iscc = (Get-Command ISCC).Source }
Invoke-Native { & $iscc "/DAppVersion=$Version" build\windows\klats.iss }
Invoke-Native { & $iscc "/DAppVersion=$Version" /DOffline build\windows\klats.iss }
