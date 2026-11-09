// Servidor SMTP local para pruebas: guarda cada correo recibido como .eml en la carpeta indicada.
const { SMTPServer } = require('smtp-server');
const fs = require('fs'); const path = require('path');
const dir = process.argv[2] || path.join(__dirname, 'output', 'mail'); fs.mkdirSync(dir, { recursive: true });
let n = 0;
new SMTPServer({ authOptional: true, allowInsecureAuth: true, hideSTARTTLS: true, onAuth: (a, s, cb) => cb(null, { user: a.username }),
  onData(stream, session, cb) { const chunks = []; stream.on('data', c => chunks.push(c)); stream.on('end', () => { fs.writeFileSync(path.join(dir, `${String(++n).padStart(3, '0')}.eml`), Buffer.concat(chunks)); cb(); }); },
}).listen(Number(process.env.PORT || 2525), () => console.log('SMTP de prueba en', process.env.PORT || 2525, '→', dir));
