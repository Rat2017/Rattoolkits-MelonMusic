$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null
$env:ELECTRON_RUN_AS_NODE = $null
& "$PSScriptRoot\node_modules\electron\dist\electron.exe" @args
