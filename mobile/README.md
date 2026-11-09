# LegalTax Equipo: app móvil (Expo / React Native)

App para el equipo del despacho (Administración, Expedientes y Cobros). Los clientes no entran aquí: usan el portal web.

## Cómo se mantiene todo en sincronía

La app **no guarda una copia propia de los datos**. Trabaja directamente con el **mismo servidor y la misma base de datos** que la versión web:

```
 Celulares del equipo ─┐
                       ├──►  Servidor LegalTax (Render) ──► PostgreSQL + archivos
 Navegadores (web) ────┘
```

- Lo que una persona registra (un documento escaneado, un pago validado, una actuación) queda guardado en el servidor al instante.
- Cada pantalla consulta cada 10–15 segundos si hubo cambios y se actualiza sola. Al deslizar hacia abajo se actualiza de inmediato.
- Los documentos se guardan en el servidor, no en el teléfono. Al abrirlos se descargan con el acceso del usuario y se muestran con el visor del celular.
- El acceso usa un **token por dispositivo** guardado cifrado (SecureStore). Al desactivar un usuario en *Configuración → Usuarios*, sus teléfonos pierden el acceso.

**Importante:** para que todos compartan los datos, el servidor debe estar publicado (por ejemplo en Render). La demostración gratuita de Render borra los archivos subidos cuando se reinicia; para el uso real hace falta el plan con disco.

## Qué hace

| Pantalla | Para qué |
|---|---|
| Inicio | Indicadores del día: expedientes activos, vencimientos, tareas atrasadas, vouchers y saldo por cobrar |
| Expedientes | Lista y ficha del caso: documentos escaneados por tipo, línea de tiempo, plazos y registro de actuaciones |
| **Escanear** | Tomar fotos con la cámara (una por página, se unen en un PDF) o subir PDF/archivos, con el **tipo de documento** |
| Buscar | Por nombre, cédula/RNC, número de expediente, número de resolución o cotización |
| Vouchers | (Cobros y Administración) Ver el comprobante, validarlo (con abono parcial) o rechazarlo con motivo |
| Agenda | Plazos, audiencias y tareas: confirmar fecha y completar |

## Probarla en su laptop (desarrollo)

Necesita **Node.js 20 o superior** (nodejs.org) y, en el celular, la app **Expo Go** (Play Store / App Store).

```bash
git clone https://github.com/legaltaxconsultores/legaltax.git
cd legaltax/mobile
npm install
npx expo start
```

Escanee el código QR que aparece en la terminal con la cámara del iPhone o con Expo Go en Android. El celular y la laptop deben estar en la misma red wifi.

Al abrir la app, toque **"cambiar"** debajo de la contraseña y escriba la dirección del servidor, por ejemplo `https://legaltax-demo-xxxx.onrender.com`. Use el mismo correo y contraseña de la versión web.

Para no escribir la dirección en cada teléfono, póngala en `app.json` → `expo.extra.apiUrl`.

## Instalarla en los teléfonos del equipo (sin laptop conectada)

Con una cuenta gratis en **expo.dev**:

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview   # genera un APK instalable y un enlace para descargarlo
```

- **Android:** comparta el enlace del APK con el equipo.
- **iPhone:** requiere una cuenta de Apple Developer (US$ 99 al año) y distribución por TestFlight.
