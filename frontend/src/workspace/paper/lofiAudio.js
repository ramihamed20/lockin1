/**
 * The sound of Lock-in's default lofi scene: soft electric-piano chords, a
 * round bass, a lazy drum loop, rain on the window and a little vinyl crackle.
 *
 * Nothing is downloaded. The score below is synthesized once, straight into a
 * ~27 second sample buffer that loops seamlessly, so playback needs no timers
 * (it keeps going in a background tab) and costs almost no CPU. Writing the
 * samples directly, rather than through hundreds of Web Audio nodes in an
 * OfflineAudioContext, keeps that one-time cost to a few tens of milliseconds,
 * so the sound starts promptly on a phone too.
 */

const BPM = 70;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 8;
export const LOFI_LOOP_SECONDS = BAR * BARS;
const SAMPLE_RATE = 24000;
// Rendered past the loop's end and folded back onto its start, so the last
// chord's release rings on into the next pass instead of being cut off.
const TAIL_SECONDS = 1.5;

// Fmaj7 · Em7 · Dm7 · Cmaj7, two bars each, voiced close around middle C.
const CHORDS = [
  { root: 41, notes: [53, 57, 60, 64] },
  { root: 40, notes: [52, 55, 59, 62] },
  { root: 38, notes: [50, 53, 57, 60] },
  { root: 36, notes: [48, 52, 55, 59] }
];

/** Every note and drum hit in one loop, in seconds from its start. */
export function lofiScore() {
  /** @type {Array<{ kind: "keys" | "bass" | "kick" | "snare" | "hat", time: number, duration: number, midi?: number, gain: number }>} */
  const events = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    const start = bar * BAR;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    // Struck on the one and pushed again just before beat three.
    for (const [offset, length, gain] of [[0, 2.4, 0.9], [2.5, 1.3, 0.6]]) {
      chord.notes.forEach((midi, index) => {
        events.push({ kind: "keys", time: start + offset * BEAT + index * 0.012, duration: length * BEAT, midi, gain: gain * (index === 0 ? 1 : 0.8) });
      });
    }
    events.push({ kind: "bass", time: start, duration: 2.2 * BEAT, midi: chord.root, gain: 1 });
    events.push({ kind: "bass", time: start + 2.5 * BEAT, duration: 1.2 * BEAT, midi: chord.root + (bar % 2 ? 7 : 0), gain: 0.75 });
    for (const beat of [0, 1.75, 2.5]) events.push({ kind: "kick", time: start + beat * BEAT, duration: 0.35, gain: beat ? 0.7 : 1 });
    for (const beat of [1, 3]) events.push({ kind: "snare", time: start + beat * BEAT, duration: 0.25, gain: 1 });
    // Swung eighths.
    for (let eighth = 0; eighth < 8; eighth += 1) {
      const swing = eighth % 2 ? 0.16 * BEAT : 0;
      events.push({ kind: "hat", time: start + (eighth / 2) * BEAT + swing, duration: 0.06, gain: eighth % 2 ? 0.55 : 0.85 });
    }
  }
  return events;
}

const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** A seeded generator, so every student hears the same loop. */
function random(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value / 2147483647) * 2 - 1;
  };
}

/** An RBJ biquad run in place over `data` (lowpass, highpass or bandpass). */
function biquad(data, type, frequencyHz, q, from = 0, to = data.length) {
  const w = (2 * Math.PI * frequencyHz) / SAMPLE_RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  let b0;
  let b1;
  let b2;
  if (type === "lowpass") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
  else if (type === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = from; index < to; index += 1) {
    const x = data[index];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[index] = y;
  }
}

/**
 * A soft piano or bass note: quick attack, a decay towards 45%, then a release.
 * Oscillators run as a two-term recurrence and envelopes as running products,
 * so a note costs a few multiplications per sample and no Math.sin or Math.exp.
 */
