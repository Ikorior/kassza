// Gmail-névjegyzék a Google People API-n keresztül.
// Bejelentkezés: OAuth 2.0 átirányításos („implicit”) folyamat – az app a Google bejelentkező
// oldalára lép, majd a Google visszairányít az app címére egy rövid életű (1 órás) hozzáférési
// kulccsal. Ez iPhone-on a kezdőképernyőről indított appban is működik (nincs felugró ablak).
// A kulcs csak ezen a telefonon, a böngésző tárolójában van; a névjegyeket nem mentjük el sehova.

const CLIENT_ID = '250835984287-hl9t9edme9n7dpump961284ic29kmvf5.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/contacts openid email';
const API = 'https://people.googleapis.com/v1/';
const FIELDS = 'names,phoneNumbers,emailAddresses,addresses,organizations,biographies';
const KEY = 'kassza-gtoken';
const STATE_KEY = 'kassza-gstate';
const SILENT_KEY = 'kassza-gsilent';

const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* privát mód */ } };

// A visszairányítás címe: pontosan az app gyökere (ezt a Google-ben is így adtuk meg).
const redirectUri = () => location.origin + location.pathname.replace(/[^/]*$/, '');

export function token() {
  const t = read(KEY);
  return t && t.exp > Date.now() + 60_000 ? t : null;
}
export const signedEmail = () => read(KEY)?.email ?? '';

// Átirányítás a Google bejelentkezéshez. silent: csendes megújítás (nem kérdez, ha már engedélyezve van).
export function signIn(email, { silent = false } = {}) {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  write(STATE_KEY, { state, silent, email, at: Date.now() });
  if (silent) write(SILENT_KEY, Date.now());
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (email) p.set('login_hint', email);
  if (silent) p.set('prompt', 'none');
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
}

// Szabad-e most automatikusan (csendben) megújítani: legfeljebb 2 percenként egyszer, hogy ne pörögjön.
export const maySilentRenew = () => Date.now() - (read(SILENT_KEY) ?? 0) > 120_000;

// Induláskor: a Google visszairányítás feldolgozása. Visszaadja, hogy volt-e ilyen
// ({ ok: true } vagy { ok: false, error }), vagy null, ha nem a Google-től jöttünk vissza.
export async function consumeRedirect() {
  if (!location.hash.includes('state=')) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  const saved = read(STATE_KEY);
  if (!saved || h.get('state') !== saved.state) return null;
  write(STATE_KEY, null);
  history.replaceState(null, '', location.pathname + location.search); // a kulcs ne maradjon a címsorban
  if (h.get('error')) return { ok: false, error: h.get('error'), silent: saved.silent };
  const access = h.get('access_token');
  const exp = Date.now() + Number(h.get('expires_in') || 3600) * 1000;
  let email = '';
  try {
    const info = await (await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(access))).json();
    email = info.email ?? '';
  } catch { /* nem kötelező */ }
  write(KEY, { token: access, exp, email });
  write(SILENT_KEY, null);
  return { ok: true, email };
}

export function signOut() {
  const t = read(KEY);
  write(KEY, null);
  cache = null;
  // A Google-nél is visszavonjuk az engedélyt ezen a kulcson (nem baj, ha nem sikerül).
  if (t?.token) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.token), { method: 'POST' }).catch(() => {});
}

export class AuthError extends Error {}

async function api(path, opts = {}) {
  const t = token();
  if (!t) throw new AuthError('nincs bejelentkezve');
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) { write(KEY, null); throw new AuthError('lejárt'); }
  if (!res.ok) throw new Error(`Google People API hiba (${res.status})`);
  return res.json();
}

// Egy névjegy egyszerűsített formában.
function simplify(p) {
  const n = p.names?.[0] ?? {};
  const name = n.displayName || [n.familyName, n.givenName].filter(Boolean).join(' ')
    || p.organizations?.[0]?.name || p.emailAddresses?.[0]?.value || p.phoneNumbers?.[0]?.value || '(név nélkül)';
  return {
    id: p.resourceName,
    name,
    family: n.familyName ?? '',
    given: n.givenName ?? '',
    phones: (p.phoneNumbers ?? []).map(x => ({ value: x.value, type: x.formattedType || x.type || '' })),
    emails: (p.emailAddresses ?? []).map(x => ({ value: x.value, type: x.formattedType || x.type || '' })),
    addresses: (p.addresses ?? []).map(x => ({ value: x.formattedValue || [x.postalCode, x.city, x.streetAddress].filter(Boolean).join(' '), type: x.formattedType || '' })),
    org: [p.organizations?.[0]?.name, p.organizations?.[0]?.title].filter(Boolean).join(' – '),
    note: p.biographies?.[0]?.value ?? '',
  };
}

let cache = null; // { at, list, email }

// Az összes névjegy (lapozva), név szerint rendezve. 60 mp-ig a memóriából.
export async function listContacts(force = false) {
  const email = signedEmail();
  if (!force && cache && cache.email === email && Date.now() - cache.at < 60_000) return cache.list;
  const all = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ personFields: FIELDS, pageSize: '1000' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await api('people/me/connections?' + q);
    all.push(...(r.connections ?? []));
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  const list = all.map(simplify).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  cache = { at: Date.now(), list, email };
  return list;
}

export const clearCache = () => { cache = null; };

// Új névjegy a Gmail-fiókba.
export async function createContact(c) {
  const body = {
    names: [{ givenName: c.given, familyName: c.family }],
    ...(c.phone ? { phoneNumbers: [{ value: c.phone, type: 'mobile' }] } : {}),
    ...(c.email ? { emailAddresses: [{ value: c.email }] } : {}),
    ...(c.org ? { organizations: [{ name: c.org }] } : {}),
    ...(c.address ? { addresses: [{ formattedValue: c.address, streetAddress: c.address }] } : {}),
    ...(c.note ? { biographies: [{ value: c.note, contentType: 'TEXT_PLAIN' }] } : {}),
  };
  const p = await api('people:createContact?personFields=' + FIELDS, { method: 'POST', body: JSON.stringify(body) });
  const s = simplify(p);
  if (cache) cache.list = [...cache.list, s].sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  return s;
}
