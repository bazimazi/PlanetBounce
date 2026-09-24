import { clamp } from '../core/math';

/**
 * Procedural WebAudio engine. Sound communicates physics: pitch rises with speed, a low
 * harmonic hum swells inside gravity wells, slingshots sweep upward, orbits pulse.
 * No audio files — everything is synthesized, so it stays tiny and adaptive.
 */

const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

export interface AudioState {
  flying: boolean;
  speed: number;
  well: number;
  thrust: number;
  danger: number;
  paused: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private delay!: DelayNode;
  private speedOsc!: OscillatorNode;
  private speedGain!: GainNode;
  private speedFilter!: BiquadFilterNode;
  private wellGain!: GainNode;
  private wellOsc!: OscillatorNode;
  private wellOsc2!: OscillatorNode;
  private thrustGain!: GainNode;
  private thrustFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private nextNote = 0;
  private dangerNext = 0;
  root = 146.83;
  sfxVolume = 0.8;
  musicVolume = 0.5;

  get ready(): boolean {
    return !!this.ctx;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);

    // Echo send for a sense of space.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2200;
    this.delay.connect(dl);
    dl.connect(fb);
    fb.connect(this.delay);
    dl.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Continuous layers.
    this.speedFilter = ctx.createBiquadFilter();
    this.speedFilter.type = 'lowpass';
    this.speedFilter.frequency.value = 900;
    this.speedGain = ctx.createGain();
    this.speedGain.gain.value = 0;
    this.speedOsc = ctx.createOscillator();
    this.speedOsc.type = 'triangle';
    this.speedOsc.frequency.value = 110;
    this.speedOsc.connect(this.speedFilter);
    this.speedFilter.connect(this.speedGain);
    this.speedGain.connect(this.sfx);
    this.speedOsc.start();

    this.wellGain = ctx.createGain();
    this.wellGain.gain.value = 0;
    this.wellOsc = ctx.createOscillator();
    this.wellOsc.frequency.value = 55;
    this.wellOsc2 = ctx.createOscillator();
    this.wellOsc2.frequency.value = 82.5;
    this.wellOsc2.type = 'sine';
    const w2 = ctx.createGain();
    w2.gain.value = 0.5;
    this.wellOsc.connect(this.wellGain);
    this.wellOsc2.connect(w2);
    w2.connect(this.wellGain);
    this.wellGain.connect(this.sfx);
    this.wellOsc.start();
    this.wellOsc2.start();

    const tn = ctx.createBufferSource();
    tn.buffer = this.noise;
    tn.loop = true;
    this.thrustFilter = ctx.createBiquadFilter();
    this.thrustFilter.type = 'bandpass';
    this.thrustFilter.frequency.value = 500;
    this.thrustFilter.Q.value = 0.8;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    tn.connect(this.thrustFilter);
    this.thrustFilter.connect(this.thrustGain);
    this.thrustGain.connect(this.sfx);
    tn.start();

