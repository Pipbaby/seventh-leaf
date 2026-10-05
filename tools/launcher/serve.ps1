# Seventh Leaf's launcher for Windows (started by "Start Seventh Leaf.bat"). A small web server
# for this folder, reachable only from this computer (127.0.0.1), on a fixed port so the browser
# finds its saved library again. Windows PowerShell 5.1 is enough: no Python, no admin rights.
#
# Every copy answers GET /__seventh-leaf with its version and folder. Before starting, the
# launcher asks the ports in turn: the same copy already running is simply opened again; another
# copy (an older version, or another folder) is stopped and replaced; a port held by another
# program is skipped. Keep this file ASCII: Windows PowerShell reads it in the system code page.
param([switch]$NoBrowser, [int]$Port = 0)

$ErrorActionPreference = 'Stop'
$Ports = 41777..41786
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Version = '?'
try {
  $m = Select-String -Path (Join-Path $Root 'CHANGELOG.md') -Pattern '^## (\d+\.\d+\.\d+)' | Select-Object -First 1
  if ($m) { $Version = $m.Matches[0].Groups[1].Value }
} catch {}
if ($Port) { $Ports = @($Port) }
$Host.UI.RawUI.WindowTitle = "Seventh Leaf $Version"

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

# one plain HTTP request to 127.0.0.1 (no proxy settings involved); $null if nothing answers
function Ask([int]$port, [string]$method, [string]$path, [string]$extra = '') {
  $c = New-Object Net.Sockets.TcpClient
  try {
    $wait = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $wait.AsyncWaitHandle.WaitOne(1500)) { return $null }
    $c.EndConnect($wait)
    $c.ReceiveTimeout = 3000
    $s = $c.GetStream()
    $req = [Text.Encoding]::ASCII.GetBytes("$method $path HTTP/1.1`r`nHost: 127.0.0.1:$port`r`n$extra" + "Content-Length: 0`r`nConnection: close`r`n`r`n")
    $s.Write($req, 0, $req.Length)
    $buf = New-Object byte[] 65536
    $ms = New-Object IO.MemoryStream
    while (($n = $s.Read($buf, 0, $buf.Length)) -gt 0) { $ms.Write($buf, 0, $n) }
    return [Text.Encoding]::UTF8.GetString($ms.ToArray())
  } catch { return $null } finally { $c.Close() }
}

# what is on a port: 'free', 'other' (another program), or a Seventh Leaf copy's details
function Probe([int]$port) {
  $r = Ask $port 'GET' '/__seventh-leaf'
  if ($null -eq $r) { return 'free' }
  $body = ($r -split "`r`n`r`n", 2)[1]
  try {
    $info = $body | ConvertFrom-Json
    if ($info.app -eq 'seventh-leaf') { return $info }
  } catch {}
  return 'other'
}

function Open-Browser([int]$port) {
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$port/" }
}

$Types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.md' = 'text/markdown; charset=utf-8'
  '.txt' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.avif' = 'image/avif'; '.bmp' = 'image/bmp'
  '.ico' = 'image/x-icon'; '.mp4' = 'video/mp4'; '.m4v' = 'video/mp4'; '.webm' = 'video/webm'; '.mov' = 'video/quicktime'
  '.mp3' = 'audio/mpeg'; '.m4a' = 'audio/mp4'; '.aac' = 'audio/aac'; '.flac' = 'audio/flac'; '.ogg' = 'audio/ogg'
  '.opus' = 'audio/ogg'; '.wav' = 'audio/wav'; '.wasm' = 'application/wasm'; '.woff2' = 'font/woff2'
}

