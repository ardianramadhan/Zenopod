# Helper Windows untuk Zenopod (Windows PowerShell 5.1).
# - Musik: membaca sesi media Windows (Spotify, Chrome, dll).
# - Notifikasi: membaca notifikasi semua aplikasi lewat UserNotificationListener
#   (Pengaturan > Privasi > Notifikasi > izinkan aplikasi desktop).
# - Bluetooth: perangkat yang sedang tersambung (untuk reaksi Zeno saat tersambung/terputus).
# - USB: perangkat USB luar (bukan bawaan laptop) dan drive (flashdisk / hard disk eksternal).
# Menulis satu baris JSON per perubahan: {type: media|notifications|icon|bluetooth|usb, ...}.
# Perintah dari stdin: toggle | next | prev | seek <ms> | refresh | dismiss <id> | clear | speak | quick | ocr <id> <file> | eject <E:>.

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
[void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
[void][Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
[void][Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]

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
    # Posisi lagu (untuk lirik). Aplikasi memperbarui ini saat putar/jeda/geser, bukan tiap detik.
    $timeline = $session.GetTimelineProperties()
    $duration = [math]::Round($timeline.EndTime.TotalMilliseconds - $timeline.StartTime.TotalMilliseconds)
    $trackKey = "$($session.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
    $key = "$trackKey|$status|$($timeline.LastUpdatedTime.Ticks)|$duration"
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
        duration   = if ($duration -gt 0) { $duration } else { $null }
        position   = if ($duration -gt 0) { [math]::Round($timeline.Position.TotalMilliseconds) } else { $null }
        positionAt = if ($duration -gt 0) { $timeline.LastUpdatedTime.ToUnixTimeMilliseconds() } else { $null }
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

# ClearNotifications() kadang tidak berbuat apa-apa untuk aplikasi desktop (bukan paket Store),
# jadi sisa notifikasinya dihapus satu per satu seperti tombol hapus per notifikasi.
function Clear-Notifications {
    if (-not $listener) { return }
    try { $listener.ClearNotifications() } catch { [Console]::Error.WriteLine("clear: $($_.Exception.Message)") }
    $list = Await ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) `
        ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
    foreach ($n in $list) {
        try { $listener.RemoveNotification($n.Id) } catch { [Console]::Error.WriteLine("remove $($n.Id): $($_.Exception.Message)") }
    }
    Emit-Notifications $true
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
  // flow 0 = speaker, 1 = mikrofon; role 0 = konsol, 1 = multimedia, 2 = komunikasi (rapat).
  static IAudioEndpointVolume Endpoint(int flow, int role) {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, role, out dev));
    IAudioEndpointVolume epv = null;
    var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out epv));
    return epv;
  }
  static IAudioEndpointVolume Vol() { return Endpoint(0, 1); }
  // Mikrofon: bisukan perangkat bawaan untuk rapat dan untuk umum (sering perangkat yang sama).
  public static bool MicMute {
    get { bool m; Marshal.ThrowExceptionForHR(Endpoint(1, 2).GetMute(out m)); return m; }
    set {
      Marshal.ThrowExceptionForHR(Endpoint(1, 2).SetMute(value, System.Guid.Empty));
      try { Marshal.ThrowExceptionForHR(Endpoint(1, 0).SetMute(value, System.Guid.Empty)); } catch { }
    }
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
    $state = @{ type = 'quick'; volume = $null; muted = $null; micMuted = $null; brightness = $null; wifi = $null; bluetooth = $null }
    try { $state.volume = [int][math]::Round([ZenoAudio]::Volume * 100); $state.muted = [ZenoAudio]::Mute } catch { }
    try { $state.micMuted = [ZenoAudio]::MicMute } catch { }
    try { $state.brightness = [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { }
    try {
        foreach ($r in (Get-Radios)) {
            if ($r.Kind.ToString() -eq 'WiFi') { $state.wifi = $r.State.ToString() }
            if ($r.Kind.ToString() -eq 'Bluetooth') { $state.bluetooth = $r.State.ToString() }
        }
    } catch { }
    $key = "$($state.volume)|$($state.muted)|$($state.micMuted)|$($state.brightness)|$($state.wifi)|$($state.bluetooth)"
    if (-not $force -and $key -eq $script:lastQuick) { return }
    $script:lastQuick = $key
    Send $state
}

# ---------- Perangkat Bluetooth tersambung ----------

$lastBluetooth = $null
$btKinds = @{}

# Jenis perangkat dari Class of Device (Bluetooth klasik): audio | input | phone | other.
function Get-BluetoothKind($id) {
    if ($script:btKinds.ContainsKey($id)) { return $script:btKinds[$id] }
    $kind = 'other'
    try {
        $device = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($id)) ([Windows.Devices.Bluetooth.BluetoothDevice])
        switch ($device.ClassOfDevice.MajorClass.ToString()) {
            'AudioVideo' { $kind = 'audio' }
            'Peripheral' { $kind = 'input' }
            'Phone' { $kind = 'phone' }
        }
        $device.Dispose()
    } catch { }
    $script:btKinds[$id] = $kind
    return $kind
}

# Baterai perangkat Bluetooth (DEVPKEY_Bluetooth_Battery) per wadah perangkat: headset, mouse,
# keyboard, dll. yang melaporkannya (lewat profil Hands-Free atau layanan baterai BLE). ±40 ms.
$btBatteryKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
function Get-BluetoothBatteries {
    $map = @{}
    try {
        $sel = 'System.Devices.DeviceInstanceId:~<"BTHENUM\" OR System.Devices.DeviceInstanceId:~<"BTHLE\"'
        $list = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel, [string[]]@($script:btBatteryKey, 'System.Devices.ContainerId'), [Windows.Devices.Enumeration.DeviceInformationKind]::Device)) `
            ([Windows.Devices.Enumeration.DeviceInformationCollection])
        foreach ($d in $list) {
            $level = $null; $container = $null
            foreach ($kv in $d.Properties) {
                if ($kv.Key -eq $script:btBatteryKey -and $kv.Value -ne $null) { $level = [int]$kv.Value }
                if ($kv.Key -eq 'System.Devices.ContainerId' -and $kv.Value) { $container = "$($kv.Value)".ToLower() }
            }
            if ($container -and $level -ne $null) { $map[$container] = $level }
        }
    } catch { }
    return $map
}

