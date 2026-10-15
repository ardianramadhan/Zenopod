import React from 'react';
import { Easing, interpolate } from 'remotion';
import { bob, buildPromo, Button, C, Card, clamp, F, type Feature, Pill } from './Promo';
import { Zeno } from './Zeno';

// Versi lengkap ±60 detik: 18 fitur, ±2,4 detik per fitur.

type Body = React.FC<{ frame: number }>;

// Teks yang "diketik" huruf demi huruf.
const typed = (text: string, frame: number, start = 4, perChar = 2) => text.slice(0, Math.max(0, Math.floor((frame - start) / perChar)));

const SearchBox: React.FC<{ text: string; caret?: boolean }> = ({ text, caret = true }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '26px 32px', borderRadius: 30, background: C.surface, fontSize: 44 }}>
    <span style={{ color: C.muted }}>🔍</span>
    <span>
      {text || <span style={{ color: C.muted }}>Cari aplikasi…</span>}
      {caret && <span style={{ color: C.accent }}>|</span>}
    </span>
  </div>
);

const Row: React.FC<{ children: React.ReactNode; active?: boolean; style?: React.CSSProperties }> = ({ children, active, style }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      padding: '22px 28px',
      borderRadius: 26,
      fontSize: 38,
      background: active ? 'rgba(91,168,245,0.16)' : 'transparent',
      boxShadow: active ? 'inset 0 0 0 3px rgba(91,168,245,0.5)' : 'none',
      ...style,
    }}
  >
    {children}
  </div>
);

const Bar: React.FC<{ label: string; value: number; text: string; color?: string }> = ({ label, value, text, color = C.accent }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 200px', alignItems: 'center', gap: 22, fontSize: 36, whiteSpace: 'nowrap' }}>
    <span style={{ color: C.muted }}>{label}</span>
    <div style={{ height: 22, borderRadius: 999, background: C.surface, overflow: 'hidden' }}>
      <div style={{ width: `${value}%`, height: '100%', borderRadius: 999, background: color }} />
    </div>
    <span style={{ textAlign: 'right', fontWeight: 650 }}>{text}</span>
  </div>
);

// ---------- Fitur tambahan ----------

const APPS = [
  ['Chrome', '🌐', '#1a73e8'],
  ['Spotify', '🎵', '#1db954'],
  ['WhatsApp', '💬', '#25d366'],
  ['VS Code', '💻', '#0e639c'],
  ['Teams', '👥', '#5b5fc7'],
  ['Figma', '🎨', '#a259ff'],
  ['Notion', '📝', '#444'],
  ['Discord', '🎮', '#5865f2'],
] as const;

const LauncherBody: Body = ({ frame }) => {
  const query = typed('spo', frame, 6, 5);
  const opened = frame > 42;
  return (
    <Card>
      <SearchBox text={query} caret={!opened} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22, marginTop: 34 }}>
        {APPS.map(([name, icon, color]) => {
          const match = !query || name.toLowerCase().startsWith(query);
          const hit = query.length >= 2 && match;
          return (
            <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: match ? 1 : 0.25 }}>
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 30,
                  background: color,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 60,
                  boxShadow: hit ? `0 0 0 6px ${C.accent}` : 'none',
                  transform: hit && opened && frame < 48 ? 'scale(0.9)' : 'none',
                }}
              >
                {icon}
              </div>
              <span style={{ fontSize: 28, color: C.muted }}>{name}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const ReminderBody: Body = ({ frame }) => (
  <Card>
    <div style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
      <Zeno mood="alarm" size={150} style={{ transform: `rotate(${Math.sin(frame * 0.7) * 7}deg)` }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 32, color: C.muted }}>Zeno mengingatkan · 17.00</div>
        <div style={{ fontSize: 50, fontWeight: 700, marginTop: 6 }}>Pulang kerja 🏠</div>
        <div style={{ fontSize: 34, color: C.muted, marginTop: 6 }}>Setiap hari kerja</div>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 18, marginTop: 34, justifyContent: 'flex-end' }}>
      <Button label="Tunda 10 menit" />
      <Button label="Oke" primary pressed={frame > 44 && frame < 50} />
    </div>
  </Card>
);

