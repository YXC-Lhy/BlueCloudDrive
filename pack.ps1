# 一键打包出可直接上传到 Cloudflare Pages 的 zip
# 用法：右键本文件 → 使用 PowerShell 运行；或在终端执行  powershell -File .\pack.ps1
# 说明：本文件需保存为「UTF-8 带 BOM」，否则 Windows PowerShell 5.1 会把中文读成乱码。
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$out = Join-Path $root 'BlueCloudDrive.zip'

# 需要打进包里的内容（zip 根目录必须能直接看到 _worker.js）
$items = @('_worker.js', 'index.html', 'admin.html', 'files.html', 'share.html', '404.html', 'css', 'js', 'img')

$staging = Join-Path $root '_packtmp'
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach ($item in $items) {
        $src = Join-Path $root $item
        if (-not (Test-Path $src)) { throw "缺少必要文件或目录：$item" }
        Copy-Item -Recurse -Force $src $staging
    }

    if (Test-Path $out) { Remove-Item -Force $out }

    # 手动写 zip：条目名统一用 "/" 分隔
    # （Compress-Archive 在 Windows PowerShell 下会写成 "\"，某些云端解压会当成文件名的一部分）
    Add-Type -AssemblyName System.IO.Compression | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    $zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -Path $staging -Recurse -File | Sort-Object FullName
        foreach ($file in $files) {
            $rel = $file.FullName.Substring($staging.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $file.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally {
        $zip.Dispose()
    }

    if (-not (Test-Path $out)) { throw '压缩失败，未生成 zip 文件' }
    $size = [math]::Round((Get-Item $out).Length / 1KB, 1)
    Write-Host ""
    Write-Host "打包完成：$out（$($files.Count) 个文件，$size KB）" -ForegroundColor Green
    Write-Host "接下来：Cloudflare 控制台 → Workers 和 Pages → 创建 → Pages → 上传资产 → 选择该 zip"
    Write-Host "别忘了给项目添加 D1 数据库绑定，变量名必须是 DB，然后重新部署一次。"
}
finally {
    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
}
