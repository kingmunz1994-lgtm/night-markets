// ── Night Markets — Sound Engine (Web Audio API, zero audio files) ─

const NightSounds = (() => {
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, type, dur, vol = 0.22, t0 = 0) {
    if (!enabled) return;
    try {
      const c = ac();
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type;
      o.frequency.setValueAtTime(freq, c.currentTime + t0);
      g.gain.setValueAtTime(0,    c.currentTime + t0);
      g.gain.linearRampToValueAtTime(vol,   c.currentTime + t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t0 + dur);
      o.start(c.currentTime + t0);
      o.stop(c.currentTime  + t0 + dur + 0.02);
    } catch {}
  }

  function noise(dur, vol = 0.07, t0 = 0) {
    if (!enabled) return;
    try {
      const c = ac();
      const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      src.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(vol, c.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t0 + dur);
      src.start(c.currentTime + t0);
      src.stop(c.currentTime  + t0 + dur + 0.02);
    } catch {}
  }

  return {
    toggle() {
      enabled = !enabled;
      const btn = document.getElementById('sound-toggle');
      if (btn) btn.textContent = enabled ? '🔊' : '🔇';
      return enabled;
    },
    isEnabled() { return enabled; },

    // Satisfying pop when adding to cart
    addToCart() {
      tone(880, 'sine', 0.06, 0.20);
      tone(1200, 'sine', 0.05, 0.12, 0.04);
      noise(0.02, 0.06, 0.01);
    },

    // Soft click for removes / minor interactions
    click() {
      noise(0.03, 0.08);
      tone(400, 'sine', 0.04, 0.08);
    },

    // Dramatic sealed-bid sound — tension builds
    bid() {
      tone(120, 'sawtooth', 0.35, 0.18);
      tone(180, 'sawtooth', 0.25, 0.14, 0.10);
      tone(240, 'sine',     0.20, 0.12, 0.22);
      noise(0.08, 0.05, 0.30);
    },

    // ZK proof — ethereal shimmer (vault locking)
    zkProof() {
      [660, 880, 1100, 1320].forEach((f, i) =>
        tone(f, 'triangle', 0.14, 0.16, i * 0.08)
      );
      noise(0.06, 0.04, 0.05);
    },

    // Escrow locked / funds confirmed
    escrow() {
      tone(330, 'sine', 0.10, 0.20);
      tone(440, 'sine', 0.10, 0.22, 0.08);
      tone(550, 'sine', 0.14, 0.18, 0.16);
      noise(0.04, 0.05, 0.18);
    },

    // Order confirmed — bright ascending success fanfare
    checkout() {
      [440, 550, 660, 880, 1100].forEach((f, i) =>
        tone(f, 'sine', 0.22, 0.24, i * 0.09)
      );
    },

    // Listing created — creation ping
    listing() {
      tone(1400, 'sine', 0.06, 0.20);
      tone(1000, 'sine', 0.10, 0.16, 0.05);
      tone(1200, 'sine', 0.08, 0.14, 0.11);
      noise(0.04, 0.06, 0.02);
    },

    // Vault item minted — digital sparkle
    mint() {
      [1600, 1800, 2000, 2200, 2000, 1800].forEach((f, i) =>
        tone(f, 'sine', 0.06, 0.15, i * 0.06)
      );
      noise(0.05, 0.04, 0.02);
    },

    // Auction countdown tick
    tick() {
      tone(660, 'sine', 0.035, 0.10);
    },

    // Price update — subtle blip
    priceUpdate() {
      tone(880, 'sine', 0.04, 0.07);
    },
  };
})();
