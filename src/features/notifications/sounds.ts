/**
 * Notification sounds synthesized with Web Audio: soft bells, plucks and synths
 * instead of the piercing system default. Nothing is bundled; every sound is a
 * small recipe played through a shared chain (hall or small room → lowpass that
 * tames harsh highs → volume). Lo-fi recipes add tape saturation, a narrow band
 * and pitch wobble.
 */

export const NOTIFICATION_SOUNDS = [
  'gramophone',
  'cassette',
  'bubble',
  'matcha',
  'lantern',
  'bamboo',
  'dewdrop',
  'kalimba',
  'moss',
  'glasshouse',
  'nightTram',
  'aurora',
  'pebble',
] as const;

export type CustomSoundId = (typeof NOTIFICATION_SOUNDS)[number];
/** `system` = the OS default notification sound. */
export type NotificationSoundId = CustomSoundId | 'system';

export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundId = 'lantern';

/** Several notifications at once (catch-up, reminders) chime only once. */
const MIN_GAP_MS = 800;

interface Chain {
  ctx: AudioContext;
  dry: GainNode;
  /** Long, soft hall. */
  wet: GainNode;
  /** Short, tight room for the punchy lo-fi sounds. */
  room: GainNode;
  master: GainNode;
  /** Soft-clip curve shared by every lo-fi sound. */
  tape: Float32Array<ArrayBuffer>;
}

let chain: Chain | null = null;
let lastPlayedAt = 0;

/** Decaying stereo noise: a small, soft room. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.5;
  }
  return buffer;
}

function tapeCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

function getChain(): Chain | null {
  if (chain) return chain;
  if (typeof AudioContext === 'undefined') return null;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 6500;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.ratio.value = 4;
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const room = ctx.createGain();
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.4);
  const smallRoom = ctx.createConvolver();
  smallRoom.buffer = impulse(ctx, 0.35);
  dry.connect(tone);
  wet.connect(reverb).connect(tone);
  room.connect(smallRoom).connect(tone);
  tone.connect(limiter).connect(master).connect(ctx.destination);
  chain = { ctx, dry, wet, room, master, tape: tapeCurve(2.2) };
  return chain;
}

// WebKit keeps an AudioContext suspended until the user interacts with the page.
function unlock() {
  const c = getChain();
  if (c?.ctx.state === 'suspended') void c.ctx.resume();
  if (c?.ctx.state === 'running') {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
}

/** Per-sound output: dry plus hall and room sends, optionally through the lo-fi strip. */
interface Out {
  ctx: AudioContext;
  node: GainNode;
  t: number;
  /** Tape wow & flutter in cents, wired into every oscillator's detune. */
  wobble?: GainNode;
}

interface Recipe {
  /** Long hall send. */
  reverb: number;
  /** Short room send. */
  room?: number;
  lofi?: boolean;
  play: (o: Out) => void;
}

function output(c: Chain, recipe: Recipe): Out {
  const t = c.ctx.currentTime + 0.02;
  const node = c.ctx.createGain();
  let post: AudioNode = node;
  let wobble: GainNode | undefined;
  if (recipe.lofi) {
    // Tape saturation, then a narrow band like a small speaker or an old tape.
    const drive = c.ctx.createGain();
    drive.gain.value = 1.8;
    const shaper = c.ctx.createWaveShaper();
    shaper.curve = c.tape;
    shaper.oversample = '2x';
    const low = c.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 2800;
    low.Q.value = 0.5;
    const high = c.ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 160;
    const trim = c.ctx.createGain();
    trim.gain.value = 0.55;
    post = node.connect(drive).connect(shaper).connect(low).connect(high).connect(trim);
    const lfo = c.ctx.createOscillator();
    lfo.frequency.value = 5.2;
    wobble = c.ctx.createGain();
    wobble.gain.value = 9;
    lfo.connect(wobble);
    lfo.start(t);
    lfo.stop(t + 1.5);
  }
  post.connect(c.dry);
  const sends: [number | undefined, GainNode][] = [
    [recipe.reverb, c.wet],
    [recipe.room, c.room],
  ];
  for (const [amount, bus] of sends) {
    if (!amount) continue;
    const send = c.ctx.createGain();
    send.gain.value = amount;
    post.connect(send).connect(bus);
  }
  return { ctx: c.ctx, node, t, wobble };
}