function addNote(out, event, keys) {
  const start = Math.round(event.time * SAMPLE_RATE);
  const peak = event.gain * (keys ? 0.09 : 0.32);
  const attack = Math.max(1, Math.round((keys ? 0.008 : 0.02) * SAMPLE_RATE));
  const held = Math.round(event.duration * SAMPLE_RATE);
  const releaseTau = (keys ? 0.125 : 0.05) * SAMPLE_RATE;
  const length = Math.min(out.length - start, held + Math.round(releaseTau * 6));
  const base = frequency(/** @type {number} */ (event.midi));
  // A sine with a quiet, slightly detuned octave reads as a soft electric piano.
  const partials = keys ? [[base * 2 ** (-4 / 1200), 1], [base * 2 * 2 ** (3 / 1200), 0.18]] : [[base, 1]];
  const envelope = new Float32Array(length);
  const decayStep = Math.exp(-1 / ((event.duration / 3) * SAMPLE_RATE));
  const releaseStep = Math.exp(-1 / releaseTau);
  let excess = peak * 0.55;
  let level = 0;
  for (let offset = 0; offset < length; offset += 1) {
    if (offset < attack) level = peak * (offset / attack);
    else if (offset < held) { level = peak * 0.45 + excess; excess *= decayStep; }
    else level *= releaseStep;
    envelope[offset] = level;
  }
  for (const [hz, amount] of partials) {
    const w = (2 * Math.PI * hz) / SAMPLE_RATE;
    const k = 2 * Math.cos(w);
    let previous = 0;
    let current = Math.sin(w) * amount;
    for (let offset = 0; offset < length; offset += 1) {
      out[start + offset] += envelope[offset] * previous;
      const next = k * current - previous;
      previous = current;
      current = next;
    }
  }
}

function addKick(out, event) {
  const start = Math.round(event.time * SAMPLE_RATE);
  const length = Math.min(out.length - start, Math.round(0.45 * SAMPLE_RATE));
  const peak = 0.55 * event.gain;
  let phase = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const t = offset / SAMPLE_RATE;
    // Pitch falls from 110 Hz to 42 Hz over 120 ms.
    const hz = 42 + (110 - 42) * Math.exp(-t / 0.045);
    phase += (2 * Math.PI * hz) / SAMPLE_RATE;
    const level = t < 0.003 ? peak * (t / 0.003) : peak * Math.exp(-(t - 0.003) / 0.07);
    out[start + offset] += level * Math.sin(phase);
  }
}

function addNoiseHit(out, event, noise) {
  const hat = event.kind === "hat";
  const start = Math.round(event.time * SAMPLE_RATE);
  const length = Math.min(out.length - start, Math.round((hat ? 0.09 : 0.3) * SAMPLE_RATE));
  const hit = new Float32Array(length);
  // Different stretches of the noise, so no two hits sound identical.
  const from = Math.floor(((event.time * 7.3) % 1) * SAMPLE_RATE) % (noise.length - length);
  hit.set(noise.subarray(from, from + length));
  biquad(hit, hat ? "highpass" : "bandpass", hat ? 7000 : 1800, hat ? 0.7 : 0.9);
  const step = Math.exp(-1 / ((hat ? 0.014 : 0.06) * SAMPLE_RATE));
  let level = (hat ? 0.05 : 0.18) * event.gain;
  for (let offset = 0; offset < length; offset += 1) { out[start + offset] += hit[offset] * level; level *= step; }
}

/**
 * The loop as mono samples at SAMPLE_RATE. Pure computation, so it runs (and is
 * tested) without Web Audio.
 */
export function synthesizeLofiLoop() {
  const loopLength = Math.ceil(LOFI_LOOP_SECONDS * SAMPLE_RATE);
  const tail = Math.ceil(TAIL_SECONDS * SAMPLE_RATE);
  const music = new Float32Array(loopLength + tail);
  const noise = Float32Array.from({ length: SAMPLE_RATE }, random(11));
  for (const event of lofiScore()) {
    if (event.kind === "keys" || event.kind === "bass") addNote(music, event, event.kind === "keys");
    else if (event.kind === "kick") addKick(music, event);
    else addNoiseHit(music, event, noise);
  }
  // Warm, slightly dull top end: the "lo" in lofi.
  biquad(music, "lowpass", 2600, 0.707);

  // Rain: filtered noise that runs the whole loop, so the seam is inaudible.
  const rainNoise = random(29);
  const rain = new Float32Array(loopLength + tail);
  for (let index = 0; index < loopLength; index += 1) rain[index] = rainNoise();
  biquad(rain, "highpass", 500, 0.707);
  biquad(rain, "lowpass", 3200, 0.707);

  // Vinyl crackle: sparse, quiet clicks.
  const crackle = random(7);
  const out = new Float32Array(loopLength);
  for (let index = 0; index < music.length; index += 1) {
    const sample = music[index] + rain[index] * 0.035 + (index < loopLength && crackle() > 0.9995 ? 0.25 * (index % 2 ? 1 : -1) : 0);
    out[index % loopLength] += sample;
  }
  return out;
}

/** The loop as an AudioBuffer for `context`, or null when Web Audio is missing. */
export function renderLofiLoop(context) {
  if (!context?.createBuffer) return null;
  const samples = synthesizeLofiLoop();
  const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
