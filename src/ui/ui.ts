import { clamp, fmtInt } from '../core/math';
import { ABILITIES, type AbilityId } from '../data/abilities';
import { ACHIEVEMENTS } from '../data/achievements';
import { DISCOVERIES, LORE_FRAGMENTS, type DiscoveryCategory } from '../data/discoveries';
import type { ModuleDefinition } from '../data/modules';
import { moduleById } from '../data/modules';
import { REGIONS, regionById } from '../data/regions';
import { BRANCHES, TECH } from '../data/tech';
import type { Game, RunSummary } from '../game/game';
import { achievementProgress, nextGoals, techStatus } from '../progression/progression';
import { pickMemory, relativeTime, type Profile, type Settings } from '../progression/profile';
import type { FailureReport } from '../run/analysis';
import type { RunData } from '../run/runState';
import { clear, h, setText } from './dom';

/** What the UI can ask the app to do. */
export interface AppApi {
  readonly game: Game;
  readonly profile: Profile;
  savedRun(): RunData | null;
  startRun(regionId: string): void;
  startDaily(): void;
  resumeRun(): void;
  abandonRun(): void;
  toHub(): void;
  pause(on: boolean): void;
  recall(): void;
  chooseModule(id: string | null): void;
  extract(): void;
  endAfterIncident(): void;
  buyTech(id: string): void;
  setEquipped(ids: AbilityId[]): void;
  applySettings(): void;
  resetProgress(): void;
  replayTutorial(): void;
  click(): void;
}

type ScreenName = 'none' | 'hub' | 'tech' | 'atlas' | 'journal' | 'settings' | 'pause' | 'incident' | 'sector' | 'results' | 'loading' | 'tutorialDone';

export class UI {
  readonly root: HTMLElement;
  private hud: HTMLElement;
  private popups: HTMLElement;
  private toasts: HTMLElement;
  private screen: HTMLElement;
  private banner: HTMLElement;
  private promptEl: HTMLElement;
  private hintEl: HTMLElement;
  private inspectEl: HTMLElement;
  current: ScreenName = 'none';
  private screenReturn: ScreenName = 'hub';

  // HUD parts
  private hullEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private matterEl!: HTMLElement;
  private dataEl!: HTMLElement;
  private fuelBar!: HTMLElement;
  private energyBar!: HTMLElement;
  private barsEl!: HTMLElement;
  private speedEl!: HTMLElement;
  private abilitiesEl!: HTMLElement;
  private abilityButtons: { id: AbilityId; el: HTMLElement; ring: HTMLElement; cost: HTMLElement }[] = [];
  private recallBtn!: HTMLElement;
  private anchorEl!: HTMLElement;
  private hintTimer = 0;
  private inspectTimer = 0;
  private lastHull = -1;

  constructor(private app: AppApi, mount: HTMLElement) {
    this.root = mount;
    this.hud = h('div', { class: 'hud hidden' });
    this.popups = h('div', { class: 'popups' });
    this.toasts = h('div', { class: 'toasts' });
    this.banner = h('div', { class: 'banner' });
    this.promptEl = h('div', { class: 'prompt' });
    this.hintEl = h('div', { class: 'hint' });
    this.inspectEl = h('div', { class: 'inspect' });
    this.screen = h('div', { class: 'screen hidden' });
    mount.append(this.hud, this.popups, this.banner, this.promptEl, this.hintEl, this.inspectEl, this.screen, this.toasts);
    this.buildHud();
  }

  private get game(): Game {
    return this.app.game;
  }

  private get profile(): Profile {
    return this.app.profile;
  }

  applySettings(s: Settings): void {
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    this.root.classList.toggle('left-handed', s.leftHanded);
    this.root.classList.toggle('reduced', s.reducedEffects);
  }

  // ───────────────────────────── HUD ─────────────────────────────

