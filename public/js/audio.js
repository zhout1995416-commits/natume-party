// 环境声音：全部用 WebAudio 实时合成，不需要音频文件。默认关闭，用户点按钮后才启动。
export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.state = { rain: false, winter: false, night: false, birds: false, crickets: false };
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const lfo = (freq, depth, target) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = depth;
      o.connect(g).connect(target); o.start();
    };

    // 流水
    this.water = ctx.createGain(); this.water.gain.value = 0;
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 520; wbp.Q.value = 0.6;
    loop(brown).connect(wbp).connect(this.water).connect(this.master);
    lfo(0.13, 120, wbp.frequency);

    // 雨
    this.rain = ctx.createGain(); this.rain.gain.value = 0;
    const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 700;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 5200;
    loop(white).connect(rhp).connect(rlp).connect(this.rain).connect(this.master);

    // 风（冬天、雨天）
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 340;
    loop(brown).connect(wlp).connect(this.wind).connect(this.master);
    lfo(0.07, 160, wlp.frequency);

    this.timer = setInterval(() => this.tick(), 250);
    this.apply();
  }

  async toggle() {
    if (!this.ctx) this.init();
    const t = this.ctx.currentTime;
    if (this.on) {
      this.on = false;
      this.master.gain.setTargetAtTime(0, t, 0.15);
      setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 600);
    } else {
      await this.ctx.resume();
      this.on = true;
      this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
    }
    return this.on;
  }

  update(s) {
    Object.assign(this.state, s);
    if (this.ctx) this.apply();
  }

  apply() {
    const s = this.state, t = this.ctx.currentTime;
    this.water.gain.setTargetAtTime(s.winter ? 0.04 : 0.22, t, 0.8);
    this.rain.gain.setTargetAtTime(s.rain && !s.winter ? 0.42 : 0, t, 0.8);
    this.wind.gain.setTargetAtTime(s.winter ? (s.rain ? 0.32 : 0.16) : (s.rain ? 0.1 : 0.02), t, 0.8);
  }

  tick() {
    if (!this.on) return;
    const s = this.state;
    if (s.crickets && Math.random() < 0.3) this.chirp();
    if (s.birds && Math.random() < 0.05) this.bird();
  }

  voice(pan = 0) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  chirp() {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator(), g = this.voice(Math.random() * 1.6 - 0.8);
    o.frequency.value = 4200 + Math.random() * 500;
    o.connect(g);
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.06;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.035, s + 0.012);
      g.gain.linearRampToValueAtTime(0, s + 0.04);
    }
    o.start(t); o.stop(t + 0.25);
  }

  bird() {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    const o = ctx.createOscillator(), g = this.voice(Math.random() * 1.4 - 0.7);
    o.type = 'sine';
    o.connect(g);
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2400 + Math.random() * 1200;
    for (let k = 0; k < n; k++) {
      const s = t0 + k * 0.17;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, s + 0.07);
      o.frequency.exponentialRampToValueAtTime(base * 1.1, s + 0.13);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.03, s + 0.02);
      g.gain.linearRampToValueAtTime(0, s + 0.13);
    }
    o.start(t0); o.stop(t0 + n * 0.17 + 0.1);
  }

  // ---- 交互音效 ----
  pop() {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = this.voice();
    o.type = 'triangle';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); o.start(t); o.stop(t + 0.2);
  }

  noiseBurst(freq, q, dur, vol) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.voice(); g.gain.value = vol;
    s.connect(f).connect(g); s.start(t);
  }

  rustle() { this.noiseBurst(3200, 0.7, 0.6, 0.5); }
  knock() { this.noiseBurst(900, 3, 0.12, 0.9); }
}
