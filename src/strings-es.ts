// TRANSLATED string pack: Spanish. spamcha is born in English — this pack is
// the Spanish voice (--locale es / SPAMCHA_LOCALE=es). Codes are screws: they
// never get translated. Resolution priority: the site pack's own text → locale
// pack → code.

export const stringsEs: Record<string, string> = {
  // CLI
  'cli.help':
    'spamcha — juez de spam local para formularios\n' +
    'Uso:\n' +
    '  spamcha init [--dir D]                    modelo vacío + reglas por defecto en D\n' +
    '  spamcha train --model R [--spam DIR] [--ham DIR]\n' +
    '  spamcha eval --model R [--rules R] --spam DIR --ham DIR\n' +
    '  spamcha judge [--model R] [--rules R] "texto…"   (o texto por stdin; alias: juzgar)\n' +
    '  spamcha feed help                         canales de inteligencia firmados\n' +
    '  spamcha version\n' +
    'Idioma: --locale es|en (por defecto en; también SPAMCHA_LOCALE)',
  'cli.init.created': 'Creado  {path}',
  'cli.init.skipped': 'Omitido {path} (ya existe)',
  'cli.init.next': 'Siguiente paso: llena carpetas ham/ y spam/ con ejemplos reales y ejecuta train.',
  'cli.train.done': 'Entrenado: {spam} documento(s) spam, {ham} documento(s) ham',
  'cli.train.model': 'Modelo {path}: docs spam={docsSpam} ham={docsHam} · vocabulario {vocabulary} tokens',
  'cli.train.empty': 'Nada que entrenar: indica --spam DIR y/o --ham DIR',
  'cli.eval.truth': 'Verdad spam: {spam} · verdad ham: {ham}',
  'cli.eval.correct': 'Aciertos: {tp} spam detectados, {tn} ham en paso',
  'cli.eval.mistakes': 'Falsos positivos (ham a la basura): {fp} · Falsos negativos (spam pasado): {fn}',
  'cli.eval.metrics': 'Precisión {precision}% · Recall {recall}% · F1 {f1}',
  'cli.eval.errors': 'Errores:',
  'cli.eval.needs': 'eval necesita --spam DIR y --ham DIR',
  'cli.error.command': 'Comando desconocido: {command}',
  'cli.error.locale': 'Idioma no soportado: {locale} (disponibles: es, en)',

  // Feeds (canales de inteligencia firmados, estilo OpenWRT)
  'cli.feed.keygen': 'Par de claves Ed25519 generado:\n  privada (NO compartir): {privada}\n  pública (fijar en las webs): {publica}',
  'cli.feed.firmado': 'Canal firmado: {path} (versión {version}, caduca {expiresAt})',
  'cli.feed.added': 'Canal {nombre} añadido → {url}',
  'cli.feed.listed': '{nombre} → {url}{clave}',
  'cli.feed.empty': 'Sin canales suscritos. Añade uno: spamcha feed add --name oficial-es --url …',
  'cli.feed.updated-caducado': '{nombre}: CADUCADO, omitido (caducó {expiresAt})',
  'cli.feed.unchanged': '{nombre}: sin cambios (versión {version})',
  'cli.feed.bad-signature': '{nombre}: FIRMA INVÁLIDA — canal rechazado (¿clave equivocada o archivo manipulado?)',
  'cli.feed.skipped-expired': 'Feed caducado omitido: {channel}',
  'cli.feed.http': '{nombre}: la URL del canal respondió HTTP {status} — omitido',
  'cli.feed.unsigned-warning': '⚠ {nombre}: canal aceptado SIN clave fijada — feed update no verificará su firma',
  'cli.feed.help':
    'Feeds — canales de inteligencia firmados:\n' +
    '  spamcha feed keygen --private k.b64 --public k.pub.b64\n' +
    '  spamcha feed sign --file feed.json --private k.b64\n' +
    '  spamcha feed add --name N --url URL [--public k.pub.b64] [--config C]\n' +
    '  spamcha feed list [--config C]\n' +
    '  spamcha feed update [--config C] [--dir feeds/]',
  'cli.feed.updated': '{nombre}: versión {version} ({rules} reglas, {domains} dominios)',

  // Panel
  'panel.title': 'Panel — qué ha llegado',
  'panel.stats': 'Total {total} · paso {pass} · cuarentena {quarantine} · rechazo {reject} · últimas 24h: {horas24}',
  'panel.model': 'Modelo: spam={spam} ham={ham} · vocabulario {vocabulary} · fase {phase}',
  'panel.pending': 'Cuarentena pendiente: {n}',
  'panel.top-rules': 'Reglas más activas',
  'panel.top-domains': 'Dominios vistos en lo filtrado',
  'panel.none': 'Todavía nada.',
  'panel.quarantine-title': 'Cuarentena — enséñale al juez',
  'panel.quarantine-empty': 'Cuarentena vacía.',
  'panel.btn-spam': '🗑 Es basura (entrenar spam)',
  'panel.btn-ham': '✓ Es legítimo (entrenar ham)',
  'panel.btn-delete': 'Borrar sin enseñar',
  'panel.recent': 'Últimos envíos',
  'panel.empty': 'Sin envíos todavía.',
  'panel.th-time': 'Cuándo',
  'panel.th-decision': 'Veredicto',
  'panel.th-prob': 'Prob.',
  'panel.th-content': 'Contenido',
  'panel.th-codes': 'Códigos',

  // Silent signals (what the site owner reads in the verdict)
  'stamp:missing': 'Nadie trajo el sello: POST directo al servidor sin renderizar el formulario',
  'stamp:invalid': 'El sello no es válido (firma o formato manipulados)',
  'stamp:expired': 'El sello ha caducado',
  'stamp:wrong-form': 'El sello pertenece a otro formulario',
  'time:too-fast': 'Respondió demasiado rápido para ser un humano',
  'honeypot:filled': 'El campo trampa viene relleno: el bot clásico de toda la vida',
  'honeypot:missing': 'Falta el campo trampa: nadie renderizó el formulario',
  'stamp:valid': 'Sello válido',
  'honeypot:empty': 'Trampa vacía',
  'rate:limited': 'Demasiados envíos desde esa dirección: intenta más tarde',

  // SPANISH descriptions of the default pack's rules (rules-default.ts carries
  // the English ones — site-editable data).
  'rule.spam-words': 'Palabras típicas de spam',
  'rule.spam-words-heavy': 'Lluvia de palabras típicas de spam',
  'rule.many-links': 'Más de 5 enlaces en el envío',
  'rule.dense-links': 'Textos largos saturados de enlaces',
  'rule.injected-html': 'HTML incrustado en el texto',
  'rule.bbcode': 'BBCode de foros incrustado',
  'rule.shouting': 'Gritos: la mayoría del texto en mayúsculas',
  'rule.foreign-alphabet': 'Gran parte del texto en un alfabeto ajeno al sitio',
};
