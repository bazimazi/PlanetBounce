import './ui/style.css';
import { clamp } from './core/math';
import { dailySeed, randomSeed } from './core/rng';
import type { AbilityId } from './data/abilities';
import { Game } from './game/game';
import { Telemetry } from './game/telemetry';
import { AudioEngine } from './presentation/audio';
import { Haptics } from './presentation/haptics';
import { Renderer } from './presentation/renderer';
import { buyTech } from './progression/progression';
import { clearRun, loadProfile, loadRunJson, newProfile, saveProfile, type Profile } from './progression/profile';
import type { RunData } from './run/runState';
import { UI, type AppApi } from './ui/ui';

/** Wires simulation, presentation, UI, persistence and input together. */
class App implements AppApi {
  profile: Profile;
  game: Game;
  readonly audio = new AudioEngine();
  readonly haptics = new Haptics();
  readonly telemetry = new Telemetry();
  readonly renderer: Renderer;
  readonly ui: UI;
  private last = performance.now();
  private chain = 0;

  constructor(private canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.profile = loadProfile();
    this.game = new Game(this.profile);
    this.renderer = new Renderer(canvas, this.game, () => this.profile.settings);
    this.ui = new UI(this, uiRoot);
    this.wire();
    this.bindInput();
    this.applySettings();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.game.mode === 'run' && this.game.world && this.ui.current === 'none') this.pause(true);
        this.game.saveRun();
        saveProfile(this.profile);
        this.telemetry.flush();
      }
    });
    if (!this.profile.tutorialDone) {
      this.beginTutorial();
    } else {
      this.ui.showHub();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // ───────────── AppApi ─────────────

  savedRun(): RunData | null {
    const r = loadRunJson<RunData>();
    return r && r.version === 1 ? r : null;
  }

  startRun(regionId: string, daily?: { seed: number; label: string }): void {
    this.audio.unlock();
    clearRun();
    this.ui.close();
    this.ui.showLoading();
    this.game.startRun(daily ? daily.seed : randomSeed(), regionId, daily?.label);
    this.telemetry.track('runStart', { regionId, daily: !!daily });
  }

  startDaily(): void {
    this.startRun('innerBelt', dailySeed());
  }

  resumeRun(): void {
    const r = this.savedRun();
    if (!r) return this.ui.showHub();
    this.audio.unlock();
    this.ui.close();
    this.ui.showLoading('Restoring expedition…');
    this.game.resumeRun(r);
  }

  abandonRun(): void {
    this.game.paused = false;
    this.game.finishRun('lost');
  }

  toHub(): void {
    this.game.paused = false;
    this.game.stop();
    this.ui.showHud(false);
    this.ui.setPrompt('');
    this.ui.showHub();
  }

  pause(on: boolean): void {
    if (!this.game.world) return;
    this.game.paused = on;
    this.game.cancelInput();
    if (on) this.ui.showPause();
    else this.ui.close();
  }

  recall(): void {
    const g = this.game;
    if (g.phase === 'incident' || g.phase === 'flight') {
      g.recall();
      if ((g.phase as string) === 'landed' || g.mode === 'tutorial') this.ui.close();
    }
  }

  chooseModule(id: string | null): void {
    this.ui.close();
    this.ui.showLoading();
    this.game.chooseModule(id);
    this.telemetry.track('moduleChoice', { id });
  }

  extract(): void {
    const g = this.game;
    const final = g.world?.meta.kind === 'boss';
    g.finishRun(final ? 'complete' : 'extracted');
  }

  endAfterIncident(): void {
    this.game.finishRun('lost', this.game.incident ?? undefined);
  }

  buyTech(id: string): void {
    if (buyTech(this.profile, id)) {
      this.audio.achievement();
      this.game.applyStats();
      saveProfile(this.profile);
      this.telemetry.track('tech', { id });
    }
  }

  setEquipped(ids: AbilityId[]): void {
    this.profile.equipped = ids;
    saveProfile(this.profile);
  }

  applySettings(): void {
    const s = this.profile.settings;
    this.audio.setVolumes(s.sfx, s.music);
    this.haptics.enabled = s.haptics;
    this.game.camera.shakeScale = s.shake;
    this.telemetry.enabled = s.telemetry;
    this.ui.applySettings(s);
    saveProfile(this.profile);
  }

  resetProgress(): void {
    clearRun();
    const fresh = newProfile();
    fresh.settings = { ...this.profile.settings };
    Object.assign(this.profile, fresh);
    saveProfile(this.profile);
    this.beginTutorial();
  }

  replayTutorial(): void {
    this.beginTutorial();
  }

  click(): void {
    this.audio.unlock();
    this.audio.ui();
  }

  // ───────────── Flow ─────────────

  private beginTutorial(): void {
    this.game.stop();
    this.ui.close();
    this.ui.showHud(true);
    this.game.startTutorial(0);
  }

  private onResize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  private frame(now: number): void {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    const g = this.game;
    g.update(dt);
    this.renderer.render(dt, now / 1000);
    this.ui.updateHud();
    const s = g.probe;
    let danger = 0;
    if (g.world && g.phase === 'flight') {
      for (const b of g.world.bodies) {
        if (!b.type.lethal && !b.type.atmosphereDrag) continue;
        const d = Math.hypot(s.x - g.frame.x[b.index]!, s.y - g.frame.y[b.index]!) - b.coreRadius;
        danger = Math.max(danger, clamp(1 - d / (b.radius * 2.2), 0, 1));
      }
    }
    this.audio.update({
      flying: g.phase === 'flight',
      speed: Math.hypot(s.vx, s.vy),
      well: s.domAccel,
      thrust: s.thrustX || s.thrustY ? g.thrust.mag : 0,
      danger,
      paused: g.paused,
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  private screenOf(x: number, y: number): [number, number] {
    const c = this.game.camera;
    return [c.toScreenX(x), c.toScreenY(y)];
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (this.ui.current !== 'none') return;
      c.setPointerCapture(e.pointerId);
      this.game.pointerDown(e.pointerId, e.clientX, e.clientY, performance.now());
    });
    c.addEventListener('pointermove', (e) => this.game.pointerMove(e.pointerId, e.clientX, e.clientY));
    const up = (e: PointerEvent) => this.game.pointerUp(e.pointerId, e.clientX, e.clientY, performance.now());
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.game.aim.pointer || e.pointerId === this.game.thrust.pointer) this.game.cancelInput();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      const g = this.game;
      if (e.key === 'Escape' && g.world && (this.ui.current === 'none' || this.ui.current === 'pause')) this.pause(this.ui.current === 'none');
      const idx = ['1', '2'].indexOf(e.key);
      if (idx >= 0) {
        const id = g.equippedAbilities()[idx];
        if (id) g.useAbility(id);
      }
      if (e.key === 'r' && g.phase === 'flight') this.recall();
    });
  }

  // ───────────── Feedback: every important action is felt ─────────────

  private wire(): void {
    const ev = this.game.events;
    const P = this.renderer.particles;
    const cam = this.game.camera;
    const A = this.audio;
    const H = this.haptics;
    const T = this.telemetry;
    const color = (i: number) => this.game.world?.bodies[i]?.type.palette.light ?? '#ffffff';

    ev.on('launch', (e) => {
      const power = clamp(e.speed / this.game.stats.maxLaunch, 0, 1);
      A.launch(power);
      P.burst(e.x, e.y, 16 + power * 20, 140 + power * 180, 0.5, 4, '#bfefff', { dirX: -e.dirX, dirY: -e.dirY, spread: 1.6 });
      cam.shake(1.5 + power * 3);
      H.pulse(10 + Math.round(power * 15));
      this.renderer.resetTrail();
      this.ui.setPrompt('');
      T.track('launch', { speed: Math.round(e.speed) });
    });
    ev.on('bounce', (e) => {
      A.bounce(e.speed);
      P.burst(e.x, e.y, 10 + e.speed / 30, e.speed * 0.5, 0.6, 3.5, color(e.body), { additive: false });
      cam.shake(Math.min(8, e.speed / 60));
      H.pulse(12);
    });
    ev.on('land', (e) => {
      const soft = e.speed < 55;
      A.land(this.chain++, soft);
      P.burst(e.x, e.y, soft ? 12 : 22, 90, 0.8, 3.5, color(e.body), { additive: false, drag: 3 });
      P.ring(e.x, e.y, 6, 18, 60, 0.5, 2.5, '#e8fbff');
      cam.shake(soft ? 1 : 3);
      H.pulse(soft ? 8 : 18);
      if (this.game.mode === 'run') {
        const b = this.game.world!.bodies[e.body]!;
        if (e.first && b.index !== this.game.world!.goalBody) this.ui.hint(b.name, 1600);
      }
      if (e.first && this.game.world!.bodies[e.body]!.index === this.game.world!.goalBody) A.gate();
      T.track('land', { type: this.game.world!.bodies[e.body]!.type.id, speed: Math.round(e.speed) });
    });
    ev.on('reward', (e) => {
      const [sx, sy] = this.screenOf(e.x, e.y);
      let dy = -30;
      for (const m of e.maneuvers) {
        this.ui.popup(sx, sy + dy, m.name, 'maneuver');
        dy -= 26;
      }
      const parts: string[] = [];
      if (e.matter) parts.push(`+${e.matter} ◆`);
      if (e.fuel) parts.push(`+${e.fuel} fuel`);
      if (e.energy) parts.push(`+${e.energy} ϟ`);
      if (e.data) parts.push(`+${e.data} ◈`);
      if (parts.length) this.ui.popup(sx, sy + dy, parts.join('  '), 'reward');
      if (e.multiplier > 1.01) this.ui.popup(sx, sy + dy - 26, `×${e.multiplier.toFixed(2)}`, 'mult');
      if (e.matter) A.collect(e.matter);
      P.burst(e.x, e.y, 14, 120, 0.9, 3, '#ffd9a8', { drag: 2 });
    });
    ev.on('impact', (e) => {
      A.impact(e.damaged);
      P.burst(e.x, e.y, 26, 240, 0.6, 3.5, e.damaged ? '#ff7a5a' : '#ffd0a0');
      cam.shake(e.damaged ? 14 : 6);
      H.pulse(e.damaged ? [40, 30, 40] : 20);
      if (e.damaged) {
        const [sx, sy] = this.screenOf(e.x, e.y);
        this.ui.popup(sx, sy - 30, e.asteroid ? 'Asteroid hit −1 hull' : `Hard impact −1 hull`, 'bad');
      }
      T.track('impact', { speed: Math.round(e.speed), asteroid: e.asteroid });
    });
    ev.on('crash', (e) => {
      A.crash();
      P.burst(e.x, e.y, 60, 320, 1.2, 5, '#ffb070');
      P.burst(e.x, e.y, 30, 160, 1.6, 3, '#ffffff');
      cam.shake(20);
      H.pulse([60, 40, 80]);
    });
    ev.on('eject', (e) => {
      A.eruption();
      P.burst(e.x, e.y, 50, 300, 1, 5, '#ff7a2a');
      cam.shake(12);
      H.pulse([30, 20, 50]);
      this.ui.hint('Eruption! Use the throw — or correct with thrust', 2400);
    });
    ev.on('collapse', (e) => {
      A.crash();
      const b = this.game.world!.bodies[e.body]!;
      const bx = this.game.frame.x[b.index]!;
      const by = this.game.frame.y[b.index]!;
      P.burst(bx, by, 80, 200, 2, 7, b.type.palette.base, { additive: false, drag: 0.6 });
      cam.shake(16);
    });
    ev.on('assist', (e) => {
      A.assist(e.gain);
      const [sx, sy] = this.screenOf(e.x, e.y);
      this.ui.popup(sx, sy - 24, e.gain > 0.05 ? `Slingshot +${Math.round(e.gain * 100)}%` : 'Gravity Assist', 'maneuver');
      P.burst(e.x, e.y, 18, 160, 0.7, 3, '#aee9ff');
      H.pulse(8);
      T.track('assist', { body: this.game.world!.bodies[e.body]!.type.id, gain: +e.gain.toFixed(2) });
    });
    ev.on('orbit', (e) => {
      A.orbit(e.count);
      const [sx, sy] = this.screenOf(e.x, e.y);
      this.ui.popup(sx, sy - 24, e.count > 1 ? `Orbit ×${e.count}` : 'Orbit!', 'maneuver');
      H.pulse(6);
    });
    ev.on('closePass', (e) => {
      A.whoosh();
      if (e.boosted) {
        P.burst(e.x, e.y, 16, 200, 0.5, 3, '#ffd36b');
        const [sx, sy] = this.screenOf(e.x, e.y);
        this.ui.popup(sx, sy - 24, 'Coil boost', 'maneuver');
      }
    });
    ev.on('aerobrake', (e) => {
      const [sx, sy] = this.screenOf(e.x, e.y);
      this.ui.popup(sx, sy - 24, 'Aerobrake', 'maneuver');
    });
    ev.on('ability', (e) => {
      A.ability(e.id);
      P.ring(e.x, e.y, 10, 20, 140, 0.5, 3, '#ffffff');
      H.pulse(10);
      T.track('ability', { id: e.id });
    });
    ev.on('abilityFail', (e) => {
      A.denied();
      this.ui.hint(e.reason, 1400);
    });
    ev.on('discovery', (e) => {
      A.discovery();
      this.ui.toast(`Discovered: ${e.name}`, e.text, 'discovery');
      T.track('discovery', { id: e.id });
    });
    ev.on('achievement', (e) => {
      A.achievement();
      this.ui.toast(`Mastery: ${e.name}`, e.description, 'achievement');
      H.pulse([15, 40, 15]);
    });
    ev.on('signal', () => {
      A.signal();
      this.ui.toast('Unknown signal', 'Something artificial is transmitting nearby. Follow the green marker.', 'signal');
    });
    ev.on('reveal', (e) => {
      A.discovery();
      P.ring(e.x, e.y, 30, 40, 120, 1.2, 4, '#6bffb0');
      cam.shake(4);
      this.renderer.highlightBody = e.body;
      this.renderer.highlightUntil = performance.now() / 1000 + 4;
    });
    ev.on('hint', (e) => this.ui.hint(e.text));
    ev.on('inspect', (e) => this.ui.inspect(e.body));
    ev.on('incident', (e) => {
      this.renderer.incidentStart = performance.now() / 1000;
      A.fail();
      this.chain = 0;
      setTimeout(() => {
        if (this.game.phase === 'incident') this.ui.showIncident(e.report, e.final, e.hullCost);
      }, 700);
      T.track('failure', { cause: e.report.cause, final: e.final });
    });
    ev.on('recall', () => {
      this.renderer.resetTrail();
      this.chain = 0;
    });
    ev.on('sectorStart', (e) => {
      this.ui.close();
      this.ui.showHud(true);
      this.ui.rebuildAbilities();
      this.renderer.resetTrail();
      this.renderer.particles.clear();
      this.chain = 0;
      if (!e.resumed) this.ui.showBanner(e.world.meta.name, e.world.meta.subtitle);
      else this.ui.showBanner('Expedition restored', `${e.world.meta.name} — you are where you left off`);
      T.track('sectorStart', { index: e.world.meta.index, kind: e.world.meta.kind });
    });
    ev.on('sectorComplete', (e) => {
      A.gate();
      setTimeout(() => this.ui.showSectorComplete(e.final, e.choices), e.final ? 900 : 700);
    });
    ev.on('runEnd', (s) => {
      this.ui.showHud(false);
      this.ui.showResults(s);
      T.track('runEnd', { outcome: s.outcome, score: s.score, sectors: s.run.sectorsCleared });
      this.telemetry.flush();
    });
    ev.on('tutorialStep', (e) => {
      this.ui.showHud(true);
      this.ui.rebuildAbilities();
      this.ui.setPrompt(e.step.prompt);
      this.ui.showBanner(e.step.name, `Lesson ${e.index + 1} of 3`, 1800);
      this.renderer.resetTrail();
    });
    ev.on('tutorialFail', (e) => {
      this.ui.close();
      this.ui.setPrompt(e.demo ? `${e.text} — follow the golden path` : e.text);
    });
    ev.on('tutorialAdvance', (e) => {
      this.ui.setPrompt('');
      this.ui.showBanner(e.text, e.done ? '' : 'Next →', 1700);
      A.gate();
      setTimeout(() => {
        if (this.game.mode !== 'tutorial') return;
        if (!e.done) this.game.nextTutorialStep();
        else {
          const first = !this.profile.tutorialDone;
          this.profile.tutorialDone = true;
          saveProfile(this.profile);
          T.track('tutorialDone');
          this.ui.showTutorialDone(() => {
            if (first) this.startRun('innerBelt');
            else this.toHub();
          });
        }
      }, 1900);
    });
    ev.on('hull', (e) => {
      if (e.delta < 0) H.pulse([30, 30, 30]);
    });
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const app = new App(canvas, ui);
if (import.meta.env.DEV) void import('./game/debug').then((m) => m.installDebug(app.game, app));
