// NATIVE string pack: spamcha is born in Spanish. English ships as a
// translation (strings-en.ts). Codes are screws: they never get translated.
// Resolution priority: the site pack's own text → locale pack → code.

export const stringsEs: Record<string, string> = {
  // CLI
  'cli.help':
    'spamcha — juez de spam local para formularios\n' +
    'Uso:\n' +
    '  spamcha init [--dir D]                    modelo vacío + reglas por defecto en D\n' +
    '  spamcha train --model R [--spam DIR] [--ham DIR]\n' +
    '  spamcha eval --model R [--rules R] --spam DIR --ham DIR\n' +
    '  spamcha judge [--model R] [--rules R] "texto…"   (o texto por stdin; alias: juzgar)\n' +
    '  spamcha version\n' +
    'Idioma: --locale es|en (por defecto es; también SPAMCHA_LOCALE)',
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

  // Aviso: las descripciones EN ESPAÑOL de las reglas por defecto viven en el
  // pack (rules-es.ts, es dato del sitio editable). Aquí solo lo demás.
};