    // Ambient pad.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 480;
    padFilter.connect(this.padGain);
    this.padGain.connect(this.music);
    for (const det of [-7, 5, 0]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = this.root / 2;
      o.detune.value = det;
      o.connect(padFilter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(padFilter.frequency);
    lfo.start();
    this.padGain.gain.setTargetAtTime(0.035, ctx.currentTime, 3);
    this.setVolumes(this.sfxVolume, this.musicVolume);
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
  }

  update(s: AudioState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const flying = s.flying && !s.paused;
    this.speedOsc.frequency.setTargetAtTime(90 + s.speed * 0.42, t, 0.08);
    this.speedFilter.frequency.setTargetAtTime(500 + s.speed * 2.2, t, 0.1);
    this.speedGain.gain.setTargetAtTime(flying ? clamp(s.speed / 600, 0.1, 1) * 0.05 : 0, t, 0.12);
    const well = flying ? clamp(s.well / 260, 0, 1) : 0;
    this.wellGain.gain.setTargetAtTime(well * 0.16, t, 0.15);
    this.wellOsc.frequency.setTargetAtTime(48 + well * 20, t, 0.2);
    this.wellOsc2.frequency.setTargetAtTime(72 + well * 34, t, 0.2);
    this.thrustGain.gain.setTargetAtTime(flying ? s.thrust * 0.22 : 0, t, 0.04);
    this.thrustFilter.frequency.setTargetAtTime(380 + s.thrust * 500, t, 0.05);

    // Generative ambient notes.
    if (!s.paused && t > this.nextNote) {
      this.nextNote = t + 2.2 + Math.random() * 3.5;
      const deg = SCALE[Math.floor(Math.random() * 7)]!;
      this.tone(this.root * 2 * Math.pow(2, deg / 12), 0.022, 2.8, 'sine', true, this.music, 0.9);
    }
    // Danger heartbeat near lethal bodies.
    if (s.danger > 0.05 && flying && t > this.dangerNext) {
      this.dangerNext = t + clamp(1.1 - s.danger, 0.35, 1.1);
      this.tone(52, 0.18 * s.danger, 0.22, 'sine');
      this.tone(46, 0.14 * s.danger, 0.2, 'sine', false, this.sfx, 0.01, 0.13);
    }
  }

  private note(deg: number, oct = 1): number {
    const i = ((deg % SCALE.length) + SCALE.length) % SCALE.length;
    return this.root * oct * Math.pow(2, SCALE[i]! / 12);
  }

  private tone(freq: number, gain: number, dur: number, type: OscillatorType = 'sine', echo = false, bus?: GainNode, attack = 0.005, delay = 0, endFreq?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus ?? this.sfx);
    if (echo) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(gain: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  launch(power: number): void {
    this.noiseBurst(0.25 + power * 0.2, 0.35, 'bandpass', 300, 1800 + power * 1500, 1.2);
    this.tone(180 + power * 60, 0.12, 0.25, 'sine', false, undefined, 0.005, 0, 380 + power * 220);
  }

  bounce(speed: number): void {
    this.tone(160 + Math.min(speed, 500) * 0.5, 0.2, 0.16, 'triangle');
    this.noiseBurst(0.18, 0.12, 'lowpass', 900, 120);
  }

  land(chain: number, soft: boolean): void {
    this.tone(95, 0.35, 0.28, 'sine', false, undefined, 0.004, 0, 48);
    this.noiseBurst(0.15, 0.2, 'lowpass', 600, 80);
    const n = this.note(chain, 2);
    this.tone(n, 0.1, 1.2, 'sine', true, undefined, 0.01, 0.05);
    this.tone(n * 1.5, 0.05, 1.0, 'triangle', true, undefined, 0.01, 0.12);
    if (soft) this.tone(n * 2, 0.05, 1.3, 'sine', true, undefined, 0.01, 0.2);
  }

  collect(amount: number): void {
    const steps = Math.min(5, 2 + Math.floor(amount / 10));
    for (let i = 0; i < steps; i++) this.tone(this.note(i * 2 + 4, 2), 0.07, 0.3, 'triangle', true, undefined, 0.004, 0.2 + i * 0.06);
  }

  assist(gain: number): void {
    this.tone(260, 0.12, 0.7, 'sine', true, undefined, 0.02, 0, 820 + clamp(gain, 0, 1) * 600);
    this.tone(390, 0.07, 0.7, 'triangle', true, undefined, 0.05, 0.05, 1230);
  }

  orbit(count: number): void {
    const n = this.note(count + 2, 2);
    for (let i = 0; i < 3; i++) this.tone(n, 0.07, 0.18, 'sine', false, undefined, 0.01, i * 0.14);
  }

  whoosh(): void {
    this.noiseBurst(0.22, 0.5, 'bandpass', 2400, 400, 2);
  }

  impact(hard: boolean): void {
    this.noiseBurst(hard ? 0.6 : 0.35, hard ? 0.5 : 0.25, 'lowpass', 1600, 60);
    this.tone(70, 0.4, 0.4, 'sine', false, undefined, 0.002, 0, 35);
  }

  crash(): void {
    this.noiseBurst(0.7, 1.4, 'lowpass', 2000, 40);
    this.tone(90, 0.4, 1.2, 'sawtooth', false, undefined, 0.002, 0, 30);
  }

  eruption(): void {
    this.noiseBurst(0.6, 1.1, 'lowpass', 400, 50, 0.7);
    this.tone(60, 0.3, 0.8, 'sine', false, undefined, 0.02, 0, 40);
  }

  ability(id: string): void {
    switch (id) {
      case 'brake':
        this.tone(700, 0.12, 0.4, 'sine', false, undefined, 0.005, 0, 180);
        this.noiseBurst(0.2, 0.3, 'bandpass', 1400, 200, 2);
        break;
      case 'hook':
        this.tone(1200, 0.1, 0.25, 'triangle');
        this.tone(300, 0.1, 0.6, 'sine', true, undefined, 0.02, 0.05, 600);
        break;
      case 'orbitLock':
        for (const k of [0, 2, 4]) this.tone(this.note(k, 2), 0.07, 0.9, 'sine', true, undefined, 0.02, k * 0.03);
        break;
      default:
        this.noiseBurst(0.35, 0.4, 'highpass', 300, 3000, 0.8);
        this.tone(220, 0.14, 0.4, 'sawtooth', false, undefined, 0.005, 0, 880);
    }
  }

  denied(): void {
    this.tone(160, 0.1, 0.15, 'square');
    this.tone(120, 0.1, 0.15, 'square', false, undefined, 0.005, 0.1);
  }

  discovery(): void {
    [0, 2, 4, 7, 9].forEach((d, i) => this.tone(this.note(d, 2), 0.09, 1.4, 'sine', true, undefined, 0.01, i * 0.11));
  }

  achievement(): void {
    [4, 6, 8, 11].forEach((d, i) => this.tone(this.note(d, 2), 0.1, 1.1, 'triangle', true, undefined, 0.005, i * 0.08));
  }

  signal(): void {
    [0, 0.14, 0.28, 0.7].forEach((dl) => this.tone(1320, 0.05, 0.08, 'square', true, undefined, 0.002, dl));
  }

  gate(): void {
    [0, 4, 7, 12].forEach((d, i) => this.tone(this.note(d, 1) * 2, 0.08, 2, 'sine', true, undefined, 0.2, i * 0.05));
  }

  fail(): void {
    [4, 2, 0].forEach((d, i) => this.tone(this.note(d, 1), 0.1, 0.6, 'triangle', true, undefined, 0.01, i * 0.18));
  }

  ui(): void {
    this.tone(1400, 0.04, 0.05, 'sine');
  }
}
