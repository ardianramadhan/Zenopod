// Landing page Zenopod: Zeno hidup (pakai maskot asli dari aplikasi, docs/zeno/buddy.js),
// island yang berganti keadaan, dan animasi muncul saat di-scroll.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  // ---------- Zeno di hero ----------
  const hero = window.createBuddy();
  $('hero-zeno').append(hero.el);
  hero.setMood('greet');

  const REACTIONS = [
    ['laugh', 'Hehe, geli!'],
    ['starstruck', 'Wah, halo!'],
    ['wink', 'Hai kamu!'],
    ['love', 'Aku suka kamu'],
    ['surprised', 'Eh, kaget!'],
    ['smug', 'Keren, kan?'],
  ];
  let reactTimer = null;
  let sleeping = false;
  let lastMove = Date.now();
  const hint = $('hero-hint');

  function react(mood, text, ms = 1800) {
    clearTimeout(reactTimer);
    hero.setMood(mood);
    hero.jump();
    if (text) hint.textContent = text;
    reactTimer = setTimeout(() => {
      hero.setMood('happy');
      hint.textContent = 'Klik Zeno, atau diamkan kursormu.';
    }, ms);
  }

  $('hero-zeno').addEventListener('click', () => {
    const [mood, text] = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
    if (Math.random() < 0.3) hero.play('spin');
    react(mood, text);
  });
  $('hero-zeno').addEventListener('mouseenter', () => !sleeping && react('love', 'Dielus, senangnya', 1200));

  // Mata mengikuti kursor; diam 12 detik = tidur, bergerak lagi = bangun sambil menguap.
  window.addEventListener('pointermove', (event) => {
    lastMove = Date.now();
    if (sleeping) {
      sleeping = false;
      react('yawn', 'Hoaam, aku bangun!', 1400);
    }
    if (reduce) return;
    const r = hero.el.getBoundingClientRect();
    const dx = (event.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    const dy = (event.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
    hero.look(Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy)));
  }, { passive: true });
  setInterval(() => {
    if (!sleeping && Date.now() - lastMove > 12000) {
      sleeping = true;
      clearTimeout(reactTimer);
      hero.setMood('sleep');
      hint.textContent = 'Zzz… gerakkan kursor untuk membangunkan Zeno.';
    }
  }, 1000);
  setTimeout(() => !sleeping && hero.setMood('happy'), 2200);

  // ---------- Island hero: diam → jam → musik → Claude ----------
  const pills = [...document.querySelectorAll('.island img')];
  const pillMoods = ['happy', 'smug', 'music', 'work'];
  let pillIndex = 0;
  if (!reduce) {
    setInterval(() => {
      if (document.hidden) return;
      pills[pillIndex].classList.remove('on');
      pillIndex = (pillIndex + 1) % pills.length;
      pills[pillIndex].classList.add('on');
      // Zeno ikut menyesuaikan dengan isi kapsul (kecuali sedang bereaksi atau tidur).
      if (!sleeping && !document.querySelector('#hero-zeno .buddy.jump')) hero.setMood(pillMoods[pillIndex]);
    }, 3200);
  }

  // ---------- Kenalan dengan Zeno: coba ekspresi & kostum ----------
  const play = window.createBuddy();
  $('play-zeno').append(play.el);
  play.setMood('happy');

  const MOODS = [
    ['happy', 'Senang'], ['laugh', 'Tertawa'], ['wink', 'Kedip'], ['starstruck', 'Kagum'],
    ['love', 'Jatuh cinta'], ['surprised', 'Kaget'], ['think', 'Berpikir'], ['work', 'Bekerja'],
    ['music', 'Musik'], ['focus', 'Fokus'], ['sleep', 'Tidur'], ['angry', 'Marah'],
  ];
  const COSTUMES = [
    [null, 'Tanpa'], ['peci', 'Peci'], ['merahputih', 'Merah putih'], ['party', 'Pesta'], ['sunglasses', 'Kacamata'],
    ['ninja', 'Ninja'], ['tentara', 'Tentara'], ['natal', 'Natal'], ['koki', 'Koki'], ['wisuda', 'Wisuda'],
    ['proyek', 'Proyek'], ['polisi', 'Polisi'], ['dokter', 'Dokter'], ['pilot', 'Pilot'], ['pemadam', 'Pemadam'],
    ['lebaran', 'Lebaran'], ['umbrella', 'Payung'],
  ];

  function chips(box, list, current, onPick) {
    for (const [value, label] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(value === current));
      b.addEventListener('click', () => {
        for (const other of box.children) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        onPick(value);
        play.jump();
      });
      box.append(b);
    }
  }
  chips($('mood-chips'), MOODS, 'happy', (mood) => play.setMood(mood));
  chips($('costume-chips'), COSTUMES, null, (costume) => play.setCostume(costume));

  // ---------- Zeno kecil di footer ----------
  const foot = window.createBuddy();
  $('foot-zeno').append(foot.el);
  foot.setMood('work');

  // ---------- Muncul saat di-scroll ----------
  const items = document.querySelectorAll('[data-reveal]');
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  }
})();
