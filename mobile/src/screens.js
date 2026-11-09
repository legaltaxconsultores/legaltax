import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable, Image, Alert, Platform, FlatList } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { api, login, logout, getServer, defaultServer, uploadScans, openFile } from './api';
import { C, s, L, money, fdate, fdt, today, Badge, Card, Btn, Field, Choice, Empty, Loading, ErrorBox, Section, Sheet, AuthImage, useLive, caseTone } from './ui';

const notify = (title, msg) => (Platform.OS === 'web' ? globalThis.alert?.(`${title}\n${msg || ''}`) : Alert.alert(title, msg));
const refresh = (live) => <RefreshControl refreshing={live.refreshing} onRefresh={live.reload} tintColor={C.brand} colors={[C.brand]} />;

// ─────────────── Inicio de sesión
export function LoginScreen({ onLogged }) {
  const [server, setServer] = useState(getServer() || defaultServer());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showServer, setShowServer] = useState(!getServer() && !defaultServer());
  const go = async () => {
    setBusy(true); setError(null);
    try { const r = await login(server, email.trim(), password); onLogged(r.user); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 70 }]} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', marginBottom: 26 }}>
        <Image source={require('../assets/logo.png')} style={{ width: 210, height: 156 }} resizeMode="contain" accessibilityLabel="LegalTax Consultores SRL" />
        <Text style={[s.sub, { marginTop: 8 }]}>App del equipo</Text>
      </View>
      <ErrorBox error={error} />
      <Field label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="usted@legaltax.do" />
      <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={go} />
      {showServer
        ? <Field label="Dirección del servidor LegalTax" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" placeholder="https://legaltax-xxxx.onrender.com" />
        : <Pressable onPress={() => setShowServer(true)}><Text style={[s.m, { marginBottom: 14 }]}>Servidor: {server} · cambiar</Text></Pressable>}
      <Btn title={busy ? 'Entrando…' : 'Entrar'} onPress={go} disabled={busy || !email || !password || !server} />
      <Text style={[s.m, { textAlign: 'center', marginTop: 18 }]}>Use el mismo correo y contraseña de la versión web.</Text>
    </ScrollView>
  );
}

