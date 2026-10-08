/**
 * Calm nature ambience for Paper Workspace: soft rain, a stream and gentle wind, without instruments,
 * notes, a beat or vinyl clicks. Generated locally once, with no media download
 * or playback timers. The existing scene controls own play, pause and volume.
 */

export const LOFI_LOOP_SECONDS = 30;
const SAMPLE_RATE = 24000;
const CROSSFADE_SECONDS = 1;

function random(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value / 2147483647) * 2 - 1;
  };
}

/** An RBJ biquad run in place over the rain samples. */
function biquad(data, type, frequencyHz, q) {
  const w = (2 * Math.PI * frequencyHz) / SAMPLE_RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const lowpass = type === "lowpass";
  const b0 = lowpass ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = lowpass ? 1 - cos : -(1 + cos);
  const b2 = b0;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < data.length; index += 1) {
    const x = data[index];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[index] = y;
  }
}

/** Pure sample generation, also usable without Web Audio. */
export function synthesizeLofiLoop() {
  const length = LOFI_LOOP_SECONDS * SAMPLE_RATE;
  const fade = CROSSFADE_SECONDS * SAMPLE_RATE;
  const rain = Float32Array.from({ length: length + fade }, random(29));
  const water = Float32Array.from({ length: length + fade }, random(71));
  const wind = Float32Array.from({ length: length + fade }, random(113));
  // Soft rain on leaves, a low stream wash beneath it, and wind that swells and
  // settles. Whole numbers of cycles per loop keep the swells seamless.
  biquad(rain, "highpass", 250, 0.707);
  biquad(rain, "lowpass", 2400, 0.707);
  biquad(rain, "lowpass", 2400, 0.707);
  biquad(water, "highpass", 70, 0.707);
  biquad(water, "lowpass", 520, 0.707);
  biquad(wind, "highpass", 90, 0.707);
  biquad(wind, "lowpass", 420, 0.9);
  const cycle = (2 * Math.PI) / (LOFI_LOOP_SECONDS * SAMPLE_RATE);
  for (let index = 0; index < rain.length; index += 1) {
    const swell = 0.55 + 0.45 * Math.sin(index * cycle * 3 - 1.2);
    const patter = 0.9 + 0.1 * Math.sin(index * cycle * 7);
    rain[index] = rain[index] * 0.45 * patter + water[index] * 0.2 + wind[index] * 0.5 * swell;
  }

  const out = rain.slice(0, length);
  // The tail continues across the loop boundary, then blends into its start.
  // Smoothstep avoids both a click at the seam and an audible volume dip.
  for (let index = 0; index < fade; index += 1) {
    const progress = index / fade;
    const weight = progress * progress * (3 - 2 * progress);
    out[index] = rain[length + index] * (1 - weight) + rain[index] * weight;
  }
  return out;
}

export function renderLofiLoop(context) {
  if (!context?.createBuffer) return null;
  const samples = synthesizeLofiLoop();
  const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
