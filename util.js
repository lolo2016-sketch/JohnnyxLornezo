// Kleine Helfer: Datum, Formatierung, Bilder, Konfetti

export const pad = n => String(n).padStart(2, '0');
export const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ds(d); };
export const today = () => ds(new Date());
export const weekday = s => parse(s).getDay();
export const mondayOf = s => addDays(s, -((weekday(s) + 6) % 7));

export const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function prettyDate(s) {
  const t = today();
  if (s === t) return 'Heute';
  if (s === addDays(t, -1)) return 'Gestern';
  const d = parse(s);
  return `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

export function fmtMin(m) {
  m = Math.round(m || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtShort(m) {
  m = Math.round(m || 0);
  if (m < 60) return `${m}m`;
  return (Math.round(m / 6) / 10).toString().replace('.', ',') + 'h';
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function code(len = 8) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint32Array(len))].map(x => a[x % a.length]).join('');
}

export function tsMs(t) {
  if (!t) return Date.now();
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t.seconds) return t.seconds * 1000;
  return +t;
}

export function relTime(t) {
  const ms = tsMs(t), diff = (Date.now() - ms) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'gestern';
  const d = new Date(ms);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

// Bild verkleinern & als JPEG-DataURL zurückgeben (< ~700 KB, passt in ein Firestore-Dokument)
export async function compressImage(file, maxSide = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    let side = maxSide, q = 0.82, out = '';
    for (let tries = 0; tries < 10; tries++) {
      const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (out.length < 700000) break;
      q -= 0.1;
      if (q < 0.5) { q = 0.75; side *= 0.8; }
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function confetti() {
  const em = ['🎉', '💖', '✨', '🎊', '🌟', '💕', '🌸'];
  for (let i = 0; i < 42; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = em[i % em.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDelay = Math.random() * 0.7 + 's';
    s.style.fontSize = 16 + Math.random() * 20 + 'px';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 4000);
  }
  if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
}
