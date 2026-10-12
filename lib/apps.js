'use strict';

// Peluncur: tombol aplikasi/website di panel, dan daftar aplikasi terpasang untuk dipilih di Pengaturan.

const { app, nativeImage, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Path boleh memakai "/" dan %VARIABEL%; ubah ke bentuk Windows.
function expandEnv(value) {
  return path.normalize(value.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`));
}

function isUri(target) {
  // "C:\..." juga berbentuk "x:", jadi skema harus lebih dari satu huruf.
  return /^[a-z][a-z0-9+.-]+:/i.test(target);
}

function powershell(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        resolve(JSON.parse(stdout || 'null'));
      } catch {
        resolve(null);
      }
    });
  });
}

// Logo aplikasi Store punya banyak varian (scale-100, targetsize-48, ...); ambil yang paling pas.
function appxLogo(full) {
  if (!full) return null;
  if (fs.existsSync(full)) return full;
  const folder = path.dirname(full);
  const base = path.basename(full, path.extname(full));
  let files = [];
  try {
    files = fs.readdirSync(folder).filter((f) => f.startsWith(base + '.') && f.endsWith('.png'));
  } catch {
    return null;
  }
  const prefer = ['targetsize-48.png', 'targetsize-48_altform-unplated.png', 'scale-200.png', 'targetsize-64.png', 'scale-150.png', 'scale-100.png'];
  for (const suffix of prefer) {
    const hit = files.find((f) => f === `${base}.${suffix}`);
    if (hit) return path.join(folder, hit);
  }
  return files.length ? path.join(folder, files[0]) : null;
}

// Format lama: { appx: "NamaPaket" } — cari AppUserModelId & logo sekali saat dimuat.
async function resolveAppx(names) {
  if (names.length === 0) return {};
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
  const result = await powershell(`
    $out = @{}
    foreach ($n in @(${list})) {
      $p = Get-AppxPackage -Name $n | Select-Object -First 1
      if (-not $p) { continue }
      $a = @((Get-AppxPackageManifest $p).Package.Applications.Application)[0]
      $out[$n] = @{ aumid = "$($p.PackageFamilyName)!$($a.Id)"; logo = (Join-Path $p.InstallLocation $a.VisualElements.Square44x44Logo) }
    }
    $out | ConvertTo-Json -Compress`);
  return result ?? {};
}

// Shortcut (.lnk) dibaca sampai ke ikon/aplikasi aslinya; kalau tidak, Windows memberi ikon file kosong.
function iconSource(file) {
  if (!file.toLowerCase().endsWith('.lnk')) return file;
  try {
    const link = shell.readShortcutLink(file);
    if (link.icon && fs.existsSync(link.icon)) return link.icon;
    if (link.target && fs.existsSync(link.target)) return link.target;
  } catch {
    // shortcut rusak
  }
  return file;
}

async function fileIcon(file, size = 'large') {
  try {
    return (await app.getFileIcon(iconSource(file), { size })).toDataURL();
  } catch {
    return null;
  }
}

async function iconFor(item, appx) {
  if (item.icon) {
    const iconPath = expandEnv(item.icon);
    if (/\.(png|jpe?g)$/i.test(iconPath)) {
      const logo = appxLogo(iconPath);
      return logo ? nativeImage.createFromPath(logo).toDataURL() : null;
    }
    return fileIcon(iconPath);
  }
  if (appx?.logo) {
    const logo = appxLogo(appx.logo);
    if (logo) return nativeImage.createFromPath(logo).toDataURL();
  }
  if (item.target && !isUri(item.target)) return fileIcon(expandEnv(item.target));
  return null;
}

// Item config → tombol siap pakai (dengan ikon & cara menjalankan).
async function resolveItems(apps) {
  const appx = await resolveAppx(apps.filter((i) => i.appx).map((i) => i.appx));
  return Promise.all(
    apps.map(async (item, index) => {
      const fromAppx = item.appx ? appx[item.appx] : null;
      return {
        index,
        name: item.name,
        color: item.color ?? null,
        launch: item.aumid
          ? { aumid: item.aumid }
          : item.appx
            ? { aumid: fromAppx?.aumid ?? null }
            : { target: item.target, args: item.args ?? [] },
        icon: await iconFor(item, fromAppx),
      };
    }),
  );
}

function launch(item) {
  const { aumid, target, args = [] } = item.launch;
  if (aumid) {
    spawn('explorer.exe', [`shell:AppsFolder\\${aumid}`], { detached: true, stdio: 'ignore' }).unref();
  } else if (target && isUri(target)) {
    shell.openExternal(target);
  } else if (target && args.length) {
    spawn(expandEnv(target), args, { detached: true, stdio: 'ignore' }).unref();
  } else if (target) {
    shell.openPath(expandEnv(target));
  }
}

// ---------- Aplikasi terpasang (untuk dipilih di Pengaturan) ----------

const START_MENUS = [
  path.join(process.env.ProgramData ?? 'C:/ProgramData', 'Microsoft/Windows/Start Menu/Programs'),
  path.join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs'),
];
const SKIP = /uninstall|readme|read me|help|documentation|release notes|website|license|changelog/i;

let installedCache = null;

async function installedApps() {
  if (installedCache) return installedCache;

  // Aplikasi desktop: shortcut di Start Menu.
  const shortcuts = new Map();
  for (const root of START_MENUS) {
    let files = [];
    try {
      files = fs.readdirSync(root, { recursive: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!String(file).toLowerCase().endsWith('.lnk')) continue;
      const name = path.basename(String(file), '.lnk');
      if (SKIP.test(name) || shortcuts.has(name.toLowerCase())) continue;
      shortcuts.set(name.toLowerCase(), { name, target: path.join(root, String(file)) });
    }
  }

  // Aplikasi Microsoft Store: AppUserModelId + logo dari manifest.
  const store =
    (await powershell(`
      $pk = @{}
      Get-AppxPackage | ForEach-Object { $pk[$_.PackageFamilyName] = $_ }
      @(Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ForEach-Object {
        $pfn, $aid = $_.AppID -split '!', 2
        $p = $pk[$pfn]; $logo = $null
        if ($p) {
          try {
            $a = @((Get-AppxPackageManifest $p).Package.Applications.Application | Where-Object { $_.Id -eq $aid })[0]
            if ($a) { $logo = Join-Path $p.InstallLocation $a.VisualElements.Square44x44Logo }
          } catch {}
        }
        [pscustomobject]@{ name = $_.Name; aumid = $_.AppID; logo = $logo }
      }) | ConvertTo-Json -Compress`)) ?? [];

  const list = [];
  for (const item of shortcuts.values()) {
    list.push({ key: 'lnk:' + item.target, name: item.name, target: item.target, icon: await fileIcon(item.target, 'normal') });
  }
  for (const item of Array.isArray(store) ? store : [store]) {
    if (!item?.name || shortcuts.has(item.name.toLowerCase())) continue;
    const logo = appxLogo(item.logo);
    list.push({
      key: 'aumid:' + item.aumid,
      name: item.name,
      aumid: item.aumid,
      iconPath: logo,
      icon: logo ? nativeImage.createFromPath(logo).toDataURL() : null,
    });
  }

  installedCache = list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return installedCache;
}

module.exports = { expandEnv, isUri, resolveItems, launch, installedApps, fileIcon };