/** Percussive envelope: quick attack, exponential decay to silence. */
function envelope(o: Out, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = o.ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

function osc(o: Out, type: OscillatorType, freq: number, at: number, stop: number): OscillatorNode {
  const node = o.ctx.createOscillator();
  node.type = type;
  node.frequency.setValueAtTime(freq, at);
  o.wobble?.connect(node.detune);
  node.start(at);
  node.stop(stop + 0.05);
  return node;
}

/** Additive struck tone; `partials` = [frequency ratio, level, decay seconds]. */
function strike(o: Out, freq: number, delay: number, gain: number, partials: [number, number, number][]) {
  const at = o.t + delay;
  for (const [ratio, level, decay] of partials) {
    const env = envelope(o, at, gain * level, 0.004, decay);
    osc(o, 'sine', freq * ratio, at, at + decay).connect(env).connect(o.node);
  }
}

/** Two-operator FM, the electric piano / tine family. */
function fm(o: Out, freq: number, delay: number, gain: number, opts: { ratio: number; index: number; decay: number }) {
  const at = o.t + delay;
  const end = at + opts.decay;
  const mod = osc(o, 'sine', freq * opts.ratio, at, end);
  const depth = o.ctx.createGain();
  depth.gain.setValueAtTime(freq * opts.index, at);
  depth.gain.exponentialRampToValueAtTime(freq * 0.05, at + opts.decay * 0.5);
  const carrier = osc(o, 'sine', freq, at, end);
  mod.connect(depth).connect(carrier.frequency);
  carrier.connect(envelope(o, at, gain, 0.006, opts.decay)).connect(o.node);
}

/** Sine with a pitch glide, for droplets and taps. */
function blip(o: Out, from: number, to: number, delay: number, gain: number, glide: number, decay: number) {
  const at = o.t + delay;
  const node = osc(o, 'sine', from, at, at + decay);
  node.frequency.exponentialRampToValueAtTime(to, at + glide);
  node.connect(envelope(o, at, gain, 0.003, decay)).connect(o.node);
}

/** Detuned oscillators through a closing lowpass: soft synth chords and pads. */
function pad(
  o: Out,
  freqs: number[],
  delay: number,
  gain: number,
  opts: { type: OscillatorType; attack: number; hold: number; release: number; cutoff: number; detune: number },
) {
  const at = o.t + delay;
  const end = at + opts.attack + opts.hold + opts.release;
  const filter = o.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(opts.cutoff, at);
  filter.frequency.exponentialRampToValueAtTime(opts.cutoff * 0.35, end);
  const amp = o.ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + opts.attack);
  amp.gain.setValueAtTime(gain, at + opts.attack + opts.hold);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);
  filter.connect(amp).connect(o.node);
  for (const f of freqs) {
    for (const cents of [-opts.detune, opts.detune]) {
      const node = osc(o, opts.type, f, at, end);
      node.detune.value = cents;
      node.connect(filter);
    }
  }
}

/** Synth pluck: oscillators with a fast-closing filter, the classic lo-fi keys/bass blip. */
function pluck(
  o: Out,
  freqs: number[],
  delay: number,
  gain: number,
  opts: { type: OscillatorType; decay: number; cutoff: number; floor?: number; detune?: number },
) {
  const at = o.t + delay;
  const end = at + opts.decay;
  const filter = o.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(opts.cutoff, at);
  filter.frequency.exponentialRampToValueAtTime(opts.floor ?? 300, at + opts.decay * 0.6);
  filter.connect(envelope(o, at, gain, 0.002, opts.decay)).connect(o.node);
  for (const f of freqs) {
    for (const cents of opts.detune ? [-opts.detune, opts.detune] : [0]) {
      const node = osc(o, opts.type, f, at, end);
      node.detune.value = cents;
      node.connect(filter);
    }
  }
}