function Send($s, [int]$code, [string]$reason, $headers, [byte[]]$body) {
  $head = "HTTP/1.1 $code $reason`r`nConnection: close`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`n"
  foreach ($k in $headers.Keys) { $head += "${k}: $($headers[$k])`r`n" }
  if ($null -ne $body) { $head += "Content-Length: $($body.Length)`r`n" }
  $b = [Text.Encoding]::ASCII.GetBytes($head + "`r`n")
  $s.Write($b, 0, $b.Length)
  if ($null -ne $body -and $body.Length) { $s.Write($body, 0, $body.Length) }
}
function Text($s, [int]$code, [string]$reason, [string]$text, [string]$type = 'text/plain; charset=utf-8') {
  Send $s $code $reason @{ 'Content-Type' = $type } ([Text.Encoding]::UTF8.GetBytes($text))
}

# one request per connection; returns $true when asked to stop
function Handle($client, [int]$port) {
  $client.ReceiveTimeout = 5000
  $client.SendTimeout = 30000
  $s = $client.GetStream()
  $buf = New-Object byte[] 16384
  $got = 0
  while ($got -lt $buf.Length) {
    $n = $s.Read($buf, $got, $buf.Length - $got)
    if ($n -le 0) { return $false }
    $got += $n
    if ([Text.Encoding]::ASCII.GetString($buf, 0, $got).Contains("`r`n`r`n")) { break }
  }
  $lines = ([Text.Encoding]::ASCII.GetString($buf, 0, $got) -split "`r`n`r`n", 2)[0] -split "`r`n"
  $first = $lines[0] -split ' '
  if ($first.Count -lt 2) { return $false }
  $method = $first[0]
  $target = $first[1]
  $h = @{}
  foreach ($l in ($lines | Select-Object -Skip 1)) {
    $i = $l.IndexOf(':')
    if ($i -gt 0) { $h[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() }
  }
  # only requests addressed to this server, so another web page cannot reach it under a borrowed name
  if (@("127.0.0.1:$port", "localhost:$port") -notcontains $h['host']) {
    Text $s 421 'Misdirected Request' 'Not for this server'
    return $false
  }
  $path = [Uri]::UnescapeDataString(($target -split '\?', 2)[0])

  if ($path -eq '/__seventh-leaf') {
    $info = @{ app = 'seventh-leaf'; version = $Version; root = $Root; pid = $PID } | ConvertTo-Json -Compress
    Text $s 200 'OK' $info 'application/json; charset=utf-8'
    return $false
  }
  if ($path -eq '/__seventh-leaf/quit') {
    # a web page cannot send this header without asking first (CORS), and this server never agrees
    if ($method -eq 'POST' -and $h['x-seventh-leaf'] -eq 'quit') {
      Text $s 200 'OK' 'stopping'
      return $true
    }
    Text $s 403 'Forbidden' 'No'
    return $false
  }
  if ($method -ne 'GET' -and $method -ne 'HEAD') {
    Text $s 405 'Method Not Allowed' 'GET only'
    return $false
  }

  $rel = $path.TrimStart('/') -replace '/', '\'
  if ($rel) { $file = [IO.Path]::GetFullPath((Join-Path $Root $rel)) } else { $file = $Root }
  if (-not ($file + '\').StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    Text $s 403 'Forbidden' 'Outside the project folder'
    return $false
  }
  if (Test-Path -LiteralPath $file -PathType Container) { $file = Join-Path $file 'index.html' }
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    Text $s 404 'Not Found' 'Not found'
    return $false
  }
  $ext = [IO.Path]::GetExtension($file).ToLower()
  $type = $Types[$ext]
  if (-not $type) { $type = 'application/octet-stream' }
  $fs = [IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
  try {
    $size = $fs.Length
    $from = 0
    $count = $size
    $code = 200
    $reason = 'OK'
    $headers = @{ 'Content-Type' = $type; 'Accept-Ranges' = 'bytes' }
    # ranges let videos and music seek; open-ended ones are served in parts of at most 8 MB, so a
    # long video never holds up the pictures behind it (this server answers one request at a time)
    if ($h['range'] -match '^bytes=(\d*)-(\d*)$') {
      if ($Matches[1] -ne '') {
        $from = [int64]$Matches[1]
        if ($Matches[2] -ne '') { $to = [Math]::Min([int64]$Matches[2], $size - 1) } else { $to = [Math]::Min($size - 1, $from + 8MB - 1) }
      } else {
        $from = [Math]::Max(0, $size - [int64]$Matches[2])
        $to = $size - 1
      }
      if ($from -ge $size -or $to -lt $from) {
        Send $s 416 'Range Not Satisfiable' @{ 'Content-Range' = "bytes */$size" } ([byte[]]@())
        return $false
      }
      $count = $to - $from + 1
      $code = 206
      $reason = 'Partial Content'
      $headers['Content-Range'] = "bytes $from-$to/$size"
    }
    $headers['Content-Length'] = $count
    Send $s $code $reason $headers $null
    if ($method -eq 'GET') {
      [void]$fs.Seek($from, 'Begin')
      $chunk = New-Object byte[] 262144
      $left = $count
      while ($left -gt 0) {
        $n = $fs.Read($chunk, 0, [int][Math]::Min($chunk.Length, $left))
        if ($n -le 0) { break }
        $s.Write($chunk, 0, $n)
        $left -= $n
      }
    }
  } finally { $fs.Close() }
  return $false
}

# --- find a port: reuse, replace or skip what is already there ---
Say ''
Say "  Seventh Leaf $Version" 'White'
Say "  $Root"
Say ''
$listener = $null
$usePort = 0
$skipped = @()
foreach ($p in $Ports) {
  $there = Probe $p
  if ($there -is [string] -and $there -eq 'other') {
    $skipped += $p
    continue
  }
  if ($there -isnot [string]) {
    if ($there.version -eq $Version -and $there.root -eq $Root) {
      Say "  Seventh Leaf is already running at http://127.0.0.1:$p/ - opening it." 'Green'
      Open-Browser $p
      Start-Sleep -Seconds 3
      exit 0
    }
    Say "  Another copy is running on this address: version $($there.version) from" 'Yellow'
    Say "    $($there.root)" 'Yellow'
    Say '  It is being stopped and replaced by this one.' 'Yellow'
    Say ''
    [void](Ask $p 'POST' '/__seventh-leaf/quit' "X-Seventh-Leaf: quit`r`n")
    for ($i = 0; $i -lt 50 -and (Probe $p) -isnot [string]; $i++) { Start-Sleep -Milliseconds 100 }
  }
  try {
    $l = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, $p)
    $l.ExclusiveAddressUse = $true
    $l.Start()
    $listener = $l
    $usePort = $p
    break
  } catch {
    $skipped += $p # in use or reserved by Windows
  }
}
if (-not $listener) {
  Say "  Could not start: ports $($Ports[0])-$($Ports[-1]) are all in use by other programs." 'Red'
  Say '  Close some programs, or restart the computer, and try again.' 'Red'
  exit 1
}
if ($skipped.Count) {
  Say "  Port $($skipped -join ', ') is used by another program, so Seventh Leaf uses $usePort." 'Yellow'
  Say '  Pictures, settings and folders are remembered per address: at this one the library' 'Yellow'
  Say "  starts empty, and comes back once port $($Ports[0]) is free again." 'Yellow'
  Say ''
}
Say "  Running at http://127.0.0.1:$usePort/" 'Green'
Say '  Only this computer can reach it. Close this window to stop Seventh Leaf.'
Say ''
Open-Browser $usePort

try {
  $stop = $false
  while (-not $stop) {
    # wait in short steps, so closing the window or Ctrl+C stops it at once
    while (-not $listener.Pending()) { Start-Sleep -Milliseconds 10 }
    $client = $listener.AcceptTcpClient()
    try { $stop = Handle $client $usePort } catch {} finally { $client.Close() }
  }
  Say '  Stopped: another copy of Seventh Leaf was started and took over this address.' 'Yellow'
} finally {
  $listener.Stop()
}
