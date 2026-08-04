[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$Changed = 'no'

function Stop-Install {
    param(
        [Parameter(Mandatory = $true)][string]$WhatHappened,
        [string]$WhatChanged = 'nothing',
        [string]$NextAction = "Fix the item above, then run '.\install.ps1' again from this folder."
    )
    Write-Host 'Agent Kickstart could not be initialized.'
    Write-Host "What happened: $WhatHappened"
    Write-Host "What changed: $WhatChanged"
    Write-Host "Safest next action: $NextAction"
    exit 1
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Stop-Install -WhatHappened 'Claude Code is not available in your command path.' `
        -NextAction "Install or repair Claude Code, confirm 'claude --version' works, then run this installer again."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-Install -WhatHappened 'Node.js is required by this version-zero state engine but was not found.' `
        -NextAction 'Install Node.js 18 or newer, then run this installer again.'
}

$NodeMajor = [int](& node -p 'Number(process.versions.node.split(".")[0])')
if ($NodeMajor -lt 18) {
    Stop-Install -WhatHappened "Node.js 18 or newer is required; this computer has $(& node --version)." `
        -NextAction 'Update Node.js, then run this installer again.'
}

$Required = @(
    '.claude\commands\kickstart.md',
    '.claude\commands\leave-kickstart.md',
    '.claude\settings.json',
    'agent-kickstart\RUNTIME.md',
    'agent-kickstart\SAFETY.md',
    'agent-kickstart\bin\kickstart-state.mjs'
)

foreach ($Relative in $Required) {
    $Candidate = Join-Path $Root $Relative
    if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
        Stop-Install -WhatHappened "A required repository file is missing: $Relative" `
            -WhatChanged $Changed `
            -NextAction 'Download a fresh copy of the repository; do not create a guessed replacement file.'
    }
}

$SettingsPath = Join-Path $Root '.claude\settings.json'
try {
    $null = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Stop-Install -WhatHappened '.claude\settings.json is not valid JSON.' `
        -WhatChanged $Changed `
        -NextAction 'Restore the repository copy of .claude\settings.json, then retry.'
}

Push-Location $Root
try {
    $InitOutput = & node 'agent-kickstart\bin\kickstart-state.mjs' init 2>&1
    if ($LASTEXITCODE -ne 0) {
        Stop-Install -WhatHappened ($InitOutput -join [Environment]::NewLine) -WhatChanged $Changed
    }
    if (($InitOutput -join [Environment]::NewLine) -match '"changed": true') {
        $Changed = 'only missing project-local state files were created'
    }

    $DoctorOutput = & node 'agent-kickstart\bin\kickstart-state.mjs' doctor 2>&1
    if ($LASTEXITCODE -ne 0) {
        Stop-Install -WhatHappened ($DoctorOutput -join [Environment]::NewLine) -WhatChanged $Changed
    }
} finally {
    Pop-Location
}

$StartLine = "Set-Location -LiteralPath '$Root'; claude '/kickstart'"

Write-Host 'Agent Kickstart installation succeeded.'
Write-Host "What changed: $Changed."
Write-Host 'Nothing was written to global Claude Code settings or outside this repository.'
Write-Host "Open this exact folder: $Root"
Write-Host 'Claude Code must be closed and reopened once so the new project command and safety settings load — part of installation, not an error.'
Write-Host ''
Write-Host '──────────────── COPY THIS ONE LINE ────────────────'
Write-Host $StartLine
Write-Host '────────────────────────────────────────────────────'
Write-Host ''
Write-Host 'If you are inside Claude Code right now, type: /exit — then paste the line into PowerShell and Kickstart begins.'
Write-Host 'The same line works any time you want to come back — you never need to remember a command.'
Write-Host 'If a workspace trust screen appears, confirm it shows this exact folder, review the project permissions, and choose: Yes, I trust this folder.'
Write-Host 'If /kickstart is not recognized, paste the same line again; if it still fails, ask Claude to verify .claude/commands/kickstart.md in this folder and repair only this project-local installation.'

try {
    Set-Clipboard -Value $StartLine -ErrorAction Stop
    Write-Host '(Already copied to your clipboard — just paste.)'
} catch {
    # Clipboard is a convenience only; never fail installation over it.
}
