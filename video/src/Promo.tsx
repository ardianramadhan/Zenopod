import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Zeno } from './Zeno';

// Video promosi Zenopod: vertikal 1080×1920, 30 fps, ±30 detik.
// Urutan: kenalan → kapsul di layar → 6 fitur → main dengan Zeno → ajakan unduh.

const FPS = 30;
const INTRO = 100;
const DESKTOP = 95;
const FEATURE = 72;
const FEATURES = 6;
const PLAY = 135;
const OUTRO = 150;
export const PROMO_FRAMES = INTRO + DESKTOP + FEATURE * FEATURES + PLAY + OUTRO;

const C = {
  bg: '#08080b',
  card: '#121217',
  surface: '#1c1c23',
  line: 'rgba(255,255,255,0.09)',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  accent: '#5ba8f5',
  green: '#4ade80',
};

const FONT = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

// ---------- Bantuan animasi ----------

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function usePop(delay = 0, damping = 12) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness: 160, mass: 0.7 } });
}

// Masuk dari bawah + memudar; keluar memudar di akhir durasi.
function useEnterExit(duration: number, delay = 0) {
  const frame = useCurrentFrame();
  const enter = interpolate(frame - delay, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const exit = interpolate(frame, [duration - 10, duration], [1, 0], clamp);
  return { opacity: Math.min(enter, exit), y: (1 - enter) * 40 };
}

// Gerak tubuh Zeno per frame.
const bob = (frame: number, speed = 0.12, amount = 10) => Math.sin(frame * speed) * amount;
const hop = (frame: number, period = 24, height = 60) => {
  const t = (frame % period) / period;
  return -Math.sin(t * Math.PI) * height;
};

// ---------- Komponen kecil ----------

const Glow: React.FC<{ x: string; y: string; color: string; size?: number }> = ({ x, y, color, size = 900 }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: size,
      height: size,
      marginLeft: -size / 2,
      marginTop: -size / 2,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
      opacity: 0.35,
    }}
  />
);

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <Glow x={`${30 + Math.sin(frame / 90) * 8}%`} y="18%" color="#2563eb" />
      <Glow x={`${75 + Math.cos(frame / 110) * 8}%`} y="78%" color="#7c3aed" size={1000} />
    </AbsoluteFill>
  );
};

const Headline: React.FC<{ title: string; sub?: string; duration: number; top?: number }> = ({ title, sub, duration, top = 250 }) => {
  const { opacity, y } = useEnterExit(duration);
  return (
    <div style={{ position: 'absolute', top, left: 80, right: 80, textAlign: 'center', opacity, transform: `translateY(${y}px)` }}>
      <div style={{ fontSize: 84, fontWeight: 750, lineHeight: 1.08, letterSpacing: -1.5, color: C.text }}>{title}</div>
      {sub && <div style={{ marginTop: 26, fontSize: 40, lineHeight: 1.35, color: C.muted }}>{sub}</div>}
    </div>
  );
};

const Card: React.FC<{ children: React.ReactNode; width?: number; style?: React.CSSProperties }> = ({ children, width = 880, style }) => (
  <div
    style={{
      width,
      padding: 40,
      borderRadius: 52,
      background: C.card,
      border: `2px solid ${C.line}`,
      boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
      color: C.text,
      ...style,
    }}
  >
    {children}
  </div>
);

const Button: React.FC<{ label: string; primary?: boolean; pressed?: boolean }> = ({ label, primary, pressed }) => (
  <div
    style={{
      padding: '20px 44px',
      borderRadius: 999,
      fontSize: 36,
      fontWeight: 650,
      background: primary ? C.text : C.surface,
      color: primary ? C.bg : C.text,
      transform: pressed ? 'scale(0.93)' : 'none',
    }}
  >
    {label}
  </div>
);

// Kapsul hitam seperti di aplikasi, diperbesar supaya terbaca di ponsel.
const Pill: React.FC<{ mood: string; children: React.ReactNode; frame: number; width?: number }> = ({ mood, children, frame, width = 760 }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 22,
      width,
      height: 128,
      padding: '0 40px 0 22px',
      borderRadius: 999,
      background: '#000',
      border: `2px solid ${C.line}`,
      boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
      color: C.text,
      fontSize: 40,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    }}
  >
    <Zeno mood={mood} size={96} style={{ flex: 'none', transform: `translateY(${bob(frame, 0.2, 3)}px)` }} />
    {children}
  </div>
);

