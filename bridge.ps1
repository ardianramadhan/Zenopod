# Helper Windows untuk Zenopod (Windows PowerShell 5.1).
# - Musik: membaca sesi media Windows (Spotify, Chrome, dll).
# - Notifikasi: membaca notifikasi semua aplikasi lewat UserNotificationListener
#   (Pengaturan > Privasi > Notifikasi > izinkan aplikasi desktop).
# Menulis satu baris JSON per perubahan: {type: media|notifications|icon, ...}.
# Perintah dari stdin: toggle | next | prev | refresh | dismiss <id> | clear | speak | quick | ocr <id> <file>.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

function Send($object) {
    Write-Output ($object | ConvertTo-Json -Compress -Depth 5)
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]

function Read-Image($reference) {
    if (-not $reference) { return $null }
    try {
        $stream = Await ($reference.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
        $mem = New-Object System.IO.MemoryStream
        $net.CopyTo($mem)
        $type = if ($stream.ContentType) { $stream.ContentType } else { 'image/png' }
        $data = "data:$type;base64," + [Convert]::ToBase64String($mem.ToArray())
        $net.Dispose(); $mem.Dispose()
        return $data
    } catch { return $null }
}

# ---------- Musik ----------

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$lastKey = $null
$lastArt = $null
$artTries = 0

function Emit-Media([bool]$force) {
    $session = $manager.GetCurrentSession()
    if (-not $session) {
        if ($force -or $script:lastKey -ne 'none') {
            $script:lastKey = 'none'
            Send @{ type = 'media'; playing = $false; title = $null }
        }
        return
    }

    $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
    $trackKey = "$($session.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
    $key = "$trackKey|$status"
    $sameTrack = $script:lastKey -and $script:lastKey.StartsWith($trackKey + '|')

    # Sampul kadang baru tersedia beberapa detik setelah lagu berganti: coba lagi beberapa kali.
    $retryArt = $sameTrack -and -not $script:lastArt -and $script:artTries -lt 6
    if (-not $force -and $key -eq $script:lastKey -and -not $retryArt) { return }

    if (-not $sameTrack -or $force -or $retryArt) {
        $script:artTries = if ($sameTrack) { $script:artTries + 1 } else { 0 }
        $script:lastArt = Read-Image $props.Thumbnail
        if ($retryArt -and -not $force -and $key -eq $script:lastKey -and -not $script:lastArt) { return }
    }
    $script:lastKey = $key

    Send @{
        type    = 'media'
        app     = $session.SourceAppUserModelId
        title   = $props.Title
        artist  = $props.Artist
        playing = ($status -eq 'Playing')
        status  = $status
        art     = $script:lastArt
    }
}

# ---------- Notifikasi ----------

$listener = $null
try {
    $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
    $access = Await ($listener.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
    if ($access.ToString() -ne 'Allowed') {
        Send @{ type = 'notifications'; access = $access.ToString(); items = @() }
        $listener = $null
    }
} catch {
    $listener = $null
}

$lastIds = $null
$sentIcons = @{}

function Emit-Notifications([bool]$force) {
    if (-not $listener) { return }
    $list = Await ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) `
        ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])

    $ids = ($list | ForEach-Object { $_.Id }) -join ','
    if (-not $force -and $ids -eq $script:lastIds) { return }
    $script:lastIds = $ids

    $items = @()
    foreach ($n in ($list | Select-Object -Last 30)) {
        $app = $n.AppInfo
        $appId = $app.AppUserModelId
        if ($appId -and -not $script:sentIcons.ContainsKey($appId)) {
            $script:sentIcons[$appId] = $true
            $icon = Read-Image ($app.DisplayInfo.GetLogo([Windows.Foundation.Size]::new(64, 64)))
            if ($icon) { Send @{ type = 'icon'; app = $appId; data = $icon } }
        }

        $texts = @()
        $binding = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
        if ($binding) { $texts = @($binding.GetTextElements() | ForEach-Object { $_.Text }) }

        $items += @{
            id      = $n.Id
            app     = $appId
            appName = $app.DisplayInfo.DisplayName
            title   = if ($texts.Count -gt 0) { $texts[0] } else { '' }
            body    = if ($texts.Count -gt 1) { ($texts[1..($texts.Count - 1)] -join "`n") } else { '' }
            time    = $n.CreationTime.ToUnixTimeMilliseconds()
        }
    }

    Send @{ type = 'notifications'; access = 'Allowed'; items = $items }
}

# ---------- Kontrol cepat: volume, kecerahan, Wi-Fi, Bluetooth ----------

try {
    Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class ZenoAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out epv));
    return epv;
  }
  public static float Volume { get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; } set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); } }
  public static bool Mute { get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; } set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); } }
}
"@
} catch { }

[void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
$radioAccess = $false
try {
    $radioAccess = (Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])).ToString() -eq 'Allowed'
} catch { }

function Get-Radios {
    if (-not $radioAccess) { return @() }
    return @(Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]))
}

$lastQuick = $null

