# Unggah installer hasil build ke GitHub Releases sebagai draft (untuk pembaruan otomatis).
# Pakai:
#   npx electron-builder --win nsis --publish never --config.directories.output=dist-release
#   $env:GH_TOKEN = "github_pat_..."   # token dengan izin Contents: Read and write
#   powershell -ExecutionPolicy Bypass -File scripts\upload-release.ps1
# Lalu buka halaman Releases dan tekan Publish release.

$ErrorActionPreference = 'Stop'
if (-not $env:GH_TOKEN) { throw 'Isi dulu $env:GH_TOKEN dengan token GitHub.' }

$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$tag = "v$version"
$dir = Join-Path $root 'dist-release'
$files = @('latest.yml', "Zenopod-Setup-$version.exe.blockmap", "Zenopod-Setup-$version.exe")
foreach ($name in $files) {
    if (-not (Test-Path (Join-Path $dir $name))) { throw "File $name tidak ada di dist-release. Build dulu." }
}

$h = @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json' }
$api = 'https://api.github.com/repos/ardianramadhan/Zenopod/releases'

# PowerShell 5.1 mengembalikan array JSON sebagai satu objek: urai per elemen.
$matching = @((Invoke-RestMethod -Uri $api -Headers $h) | ForEach-Object { $_ } | Where-Object { $_.tag_name -eq $tag })
if ($matching.Count -gt 1) { throw "Ada $($matching.Count) rilis $tag. Rapikan di GitHub dulu." }
$release = $matching | Select-Object -First 1
if ($release -and -not $release.draft) { throw "Rilis $tag sudah dipublikasikan, tidak diubah." }
if (-not $release) {
    $body = @{ tag_name = $tag; name = $version; draft = $true; target_commitish = 'main' } | ConvertTo-Json
    $release = Invoke-RestMethod -Method Post -Uri $api -Headers $h -ContentType 'application/json' -Body $body
    "Draft $tag dibuat."
}

$upload = $release.upload_url -replace '\{.*\}', ''
$assets = @($release.assets | ForEach-Object { $_ })
foreach ($name in $files) {
    $existing = $assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($existing -and $existing.state -eq 'uploaded') { "Sudah ada: $name"; continue }
    if ($existing) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/ardianramadhan/Zenopod/releases/assets/$($existing.id)" -Headers $h | Out-Null }
    "Mengunggah $name..."
    Invoke-RestMethod -Method Post -Uri "$upload`?name=$name" -Headers $h -ContentType 'application/octet-stream' -InFile (Join-Path $dir $name) -TimeoutSec 1200 | Out-Null
}

$final = Invoke-RestMethod -Uri "$api/$($release.id)" -Headers $h
"Selesai. Buka https://github.com/ardianramadhan/Zenopod/releases lalu Publish release $tag."
foreach ($a in @($final.assets | ForEach-Object { $_ })) { "  $($a.name) $([math]::Round($a.size / 1MB, 1)) MB" }