const FocusBody: Body = ({ frame }) => {
  // Waktu dipercepat: 25:00 turun cepat supaya terlihat berjalan.
  const remaining = Math.max(0, 25 * 60 - Math.floor(frame * 9));
  const progress = 1 - remaining / (25 * 60);
  const r = 150;
  const circumference = 2 * Math.PI * r;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 50 }}>
      <div style={{ position: 'relative', width: 360, height: 360 }}>
        <svg width={360} height={360} viewBox="0 0 360 360" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={180} cy={180} r={r} fill="none" stroke={C.surface} strokeWidth={22} />
          <circle cx={180} cy={180} r={r} fill="none" stroke={C.accent} strokeWidth={22} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 84, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
          {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Zeno mood="focus" size={230} style={{ transform: `translateY(${bob(frame, 0.08, 4)}px)` }} />
        <div style={{ fontSize: 34, color: C.muted }}>Fokus · sesi 2/4</div>
      </div>
    </div>
  );
};

const WellnessBody: Body = ({ frame }) => {
  const second = frame > 24;
  const card = (emoji: string, title: string, sub: string, button: React.ReactNode, show: boolean) => (
    <Card style={{ padding: 34, opacity: show ? 1 : 0, transform: show ? 'none' : 'translateY(30px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
        <span style={{ fontSize: 76 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 44, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 32, color: C.muted, marginTop: 4 }}>{sub}</div>
        </div>
        {button}
      </div>
    </Card>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {card('👀', 'Lihat yang jauh 20 detik', 'Pandang sesuatu ±6 meter', null, frame > 2)}
      {card('💧', 'Minum air dulu', 'Satu gelas, biar segar', <Button label="Sudah minum" primary pressed={frame > 44 && frame < 50} />, second)}
    </div>
  );
};

// Ketik hitungan → hasil muncul dan tetap tampil; lalu ketik timer → baris timer menyusul.
const CalcBody: Body = ({ frame }) => {
  const calc = frame < 30;
  const text = calc ? typed('250.000 x 3', frame, 2, 1.8) : typed('timer 10 menit', frame, 30, 1);
  return (
    <Card>
      <SearchBox text={text} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 26, minHeight: 230 }}>
        {frame > 22 && (
          <Row active={calc}>
            <span style={{ fontSize: 46 }}>🧮</span>
            <span style={{ color: C.muted }}>250.000 × 3 =</span>
            <b style={{ fontSize: 52 }}>750.000</b>
            <span style={{ marginLeft: 'auto', color: C.muted, fontSize: 30 }}>Enter = salin</span>
          </Row>
        )}
        {frame > 46 && (
          <Row active>
            <span style={{ fontSize: 46 }}>⏱</span>
            <b>Mulai timer 10 menit</b>
          </Row>
        )}
      </div>
    </Card>
  );
};

const ClipsBody: Body = ({ frame }) => {
  const clips = ['📦 Nomor resi JNE 0123 4567 8901', '🔗 https://meet.google.com/abc-defg', '💰 Rp 750.000', '🖼 Gambar · 1280×720'];
  const picked = frame > 30;
  return (
    <Card>
      <div style={{ fontSize: 32, color: C.muted, marginBottom: 14 }}>Klip · 20 salinan terakhir</div>
      {clips.map((clip, i) => (
        <Row key={clip} active={picked && i === 1} style={{ opacity: frame > i * 5 ? 1 : 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{clip}</span>
          {picked && i === 1 && <span style={{ color: C.green, fontSize: 32, fontWeight: 650 }}>Tersalin ✓</span>}
        </Row>
      ))}
    </Card>
  );
};

const Toggle: React.FC<{ label: string; on: boolean }> = ({ label, on }) => (
  <div
    style={{
      flex: 1,
      padding: '26px 0',
      borderRadius: 26,
      textAlign: 'center',
      fontSize: 38,
      fontWeight: 650,
      background: on ? C.accent : C.surface,
      color: on ? '#04121f' : C.text,
    }}
  >
    {label}
  </div>
);

const QuickBody: Body = ({ frame }) => {
  const volume = Math.round(interpolate(frame, [6, 34], [30, 80], { ...clamp, easing: Easing.inOut(Easing.cubic) }));
  const bright = Math.round(interpolate(frame, [20, 46], [45, 90], { ...clamp, easing: Easing.inOut(Easing.cubic) }));
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
        <Bar label="🔊 Volume" value={volume} text={`${volume}%`} />
        <Bar label="☀️ Layar" value={bright} text={`${bright}%`} color="#fbbf24" />
        <div style={{ display: 'flex', gap: 20 }}>
          <Toggle label="Wi-Fi" on />
          <Toggle label="Bluetooth" on={frame > 48} />
        </div>
      </div>
    </Card>
  );
};

const WeatherBody: Body = ({ frame }) => (
  <Card>
    <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
      <Zeno mood="happy" size={210} costume="sunglasses" style={{ transform: `translateY(${bob(frame, 0.15, 6)}px)` }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 34, color: C.muted }}>Cuaca · Bekasi</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
          <span style={{ fontSize: 130, fontWeight: 750, letterSpacing: -4 }}>31°</span>
          <span style={{ fontSize: 40 }}>Cerah berawan</span>
        </div>
        <div style={{ fontSize: 32, color: C.muted }}>Terasa 35° · Lembap 70%</div>
      </div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 30, fontSize: 34 }}>
      <span>
        <b>14.00</b> 32°
      </span>
      <span>
        <b>15.00</b> 31°
      </span>
      <span>
        <b>16.00</b> 29° <span style={{ color: C.accent }}>☂ 60%</span>
      </span>
    </div>
  </Card>
);

