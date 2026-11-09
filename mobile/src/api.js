// Conexión con el servidor de LegalTax (el mismo que usa la versión web).
// Todas las apps leen y escriben en la misma base de datos, así que siempre están en sincronía.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';

const KEY_TOKEN = 'lt_token';
const KEY_SERVER = 'lt_server';
const store = {
  get: async k => (Platform.OS === 'web' ? globalThis.localStorage?.getItem(k) ?? null : SecureStore.getItemAsync(k)),
  set: async (k, v) => (Platform.OS === 'web' ? globalThis.localStorage?.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: async k => (Platform.OS === 'web' ? globalThis.localStorage?.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

const state = { server: '', token: null, onExpired: null };
const clean = u => String(u || '').trim().replace(/\/+$/, '');
export const defaultServer = () => clean(Constants.expoConfig?.extra?.apiUrl || (Platform.OS === 'web' ? globalThis.location?.origin : ''));

export async function restore() {
  state.server = clean((await store.get(KEY_SERVER)) || defaultServer());
  state.token = await store.get(KEY_TOKEN);
  return { server: state.server, token: state.token };
}
export const getServer = () => state.server;
export const onSessionExpired = fn => { state.onExpired = fn; };
export const authHeaders = () => (state.token ? { Authorization: 'Bearer ' + state.token } : {});

async function request(method, path, body) {
  if (!state.server) throw new Error('Configure la dirección del servidor de LegalTax.');
  const headers = { ...authHeaders() };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(state.server + path, { method, headers, body: payload }); }
  catch (_) { throw new Error('Sin conexión con el servidor. Revise su internet.'); }
  if (res.status === 401 && !path.startsWith('/api/mobile/login')) { await logout(true); throw new Error('Su sesión expiró. Inicie sesión de nuevo.'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
  return data;
}
export const api = {
  get: p => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
};

export async function login(server, email, password) {
  state.server = clean(server);
  const r = await request('POST', '/api/mobile/login', { email, password, device: `${Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'Navegador'} · ${Constants.deviceName || 'app del equipo'}` });
  state.token = r.token;
  await store.set(KEY_SERVER, state.server);
  await store.set(KEY_TOKEN, r.token);
  return r;
}
export async function logout(expired) {
  if (!expired && state.token) await request('POST', '/api/mobile/logout').catch(() => {});
  state.token = null; await store.del(KEY_TOKEN);
  if (state.onExpired) state.onExpired();
}

/** Sube archivos (fotos de la cámara o PDF) al expediente. */
export async function uploadScans(caseId, files, metas, merge) {
  const fd = new FormData();
  for (const f of files) {
    if (Platform.OS === 'web') { const blob = await (await fetch(f.uri)).blob(); fd.append('files', blob, f.name); }
    else fd.append('files', { uri: f.uri, name: f.name, type: f.type });
  }
  fd.append('meta', JSON.stringify(metas));
  fd.append('merge', merge ? '1' : '0');
  return request('POST', `/api/cases/${caseId}/scans`, fd);
}

/** Abre un PDF o archivo protegido: lo descarga con el acceso del usuario y lo muestra con el visor del teléfono. */
export async function openFile(path, filename) {
  const url = state.server + path;
  if (Platform.OS === 'web') {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw new Error('No se pudo abrir el documento');
    globalThis.open(URL.createObjectURL(await r.blob()), '_blank');
    return;
  }
  const safe = String(filename || 'documento').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_');
  const dest = FileSystem.cacheDirectory + Date.now() + '-' + safe;
  const r = await FileSystem.downloadAsync(url, dest, { headers: authHeaders() });
  if (r.status !== 200) throw new Error('No se pudo abrir el documento');
  await Sharing.shareAsync(r.uri, { dialogTitle: safe });
}