/** Sine kick-style "boop": pitch drops fast, body stays round. */
function boop(o: Out, freq: number, delay: number, gain: number, decay: number) {
  const at = o.t + delay;
  const node = osc(o, 'sine', freq * 1.9, at, at + decay);
  node.frequency.exponentialRampToValueAtTime(freq, at + 0.03);
  node.connect(envelope(o, at, gain, 0.002, decay)).connect(o.node);
}

/** A few vinyl pops and a hiss tail. */
function crackle(o: Out, delay: number, gain: number, seconds: number) {
  const at = o.t + delay;
  const rate = o.ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = o.ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const fade = 1 - i / length;
    const hiss = (Math.random() * 2 - 1) * 0.06;
    const pop = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0;
    data[i] = (hiss + pop) * fade;
  }
  const src = o.ctx.createBufferSource();
  src.buffer = buffer;
  const band = o.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2200;
  band.Q.value = 0.6;
  const level = o.ctx.createGain();
  level.gain.value = gain;
  src.connect(band).connect(level).connect(o.node);
  src.start(at);
}

const note = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const MARIMBA: [number, number, number][] = [
  [1, 1, 0.55],
  [3.99, 0.22, 0.09],
  [10.1, 0.04, 0.025],
];
const KALIMBA: [number, number, number][] = [
  [1, 1, 0.9],
  [2.01, 0.12, 0.3],
  [5.9, 0.08, 0.05],
];
const MUTED_MALLET: [number, number, number][] = [
  [1, 1, 0.22],
  [3.99, 0.18, 0.04],
];
const GLASS: [number, number, number][] = [
  [1, 1, 2.6],
  [2.76, 0.32, 1.3],
  [5.4, 0.12, 0.6],
  [8.93, 0.04, 0.25],
];