const ChatBody: Body = ({ frame }) => {
  const answered = frame > 32;
  return (
    <div style={{ width: 880, display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div style={{ alignSelf: 'flex-end', padding: '26px 34px', borderRadius: '40px 40px 10px 40px', background: C.accent, color: '#04121f', fontSize: 40, fontWeight: 600, opacity: frame > 2 ? 1 : 0 }}>
        Apa bedanya RAM dan ROM?
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22 }}>
        <Zeno mood={answered ? 'happy' : 'think'} size={170} style={{ flex: 'none' }} />
        <div style={{ padding: '26px 34px', borderRadius: '40px 40px 40px 10px', background: C.surface, fontSize: 38, lineHeight: 1.35 }}>
          {answered ? 'RAM itu memori kerja sementara, ROM menyimpan data secara permanen 💡' : <span style={{ color: C.muted }}>Sebentar, aku pikir dulu…</span>}
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 30, color: C.muted }}>Dijawab Claude AI</div>
    </div>
  );
};

const ClaudeBody: Body = ({ frame }) => {
  const allowed = frame > 44;
  return (
    <Card>
      <div style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
        <Zeno mood={allowed ? (frame > 54 ? 'laugh' : 'happy') : 'think'} size={150} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 32, color: C.muted }}>{allowed && frame > 54 ? 'my-app · Claude Code selesai' : 'my-app · Claude minta izin'}</div>
          <div style={{ fontSize: 46, fontWeight: 700, marginTop: 6 }}>{allowed && frame > 54 ? 'Semua test lulus ✓' : 'Menjalankan perintah'}</div>
          <div style={{ marginTop: 12, padding: '10px 18px', borderRadius: 14, background: C.surface, fontFamily: 'Consolas, monospace', fontSize: 34, display: 'inline-block' }}>npm test</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 30, justifyContent: 'flex-end', opacity: allowed && frame > 54 ? 0.3 : 1 }}>
        <Button label="Tolak" />
        <Button label="Di terminal" />
        <Button label="Izinkan" primary pressed={frame > 44 && frame < 50} />
      </div>
    </Card>
  );
};

const SystemBody: Body = ({ frame }) => {
  const back = frame > 30;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginBottom: 34 }}>
        <Zeno mood={back ? 'laugh' : 'cry'} size={130} />
        <div>
          <div style={{ fontSize: 44, fontWeight: 700, color: back ? C.green : '#f87171' }}>{back ? '● Internet tersambung lagi' : '● Internet putus'}</div>
          <div style={{ fontSize: 32, color: C.muted, marginTop: 4 }}>{back ? 'Tadi putus sekitar 2 menit' : 'Aku kabari kalau sudah nyambung'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <Bar label="CPU" value={34} text="34%" />
        <Bar label="RAM" value={74} text="74%" />
        <Bar label="Disk C:" value={60} text="sisa 194 GB" />
      </div>
    </Card>
  );
};

