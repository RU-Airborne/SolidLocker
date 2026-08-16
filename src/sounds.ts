import { getSwSound } from "./api";
const cache = new Map<string, HTMLAudioElement | null>();

let freeAt = 0;
const GAP_MS = 1100;

async function play(name: string, fallback?: () => void) {
  const now = Date.now();
  const wait = Math.max(0, freeAt - now);
  freeAt = Math.max(now, freeAt) + GAP_MS;
  if (wait > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, wait));
  }
  try {
    if (!cache.has(name)) {
      const url = await getSwSound(name);
      cache.set(name, url ? new Audio(url) : null);
    }
    const audio = cache.get(name);
    if (audio) {
      audio.currentTime = 0;
      await audio.play();
      return;
    }
  } catch {
  }
  fallback?.();
}

/** Something went wrong: the noise every SolidWorks user flinches at. */
export function playMateFailed() {
  void play("rebuild error.wav", synthBuzz);
}

/** Work landed on GitHub: the chime after a clean rebuild. */
export function playRebuildComplete() {
  void play("rebuild complete.wav");
}

/** Finished checking GitHub. */
export function playCheckComplete() {
  void play("render complete.wav");
}

/** Something SolidLocker depends on is not there: SolidWorks is not running. */
export function playSensorAlert() {
  void play("sensor alert.wav", synthBuzz);
}

/** A new set of documents is now on disk, like a document finishing loading. */
export function playFileOpenComplete() {
  void play("file open complete.wav");
}

function synthBuzz() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [
      { freq: 622, start: 0, len: 0.13 },
      { freq: 415, start: 0.15, len: 0.28 },
    ].forEach(({ freq, start, len }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.14, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + len);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + len + 0.02);
    });
    window.setTimeout(() => ctx.close(), 900);
  } catch {
  }
}
