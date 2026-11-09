// Componentes y estilo comunes con la identidad de LegalTax Consultores (marrón #876440, gris #D9D9D9).
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView, Image, Platform, KeyboardAvoidingView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, authHeaders, getServer } from './api';

export const C = {
  brand: '#876440', brandDark: '#6E5034', brandSoft: '#F1EAE1', gray: '#D9D9D9', bg: '#F6F4F1', card: '#FFFFFF',
  ink: '#2B2520', muted: '#6F665D', line: '#E3DED7', ok: '#1E7B4F', okBg: '#E3F3EA', warn: '#A15C00', warnBg: '#FCF0DC', bad: '#B3261E', badBg: '#FBE6E4', info: '#1D4F91', infoBg: '#E5EEFA',
};
export const TZ = 'America/Santo_Domingo';
export const money = n => 'RD$ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fdate = d => { if (!d) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, x] = d.split('-'); return `${x}/${m}/${y}`; } try { return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)); } catch (_) { return String(d).slice(0, 10); } };
export const fdt = d => { if (!d) return ''; try { return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d)); } catch (_) { return String(d); } };
export const today = (off = 0) => { const d = new Date(Date.now() + off * 864e5); try { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); } catch (_) { return d.toISOString().slice(0, 10); } };

export const L = {
  caseStatus: { abierto: 'Abierto', en_tramite: 'En trámite', en_espera: 'En espera', cerrado: 'Cerrado', archivado: 'Archivado' },
  event: { actuacion: 'Actuación', deposito: 'Depósito', notificacion: 'Notificación', decision: 'Decisión', documento: 'Documento', reunion: 'Reunión', nota: 'Nota' },
  dl: { audiencia: 'Audiencia', reunion: 'Reunión', plazo: 'Plazo', tarea: 'Tarea' },
  method: { transferencia: 'Transferencia', deposito: 'Depósito', efectivo: 'Efectivo', cheque: 'Cheque', tarjeta: 'Tarjeta' },
  role: { admin: 'Administración', expedientes: 'Equipo de expedientes', cobros: 'Cobros' },
};
const TONE = { ok: [C.okBg, C.ok], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad], info: [C.infoBg, C.info], gold: [C.brandSoft, C.brandDark], '': ['#EFECE8', C.muted] };
export const caseTone = { abierto: 'info', en_tramite: 'gold', en_espera: 'warn', cerrado: 'ok', archivado: '' };

export function Badge({ tone = '', children }) {
  const [bg, fg] = TONE[tone] || TONE[''];
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeT, { color: fg }]} numberOfLines={1}>{children}</Text></View>;
}
export function Card({ children, style, onPress }) {
  const Comp = onPress ? Pressable : View;
  return <Comp onPress={onPress} style={({ pressed } = {}) => [s.card, pressed && { opacity: 0.85 }, style]}>{children}</Comp>;
}
export function Btn({ title, onPress, kind = 'primary', disabled, small, style, icon }) {
  const k = { primary: [C.brand, '#fff', C.brand], light: ['#fff', C.brandDark, C.line], danger: ['#fff', C.bad, '#E8C3BF'], ok: [C.ok, '#fff', C.ok] }[kind];
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, small && s.btnSm, { backgroundColor: k[0], borderColor: k[2], opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      <Text style={[s.btnT, small && { fontSize: 13 }, { color: k[1] }]}>{icon ? icon + '  ' : ''}{title}</Text>
    </Pressable>
  );
}
export function Field({ label, style, ...p }) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor="#A39A90" {...p} style={[s.input, p.multiline && { minHeight: 80, textAlignVertical: 'top' }, p.inputStyle]} />
    </View>
  );
}
/** Selector simple de opciones (chips). */
export function Choice({ label, options, value, onChange }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(([v, t]) => (
          <Pressable key={String(v)} onPress={() => onChange(v)} style={[s.chip, String(value) === String(v) && s.chipOn]}>
            <Text style={[s.chipT, String(value) === String(v) && { color: '#fff' }]}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function Empty({ children }) { return <Text style={s.empty}>{children}</Text>; }
export function Loading() { return <View style={{ padding: 40 }}><ActivityIndicator color={C.brand} /></View>; }
export function ErrorBox({ error }) { return error ? <View style={s.errBox}><Text style={{ color: C.bad }}>{error}</Text></View> : null; }
export function Section({ title, right, children }) {
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={s.section}>{title}</Text>{right}
      </View>
      {children}
    </View>
  );
}
export function Sheet({ visible, title, onClose, children }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBg}>
        <View style={s.sheet}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Cerrar" hitSlop={12}><Text style={{ fontSize: 26, color: C.muted }}>×</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
/** Imagen protegida (voucher, foto escaneada): se pide al servidor con el acceso del usuario. */
export function AuthImage({ path, style }) {
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let alive = true; const url = getServer() + path;
    if (Platform.OS === 'web') {
      fetch(url, { headers: authHeaders() }).then(r => r.blob()).then(b => alive && setUri(URL.createObjectURL(b))).catch(() => {});
    } else setUri(url);
    return () => { alive = false; };
  }, [path]);
  if (!uri) return <View style={[style, { backgroundColor: C.brandSoft }]} />;
  return <Image source={Platform.OS === 'web' ? { uri } : { uri, headers: authHeaders() }} style={style} resizeMode="contain" />;
}

/**
 * Carga datos y los mantiene sincronizados: recarga al volver a la pantalla y cuando
 * cualquier persona del equipo cambia algo (consulta /api/sync cada 15 segundos).
 */
export function useLive(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const last = useRef(null);
  const load = useCallback(async (quiet) => {
    if (!quiet) setRefreshing(true);
    try { setData(await loader()); setError(null); } catch (e) { setError(e.message); } finally { setRefreshing(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => {
    let alive = true;
    // primero el marcador de cambios y después los datos: así no se pierde ningún cambio intermedio
    api.get('/api/sync').then(r => { last.current = r.last; }).catch(() => {}).finally(() => alive && load(true));
    const t = setInterval(async () => {
      try {
        const r = await api.get('/api/sync');
        if (last.current !== null && r.last !== last.current) { last.current = r.last; load(true); } else last.current = r.last;
      } catch (_) { /* sin conexión: se reintenta */ }
    }, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [load]));
  return { data, error, refreshing, reload: () => load(false), setData };
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 22, fontWeight: '700', color: C.brandDark },
  sub: { color: C.muted, marginTop: 2 },
  section: { fontSize: 13, fontWeight: '700', color: C.brand, textTransform: 'uppercase', letterSpacing: 0.8 },
  card: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10 },
  t: { fontSize: 15, fontWeight: '600', color: C.ink },
  m: { fontSize: 13, color: C.muted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  badgeT: { fontSize: 12, fontWeight: '700' },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnSm: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8 },
  btnT: { fontSize: 15, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { borderWidth: 1, borderColor: '#CDC4B8', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: '#fff' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  chipT: { fontSize: 13, color: C.ink, fontWeight: '600' },
  empty: { textAlign: 'center', color: C.muted, padding: 24 },
  errBox: { backgroundColor: C.badBg, borderRadius: 10, padding: 12, marginBottom: 12 },
  sheetBg: { flex: 1, backgroundColor: 'rgba(43,37,32,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '92%' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.brandDark, flex: 1 },
  kpi: { flexBasis: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, borderTopWidth: 3, borderTopColor: C.brand, padding: 12 },
  kpiV: { fontSize: 22, fontWeight: '700', color: C.brandDark },
  kpiL: { fontSize: 12, color: C.muted, marginTop: 2 },
});