function Emit-Bluetooth([bool]$force) {
    $devices = @()
    $batteries = Get-BluetoothBatteries
    $selectors = @(
        @([Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromConnectionStatus('Connected'), $true),
        @([Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromConnectionStatus('Connected'), $false)
    )
    foreach ($pair in $selectors) {
        $list = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($pair[0], [string[]]@('System.Devices.ContainerId', 'System.Devices.Aep.ContainerId'))) ([Windows.Devices.Enumeration.DeviceInformationCollection])
        foreach ($d in $list) {
            if (-not $d.Name) { continue }
            $kind = if ($pair[1]) { Get-BluetoothKind $d.Id } else { 'other' }
            $container = $null
            # Daftar Bluetooth memakai kunci Aep.ContainerId; simpul perangkat memakai ContainerId.
            foreach ($kv in $d.Properties) { if (($kv.Key -eq 'System.Devices.ContainerId' -or $kv.Key -eq 'System.Devices.Aep.ContainerId') -and $kv.Value) { $container = "$($kv.Value)".ToLower() } }
            $battery = if ($container -and $batteries.ContainsKey($container)) { $batteries[$container] } else { $null }
            $devices += @{ id = $d.Id; name = $d.Name; kind = $kind; battery = $battery }
        }
    }
    # Persen baterai ikut dibandingkan, supaya perubahannya juga dikirim.
    $key = ($devices | ForEach-Object { "$($_.id)=$($_.battery)" } | Sort-Object) -join ','
    if (-not $force -and $key -eq $script:lastBluetooth) { return }
    $script:lastBluetooth = $key
    Send @{ type = 'bluetooth'; devices = @($devices) }
}

# ---------- Perangkat USB & drive ----------

# Antarmuka GUID_DEVINTERFACE_USB_DEVICE; perangkat bawaan laptop ada di wadah komputer (ffff…).
$usbSelector = 'System.Devices.InterfaceClassGuid:="{A5DCBF10-6530-11D2-901F-00C04FB951ED}" AND System.Devices.InterfaceEnabled:=System.StructuredQueryType.Boolean#True'
$rootContainer = '00000000-0000-0000-ffff-ffffffffffff'
$lastUsb = $null
$usbKinds = @{}

# Jenis perangkat dari kelas driver di dalam wadahnya (urutan = prioritas).
$usbClasses = [ordered]@{
    '4d36e967-e325-11ce-bfc1-08002be10318' = 'storage'   # DiskDrive
    'eec5ad98-8080-425f-922a-dabf3de3f69a' = 'phone'     # WPD (HP, kamera digital)
    'ca3e7ab9-b4c3-4ae6-8251-579ef933890f' = 'camera'    # Camera
    '6bdd1fc6-810f-11d0-bec7-08002be2092f' = 'camera'    # Image
    'c166523c-fe0c-4a94-a586-f1a80cfbbf3e' = 'audio'     # AudioEndpoint
    '4d36e96c-e325-11ce-bfc1-08002be10318' = 'audio'     # Media
    '4d36e96f-e325-11ce-bfc1-08002be10318' = 'mouse'
    '4d36e96b-e325-11ce-bfc1-08002be10318' = 'keyboard'
    '4d36e972-e325-11ce-bfc1-08002be10318' = 'network'
    '4d36e978-e325-11ce-bfc1-08002be10318' = 'serial'    # Ports (mis. Arduino)
    '4d36e979-e325-11ce-bfc1-08002be10318' = 'printer'
}

function Get-UsbKind($container) {
    if ($script:usbKinds.ContainsKey($container)) { return $script:usbKinds[$container] }
    $kind = 'other'
    try {
        $list = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync("System.Devices.ContainerId:=`"{$container}`"", [string[]]@('System.Devices.ClassGuid'), [Windows.Devices.Enumeration.DeviceInformationKind]::Device)) `
            ([Windows.Devices.Enumeration.DeviceInformationCollection])
        $found = @{}
        foreach ($d in $list) { foreach ($kv in $d.Properties) { if ($kv.Key -eq 'System.Devices.ClassGuid' -and $kv.Value) { $found["$($kv.Value)".ToLower()] = $true } } }
        foreach ($guid in $script:usbClasses.Keys) { if ($found.ContainsKey($guid)) { $kind = $script:usbClasses[$guid]; break } }
    } catch { }
    $script:usbKinds[$container] = $kind
    return $kind
}

function Emit-Usb([bool]$force) {
    $devices = @{}
    $list = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($script:usbSelector, [string[]]@('System.Devices.ContainerId'))) `
        ([Windows.Devices.Enumeration.DeviceInformationCollection])
    foreach ($d in $list) {
        $container = $null
        foreach ($kv in $d.Properties) { if ($kv.Key -eq 'System.Devices.ContainerId') { $container = "$($kv.Value)".ToLower() } }
        if (-not $container -or $container -eq $script:rootContainer -or $devices.ContainsKey($container)) { continue }
        $devices[$container] = @{ id = $container; name = $d.Name; kind = (Get-UsbKind $container) }
    }
    $drives = @()
    foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
        if (-not $drive.IsReady -or $drive.Name -eq "$env:SystemDrive\") { continue }
        $type = $drive.DriveType.ToString()
        if ($type -ne 'Removable' -and $type -ne 'Fixed') { continue }
        $drives += @{ letter = $drive.Name.Substring(0, 2); label = $drive.VolumeLabel; size = $drive.TotalSize; free = $drive.AvailableFreeSpace; removable = ($type -eq 'Removable') }
    }
    $key = (@($devices.Keys | Sort-Object) + @($drives | ForEach-Object { $_.letter } | Sort-Object)) -join ','
    if (-not $force -and $key -eq $script:lastUsb) { return }
    $script:lastUsb = $key
    Send @{ type = 'usb'; devices = @($devices.Values); drives = @($drives) }
}

# Keluarkan drive dengan aman (sama seperti "Eject" di File Explorer).
function Eject-Drive($letter) {
    if ($letter -notmatch '^[A-Za-z]:$') { return }
    $item = (New-Object -ComObject Shell.Application).Namespace(17).ParseName($letter)
    if ($item) { $item.InvokeVerb('Eject') }
}

# ---------- Privasi: aplikasi yang sedang memakai mikrofon / kamera ----------
# Sumber yang sama dengan ikon mikrofon di taskbar: CapabilityAccessManager mencatat waktu mulai &
# berhenti per aplikasi; LastUsedTimeStop = 0 artinya sedang dipakai. Zenopod sendiri dilewati.

$consentRoot = 'Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore'
$lastPrivacy = $null

function Get-CapabilityUsers($cap) {
    $names = @()
    $base = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$($script:consentRoot)\$cap")
    if (-not $base) { return $names }
    $scan = @(@($base, $false))
    $np = $base.OpenSubKey('NonPackaged')
    if ($np) { $scan += , @($np, $true) }
    foreach ($pair in $scan) {
        $key = $pair[0]
        foreach ($sub in $key.GetSubKeyNames()) {
            if ($sub -eq 'NonPackaged') { continue }
            $k = $key.OpenSubKey($sub)
            if (-not $k) { continue }
            $start = $k.GetValue('LastUsedTimeStart'); $stop = $k.GetValue('LastUsedTimeStop')
            $k.Close()
            if ($start -eq $null -or [long]$start -eq 0 -or [long]$stop -ne 0) { continue }
            # "C:#Users#…#Zoom.exe" → "Zoom"; "MSTeams_8wekyb3d8bbwe" → "MSTeams"
            $name = if ($pair[1]) { [IO.Path]::GetFileNameWithoutExtension(($sub -split '#')[-1]) } else { ($sub -split '_')[0] }
            if ($name -match '^(Zenopod|electron)$') { continue }
            $names += $name
        }
        $key.Close()
    }
    return @($names | Sort-Object -Unique)
}

function Emit-Privacy([bool]$force) {
    $mic = @(); $camera = @()
    try { $mic = Get-CapabilityUsers 'microphone'; $camera = Get-CapabilityUsers 'webcam' } catch { }
    $key = "$($mic -join ',')|$($camera -join ',')"
    if (-not $force -and $key -eq $script:lastPrivacy) { return }
    $script:lastPrivacy = $key
    Send @{ type = 'privacy'; mic = @($mic); camera = @($camera) }
}

function Set-Quick($what, $value) {
    switch ($what) {
        'volume' { [ZenoAudio]::Volume = [math]::Max(0, [math]::Min(100, [double]$value)) / 100; if ([ZenoAudio]::Mute) { [ZenoAudio]::Mute = $false } }
        'mute' { [ZenoAudio]::Mute = if ($value -eq 'toggle') { -not [ZenoAudio]::Mute } else { $value -eq '1' } }
        'micmute' { [ZenoAudio]::MicMute = if ($value -eq 'toggle') { -not [ZenoAudio]::MicMute } else { $value -eq '1' } }
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
# ---------- Waktu layar: aplikasi yang sedang di depan ----------
# Dikirim hanya saat berganti; main.js yang menghitung lamanya (dan melewati saat idle/terkunci).

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ZenoWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
  public static string ForegroundTitle() { var sb = new StringBuilder(256); GetWindowText(GetForegroundWindow(), sb, 256); return sb.ToString(); }
}
"@

$appNames = @{}   # pid → nama ramah ("Google Chrome", bukan "chrome")
$lastForeground = $null

function Emit-Foreground {
    $procId = [ZenoWin]::ForegroundPid()
    $name = $null
    if ($procId -gt 0) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            if ($proc.ProcessName -eq 'ApplicationFrameHost') {
                # Aplikasi Store (Pengaturan, Kalkulator, …) dibungkus satu proses: pakai judul jendelanya.
                $name = [ZenoWin]::ForegroundTitle()
            } elseif ($proc.ProcessName -match '^(LockApp|Idle)$') {
                $name = $null
            } else {
                if (-not $appNames.ContainsKey($procId)) {
                    $desc = $null
                    try { $desc = $proc.MainModule.FileVersionInfo.FileDescription } catch { }
                    if (-not $desc -or $desc.Length -gt 40) { $desc = $proc.ProcessName }
                    $appNames[$procId] = $desc.Trim()
                    if ($appNames.Count -gt 300) { $appNames.Clear() }
                }
                $name = $appNames[$procId]
            }
        }
    }
    $key = "$procId|$name"
    if ($key -eq $script:lastForeground) { return }
    $script:lastForeground = $key
    Send @{ type = 'foreground'; app = $name; process = if ($proc) { $proc.ProcessName } else { $null } }
}

try { Emit-Media $true } catch { }
try { Emit-Notifications $true } catch { }
try { Emit-Voices } catch { }
try { Emit-Quick $true } catch { }
try { Emit-Bluetooth $true } catch { }
try { Emit-Usb $true } catch { }
try { Emit-Privacy $true } catch { }
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
                # seek <ms>: lompat ke posisi lagu (TimeSpan dalam tick 100 ns).
                'seek'    { if ($session) { Await ($session.TryChangePlaybackPositionAsync([long]$parts[1] * 10000)) ([bool]) | Out-Null; Start-Sleep -Milliseconds 150; Emit-Media $true } }
                'next'    { if ($session) { Await ($session.TrySkipNextAsync()) ([bool]) | Out-Null } }
                'prev'    { if ($session) { Await ($session.TrySkipPreviousAsync()) ([bool]) | Out-Null } }
                'refresh' { Emit-Media $true; Emit-Notifications $true }
                'dismiss' { if ($listener) { $listener.RemoveNotification([uint32]$parts[1]) } }
                'clear'   { Clear-Notifications }
                'eject'   { Eject-Drive $parts[1].Trim() }
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
    # USB & drive tiap ±1,6 dtk (cepat: satu kueri WinRT + daftar drive).
    try { Emit-Foreground } catch { }
    if ($quickTick % 2 -eq 0) {
        try { Emit-Usb $false } catch { }
        try { Emit-Privacy $false } catch { }
    }
    if ($quickTick -ge 6) {
        $quickTick = 0
        try { Emit-Quick $false } catch { }
        try { Emit-Bluetooth $false } catch { }
    }
}