const StatsPetBody: Body = ({ frame }) => {
  const hunger = interpolate(frame, [12, 30], [38, 85], clamp);
  const xp = interpolate(frame, [20, 44], [70, 100], clamp);
  const levelUp = frame > 46;
  return (
    <Card>
      <div style={{ fontSize: 32, color: C.muted }}>Ringkasan hari ini</div>
      <div style={{ fontSize: 44, fontWeight: 700, marginTop: 8 }}>3 fokus · 7 tugas · 2 kebiasaan</div>
      <div style={{ fontSize: 34, color: C.muted, marginTop: 6 }}>Lagu favorit: Lofi Coding (1 j 20 m)</div>
      <div style={{ height: 2, background: C.line, margin: '30px 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
        <Zeno mood={levelUp ? 'laugh' : frame > 12 ? 'eat' : 'hungry'} size={170} costume={levelUp ? 'party' : null} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{levelUp ? 'Zeno naik ke Level 4! 🎉' : 'Zeno · Level 3'}</div>
          <Bar label="Kenyang" value={hunger} text={`${Math.round(hunger)}%`} color={C.green} />
          <Bar label="XP" value={levelUp ? 8 : xp} text={levelUp ? '8/400' : `${Math.round(xp * 3)}/300`} />
        </div>
      </div>
    </Card>
  );
};

// ---------- Daftar 18 fitur ----------

const FULL_FEATURES: Feature[] = [
  F.music,
  F.notif,
  { title: 'Buka aplikasi secepat kilat', sub: 'Ketik sedikit, Enter. Atau tekan 1–9', mood: 'happy', Body: LauncherBody, sfx: [[6, 'click'], [11, 'click'], [16, 'click'], [42, 'pop']] },
  F.meeting,
  { title: 'Pengingat yang nggak dicuekin', sub: 'Sekali, tiap hari, atau hari kerja saja', mood: 'alarm', Body: ReminderBody, sfx: [[6, 'alarm', 0.8], [44, 'click']] },
  { title: 'Fokus ala Pomodoro', sub: '25 menit fokus, istirahat, notifikasi ditahan', mood: 'focus', Body: FocusBody, sfx: [[6, 'tick'], [40, 'tick']] },
  { title: 'Istirahat mata & minum air', sub: 'Zeno ingatkan saat kamu lupa waktu', mood: 'stretch', Body: WellnessBody, sfx: [[4, 'notif', 0.6], [26, 'notif', 0.6], [44, 'click']] },
  F.habits,
  { title: 'Kalkulator & timer kilat', sub: 'Langsung dari kotak cari', mood: 'happy', Body: CalcBody, sfx: [[22, 'success', 0.7], [46, 'tick']] },
  F.ocr,
  { title: 'Riwayat clipboard', sub: '20 salinan terakhir, klik untuk salin lagi', mood: 'happy', Body: ClipsBody, sfx: [[30, 'click'], [33, 'tick']] },
  { title: 'Kontrol cepat Windows', sub: 'Volume, kecerahan, Wi-Fi, Bluetooth', mood: 'music', Body: QuickBody, sfx: [[10, 'tick'], [24, 'tick'], [48, 'click']] },
  { title: 'Cuaca di kotamu', sub: 'Zeno bawa payung kalau mau hujan', mood: 'happy', Body: WeatherBody, sfx: [[8, 'sparkle', 0.6]] },
  F.voice,
  { title: 'Tanya apa saja ke Zeno', sub: 'Dijawab Claude AI, pakai API key-mu sendiri', mood: 'think', Body: ChatBody, sfx: [[2, 'pop'], [32, 'notif', 0.5]] },
  { title: 'Teman ngoding Claude Code', sub: 'Pantau progres & izinkan perintah dari kapsul', mood: 'think', Body: ClaudeBody, sfx: [[6, 'question'], [44, 'click'], [54, 'success']] },
  { title: 'Pantau laptop & internet', sub: 'CPU, RAM, disk, dan kabar saat internet putus', mood: 'cry', Body: SystemBody, sfx: [[6, 'boop'], [30, 'success']] },
  { title: 'Statistik & Zeno peliharaan', sub: 'Kebiasaan baikmu bikin Zeno naik level', mood: 'eat', Body: StatsPetBody, sfx: [[13, 'munch'], [46, 'levelup', 0.8]] },
];

export const FULL = buildPromo(FULL_FEATURES);
