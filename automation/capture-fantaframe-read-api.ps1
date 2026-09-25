param(
  [int]$Port = 9222,
  [int]$WaitSeconds = 8,
  [string]$OutputPath = 'D:\幻帧剧作视频与提示词\采集成果\2026-09-09_幻帧全项目分镜\_work_to_delete\1948-read-api.json'
)

$ErrorActionPreference = 'Stop'
$routes = @('/svtapi/shot/list', '/svtapi/zh/shot/video_slot/list', '/svtapi/shot/prompt/list', '/svtapi/shot/mention/list')
$all = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list"
$target = foreach ($entry in $all) {
  if ($entry.type -eq 'page' -and [string]$entry.url -like '*aico.fantaframe.com*') { $entry }
}
if (@($target).Count -ne 1) { throw "Expected one Fantaframe page target; found $(@($target).Count)" }

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ct = [System.Threading.CancellationToken]::None
$nextId = 0
$events = [System.Collections.Generic.List[object]]::new()
$eventMethods = [System.Collections.Generic.List[string]]::new()
$observedResponses = [System.Collections.Generic.List[string]]::new()

function Receive-Cdp([int]$TimeoutMs = 10000) {
  $timeout = [System.Threading.CancellationTokenSource]::new($TimeoutMs)
  try {
    $buffer = New-Object byte[] 65536
    $stream = [IO.MemoryStream]::new()
    do {
      $part = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), $timeout.Token).GetAwaiter().GetResult()
      $stream.Write($buffer, 0, $part.Count)
    } while (-not $part.EndOfMessage)
    [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
  } finally { $timeout.Dispose() }
}

function Send-Cdp([string]$Method, [hashtable]$Params) {
  $script:nextId++
  $payload = @{ id = $script:nextId; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 12
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  [void]$ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).GetAwaiter().GetResult()
  $script:nextId
}

function Wait-Cdp([int]$Id) {
  do {
    $message = Receive-Cdp
    if ($message.id -ne $Id) { $events.Add($message) }
  } while ($message.id -ne $Id)
  if ($message.error) { throw ($message.error | ConvertTo-Json -Compress) }
  $message.result
}

try {
  $ws.ConnectAsync([uri][string]$target.webSocketDebuggerUrl, $ct).GetAwaiter().GetResult()
  Wait-Cdp (Send-Cdp 'Network.enable' @{}) | Out-Null
  Wait-Cdp (Send-Cdp 'Page.reload' @{ ignoreCache = $false }) | Out-Null

  $responses = @{}
function Add-ReadResponse($message) {
  if ($message.method) { $eventMethods.Add([string]$message.method) }
  if ($message.method -ne 'Network.responseReceived') { return }
  $url = [string]$message.params.response.url
  $observedResponses.Add($url)
    if ($routes -notcontains ([uri]$url).AbsolutePath) { return }
    $responses[[string]$message.params.requestId] = [pscustomobject]@{
      requestId = [string]$message.params.requestId
      url = $url
      status = [int]$message.params.response.status
      mimeType = [string]$message.params.response.mimeType
    }
  }
  foreach ($message in $events) { Add-ReadResponse $message }
  $events.Clear()
  $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    try { $message = Receive-Cdp 700 } catch { continue }
    Add-ReadResponse $message
  }

  $items = foreach ($entry in $responses.Values) {
    $body = Wait-Cdp (Send-Cdp 'Network.getResponseBody' @{ requestId = $entry.requestId })
    [pscustomobject]@{ url = $entry.url; status = $entry.status; mimeType = $entry.mimeType; body = $body.body }
  }
  $parent = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  [pscustomobject]@{ capturedAt = [DateTime]::UtcNow.ToString('o'); items = @($items) } |
    ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputPath -Encoding utf8
  [pscustomobject]@{ output = $OutputPath; responses = @($items).Count; routes = @($items.url); eventMethods = @($eventMethods | Select-Object -Unique); observedResponses = @($observedResponses | Select-Object -Unique) } | ConvertTo-Json -Compress -Depth 8
} finally {
  $ws.Dispose()
}