function Emit-Quick([bool]$force) {
    $state = @{ type = 'quick'; volume = $null; muted = $null; brightness = $null; wifi = $null; bluetooth = $null }
    try { $state.volume = [int][math]::Round([ZenoAudio]::Volume * 100); $state.muted = [ZenoAudio]::Mute } catch { }
    try { $state.brightness = [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { }
    try {
        foreach ($r in (Get-Radios)) {
            if ($r.Kind.ToString() -eq 'WiFi') { $state.wifi = $r.State.ToString() }
            if ($r.Kind.ToString() -eq 'Bluetooth') { $state.bluetooth = $r.State.ToString() }
        }
    } catch { }
    $key = "$($state.volume)|$($state.muted)|$($state.brightness)|$($state.wifi)|$($state.bluetooth)"
    if (-not $force -and $key -eq $script:lastQuick) { return }
    $script:lastQuick = $key
    Send $state
}

function Set-Quick($what, $value) {
    switch ($what) {
        'volume' { [ZenoAudio]::Volume = [math]::Max(0, [math]::Min(100, [double]$value)) / 100; if ([ZenoAudio]::Mute) { [ZenoAudio]::Mute = $false } }
        'mute' { [ZenoAudio]::Mute = if ($value -eq 'toggle') { -not [ZenoAudio]::Mute } else { $value -eq '1' } }
        'brightness' {
            $level = [int][math]::Max(0, [math]::Min(100, [double]$value))
            Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$level } | Out-Null
        }
        { $_ -eq 'wifi' -or $_ -eq 'bluetooth' } {
            $kind = if ($what -eq 'wifi') { 'WiFi' } else { 'Bluetooth' }
            $target = if ($value -eq 'on') { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
            foreach ($r in (Get-Radios)) {
                if ($r.Kind.ToString() -eq $kind) { Await ($r.SetStateAsync($target)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null }
            }
        }
    }
}

# ---------- Ambil teks dari layar (OCR bawaan Windows, offline) ----------

[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

# Perintah: ocr <id> <path PNG> → {type: ocr, id, text, lang} atau {type: ocr, id, error}
function Read-Text($id, $file) {
    $stream = $null
    try {
        # Bahasa profil Windows dulu; tanpa paket OCR-nya, pakai bahasa OCR apa saja yang terpasang.
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
        if (-not $engine) {
            $lang = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1
            if ($lang) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) }
        }
        if (-not $engine) { Send @{ type = 'ocr'; id = $id; error = 'no-language' }; return }
        $sf = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
        $stream = Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
        Send @{ type = 'ocr'; id = $id; text = $text; lang = $engine.RecognizerLanguage.LanguageTag }
    } catch {
        Send @{ type = 'ocr'; id = $id; error = $_.Exception.Message }
    } finally {
        if ($stream) { $stream.Dispose() }
        Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    }
}

# ---------- Suara Zeno (TTS) ----------

$synth = $null
try { $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer } catch { }

function Emit-Voices {
    $list = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object {
        @{ id = $_.Id; name = $_.DisplayName; lang = $_.Language }
    })
    Send @{ type = 'voices'; voices = $list }
}

# Perintah: speak <id> <base64 JSON {text, voice, rate, pitch}> → {type: speech, id, data: data:audio/wav;base64}
function Speak($id, $payload) {
    if (-not $synth) { return }
    $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    if ($json.voice) {
        $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq $json.voice } | Select-Object -First 1
        if ($voice) { $synth.Voice = $voice }
    }
    $synth.Options.SpeakingRate = [double]$json.rate
    $synth.Options.AudioPitch = [double]$json.pitch
    $stream = Await ($synth.SynthesizeTextToStreamAsync([string]$json.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $mem = New-Object System.IO.MemoryStream
    $net.CopyTo($mem)
    Send @{ type = 'speech'; id = $id; data = 'data:audio/wav;base64,' + [Convert]::ToBase64String($mem.ToArray()) }
    $net.Dispose(); $mem.Dispose()
}

# ---------- Loop ----------

# [Console]::In.ReadLineAsync() di .NET Framework berjalan sinkron dan menahan output konsol,
# jadi stdin dibaca lewat StreamReader sendiri (benar-benar async).
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()
try { Emit-Media $true } catch { }
try { Emit-Notifications $true } catch { }
try { Emit-Voices } catch { }
try { Emit-Quick $true } catch { }
$quickTick = 0

while ($true) {
    if ($pending.Wait(800)) {
        $cmd = $pending.Result
        if ($null -eq $cmd) { break }  # stdin ditutup = Zenopod keluar
        $parts = $cmd.Trim() -split '\s+', 2
        $session = $manager.GetCurrentSession()
        try {
            switch ($parts[0]) {
                'toggle'  { if ($session) { Await ($session.TryTogglePlayPauseAsync()) ([bool]) | Out-Null } }
                'next'    { if ($session) { Await ($session.TrySkipNextAsync()) ([bool]) | Out-Null } }
                'prev'    { if ($session) { Await ($session.TrySkipPreviousAsync()) ([bool]) | Out-Null } }
                'refresh' { Emit-Media $true; Emit-Notifications $true }
                'dismiss' { if ($listener) { $listener.RemoveNotification([uint32]$parts[1]) } }
                'clear'   { if ($listener) { $listener.ClearNotifications() } }
                'voices'  { Emit-Voices }
                'speak'   { $p = $parts[1] -split '\s+', 2; Speak $p[0] $p[1] }
                'ocr'     { $p = $parts[1] -split '\s+', 2; Read-Text $p[0] $p[1] }
                'quick'   { $p = $parts[1] -split '\s+', 2; Set-Quick $p[0] $p[1]; Start-Sleep -Milliseconds 250; Emit-Quick $true }
            }
        } catch { }
        Start-Sleep -Milliseconds 150
        $pending = $stdin.ReadLineAsync()
    }
    try { Emit-Media $false } catch { }
    try { Emit-Notifications $false } catch { }
    # Volume/kecerahan/radio bisa berubah dari luar: cek tiap ±4 detik.
    $quickTick++
    if ($quickTick -ge 5) { $quickTick = 0; try { Emit-Quick $false } catch { } }
}