// ─────────────── Inicio (panel)
export function HomeScreen({ navigation, user }) {
  const live = useLive(() => api.get('/api/dashboard'));
  const d = live.data;
  const K = ({ v, l, to, tone }) => (
    <Pressable onPress={to} style={[s.kpi, tone && { borderTopColor: tone }]}><Text style={s.kpiV}>{v}</Text><Text style={s.kpiL}>{l}</Text></Pressable>
  );
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={refresh(live)}>
      <Text style={s.h1}>Hola, {String(user.name).split(' ')[0]}</Text>
      <Text style={s.sub}>{L.role[user.role]} · se actualiza solo cuando alguien del equipo hace cambios</Text>
      <ErrorBox error={live.error} />
      {!d ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            <K v={d.kpis.active_cases} l="Expedientes activos" to={() => navigation.navigate('Expedientes')} />
            <K v={d.kpis.upcoming} l="Vencimientos próximos" to={() => navigation.navigate('Agenda')} />
            <K v={d.kpis.overdue} l="Tareas atrasadas" to={() => navigation.navigate('Agenda')} tone={d.kpis.overdue ? C.bad : null} />
            {['admin', 'cobros'].includes(user.role) && <K v={d.kpis.vouchers} l="Vouchers por validar" to={() => navigation.navigate('Vouchers')} tone={d.kpis.vouchers ? C.warn : null} />}
            {['admin', 'cobros'].includes(user.role) && <K v={money(d.kpis.receivable)} l="Saldo por cobrar" />}
            <K v={d.kpis.requests} l="Solicitudes abiertas" />
          </View>
          <Section title="Próximos vencimientos">
            {d.next.length ? d.next.map(x => (
              <Card key={x.id} onPress={x.case_id ? () => navigation.navigate('Expediente', { id: x.case_id }) : undefined}>
                <View style={s.row}><Text style={[s.t, { flex: 1 }]}>{x.title}</Text>{new Date(x.due_at) < new Date() ? <Badge tone="bad">Atrasada</Badge> : null}</View>
                <Text style={s.m}>{fdt(x.due_at)} · {L.dl[x.kind]}{x.client_name ? ' · ' + x.client_name : ''}</Text>
              </Card>
            )) : <Empty>No hay vencimientos pendientes.</Empty>}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

// ─────────────── Buscar
export function SearchScreen({ navigation }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const run = async () => { if (q.trim().length < 2) return; try { setR(await api.get('/api/search?q=' + encodeURIComponent(q.trim()))); setError(null); } catch (e) { setError(e.message); } };
  const Group = ({ title, items, render }) => (items?.length ? <Section title={`${title} (${items.length})`}>{items.map(render)}</Section> : null);
  const total = r ? Object.values(r).reduce((a, x) => a + (x?.length || 0), 0) : 0;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Field placeholder="Nombre, cédula/RNC, expediente, resolución…" value={q} onChangeText={setQ} onSubmitEditing={run} returnKeyType="search" autoCapitalize="none" />
      <Btn title="Buscar" onPress={run} />
      <ErrorBox error={error} />
      {r && !total ? <Empty>Sin resultados para “{q}”.</Empty> : null}
      {r && <>
        <Group title="Clientes" items={r.clients} render={x => <Card key={'c' + x.id} onPress={() => navigation.navigate('Cliente', { id: x.id })}><Text style={s.t}>{x.name}</Text><Text style={s.m}>{x.id_type === 'rnc' ? 'RNC' : 'Cédula'} {x.id_number}</Text></Card>} />
        <Group title="Expedientes" items={r.cases} render={x => <Card key={'e' + x.id} onPress={() => navigation.navigate('Expediente', { id: x.id })}><Text style={s.t}>{x.code} · {x.title}</Text><Text style={s.m}>{x.client_name} · {x.institution || ''} {x.official_number || ''}</Text></Card>} />
        <Group title="Documentos y resoluciones" items={r.documents} render={x => <Card key={'d' + x.id} onPress={() => openFile(`/api/files/${x.id}`, x.filename).catch(e => notify('Error', e.message))}><Text style={s.t}>{x.title}</Text><Text style={s.m}>{x.resolution_number ? 'No. ' + x.resolution_number + ' · ' : ''}{x.client_name} {x.case_code ? '· ' + x.case_code : ''}</Text></Card>} />
        <Group title="Cotizaciones" items={r.quotes} render={x => <Card key={'q' + x.id}><Text style={s.t}>{x.number} · {x.title}</Text><Text style={s.m}>{x.client_name} · {money(x.total)} · {x.status}</Text></Card>} />
        <Group title="PDF emitidos" items={r.gendocs} render={x => <Card key={'g' + x.id} onPress={() => openFile(`/api/gendocs/${x.id}/pdf`, x.number + '.pdf').catch(e => notify('Error', e.message))}><Text style={s.t}>{x.number}</Text><Text style={s.m}>{x.title}</Text></Card>} />
      </>}
    </ScrollView>
  );
}

// ─────────────── Expedientes
export function CasesScreen({ navigation }) {
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const live = useLive(() => api.get('/api/query/cases'));
  const rows = (live.data?.rows || []).filter(r => (!onlyActive || ['abierto', 'en_tramite', 'en_espera'].includes(r.status))
    && (!q || `${r.code} ${r.title} ${r.client_name} ${r.id_number} ${r.official_number || ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <FlatList style={s.screen} contentContainerStyle={s.pad} data={rows} keyExtractor={x => String(x.id)} refreshControl={refresh(live)}
      ListHeaderComponent={<>
        <Field placeholder="Filtrar por código, cliente o RNC" value={q} onChangeText={setQ} autoCapitalize="none" />
        <Choice options={[[true, 'Activos'], [false, 'Todos']]} value={onlyActive} onChange={v => setOnlyActive(v === true || v === 'true')} />
        <ErrorBox error={live.error} />{!live.data ? <Loading /> : null}
      </>}
      ListEmptyComponent={live.data ? <Empty>No hay expedientes.</Empty> : null}
      renderItem={({ item: r }) => (
        <Card onPress={() => navigation.navigate('Expediente', { id: r.id })}>
          <View style={s.row}><Text style={[s.t, { flex: 1 }]}>{r.code}</Text><Badge tone={caseTone[r.status]}>{L.caseStatus[r.status]}</Badge></View>
          <Text style={[s.t, { fontWeight: '400', marginTop: 2 }]}>{r.title}</Text>
          <Text style={s.m}>{r.client_name} · {r.institution || '—'}{r.next_action ? ' · Próximo: ' + r.next_action : ''}</Text>
        </Card>
      )} />
  );
}

export function CaseScreen({ route, navigation, user }) {
  const id = route.params.id;
  const [tab, setTab] = useState('escaneados');
  const [ev, setEv] = useState(null);
  const live = useLive(() => api.get('/api/cases/' + id), [id]);
  const d = live.data;
  const canEdit = ['admin', 'expedientes'].includes(user.role);
  if (!d) return <View style={s.screen}><ErrorBox error={live.error} /><Loading /></View>;
  const c = d.case;
  const scans = d.documents.filter(x => x.scanned);
  const groups = {}; scans.forEach(x => { const k = x.doc_type_name || 'Sin tipo'; (groups[k] = groups[k] || []).push(x); });
  const saveEvent = async () => {
    try { await api.post(`/api/cases/${id}/events`, ev); setEv(null); live.reload(); notify('Actuación registrada'); } catch (e) { notify('No se pudo guardar', e.message); }
  };
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.pad} refreshControl={refresh(live)}>
        <Text style={s.h1}>{c.code}</Text>
        <Text style={[s.t, { marginTop: 2 }]}>{c.title}</Text>
        <Pressable onPress={() => navigation.navigate('Cliente', { id: c.client_id })}><Text style={[s.m, { color: C.brand }]}>{c.client_name} · {c.client_id_number}</Text></Pressable>
        <Card style={{ marginTop: 12 }}>
          <View style={s.row}><Badge tone={caseTone[c.status]}>{L.caseStatus[c.status]}</Badge><Text style={s.m}>{c.institution || ''} {c.official_number || ''}</Text></View>
          {c.fiscal_periods ? <Text style={s.m}>Períodos: {c.fiscal_periods}</Text> : null}
          {c.next_action ? <Text style={[s.m, { color: C.ink }]}>Próxima acción: {c.next_action}{c.next_action_date ? ' (' + fdate(c.next_action_date) + ')' : ''}</Text> : null}
          <Text style={s.m}>Responsable: {c.responsible_name || '—'}</Text>
        </Card>
        <Btn title="Escanear o subir documentos" icon="📷" onPress={() => navigation.navigate('Escanear', { caseId: id, code: c.code })} style={{ marginTop: 4 }} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {[['escaneados', `Escaneados (${scans.length})`], ['linea', 'Línea de tiempo'], ['plazos', 'Plazos']].map(([k, t]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[s.chip, tab === k && s.chipOn]}><Text style={[s.chipT, tab === k && { color: '#fff' }]}>{t}</Text></Pressable>
          ))}
        </View>
        {tab === 'escaneados' && (scans.length ? Object.keys(groups).sort().map(k => (
          <Section key={k} title={`📁 ${k} (${groups[k].length})`}>
            {groups[k].map(x => (
              <Card key={x.id} onPress={() => openFile(`/api/files/${x.id}`, x.filename).catch(e => notify('Error', e.message))}>
                <View style={s.row}><Text style={[s.t, { flex: 1 }]} numberOfLines={2}>{x.title}</Text>{x.visibility === 'cliente' ? <Badge tone="info">Compartido</Badge> : <Badge>Privado</Badge>}</View>
                <Text style={s.m}>{x.resolution_number ? 'No. ' + x.resolution_number + ' · ' : ''}{x.pages ? x.pages + ' pág. · ' : ''}{fdt(x.created_at)} · {x.uploaded_by_name || ''}</Text>
              </Card>
            ))}
          </Section>
        )) : <Empty>Aún no hay documentos escaneados. Use “Escanear o subir documentos”.</Empty>)}
        {tab === 'linea' && <>
          {canEdit ? <Btn kind="light" small title="+ Registrar actuación" onPress={() => setEv({ kind: 'actuacion', title: '', description: '', event_date: today(), visibility: 'interna' })} style={{ marginTop: 12, alignSelf: 'flex-start' }} /> : null}
          <Section title="Actuaciones">
            {d.events.map(e => (
              <Card key={e.id} style={e.visibility === 'interna' ? { borderLeftWidth: 3, borderLeftColor: C.warn } : { borderLeftWidth: 3, borderLeftColor: C.brand }}>
                <Text style={s.m}>{fdate(e.event_date)} · {L.event[e.kind]} · {e.visibility === 'cliente' ? 'Publicada al cliente' : 'Interna'}</Text>
                <Text style={[s.t, { marginTop: 2 }]}>{e.title}</Text>
                {e.description ? <Text style={[s.m, { color: C.ink }]}>{e.description}</Text> : null}
              </Card>
            ))}
          </Section>
        </>}
        {tab === 'plazos' && <Section title="Plazos y agenda">
          {d.deadlines.length ? d.deadlines.map(x => (
            <Card key={x.id}><Text style={s.t}>{x.title}</Text><Text style={s.m}>{fdt(x.due_at)} · {L.dl[x.kind]} · {x.status}{x.confirmed ? ' · confirmada' : ''}</Text></Card>
          )) : <Empty>Sin plazos registrados.</Empty>}
        </Section>}
      </ScrollView>
      <Sheet visible={!!ev} title="Registrar actuación" onClose={() => setEv(null)}>
        {ev && <>
          <Choice label="Tipo" options={Object.entries(L.event)} value={ev.kind} onChange={v => setEv({ ...ev, kind: v })} />
          <Field label="Título" value={ev.title} onChangeText={v => setEv({ ...ev, title: v })} />
          <Field label="Detalle" value={ev.description} onChangeText={v => setEv({ ...ev, description: v })} multiline />
          <Field label="Fecha (AAAA-MM-DD)" value={ev.event_date} onChangeText={v => setEv({ ...ev, event_date: v })} />
          <Choice label="Visibilidad" options={[['interna', 'Nota interna'], ['cliente', 'Publicar al cliente']]} value={ev.visibility} onChange={v => setEv({ ...ev, visibility: v })} />
          <Btn title="Guardar" onPress={saveEvent} disabled={!ev.title} />
        </>}
      </Sheet>
    </View>
  );
}

// ─────────────── Escanear y subir documentos al expediente
export function ScanScreen({ route, navigation }) {
  const { caseId, code } = route.params;
  const [files, setFiles] = useState([]);
  const [types, setTypes] = useState(null);
  const [meta, setMeta] = useState({ doc_type_id: '', title: '', number: '', doc_date: '', visibility: 'privado', notes: '' });
  const [merge, setMerge] = useState(true);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { api.get('/api/doc-types').then(setTypes).catch(e => notify('Error', e.message)); }, []);
  const allImages = files.length > 0 && files.every(f => /^image\/(jpeg|png)$/.test(f.type));
  const doMerge = merge && allImages && files.length > 1;
  const addPhotos = async (camera) => {
    if (camera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return notify('Permiso de cámara', 'Active el permiso de cámara para escanear documentos.');
    }
    const opts = { mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: !camera, selectionLimit: 30 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    setFiles(f => [...f, ...r.assets.map((a, i) => ({ uri: a.uri, name: a.fileName || `pagina-${Date.now()}-${i + 1}.jpg`, type: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', image: true }))]);
  };
  const addPdf = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    setFiles(f => [...f, ...r.assets.map(a => ({ uri: a.uri, name: a.name, type: a.mimeType || 'application/pdf', image: (a.mimeType || '').startsWith('image/') }))]);
  };
  const send = async () => {
    if (!meta.doc_type_id) return notify('Falta el tipo', 'Seleccione el tipo de documento.');
    setBusy(true);
    try {
      const metas = doMerge ? [meta] : files.map(() => meta);
      const r = await uploadScans(caseId, files, metas, doMerge);
      notify('Documentos guardados', `${r.created.length} documento(s) agregado(s) al expediente ${code}. Ya los ve todo el equipo.`);
      navigation.goBack();
    } catch (e) { notify('No se pudo subir', e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.sub}>Expediente {code}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Btn title="Tomar foto" icon="📷" onPress={() => addPhotos(true).catch(e => notify('Error', e.message))} style={{ flexGrow: 1 }} />
        <Btn kind="light" title="Galería" onPress={() => addPhotos(false).catch(e => notify('Error', e.message))} style={{ flexGrow: 1 }} />
        <Btn kind="light" title="PDF / archivo" onPress={() => addPdf().catch(e => notify('Error', e.message))} style={{ flexGrow: 1 }} />
      </View>
      <Text style={[s.m, { marginTop: 8 }]}>Tome una foto por página. Puede agregar varias y se unen en un solo PDF.</Text>
      {files.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {files.map((f, i) => (
            <Pressable key={f.uri + i} onLongPress={() => setFiles(x => x.filter((_, k) => k !== i))} style={{ width: 76 }}>
              {f.image ? <Image source={{ uri: f.uri }} style={{ width: 76, height: 100, borderRadius: 6, backgroundColor: C.brandSoft }} />
                : <View style={{ width: 76, height: 100, borderRadius: 6, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '700', color: C.brand }}>PDF</Text></View>}
              <Text style={[s.m, { fontSize: 11 }]} numberOfLines={1}>{i + 1}. {f.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {files.length ? <Text style={[s.m, { fontSize: 11 }]}>Mantenga presionada una página para quitarla.</Text> : null}
      {allImages && files.length > 1 ? <Choice label="¿Cómo guardar las fotos?" options={[[true, `Un solo PDF de ${files.length} páginas`], [false, 'Un documento por foto']]} value={merge} onChange={v => setMerge(v === true || v === 'true')} /> : null}
      <Section title="Tipo de documento *">
        {!types ? <Loading /> : <Choice options={types.map(t => [t.id, t.name])} value={meta.doc_type_id} onChange={v => setMeta({ ...meta, doc_type_id: v })} />}
      </Section>
      <Field label="Título (opcional)" value={meta.title} onChangeText={v => setMeta({ ...meta, title: v })} placeholder="Se usa el tipo si lo deja vacío" />
      <Field label="No. del documento" value={meta.number} onChangeText={v => setMeta({ ...meta, number: v })} />
      <Field label="Fecha del documento (AAAA-MM-DD)" value={meta.doc_date} onChangeText={v => setMeta({ ...meta, doc_date: v })} placeholder={today()} />
      <Field label="Nota" value={meta.notes} onChangeText={v => setMeta({ ...meta, notes: v })} />
      <Choice label="Visibilidad" options={[['privado', 'Privado (equipo)'], ['cliente', 'Compartir con el cliente']]} value={meta.visibility} onChange={v => setMeta({ ...meta, visibility: v })} />
      <Btn title={busy ? 'Subiendo…' : `Subir ${doMerge ? '1 documento' : files.length + ' documento(s)'}`} onPress={send} disabled={busy || !files.length || !meta.doc_type_id} />
    </ScrollView>
  );
}

// ─────────────── Cliente (consulta rápida)
export function ClientScreen({ route, navigation }) {
  const live = useLive(() => api.get('/api/clients/' + route.params.id), [route.params.id]);
  const d = live.data;
  if (!d) return <View style={s.screen}><ErrorBox error={live.error} /><Loading /></View>;
  const c = d.client;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={refresh(live)}>
      <Text style={s.h1}>{c.name}</Text>
      <Text style={s.sub}>{c.id_type === 'rnc' ? 'RNC' : 'Cédula'} {c.id_number}</Text>
      <Card style={{ marginTop: 12 }}>
        {c.representative ? <Text style={s.m}>Representante: {c.representative}</Text> : null}
        <Text style={s.m}>{[c.phone, c.email].filter(Boolean).join(' · ') || 'Sin contacto registrado'}</Text>
        <Text style={s.m}>Responsable: {c.responsible_name || '—'}</Text>
      </Card>
      <Card><View style={s.row}><Text style={s.t}>Saldo pendiente</Text><Text style={[s.t, { color: C.brandDark }]}>{money(d.account.totals.balance)}</Text></View>
        {d.account.totals.overdue > 0 ? <Text style={[s.m, { color: C.bad }]}>Vencido: {money(d.account.totals.overdue)}</Text> : null}</Card>
      <Section title={`Expedientes (${d.cases.length})`}>
        {d.cases.map(x => <Card key={x.id} onPress={() => navigation.navigate('Expediente', { id: x.id })}><View style={s.row}><Text style={[s.t, { flex: 1 }]}>{x.code}</Text><Badge tone={caseTone[x.status]}>{L.caseStatus[x.status]}</Badge></View><Text style={s.m}>{x.title}</Text></Card>)}
      </Section>
    </ScrollView>
  );
}

// ─────────────── Vouchers (Cobros)
export function VouchersScreen() {
  const live = useLive(() => api.get('/api/payments?status=pendiente'));
  const [act, setAct] = useState(null);
  const run = async () => {
    try {
      if (act.mode === 'ok') { const r = await api.post(`/api/payments/${act.p.id}/validate`, { amount: Number(act.amount) }); notify('Pago validado', `Recibo ${r.receipt_number}. Nuevo saldo: ${money(r.balance)}`); }
      else { await api.post(`/api/payments/${act.p.id}/reject`, { reason: act.reason }); notify('Comprobante rechazado'); }
      setAct(null); live.reload();
    } catch (e) { notify('No se pudo completar', e.message); }
  };
  const rows = live.data || [];
  return (
    <View style={s.screen}>
      <FlatList contentContainerStyle={s.pad} data={rows} keyExtractor={x => String(x.id)} refreshControl={refresh(live)}
        ListHeaderComponent={<><Text style={s.sub}>Solo un pago validado baja el saldo y genera el recibo.</Text><ErrorBox error={live.error} />{!live.data ? <Loading /> : null}</>}
        ListEmptyComponent={live.data ? <Empty>No hay vouchers por validar.</Empty> : null}
        renderItem={({ item: p }) => (
          <Card>
            <View style={s.row}><Text style={[s.t, { flex: 1 }]}>{p.client_name}</Text><Text style={[s.t, { color: C.brandDark }]}>{money(p.amount_declared)}</Text></View>
            <Text style={s.m}>{p.quote_number} · {L.method[p.method]} {p.bank ? '· ' + p.bank : ''} · Ref. {p.reference || '—'} · {fdate(p.paid_on)}</Text>
            {p.voucher_document_id ? <Pressable onPress={() => openFile(`/api/files/${p.voucher_document_id}`, 'voucher').catch(e => notify('Error', e.message))}>
              <AuthImage path={`/api/files/${p.voucher_document_id}`} style={{ width: '100%', height: 170, marginTop: 10, borderRadius: 8, backgroundColor: C.brandSoft }} />
            </Pressable> : <Text style={s.m}>Sin comprobante adjunto</Text>}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Btn small kind="ok" title="Validar" onPress={() => setAct({ mode: 'ok', p, amount: String(p.amount_declared) })} style={{ flex: 1 }} />
              <Btn small kind="danger" title="Rechazar" onPress={() => setAct({ mode: 'no', p, reason: '' })} style={{ flex: 1 }} />
            </View>
          </Card>
        )} />
      <Sheet visible={!!act} title={act?.mode === 'ok' ? 'Validar pago' : 'Rechazar comprobante'} onClose={() => setAct(null)}>
        {act && (act.mode === 'ok'
          ? <><Text style={[s.m, { marginBottom: 10 }]}>{act.p.client_name} · declarado {money(act.p.amount_declared)}. Si el depósito es parcial, ajuste el monto.</Text>
            <Field label="Monto validado (RD$)" value={act.amount} onChangeText={v => setAct({ ...act, amount: v })} keyboardType="decimal-pad" />
            <Btn kind="ok" title="Validar y emitir recibo" onPress={run} disabled={!(Number(act.amount) > 0)} /></>
          : <><Field label="Motivo (lo verá el cliente)" value={act.reason} onChangeText={v => setAct({ ...act, reason: v })} multiline />
            <Btn kind="danger" title="Rechazar" onPress={run} disabled={!act.reason.trim()} /></>)}
      </Sheet>
    </View>
  );
}

// ─────────────── Agenda
export function AgendaScreen({ navigation }) {
  const [scope, setScope] = useState('abiertas');
  const live = useLive(() => api.get('/api/deadlines?scope=' + scope), [scope]);
  const upd = async (id, body, msg) => { try { await api.patch('/api/deadlines/' + id, body); live.reload(); notify(msg); } catch (e) { notify('Error', e.message); } };
  return (
    <FlatList style={s.screen} contentContainerStyle={s.pad} data={live.data || []} keyExtractor={x => String(x.id)} refreshControl={refresh(live)}
      ListHeaderComponent={<><Choice options={[['abiertas', 'Pendientes'], ['proximas', 'Próximos'], ['atrasadas', 'Atrasados'], ['todas', 'Todos']]} value={scope} onChange={setScope} />
        <ErrorBox error={live.error} />{!live.data ? <Loading /> : null}</>}
      ListEmptyComponent={live.data ? <Empty>Nada en esta vista.</Empty> : null}
      renderItem={({ item: x }) => (
        <Card onPress={x.case_id ? () => navigation.navigate('Expediente', { id: x.case_id }) : undefined}>
          <View style={s.row}><Text style={[s.t, { flex: 1 }]}>{x.title}</Text>{x.is_overdue ? <Badge tone="bad">Atrasada</Badge> : x.in_alert ? <Badge tone="warn">Alerta</Badge> : null}</View>
          <Text style={s.m}>{fdt(x.due_at)} · {L.dl[x.kind]}{x.client_name ? ' · ' + x.client_name : ''}{x.case_code ? ' · ' + x.case_code : ''}</Text>
          <Text style={s.m}>Responsable: {x.responsible_name || '—'}</Text>
          {x.status === 'pendiente' ? <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {!x.confirmed ? <Btn small kind="light" title="Confirmar fecha" onPress={() => upd(x.id, { confirmed: true }, 'Fecha confirmada')} /> : <Badge tone="ok">Fecha confirmada</Badge>}
            <Btn small title="Completar" onPress={() => upd(x.id, { status: 'completada' }, 'Marcado como completado')} />
          </View> : <Badge tone="ok">{x.status}</Badge>}
        </Card>
      )} />
  );
}

// ─────────────── Más
export function MoreScreen({ user, onLogout }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card><Text style={s.t}>{user.name}</Text><Text style={s.m}>{user.email}</Text><Text style={s.m}>{L.role[user.role]}</Text></Card>
      <Card><Text style={s.t}>Servidor</Text><Text style={s.m}>{getServer()}</Text>
        <Text style={[s.m, { marginTop: 6 }]}>La app, la versión web y los demás teléfonos usan este mismo servidor y la misma base de datos. Los cambios de cualquier persona aparecen en todas en segundos.</Text></Card>
      <Btn kind="danger" title="Cerrar sesión" onPress={async () => { await logout(); onLogout(); }} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