const RECIPES: Record<CustomSoundId, Recipe> = {
  // Muted electric-piano minor-seventh stab over a crackling record.
  gramophone: {
    reverb: 0,
    room: 0.18,
    lofi: true,
    play: (o) => {
      crackle(o, 0, 0.5, 0.45);
      [note(57), note(60), note(64), note(67)].forEach((f) =>
        fm(o, f, 0.01, 0.13, { ratio: 1, index: 2.2, decay: 0.42 }),
      );
    },
  },
  // Two warm square-wave plucks, like a melody off an old tape deck.
  cassette: {
    reverb: 0,
    room: 0.15,
    lofi: true,
    play: (o) => {
      const opts = { type: 'square' as const, decay: 0.2, cutoff: 2400, floor: 350, detune: 6 };
      pluck(o, [note(74)], 0, 0.16, opts);
      pluck(o, [note(81)], 0.085, 0.13, { ...opts, decay: 0.3 });
    },
  },
  // Round bass-synth boops a fourth apart, popping like bubble tea pearls.
  bubble: {
    reverb: 0,
    room: 0.12,
    lofi: true,
    play: (o) => {
      boop(o, note(60), 0, 0.5, 0.16);
      boop(o, note(65), 0.075, 0.42, 0.2);
    },
  },
  // Felt-muted mallets with a soft saw pluck underneath.
  matcha: {
    reverb: 0.04,
    room: 0.2,
    lofi: true,
    play: (o) => {
      strike(o, note(72), 0, 0.32, MUTED_MALLET);
      strike(o, note(76), 0.07, 0.26, MUTED_MALLET);
      strike(o, note(79), 0.14, 0.22, MUTED_MALLET);
      pluck(o, [note(60)], 0, 0.06, { type: 'sawtooth', decay: 0.28, cutoff: 1400, floor: 250 });
    },
  },
  // Warm electric-piano chord rolled upwards, like a lit paper lantern.
  lantern: {
    reverb: 0.35,
    play: (o) => {
      [note(69), note(73), note(76), note(80)].forEach((f, i) =>
        fm(o, f, i * 0.045, 0.12, { ratio: 1, index: 1.4, decay: 1.6 }),
      );
    },
  },
  // Two wooden mallet notes a fifth apart.
  bamboo: {
    reverb: 0.25,
    play: (o) => {
      strike(o, note(67), 0, 0.3, MARIMBA);
      strike(o, note(74), 0.11, 0.26, MARIMBA);
    },
  },
  // Two drops falling into still water.
  dewdrop: {
    reverb: 0.4,
    play: (o) => {
      blip(o, note(72), note(81), 0, 0.28, 0.05, 0.28);
      blip(o, note(76), note(84), 0.13, 0.18, 0.04, 0.24);
    },
  },
  // Rising pentatonic thumb-piano phrase.
  kalimba: {
    reverb: 0.3,
    play: (o) => {
      [note(74), note(78), note(81)].forEach((f, i) => strike(o, f, i * 0.09, 0.24 - i * 0.03, KALIMBA));
    },
  },
  // The quietest one: a muffled falling third.
  moss: {
    reverb: 0.3,
    play: (o) => {
      const opts = { type: 'triangle' as const, attack: 0.015, hold: 0.04, release: 0.45, cutoff: 1400, detune: 4 };
      pad(o, [note(69)], 0, 0.22, opts);
      pad(o, [note(66)], 0.14, 0.18, opts);
    },
  },
  // A single glass chime with a faint answer.
  glasshouse: {
    reverb: 0.45,
    play: (o) => {
      strike(o, note(79), 0, 0.2, GLASS);
      strike(o, note(86), 0.22, 0.06, GLASS);
    },
  },
  // Lo-fi major-seventh chord with a closing filter, late-night city.
  nightTram: {
    reverb: 0.4,
    play: (o) => {
      pad(o, [note(65), note(69), note(72), note(76)], 0, 0.05, {
        type: 'sawtooth',
        attack: 0.03,
        hold: 0.12,
        release: 0.9,
        cutoff: 1800,
        detune: 9,
      });
    },
  },
  // Slow shimmering swell of an open fifth.
  aurora: {
    reverb: 0.55,
    play: (o) => {
      pad(o, [note(69), note(76), note(81)], 0, 0.07, {
        type: 'sine',
        attack: 0.28,
        hold: 0.15,
        release: 1.1,
        cutoff: 5000,
        detune: 7,
      });
    },
  },
  // Barely there: two soft taps.
  pebble: {
    reverb: 0.15,
    play: (o) => {
      blip(o, 560, 400, 0, 0.32, 0.05, 0.12);
      blip(o, 700, 500, 0.09, 0.22, 0.05, 0.1);
    },
  },
};

/** Plays a custom notification sound; `volume` 0–100. Repeated calls within a short gap are dropped. */
export async function playNotificationSound(id: CustomSoundId, volume: number, opts?: { preview?: boolean }) {
  const c = getChain();
  const recipe = RECIPES[id];
  if (!c || !recipe) return;
  const now = Date.now();
  if (!opts?.preview && now - lastPlayedAt < MIN_GAP_MS) return;
  lastPlayedAt = now;
  if (c.ctx.state === 'suspended') await c.ctx.resume().catch(() => undefined);
  // Squared: loudness is perceived roughly logarithmically.
  c.master.gain.setValueAtTime((Math.max(0, Math.min(100, volume)) / 100) ** 2, c.ctx.currentTime);
  recipe.play(output(c, recipe));
}

export function isCustomSound(id: NotificationSoundId): id is CustomSoundId {
  return id !== 'system' && (NOTIFICATION_SOUNDS as readonly string[]).includes(id);
}