// ---------- Adegan 1: kenalan ----------

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const pop = usePop(4, 9);
  const wave = Math.sin(frame * 0.35) * 6;
  const { opacity } = useEnterExit(INTRO, 18);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `scale(${pop}) translateY(${bob(frame) - 120}px) rotate(${wave}deg)` }}>
        <Zeno mood={frame < 40 ? 'surprised' : 'greet'} size={560} lookX={Math.sin(frame / 20) * 0.4} lookY={0.15} />
      </div>
      <div style={{ position: 'absolute', top: 1260, left: 0, right: 0, textAlign: 'center', opacity }}>
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -2 }}>Halo, aku Zeno 👋</div>
        <div style={{ marginTop: 24, fontSize: 44, color: C.muted }}>teman kerja kecil di layarmu</div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Adegan 2: kapsul di layar laptop ----------

const Desktop: React.FC = () => {
  const frame = useCurrentFrame();
  const screen = usePop(0, 14);
  const pill = usePop(22, 10);
  const { opacity } = useEnterExit(DESKTOP);
  return (
    <AbsoluteFill style={{ alignItems: 'center', opacity }}>
      <Headline title="Selalu ada di tepi layar" sub="Kapsul kecil yang berganti isi sendiri" duration={DESKTOP} />
      <div
        style={{
          position: 'absolute',
          top: 760,
          width: 960,
          height: 600,
          borderRadius: 36,
          border: '14px solid #26262e',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #312e81 45%, #0f172a 100%)',
          transform: `scale(${0.85 + screen * 0.15})`,
          opacity: screen,
          overflow: 'hidden',
        }}
      >
        {/* Jendela-jendela samar */}
        <div style={{ position: 'absolute', left: 60, top: 150, width: 520, height: 330, borderRadius: 18, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', left: 420, top: 220, width: 460, height: 300, borderRadius: 18, background: 'rgba(255,255,255,0.12)' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, background: 'rgba(0,0,0,0.45)' }} />
        <div style={{ position: 'absolute', top: 20, left: '50%', transform: `translateX(-50%) scale(${pill * 0.62})`, transformOrigin: 'top center' }}>
          <Pill mood="happy" frame={frame} width={640}>
            <span style={{ color: C.muted }}>Rab, 15 Okt&nbsp;&nbsp;</span>14:00
          </Pill>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Adegan 3: fitur ----------

type Feature = { title: string; sub: string; mood: string; Body: React.FC<{ frame: number }> };

const Equalizer: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 40, marginLeft: 'auto' }}>
    {[0, 1, 2, 3].map((i) => (
      <div key={i} style={{ width: 8, borderRadius: 4, background: C.accent, height: 12 + Math.abs(Math.sin(frame * 0.3 + i * 1.3)) * 28 }} />
    ))}
  </div>
);

const MusicBody: React.FC<{ frame: number }> = ({ frame }) => (
  <Pill mood="music" frame={frame} width={880}>
    <span style={{ fontSize: 44 }}>♪</span>
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
      Lofi Coding <span style={{ color: C.muted }}>· Chill Beats</span>
    </span>
    <Equalizer frame={frame} />
  </Pill>
);

const NotifBody: React.FC<{ frame: number }> = ({ frame }) => (
  <Card>
    <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
      <Zeno mood="surprised" size={150} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 32, color: C.muted }}>WhatsApp · baru saja</div>
        <div style={{ fontSize: 44, fontWeight: 700, marginTop: 6 }}>Ibu</div>
        <div style={{ fontSize: 38, color: C.muted, marginTop: 6 }}>Jangan lupa makan siang ya 😊</div>
      </div>
      <div style={{ width: 96, height: 96, borderRadius: 26, background: '#25d366', display: 'grid', placeItems: 'center', fontSize: 54 }}>💬</div>
    </div>
  </Card>
);

const MeetingBody: React.FC<{ frame: number }> = ({ frame }) => (
  <Card>
    <div style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
      <Zeno mood="alarm" size={150} style={{ transform: `rotate(${Math.sin(frame * 0.6) * 6}deg)` }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 32, color: C.muted }}>Kantor · 14.00–15.00</div>
        <div style={{ fontSize: 46, fontWeight: 700, marginTop: 6 }}>Review sprint</div>
        <div style={{ fontSize: 36, color: C.muted, marginTop: 6 }}>Mulai 10 menit lagi</div>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 18, marginTop: 34, justifyContent: 'flex-end' }}>
      <Button label="Nanti" />
      <Button label="Gabung" primary pressed={frame > 44 && frame < 50} />
    </div>
  </Card>
);