  private buildHud(): void {
    this.hullEl = h('div', { class: 'hull', 'aria-label': 'Hull integrity' });
    this.titleEl = h('div', { class: 'sector-title' });
    this.progressEl = h('div', { class: 'progress-fill' });
    this.matterEl = h('span');
    this.dataEl = h('span');
    const pauseBtn = h('button', { class: 'icon-btn', 'aria-label': 'Pause', onClick: () => this.app.pause(true) }, 'II');
    this.fuelBar = h('div', { class: 'bar-fill fuel' });
    this.energyBar = h('div', { class: 'bar-fill energy' });
    this.anchorEl = h('div', { class: 'anchor' });
    this.barsEl = h(
      'div',
      { class: 'bars' },
      h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, 'FUEL'), h('div', { class: 'bar-track' }, this.fuelBar)),
      h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, 'ENERGY'), h('div', { class: 'bar-track' }, this.energyBar)),
      this.anchorEl,
    );
    this.speedEl = h('div', { class: 'speed' });
    this.abilitiesEl = h('div', { class: 'abilities' });
    this.recallBtn = h('button', { class: 'recall-btn hidden', onClick: () => this.app.recall() }, 'Recall');
    this.hud.append(
      h(
        'div',
        { class: 'topbar' },
        this.hullEl,
        h('div', { class: 'top-center' }, this.titleEl, h('div', { class: 'progress' }, this.progressEl)),
        h('div', { class: 'top-right' }, h('div', { class: 'res' }, h('span', { class: 'gem' }, '◆'), this.matterEl, h('span', { class: 'gem data' }, '◈'), this.dataEl), pauseBtn),
      ),
      h('div', { class: 'bottombar' }, this.barsEl, this.speedEl, h('div', { class: 'ability-col' }, this.recallBtn, this.abilitiesEl)),
    );
  }

  showHud(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
  }

  rebuildAbilities(): void {
    clear(this.abilitiesEl);
    this.abilityButtons = [];
    for (const id of this.game.equippedAbilities()) {
      const def = ABILITIES[id];
      const ring = h('div', { class: 'ab-ring' });
      const cost = h('div', { class: 'ab-cost' }, String(def.energy));
      const el = h(
        'button',
        {
          class: 'ability',
          style: `--ab:${def.color}`,
          'aria-label': def.name,
          onPointerdown: (e: PointerEvent) => {
            e.stopPropagation();
            this.game.useAbility(id);
          },
        },
        ring,
        h('div', { class: 'ab-glyph' }, def.glyph),
        h('div', { class: 'ab-name' }, def.short),
        cost,
      );
      this.abilitiesEl.appendChild(el);
      this.abilityButtons.push({ id, el, ring, cost });
    }
  }

  updateHud(): void {
    const g = this.game;
    const w = g.world;
    if (!w || this.hud.classList.contains('hidden')) return;
    const r = g.run;
    const tut = g.mode === 'tutorial';
    this.hud.classList.toggle('tutorial', tut);
    if (r) {
      if (r.hull !== this.lastHull || this.hullEl.childElementCount !== g.stats.hullMax) {
        clear(this.hullEl);
        for (let i = 0; i < g.stats.hullMax; i++) this.hullEl.appendChild(h('span', { class: i < r.hull ? 'pip on' : 'pip' }));
        if (this.lastHull > r.hull) {
          this.hullEl.classList.remove('flash');
          void this.hullEl.offsetWidth;
          this.hullEl.classList.add('flash');
        }
        this.lastHull = r.hull;
      }
      setText(this.matterEl, fmtInt(r.matter));
      setText(this.dataEl, fmtInt(r.data));
      this.fuelBar.style.width = `${clamp(r.fuel / g.stats.fuelMax, 0, 1) * 100}%`;
      this.energyBar.style.width = `${clamp(r.energy / g.stats.energyMax, 0, 1) * 100}%`;
      this.fuelBar.classList.toggle('low', r.fuel < g.stats.fuelMax * 0.2);
      this.progressEl.style.width = `${r.sectorProgress * 100}%`;
      setText(this.anchorEl, r.anchor > 1 ? `Anchor +${Math.round(r.anchor)}` : '');
      const region = regionById(r.regionId);
      const label = w.meta.kind === 'boss' ? region.boss.name : `${region.name} · ${r.sectorIndex + 1}/${region.sectors.length}`;
      setText(this.titleEl, r.daily ? `Daily · ${label}` : label);
    } else if (tut) {
      setText(this.titleEl, `First Light · ${g.tutorialIndex + 1}/3`);
      this.progressEl.style.width = `${((g.tutorialIndex + (g.phase === 'transition' ? 1 : 0)) / 3) * 100}%`;
    }
    const sp = Math.hypot(g.probe.vx, g.probe.vy);
    setText(this.speedEl, g.phase === 'flight' ? `${Math.round(sp)} u/s` : g.aim.valid ? `${Math.round(g.aim.speed)} u/s` : '');
    for (const b of this.abilityButtons) {
      const ready = g.abilityReady(b.id);
      const cd = g.cooldowns[b.id] / ABILITIES[b.id].cooldown;
      b.el.classList.toggle('ready', ready);
      b.el.classList.toggle('active', b.id === 'orbitLock' && g.probe.lockBody >= 0);
      b.ring.style.setProperty('--cd', String(cd));
      setText(b.cost, String(g.abilityCost(b.id)));
    }
    this.recallBtn.classList.toggle('hidden', !(g.phase === 'flight' && g.flightTime > 5));
    if (this.hintTimer > 0 && performance.now() > this.hintTimer) {
      this.hintEl.classList.remove('show');
      this.hintTimer = 0;
    }
    if (this.inspectTimer > 0 && performance.now() > this.inspectTimer) {
      this.inspectEl.classList.remove('show');
      this.inspectTimer = 0;
    }
  }

  // ───────────────────────────── Transient feedback ─────────────────────────────

  popup(sx: number, sy: number, text: string, cls = ''): void {
    const el = h('div', { class: `popup ${cls}`, style: `left:${sx}px;top:${sy}px` }, text);
    this.popups.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  toast(title: string, sub: string, kind: 'discovery' | 'achievement' | 'signal' | 'info' = 'info'): void {
    const icon = kind === 'discovery' ? '✦' : kind === 'achievement' ? '★' : kind === 'signal' ? '((·))' : 'i';
    const el = h('div', { class: `toast ${kind}` }, h('div', { class: 'toast-icon' }, icon), h('div', null, h('div', { class: 'toast-title' }, title), h('div', { class: 'toast-sub' }, sub)));
    this.toasts.appendChild(el);
    while (this.toasts.childElementCount > 2) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 3000);
    setTimeout(() => el.remove(), 3500);
  }

  hint(text: string, ms = 4200): void {
    setText(this.hintEl, text);
    this.hintEl.classList.add('show');
    this.hintTimer = performance.now() + ms;
  }

  setPrompt(text: string): void {
    setText(this.promptEl, text);
    this.promptEl.classList.toggle('show', !!text);
  }

  showBanner(title: string, sub: string, ms = 2600): void {
    clear(this.banner);
    this.banner.append(h('div', { class: 'banner-title' }, title), h('div', { class: 'banner-sub' }, sub));
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  inspect(bodyIdx: number): void {
    const g = this.game;
    const b = g.world?.bodies[bodyIdx];
    if (!b) return;
    clear(this.inspectEl);
    const unknown = b.tags.has('unknown') && !b.identified;
    const known = b.scanned || b.visited || g.mode === 'tutorial';
    const rows: HTMLElement[] = [];
    if (unknown) rows.push(h('div', null, 'Unknown signal. Land to identify — or research Deep Scan.'));
    else {
      rows.push(h('div', { class: 'insp-hint' }, b.type.hint));
      if (known && g.mode === 'run' && b.type.landable && !b.collected && b.index !== g.world!.goalBody) {
        const parts: string[] = [];
        if (b.matter) parts.push(`◆ ${Math.round(b.matter * g.stats.matterMult)} matter`);
        if (b.type.rewards.fuel) parts.push(`+${b.type.rewards.fuel} fuel`);
        if (b.type.rewards.energy) parts.push(`ϟ +${b.type.rewards.energy} energy`);
        if (b.type.rewards.data) parts.push(`◈ +${b.type.rewards.data} data`);
        if (parts.length) rows.push(h('div', { class: 'insp-rewards' }, parts.join('  ·  ')));
      } else if (!known) rows.push(h('div', { class: 'insp-muted' }, 'Out of scanner range — details unknown.'));
      if (b.tags.has('unstable')) rows.push(h('div', { class: 'insp-warn' }, '⚠ Unstable — collapses soon after landing'));
      if (b.collected && b.visited && g.mode === 'run') rows.push(h('div', { class: 'insp-muted' }, 'Already harvested'));
    }
    const danger = unknown ? '' : '●'.repeat(b.type.danger) + '○'.repeat(3 - b.type.danger);
    this.inspectEl.append(h('div', { class: 'insp-title' }, unknown ? 'Unknown Signal' : b.name, h('span', { class: 'insp-danger', title: 'Danger' }, danger)), ...rows);
    this.inspectEl.classList.add('show');
    this.inspectTimer = performance.now() + 3800;
  }

  // ───────────────────────────── Screens ─────────────────────────────

  private open(name: ScreenName, ...content: (HTMLElement | null)[]): void {
    this.current = name;
    clear(this.screen);
    this.screen.className = `screen screen-${name}`;
    const panel = h('div', { class: 'panel' }, ...content.filter((c): c is HTMLElement => !!c));
    this.screen.appendChild(panel);
    this.screen.scrollTop = 0;
  }

  close(): void {
    this.current = 'none';
    this.screen.className = 'screen hidden';
    clear(this.screen);
  }

  private btn(label: string, onClick: () => void, cls = '', sub?: string): HTMLElement {
    return h(
      'button',
      {
        class: `btn ${cls}`,
        onClick: () => {
          this.app.click();
          onClick();
        },
      },
      h('span', { class: 'btn-label' }, label),
      sub ? h('span', { class: 'btn-sub' }, sub) : null,
    );
  }

  private back(to: ScreenName = 'hub'): HTMLElement {
    return this.btn('← Back', () => (to === 'pause' ? this.showPause() : this.showHub()), 'ghost small');
  }

  showLoading(text = 'Charting sector…'): void {
    this.open('loading', h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('div', null, text)));
  }

  showHub(): void {
    const p = this.profile;
    const saved = this.app.savedRun();
    const memory = pickMemory(p);
    const unlockedRegions = REGIONS.filter((r) => !r.requires || p.discoveries[r.requires]);
    const ach = achievementProgress(p);
    const goals = nextGoals(p, 1);
    const regionBtns = unlockedRegions.map((r) => {
      const prog = p.regionProgress[r.id];
      const sub = prog?.completed ? 'Completed ✓' : prog ? `Best: sector ${prog.bestSector}/${r.sectors.length + 1}` : r.subtitle;
      return this.btn(saved ? `New: ${r.name}` : `Launch · ${r.name}`, () => this.app.startRun(r.id), saved ? '' : 'primary', sub);
    });
    const lockedRegions = REGIONS.filter((r) => r.requires && !p.discoveries[r.requires]).map(() =>
      h('div', { class: 'locked-region' }, h('div', { class: 'lr-name' }, '??? ', h('span', null, 'Signal beyond the Inner Belt')), h('div', { class: 'lr-sub' }, 'Complete the Inner Belt to chart it')),
    );
    this.open(
      'hub',
      h('div', { class: 'logo' }, h('div', { class: 'logo-orb' }), h('h1', null, 'PLANET', h('br'), 'BOUNCE')),
      memory ? h('p', { class: 'memory' }, memory) : h('p', { class: 'memory' }, 'Gravity is not an obstacle. It is your engine.'),
      h('div', { class: 'wallet' }, h('span', null, h('b', { class: 'gem' }, '◆ '), fmtInt(p.matter), ' matter'), h('span', null, h('b', { class: 'gem data' }, '◈ '), fmtInt(p.data), ' data')),
      h(
        'div',
        { class: 'menu' },
        saved ? this.btn('Continue Expedition', () => this.app.resumeRun(), 'primary', `${regionById(saved.regionId).name} · sector ${saved.sectorIndex + 1} · hull ${saved.hull}`) : null,
        ...regionBtns,
        ...lockedRegions,
        p.stats.runs > 0 ? this.btn('Daily Expedition', () => this.app.startDaily(), '', 'Same universe for everyone today') : null,
        h(
          'div',
          { class: 'menu-grid' },
          this.btn('Technology', () => this.showTech(), '', goals[0] ? `Next: ${goals[0].node.name}` : undefined),
          this.btn('Cosmic Atlas', () => this.showAtlas(), '', `${Object.keys(p.discoveries).length}/${DISCOVERIES.length}`),
          this.btn('Journal', () => this.showJournal(), '', `Mastery ${ach.done}/${ach.total}`),
          this.btn('Settings', () => this.showSettings('hub')),
        ),
      ),
      p.stats.bestScore ? h('div', { class: 'foot' }, `Best score ${fmtInt(p.stats.bestScore)} · ${p.stats.runs} expeditions · top speed ${fmtInt(p.stats.bestSpeed)} u/s`) : null,
    );
  }

  showTech(): void {
    const p = this.profile;
    const stats = this.game.stats;
    const cols = BRANCHES.map((br) => {
      const nodes = TECH.filter((t) => t.branch === br.id).sort((a, b) => a.lane - b.lane || a.tier - b.tier);
      return h(
        'div',
        { class: 'branch', style: `--br:${br.color}` },
        h('div', { class: 'branch-name' }, br.name),
        ...nodes.map((n) => {
          const st = techStatus(p, n);
          const cost = [n.cost.matter ? `◆ ${n.cost.matter}` : '', n.cost.data ? `◈ ${n.cost.data}` : ''].filter(Boolean).join('  ');
          return h(
            'button',
            {
              class: `tech ${st.status}`,
              onClick: () => {
                if (st.status === 'available') {
                  this.app.buyTech(n.id);
                  this.showTech();
                } else this.app.click();
              },
            },
            h('div', { class: 'tech-top' }, h('span', { class: 'tech-tier' }, `T${n.tier}`), h('span', { class: 'tech-name' }, n.name)),
            h('div', { class: 'tech-desc' }, n.description),
            h('div', { class: 'tech-foot' }, st.status === 'owned' ? '✓ Researched' : st.status === 'available' ? `Research · ${cost}` : st.status === 'gated' ? `🔒 ${st.reason}` : st.status === 'locked' ? st.reason : `${cost}`),
          );
        }),
      );
    });
    const unlocked = stats.unlockedAbilities;
    const equipped = new Set(p.equipped);
    const loadout = h(
      'div',
      { class: 'loadout' },
      h('div', { class: 'section-title' }, `Ability loadout · ${stats.abilitySlots} slot${stats.abilitySlots > 1 ? 's' : ''}`),
      h(
        'div',
        { class: 'loadout-row' },
        ...(Object.keys(ABILITIES) as AbilityId[]).map((id) => {
          const def = ABILITIES[id];
          const has = unlocked.includes(id);
          return h(
            'button',
            {
              class: `ab-card ${equipped.has(id) ? 'on' : ''} ${has ? '' : 'locked'}`,
              style: `--ab:${def.color}`,
              onClick: () => {
                if (!has) return;
                let next = p.equipped.filter((x) => x !== id);
                if (!equipped.has(id)) next = [id, ...next].slice(0, stats.abilitySlots);
                if (!next.length) next = [id];
                this.app.setEquipped(next);
                this.showTech();
              },
            },
            h('div', { class: 'ab-glyph' }, has ? def.glyph : '?'),
            h('div', { class: 'ab-title' }, has ? def.name : 'Locked'),
            h('div', { class: 'ab-desc' }, has ? def.description : 'Research to unlock.'),
          );
        }),
      ),
    );
    this.open(
      'tech',
      h('div', { class: 'screen-head' }, this.back(), h('h2', null, 'Technology'), h('div', { class: 'wallet small' }, `◆ ${fmtInt(p.matter)}  ◈ ${fmtInt(p.data)}`)),
      h('p', { class: 'lead' }, 'Every tier unlocks a new capability. Some research requires discoveries, not just resources.'),
      loadout,
      h('div', { class: 'tree' }, ...cols),
    );
  }

  showAtlas(): void {
    const p = this.profile;
    const cats: { id: DiscoveryCategory; name: string }[] = [
      { id: 'planet', name: 'Planets' },
      { id: 'moon', name: 'Moons' },
      { id: 'star', name: 'Stars' },
      { id: 'anomaly', name: 'Anomalies' },
      { id: 'structure', name: 'Structures' },
      { id: 'hazard', name: 'Hazards' },
      { id: 'phenomenon', name: 'Phenomena' },
      { id: 'region', name: 'Regions' },
    ];
    const sections = cats
      .map((c) => {
        const list = DISCOVERIES.filter((d) => d.category === c.id);
        if (!list.length) return null;
        const found = list.filter((d) => p.discoveries[d.id]).length;
        return h(
          'div',
          { class: 'atlas-cat' },
          h('div', { class: 'section-title' }, `${c.name} ${found}/${list.length}`),
          h(
            'div',
            { class: 'atlas-grid' },
            ...list.map((d) => {
              const t = p.discoveries[d.id];
              return h(
                'div',
                { class: `atlas-card ${t ? 'found' : ''}` },
                h('div', { class: 'atlas-name' }, t ? d.name : '? ? ?'),
                h('div', { class: 'atlas-text' }, t ? d.text : `Hint: ${d.hint}`),
                t ? h('div', { class: 'atlas-date' }, relativeTime(t)) : null,
              );
            }),
          ),
        );
      })
      .filter((x): x is HTMLDivElement => !!x);
    const lore = p.lore
      ? h('div', { class: 'atlas-cat' }, h('div', { class: 'section-title' }, `Recovered fragments ${p.lore}/${LORE_FRAGMENTS.length}`), ...LORE_FRAGMENTS.slice(0, p.lore).map((l) => h('p', { class: 'lore' }, l)))
      : null;
    this.open('atlas', h('div', { class: 'screen-head' }, this.back(), h('h2', null, 'Cosmic Atlas')), ...sections, lore);
  }

  showJournal(): void {
    const p = this.profile;
    const entries = [...p.journal].reverse().slice(0, 80);
    this.open(
      'journal',
      h('div', { class: 'screen-head' }, this.back(), h('h2', null, 'Journal')),
      h('div', { class: 'section-title' }, 'Mastery'),
      h(
        'div',
        { class: 'mastery' },
        ...ACHIEVEMENTS.map((a) =>
          h(
            'div',
            { class: `mastery-card ${p.achievements[a.id] ? 'done' : ''}` },
            h('div', { class: 'm-name' }, `${p.achievements[a.id] ? '★' : '☆'} ${a.name}`),
            h('div', { class: 'm-desc' }, a.description),
            h('div', { class: 'm-teach' }, a.teaches),
          ),
        ),
      ),
      h('div', { class: 'section-title' }, 'Log'),
      entries.length
        ? h('div', { class: 'log' }, ...entries.map((e) => h('div', { class: `log-row ${e.kind}` }, h('span', { class: 'log-time' }, relativeTime(e.t)), h('span', null, e.text))))
        : h('p', { class: 'lead' }, 'Your story has not started yet.'),
    );
  }

  showSettings(from: ScreenName): void {
    this.screenReturn = from;
    const s = this.profile.settings;
    const apply = () => this.app.applySettings();
    const toggle = (label: string, key: keyof Settings, note?: string) =>
      h(
        'label',
        { class: 'set-row' },
        h('span', null, label, note ? h('small', null, note) : null),
        h('input', {
          type: 'checkbox',
          ...(s[key] ? { checked: true } : {}),
          onChange: (e: Event) => {
            (s as unknown as Record<string, unknown>)[key] = (e.target as HTMLInputElement).checked;
            apply();
          },
        }),
      );
    const slider = (label: string, key: 'sfx' | 'music' | 'shake' | 'uiScale', min: number, max: number, stepv: number) =>
      h(
        'label',
        { class: 'set-row' },
        h('span', null, label),
        h('input', {
          type: 'range',
          min,
          max,
          step: stepv,
          value: s[key],
          onInput: (e: Event) => {
            s[key] = Number((e.target as HTMLInputElement).value);
            apply();
          },
        }),
      );
    this.open(
      'settings',
      h('div', { class: 'screen-head' }, this.btn('← Back', () => (this.screenReturn === 'pause' ? this.showPause() : this.showHub()), 'ghost small'), h('h2', null, 'Settings')),
      h('div', { class: 'section-title' }, 'Audio & feel'),
      slider('Sound effects', 'sfx', 0, 1, 0.05),
      slider('Music', 'music', 0, 1, 0.05),
      slider('Screen shake', 'shake', 0, 1, 0.1),
      toggle('Haptics', 'haptics'),
      h('div', { class: 'section-title' }, 'Controls'),
      h(
        'label',
        { class: 'set-row' },
        h('span', null, 'Aim style', h('small', null, 'Pull back like a slingshot, or push toward the target')),
        h(
          'select',
          {
            onChange: (e: Event) => {
              s.aimMode = (e.target as HTMLSelectElement).value as Settings['aimMode'];
              apply();
            },
          },
          h('option', { value: 'pull', ...(s.aimMode === 'pull' ? { selected: true } : {}) }, 'Pull back'),
          h('option', { value: 'push', ...(s.aimMode === 'push' ? { selected: true } : {}) }, 'Push'),
        ),
      ),
      toggle('Left-handed layout', 'leftHanded'),
      toggle('Assist mode', 'aimAssist', 'Longer prediction and softer landings'),
      h('div', { class: 'section-title' }, 'Display & accessibility'),
      slider('Interface size', 'uiScale', 0.85, 1.35, 0.05),
      toggle('High-contrast trajectory', 'highContrastPath'),
      toggle('Reduced effects', 'reducedEffects', 'Fewer particles, no slow-motion'),
      toggle('Local gameplay analytics', 'telemetry', 'Stored on this device only'),
      h('div', { class: 'section-title' }, 'Data'),
      this.btn('Replay tutorial', () => this.app.replayTutorial(), 'ghost'),
      this.btn(
        'Reset all progress',
        () => {
          if (confirm('Erase all progress, technology and discoveries? This cannot be undone.')) this.app.resetProgress();
        },
        'danger',
      ),
    );
  }

  showPause(): void {
    const g = this.game;
    const r = g.run;
    const canRecall = g.phase === 'flight';
    const recallSub = r ? (r.freeRecalls > 0 ? 'Free (Recall Beacon)' : '−1 hull') : undefined;
    this.open(
      'pause',
      h('h2', null, 'Paused'),
      r ? h('p', { class: 'lead' }, `${regionById(r.regionId).name} · sector ${r.sectorIndex + 1} · hull ${r.hull}/${g.stats.hullMax} · ◆ ${fmtInt(r.matter)}`) : null,
      r && r.modules.length ? h('div', { class: 'module-list' }, ...r.modules.map((m) => h('span', { class: 'chip' }, moduleById(m)?.name ?? m))) : null,
      h(
        'div',
        { class: 'menu' },
        this.btn('Resume', () => this.app.pause(false), 'primary'),
        canRecall ? this.btn('Recall to last world', () => {
          this.app.pause(false);
          this.app.recall();
        }, '', recallSub) : null,
        this.btn('Settings', () => this.showSettings('pause')),
        r
          ? this.btn('Abandon expedition', () => {
              if (confirm('Abandon this expedition? You keep 70% of the matter collected.')) this.app.abandonRun();
            }, 'danger', 'Keep 70% of matter')
          : this.btn('Exit to observatory', () => this.app.toHub(), 'ghost'),
      ),
      r ? h('div', { class: 'foot' }, `Seed ${r.seed}${r.daily ? ` · Daily ${r.daily}` : ''}`) : null,
    );
  }

  showIncident(report: FailureReport, final: boolean, hullCost: number): void {
    const g = this.game;
    const tut = g.mode === 'tutorial';
    const r = g.run;
    const action = final
      ? this.btn('End expedition', () => this.app.endAfterIncident(), 'danger')
      : this.btn(tut ? 'Try again' : 'Recall to last world', () => this.app.recall(), 'primary', !tut ? (hullCost ? `−1 hull · ${r?.hull ?? 0} left` : 'No hull lost') : undefined);
    this.open(
      'incident',
      h('div', { class: 'incident-title' }, report.title),
      ...report.lines.map((l) => h('p', { class: 'incident-line' }, l)),
      h('p', { class: 'incident-tip' }, '💡 ', report.tip),
      final ? h('p', { class: 'incident-final' }, 'The hull is gone. Your expedition ends here — but what you found is kept.') : null,
      h('div', { class: 'menu' }, action),
    );
  }

  showSectorComplete(final: boolean, choices: ModuleDefinition[]): void {
    const g = this.game;
    const r = g.run!;
    const region = regionById(r.regionId);
    if (final) {
      this.open(
        'sector',
        h('div', { class: 'big-title gold' }, 'Expedition complete'),
        h('p', { class: 'lead' }, `You crossed ${region.name} and reached the Beacon.`),
        h('div', { class: 'menu' }, this.btn('See results', () => this.app.extract(), 'primary')),
      );
      return;
    }
    let selected: string | null = null;
    const cards = choices.map((m) => {
      const el = h(
        'button',
        {
          class: `module r${m.rarity}`,
          onClick: () => {
            this.app.click();
            selected = m.id;
            for (const c of cardEls) c.classList.toggle('sel', c === el);
            jump.classList.remove('disabled');
          },
        },
        h('div', { class: 'mod-slot' }, `${m.slot.toUpperCase()} · ${m.archetype}`),
        h('div', { class: 'mod-name' }, m.name),
        h('div', { class: 'mod-desc' }, m.description),
        m.drawback ? h('div', { class: 'mod-draw' }, m.drawback) : null,
      );
      return el;
    });
    const cardEls = cards;
    const jump = this.btn('Jump deeper', () => {
      if (!selected && choices.length) return;
      this.app.chooseModule(selected);
    }, `primary ${choices.length ? 'disabled' : ''}`, 'Take the module · refuel 35%');
    const nextIsBoss = r.sectorIndex + 1 >= region.sectors.length;
    this.open(
      'sector',
      h('div', { class: 'big-title' }, 'Sector cleared'),
      h(
        'div',
        { class: 'stat-row' },
        stat('Hull', `${r.hull}/${g.stats.hullMax}`),
        stat('Matter', fmtInt(r.matter)),
        stat('Fuel', `${Math.round(r.fuel)}`),
        stat('Maneuvers', String(r.maneuvers)),
      ),
      h('p', { class: 'lead' }, nextIsBoss ? `Ahead: ${region.boss.name}. ${region.boss.subtitle}` : `Next: sector ${r.sectorIndex + 2} — ${region.sectors[r.sectorIndex + 1]?.introduces ?? ''}`),
      h('div', { class: 'section-title' }, 'Choose one module'),
      h('div', { class: 'modules' }, ...cards),
      h('div', { class: 'menu' }, jump, this.btn('Extract now', () => this.app.extract(), 'ghost', 'End the expedition safely · keep 100%')),
    );
  }

  showResults(s: RunSummary): void {
    const p = this.profile;
    const r = s.run;
    const region = regionById(r.regionId);
    const goals = nextGoals(p, 3);
    const title = s.outcome === 'complete' ? 'Expedition complete' : s.outcome === 'extracted' ? 'Safely extracted' : 'Expedition lost';
    const dist = r.sectorsCleared + r.sectorProgress * (s.outcome === 'lost' ? 1 : 0);
    const totalSectors = region.sectors.length + 1;
    const pct = Math.round(Math.min(1, dist / totalSectors) * 100);
    this.open(
      'results',
      h('div', { class: `big-title ${s.outcome === 'lost' ? 'red' : 'gold'}` }, title),
      h('p', { class: 'lead' }, s.newBest ? `New best score: ${fmtInt(s.score)}` : `Score ${fmtInt(s.score)}`),
      h('div', { class: 'journey' }, h('div', { class: 'journey-fill', style: `width:${pct}%` }), h('span', null, `${region.name} · ${pct}% charted`)),
      h(
        'div',
        { class: 'stat-grid' },
        stat('Sectors', `${r.sectorsCleared}/${totalSectors}`),
        stat('Worlds visited', String(r.planets)),
        stat('Discoveries', String(r.discoveries.length)),
        stat('Matter banked', `◆ ${fmtInt(s.banked)}${s.keptFraction < 1 ? ' (70%)' : ''}`),
        stat('Data', `◈ ${fmtInt(s.bankedData)}`),
        stat('Top speed', `${fmtInt(r.maxSpeed)} u/s`),
        stat('Assists', String(r.assists)),
        stat('Best maneuver', r.bestManeuver || '—'),
      ),
      s.report ? h('p', { class: 'incident-line' }, `${s.report.title}. ${s.report.tip}`) : null,
      h('div', { class: 'section-title' }, 'What do you want to improve next?'),
      h(
        'div',
        { class: 'goals' },
        ...goals.map((gl) =>
          h(
            'button',
            { class: `goal ${gl.status}`, onClick: () => this.showTech() },
            h('div', { class: 'goal-name' }, gl.node.name, gl.status === 'available' ? h('span', { class: 'chip ok' }, 'Ready') : null),
            h('div', { class: 'goal-desc' }, gl.status === 'gated' ? `🔒 ${gl.reason}` : gl.node.description),
            h('div', { class: 'goal-bar' }, h('div', { style: `width:${Math.round(Math.min(1, gl.progress) * 100)}%` })),
          ),
        ),
      ),
      h('div', { class: 'menu' }, this.btn(r.daily ? 'New expedition' : 'Try again', () => this.app.startRun(r.regionId), 'primary'), this.btn('Observatory', () => this.app.toHub(), 'ghost')),
    );
  }

  showTutorialDone(onGo: () => void): void {
    this.open(
      'tutorialDone',
      h('div', { class: 'big-title gold' }, 'You just used gravity as propulsion.'),
      h('p', { class: 'lead' }, 'Every world is a destination, a tool, and a hazard. Now the real expedition begins.'),
      h('div', { class: 'menu' }, this.btn('Begin expedition', onGo, 'primary', 'The Inner Belt')),
    );
  }
}

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));
}