const HabitsBody: React.FC<{ frame: number }> = ({ frame }) => {
  const habits = [
    { label: '🏃 Olahraga', streak: 5, at: 14 },
    { label: '📖 Baca buku', streak: 12, at: 26 },
    { label: '💧 Minum air', streak: 30, at: 38 },
  ];
  return (
    <Card>
      <div style={{ fontSize: 34, color: C.muted, marginBottom: 26 }}>Kebiasaan hari ini · {habits.filter((h) => frame >= h.at).length}/3</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {habits.map((h) => {
          const done = frame >= h.at;
          return (
            <div
              key={h.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '22px 30px',
                borderRadius: 999,
                fontSize: 42,
                fontWeight: 600,
                background: done ? 'rgba(74,222,128,0.16)' : C.surface,
                boxShadow: done ? 'inset 0 0 0 3px rgba(74,222,128,0.5)' : 'none',
                transform: frame >= h.at && frame < h.at + 5 ? 'scale(1.05)' : 'none',
              }}
            >
              {h.label}
              <span style={{ marginLeft: 'auto', color: done ? C.green : C.muted, fontSize: 36 }}>🔥 {done ? h.streak + 1 : h.streak}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const OcrBody: React.FC<{ frame: number }> = ({ frame }) => {
  const draw = interpolate(frame, [8, 34], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const copied = frame > 40;
  return (
    <div style={{ position: 'relative', width: 880 }}>
      <Card style={{ background: '#f8fafc', color: '#0f172a' }}>
        <div style={{ fontSize: 30, color: '#64748b' }}>foto_resi.jpg</div>
        <div style={{ fontSize: 44, fontWeight: 700, marginTop: 18, fontFamily: 'Consolas, monospace' }}>Nomor resi:</div>
        <div style={{ fontSize: 50, fontWeight: 700, marginTop: 6, fontFamily: 'Consolas, monospace' }}>JNE 0123 4567 8901</div>
        <div style={{ fontSize: 32, color: '#64748b', marginTop: 18 }}>Jl. Melati No. 5, Bekasi</div>
      </Card>
      {/* Kotak pilihan yang diseret */}
      <div
        style={{
          position: 'absolute',
          left: 26,
          top: 96,
          width: 700 * draw,
          height: 150 * draw,
          border: `5px solid ${C.accent}`,
          borderRadius: 10,
          background: 'rgba(91,168,245,0.12)',
          opacity: draw > 0 ? 1 : 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -175,
          transform: `translateX(-50%) scale(${copied ? 1 : 0.6})`,
          opacity: copied ? 1 : 0,
        }}
      >
        <Pill mood="happy" frame={frame} width={620}>
          ✓ Teks tersalin
        </Pill>
      </div>
    </div>
  );
};

const VoiceBody: React.FC<{ frame: number }> = ({ frame }) => {
  const answered = frame > 34;
  const bubble = (text: string, mine: boolean, show: boolean) => (
    <div
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: 720,
        padding: '26px 34px',
        borderRadius: mine ? '40px 40px 10px 40px' : '40px 40px 40px 10px',
        background: mine ? C.accent : C.surface,
        color: mine ? '#04121f' : C.text,
        fontSize: 40,
        fontWeight: 600,
        opacity: show ? 1 : 0,
        transform: show ? 'none' : 'translateY(20px)',
      }}
    >
      {text}
    </div>
  );
  return (
    <div style={{ width: 880, display: 'flex', flexDirection: 'column', gap: 26 }}>
      {bubble('“Zeno, ingatkan aku pulang jam 5”', true, frame > 4)}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22 }}>
        <Zeno mood={answered ? 'happy' : 'hear'} size={170} style={{ flex: 'none', transform: `translateY(${answered ? hop(frame, 20, 20) : 0}px)` }} />
        {bubble('Siap! Aku ingatkan jam 17.00 ⏰', false, answered)}
      </div>
    </div>
  );
};

const FEATURE_LIST: Feature[] = [
  { title: 'Musikmu, di kapsul', sub: 'Judul lagu & kontrol Spotify, YouTube, dan lainnya', mood: 'music', Body: MusicBody },
  { title: 'Notifikasi nggak kelewat', sub: 'WhatsApp, email, Teams… semua mampir ke Zeno', mood: 'surprised', Body: NotifBody },
  { title: 'Rapat? Tinggal Gabung', sub: 'Dari Google Calendar & Outlook, diingatkan sebelum mulai', mood: 'alarm', Body: MeetingBody },
  { title: 'Jaga streak kebiasaan', sub: 'Centang tiap hari, Zeno ikut naik level', mood: 'laugh', Body: HabitsBody },
  { title: 'Ambil teks dari layar', sub: 'Seret kotak, teksnya langsung tersalin', mood: 'happy', Body: OcrBody },
  { title: 'Cukup bilang “Zeno…”', sub: 'Perintah suara bahasa Indonesia, diproses offline', mood: 'hear', Body: VoiceBody },
];

const FeatureScene: React.FC<{ feature: Feature; index: number }> = ({ feature, index }) => {
  const frame = useCurrentFrame();
  const { opacity, y } = useEnterExit(FEATURE, 4);
  const Body = feature.Body;
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <Headline title={feature.title} sub={feature.sub} duration={FEATURE} />
      {/* Isi di tengah ruang antara judul dan penanda urutan */}
      <div style={{ position: 'absolute', top: 620, bottom: 260, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ opacity, transform: `translateY(${y}px)` }}>
          <Body frame={frame} />
        </div>
      </div>
      {/* Penanda urutan fitur */}
      <div style={{ position: 'absolute', bottom: 170, display: 'flex', gap: 14 }}>
        {FEATURE_LIST.map((_, i) => (
          <div key={i} style={{ width: i === index ? 54 : 16, height: 16, borderRadius: 999, background: i === index ? C.accent : 'rgba(255,255,255,0.2)' }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------- Adegan 4: main dengan Zeno ----------

const PLAY_STEPS = [
  { at: 0, mood: 'happy', say: 'Klik aku dong!' },
  { at: 18, mood: 'laugh', say: 'Hihi, geli!', tap: [0.52, 0.85] },
  { at: 40, mood: 'boop', say: 'Boop!', tap: [0.5, 0.6] },
  { at: 58, mood: 'purr', say: 'Elus terus~', tap: [0.5, 0.3] },
  { at: 80, mood: 'dizzy', say: 'Pusing… 💫', spin: true },
  { at: 104, mood: 'love', say: 'Hehe, sayang kamu!' },
];

const Play: React.FC = () => {
  const frame = useCurrentFrame();
  const step = [...PLAY_STEPS].reverse().find((s) => frame >= s.at) ?? PLAY_STEPS[0];
  const local = frame - step.at;
  const spin = step.spin ? interpolate(local, [0, 22], [0, 360], { ...clamp, easing: Easing.out(Easing.back(1.4)) }) : 0;
  const squash = step.tap && local < 8 ? 1 - Math.sin((local / 8) * Math.PI) * 0.12 : 1;
  const { opacity } = useEnterExit(PLAY);
  const size = 560;
  return (
    <AbsoluteFill style={{ alignItems: 'center', opacity }}>
      <Headline title="Bisa diajak main juga" sub="Elus, colek, gelitik… Zeno punya puluhan ekspresi" duration={PLAY} />
      <div style={{ position: 'absolute', top: 860, width: size, height: size }}>
        <div style={{ transform: `translateY(${bob(frame, 0.15, 8)}px) rotate(${spin}deg) scale(${1 / squash}, ${squash})`, transformOrigin: '50% 60%' }}>
          <Zeno mood={step.mood} size={size} lookY={0.1} />
        </div>
        {/* Bekas ketukan jari */}
        {step.tap && local < 14 && (
          <div
            style={{
              position: 'absolute',
              left: step.tap[0] * size - 60,
              top: step.tap[1] * size - 60,
              width: 120,
              height: 120,
              borderRadius: '50%',
              border: `6px solid ${C.text}`,
              opacity: 1 - local / 14,
              transform: `scale(${0.5 + local / 14})`,
            }}
          />
        )}
        {/* Balon kata */}
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: '40%',
            padding: '20px 32px',
            borderRadius: '36px 36px 36px 8px',
            background: C.text,
            color: C.bg,
            fontSize: 40,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            transform: `scale(${interpolate(local, [0, 6], [0.7, 1], clamp)})`,
            transformOrigin: 'bottom left',
          }}
        >
          {step.say}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Adegan 5: ajakan ----------

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const pop = usePop(0, 10);
  const text = usePop(14, 14);
  const cta = usePop(30, 12);
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{ position: 'absolute', top: 360, transform: `scale(${pop}) translateY(${hop(frame, 26, 70)}px)` }}>
        <Zeno mood={frame % 52 < 26 ? 'laugh' : 'happy'} size={420} />
      </div>
      <div style={{ position: 'absolute', top: 900, left: 0, right: 0, textAlign: 'center', opacity: text, transform: `translateY(${(1 - text) * 40}px)` }}>
        <div style={{ fontSize: 150, fontWeight: 850, letterSpacing: -4 }}>Zenopod</div>
        <div style={{ marginTop: 10, fontSize: 48, color: C.muted }}>Teman kerja kecil di layarmu</div>
      </div>
      <div style={{ position: 'absolute', top: 1260, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, opacity: cta, transform: `scale(${0.9 + cta * 0.1})` }}>
        <div style={{ padding: '30px 64px', borderRadius: 999, background: C.text, color: C.bg, fontSize: 50, fontWeight: 750 }}>Unduh gratis untuk Windows</div>
        <div style={{ fontSize: 38, color: C.accent, fontWeight: 600 }}>github.com/ardianramadhan/Zenopod</div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Suara ----------
// Musik & efek dibuat oleh audio/synth.js (bebas hak cipta). Efek ditempatkan di frame
// yang sama dengan gerakan di layar.

const AT = {
  desktop: INTRO,
  features: INTRO + DESKTOP,
  play: INTRO + DESKTOP + FEATURE * FEATURES,
  outro: INTRO + DESKTOP + FEATURE * FEATURES + PLAY,
};
const feature = (i: number) => AT.features + i * FEATURE;

const SFX: [number, string, number?][] = [
  [4, 'pop'],
  [42, 'hello'],
  [AT.desktop, 'whoosh', 0.6],
  [AT.desktop + 22, 'pop'],
  ...Array.from({ length: FEATURES }, (_, i) => [feature(i), 'swipe', 0.8] as [number, string, number]),
  [feature(0) + 10, 'note'],
  [feature(1) + 8, 'notif'],
  [feature(2) + 6, 'alarm', 0.8],
  [feature(2) + 44, 'click'],
  [feature(3) + 14, 'tick'],
  [feature(3) + 26, 'tick'],
  [feature(3) + 38, 'tick'],
  [feature(3) + 46, 'levelup', 0.7],
  [feature(4) + 8, 'drag'],
  [feature(4) + 40, 'success'],
  [feature(5) + 4, 'pop'],
  [feature(5) + 34, 'hello'],
  ...PLAY_STEPS.slice(1).map((s) => [AT.play + s.at, { laugh: 'giggle', boop: 'boop', purr: 'purr', dizzy: 'dizzy', love: 'sparkle' }[s.mood] ?? 'pop'] as [number, string]),
  [AT.outro, 'pop'],
  [AT.outro + 14, 'levelup', 0.8],
  [AT.outro + 30, 'sparkle'],
];

const Sounds: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  return (
    <>
      <Audio
        src={staticFile('music.wav')}
        // Musik pelan di awal, lalu sedikit turun di bagian akhir.
        volume={(f) => interpolate(f, [0, 20, durationInFrames - 45, durationInFrames], [0, 0.66, 0.66, 0], clamp)}
      />
      {SFX.map(([at, name, volume = 0.85]) => (
        <Sequence key={`${at}-${name}`} from={at} durationInFrames={45}>
          <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
        </Sequence>
      ))}
    </>
  );
};

// ---------- Susunan ----------

export const Promo: React.FC = () => {
  let at = 0;
  const next = (length: number) => {
    const from = at;
    at += length;
    return { from, durationInFrames: length };
  };
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.text }}>
      <Background />
      <Sounds />
      <Sequence {...next(INTRO)}>
        <Intro />
      </Sequence>
      <Sequence {...next(DESKTOP)}>
        <Desktop />
      </Sequence>
      {FEATURE_LIST.map((feature, i) => (
        <Sequence key={feature.title} {...next(FEATURE)}>
          <FeatureScene feature={feature} index={i} />
        </Sequence>
      ))}
      <Sequence {...next(PLAY)}>
        <Play />
      </Sequence>
      <Sequence {...next(OUTRO)}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};

export const PROMO_FPS = FPS;
