# spamcha

**English:** [README.md](./README.md): spamcha nace en inglés (API, CLI por defecto); el español va incluido como locale de primera clase (`--locale es` o `SPAMCHA_LOCALE=es`).

**El antispam invisible para formularios web: local, entrenable, cero dependencias de runtime.**
**El captcha después, no antes.** Un sello firmado al renderizar + suelo de tiempo en el servidor + honeypot + un juez de contenido local (bayesiano + reglas declarativas). El contenido de tus formularios nunca sale de tu servidor, y ningún ser humano ve nunca un desafío.

La pieza que faltaba en la pila antispam invisible. Los captchas de proof-of-work (ALTCHA, Cap) paran bots baratos pero juzgan *comportamiento*. Los jueces en la nube (Akismet, Formspree, CleanTalk) juzgan *contenido*: pero el texto de tus visitantes viaja a la nube de otro. ALTCHA Sentinel ofrece ya clasificación autoalojada como plataforma comercial ([docs del classifier](https://altcha.org/docs/sentinel/features/classifier)): merece compararse. Lo que faltaba era un juez entrenable como **librería MIT incrustable**: cinco líneas, cero dependencias, veredictos explicables entrenados con tus propios clics. Esta es esa pieza.

```
humano → formulario → sello invisible → portero → juez → ✓ bandeja de entrada
bot    → formulario → (sin sello | slop)               → ✗ cuarentena / rechazo
```

Ningún humano ve nunca una prueba. Ningún contenido sale jamás de la caja.

**English:** [README.md](./README.md)

## Instalación

```sh
npm install spamcha
```

Requiere Node ≥ 20. Cero dependencias de runtime.

## Arranque rápido (CLI)

```sh
# 1. Modelo vacío + reglas por defecto (es)
spamcha init

# 2. Aliméntalo con ejemplos reales (carpetas de .txt o .json {campo: valor})
spamcha train --spam spam/ --ham ham/

# 3. Mide contra ejemplos no vistos
spamcha eval --spam eval-spam/ --ham eval-ham/

# 4. Juzga cualquier texto (alias: juzgar)
spamcha judge "check my cheap seo backlinks http://a.xyz http://b.xyz ..."
```

Comandos: `init · train · eval · judge · version`. Banderas: `--model`, `--rules`, `--dir`, `--spam`, `--ham`, `--locale es|en` (variable `SPAMCHA_LOCALE`).

## Biblioteca

```ts
import { loadModel, judge, trainFields } from 'spamcha';

const modelo = loadModel('./spamcha.json');

// Acepta un texto suelto o el objeto de campos del formulario tal cual:
const veredicto = judge(
  { nombre: 'anna', mensaje: 'check my cheap seo backlinks http://a.xyz …' },
  modelo,
);

if (veredicto.decision === 'reject') {
  // tirar en silencio
} else if (veredicto.decision === 'quarantine') {
  // retener: doble opt-in, cola de moderación… lo decides tú
} else {
  // pass: procesar con normalidad
}
```

El veredicto siempre es estructurado y siempre se explica:

```json
{
  "decision": "quarantine",
  "probability": 0.56,
  "bayes": 0.31,
  "rules": 6,
  "phase": "trained",
  "reasons": [
    { "code": "rule:many-links", "text": "Más de 5 enlaces en el envío", "field": "mensaje", "detail": "6/5" },
    { "code": "bayes", "detail": "0.314" },
    { "code": "fusion", "detail": "0.557 (bayes weight 0.06)" }
  ]
}
```

## El pipeline completo (sello + puertas + juez)

`verifySubmission` es el portero entero. Dale TODOS los campos del formulario tal como llegan del POST: él extrae su sello y su honeypot, corre las puertas y juzga el resto:

```ts
import { issueStamp, verifySubmission, loadModel } from 'spamcha';

const modelo = loadModel('./spamcha.json');
const SECRETO = process.env.SPAMCHA_SECRET; // frase larga y aleatoria

// GET /contacto: incrusta el sello al renderizar el formulario:
const token = await issueStamp(SECRETO);
// <input type="hidden" name="spamcha" value="${token}">
// <input type="text" name="website" value="" style="display:none" tabindex="-1" aria-hidden="true">
// (o usa el helper listo: stampFieldsHtml(token))

// POST /enviar: todos los campos, directos del body:
const veredicto = await verifySubmission(body, modelo, { secret: SECRETO });
```

Las puertas, en orden: cualquier fallo es un `reject` instantáneo y silencioso:

1. **`stamp`**: token firmado con HMAC-SHA256 emitido al renderizar (`payloadB64url.firmaB64url`, JWT-lite a mano). Firma errónea, payload manipulado, caducado (TTL 30 min) o formulario equivocado → fuera.
2. **`time`**: la fecha de emisión va DENTRO de la firma, así que el servidor compara contra su propio reloj al recibir: un envío con menos de 3 segundos de vida nunca lo tecleó un humano. Infalsificable sin cooperación del cliente: esto caza a los bots que hacen POST directo al handler sin renderizar jamás la página.
3. **`honeypot`**: el campo trampa debe existir y venir vacío. Campo ausente = nadie renderizó tu HTML.

Solo entonces el **juez** lee el contenido. El veredicto gana un array `signals` junto a las `reasons` del juez:

```json
{ "decision": "reject", "signals": [{ "code": "stamp:missing" }] }
```

El formato del sello está documentado y libre de dependencias: un backend PHP o Python puede emitir y verificar el mismo token (HMAC-SHA256 sobre `JSON {v,f,i,e,n}`).

### Adaptador ALTCHA

¿Ya usas ALTCHA como proof-of-work? Verifica sus soluciones con el mismo secreto, sin altcha-lib:

```ts
import { verifyAltchaSolution } from 'spamcha';
const v = await verifyAltchaSolution(fields.altcha, SECRETO);
// { ok: true } | { ok: false, reason: 'altcha:invalid' | 'altcha:unsolved' | 'altcha:expired' }
```

### Demo en vivo

```sh
npm run demo   # → http://localhost:8787
```

Tres botones en una página: un formulario real (escribe despacio, envía → `pass`), un bot que hace POST sin sello (`stamp:missing`) y un bot que rellena el honeypot (`honeypot:filled`).

## Instalación en 5 líneas: el guard + middleware

`createGatekeeper` es el producto instalado: un objeto que posee el modelo (carga-o-crea, autoguarda), la tienda de cuarentena, el limitador de ritmo y el emisor de sellos.

```ts
import { createGatekeeper } from 'spamcha';

const guard = createGatekeeper({
  secret: process.env.SPAMCHA_SECRET,        // frase larga y aleatoria
  modelPath: './spamcha.json',               // tu modelo privado
  quarantinePath: './spamcha-quarantine.jsonl',
  rateLimit: { max: 10, windowMs: 60_000 },  // por IP, en memoria
});

// GET /contacto: el sello, listo para el formulario:
app.get('/contacto', async (c) => c.html(`<form method="post" action="/submit">${await guard.stampHtml()}…`));

// POST /submit: todos los campos, directos del body:
const veredicto = await guard.review(body, { ip });
```

¿Prefieres middleware? Los dos sabores incluidos, cero imports de framework:

```ts
import { middlewareExpress, middlewareHono } from 'spamcha';

app.post('/submit', middlewareExpress(guard), (req, res) => { /* req.spamcha */ });
app.post('/submit', middlewareHono(guard), (c) => { /* c.get('spamcha') */ });
```

Comportamiento: `reject` → el middleware contesta 403 con el veredicto JSON y tu handler nunca corre; todo lo demás fluye con el veredicto adjunto. Next.js no necesita adaptador: llama a `guard.review()` en el route handler.

## El bucle de feedback: el botón "esto era mierda"

Esta es la parte que nadie más entrega: los envíos en cuarentena se guardan localmente, el dueño los revisa y **el juez entrena al momento**.
El auto-entrenamiento como ham es **opt-in** (`autoHam: true`) y viene apagado: en el día 0, el spam desconocido también pasa, y entrenarlo como ham envenenaría el corpus. Actívalo cuando reglas+feeds cacen la mayoría del slop entrante.

**La curva de aprendizaje medida sobre una familia de spam nueva** (sin reglas que la pillen, seis variantes, cuatro hams reales):
día 0 → **0/6 cazados** (honesto: las reglas no la ven); tras marcar 1 → 1/6; tras marcar 3 → **6/6, cero falsos positivos**,
gracias al booster de fase verde: un bayes pequeño pero *convencido* retiene para revisión en vez de dejar pasar.
Los sistemas solo-reglas (mosparo, form-guard, plugins honeypot) se quedan en 0/6 para siempre: no es peor ajuste, es una capacidad que falta.

```ts
guard.listQuarantine();             // envíos retenidos esperando revisión
guard.resolveQuarantine(id, 'spam'); // entrena el modelo vivo + autoguarda + limpia
guard.resolveQuarantine(id, 'ham');  // era legítimo: eso también enseña
guard.discardQuarantine(id);         // borrar sin enseñar
```

`npm run demo` incluye una página de revisión lista (`/revision`) con los tres botones: ábrela, marca un envío retenido como basura y mira cambiar las estadísticas del modelo. El corpus de cada sitio vive en su propio archivo JSONL y su propio modelo: las palabras de tus usuarios nunca salen del servidor.

## El panel: qué ha llegado, de un vistazo

Confiar requiere ojos. Con `logPath` configurado, el guard registra el resultado de **todos** los envíos (pass, quarantine, reject: con rotación, se conservan los más recientes), y `panelHtml` lo pinta: totales, últimas 24h, estado del modelo, reglas más activas, dominios de spam vistos, los últimos envíos con sus códigos y los botones de revisión de cuarentena inline.

```ts
const guard = createGatekeeper({ secret, logPath: './spamcha-log.jsonl' });

// Cualquier servidor, cualquier framework: una llamada devuelve la página entera:
app.get('/panel', (c) => c.html(panelHtml(guard)));
```

Cero JavaScript, renderizado en servidor, escapado contra XSS. **Nota de seguridad: el panel lee tus datos privados y no trae autenticación propia: sírvelo en localhost o detrás de tu propia auth** (Cloudflare Access encaja de natural).

## Feeds: el torrente compartido (canales estilo OpenWRT)

Aprendizaje local + recetas compartidas. Cada sitio entrena su propio bayes (privado, se queda en casa), pero nadie tiene que descubrir solo la misma ola de spam: **canales de reglas**: archivos JSON firmados en una URL: se descargan, se verifican y se fusionan en el juez.

Lo que viaja por un feed: **reglas** escritas a mano y **dominios de spam**. Lo que jamás viaja: tu modelo bayesiano, tu corpus, el contenido de tus usuarios.

```sh
# Productor (el dueño del canal, p. ej. tú para tu propia flota):
spamcha feed keygen --privada .claves/feed-es.priv.b64 --publica feeds/oficial-es.pub.b64
# …edita feeds/oficial-es.json (reglas + dominios + version + expiresAt)…
spamcha feed sign --archivo feeds/oficial-es.json --privada .claves/feed-es.priv.b64
# aloja el archivo en cualquier sitio estático (spamcha.com/feeds/… vale)

# Consumidor (cada web):
spamcha feed add --nombre oficial-es --url https://spamcha.com/feeds/oficial-es.json \
  --publica feeds/oficial-es.pub.b64
spamcha feed update        # ponlo en cron: descarga + verifica firma + control de versión
```

**La clave fijada es obligatoria**: `feed add` exige `--public` salvo que pases `--unsigned` de forma explícita. Sin clave fijada, `update` cachearía cualquier cosa que sirva la URL: esa clave es el ancla de confianza de todo el modelo de canales.

Entonces `judge`, `eval` y el guard fusionan los canales automáticamente (`--feeds-dir` / `feedsDir`). Modelo de confianza: **firmas Ed25519 con la clave pública fijada localmente** (un host de feed comprometido no puede envenenarte), versiones monótonas y los feeds **caducan a propósito**: la inteligencia rancia es un pasivo; los productores deben refrescar.

Una razón de cuarentena siempre dice quién mandó la regla: `rule:feed:oficial/es:seo-slop-es`.

## Operación sin manos (la escalera de intervención)

spamcha está diseñado para que **la intervención humana sea opcional en todos los niveles**:

- **Nivel 0: sin manos (por defecto):** las puertas paran a los bots tontos, las reglas
  paran el slop clásico, `spamcha feed update` en un cron trae las reglas del gremio, y
  los envíos retenidos llevan un **enlace de confirmación** para el remitente (el patrón
  doble opt-in de los boletines): una persona real lo pulsa y el mensaje se entrega en la
  bandeja "Confirmados" del panel: los bots no confirman enlaces. Lo que nadie confirma
  en 7 días se barre como presunto spam (borrado, sin entrenar: el ruido de
  entregabilidad hace de la no-respuesta una señal débil).
- **Nivel 1: ocasional:** un vistazo al panel y unos clics de "esto era mierda" afinan
  el bayes de tu sitio. Opcional, no requerido.
- **Nivel 2: nunca necesario:** los packs por sector y el ajuste fino existen para
  quien los quiera.

El veredicto JSON lleva `confirmToken` / `confirmUrl` y un `confirmCode` de 6 cifras para
los envíos retenidos. Dos rutas, ambas a prueba de escáneres de correo (los escáneres
hacen clic en enlaces; un código hay que teclearlo):
- **Enlace** (`GET /confirm?token=…`): el sitio lo pone en su página de gracias. Un clic.
- **Código** (`GET /confirm?code=123456`): el sitio manda el código con su propio correo
  (WordPress `wp_mail`, por ejemplo) y el remitente lo teclea.
Confirmar entrega sin entrenar: un spammer con buzón monitorizado podría confirmar su
oferta, así que el juicio de ham se queda en el operador (que también puede entrenar
desde cualquier mensaje con un clic). Tres códigos erróneos bloquean esa entrada.
## Cómo decide

Dos señales, fusionadas:

1. **Reglas**: un pack declarativo (JSON, editable por sitio). Tres tipos de regla sobre regex: `count` (coincidencias mínimas), `ratio` (proporción de caracteres emparejados), `density` (coincidencias por 1000 caracteres). Cada acierto suma peso. El pack por defecto viene afinado para webs en español: palabras-chivo, densidad de enlaces, HTML/BBCode incrustado, gritos, alfabetos ajenos.
2. **Bayes**: un clasificador suavizado por token (estilo Graham, probado en 20 años de filtrado de correo). Aprende el spam de *tu* sitio con tu propio feedback. El texto no visto se queda neutro en vez de adivinar.

La fusión es deliberadamente asimétrica en un punto: **el bayes gana voz a medida que madura su corpus** (peso pleno con ~50 documentos por clase). Con corpus verde deciden las reglas; un modelo ingenuo jamás debe vetar a una regla que acaba de ver seis enlaces. El arranque en frío funciona solo-con-reglas, desde el minuto cero.

Bandas: `probabilidad ≥ 0.85 → reject`, `≥ 0.5 → quarantine`, si no `pass`. Configurable.

**El arranque en frío funciona desde el minuto cero: no hace falta entrenar para que sea útil.** Las puertas paran a los bots sin necesidad de conocer nada de spam (un POST sin sello se rechaza con conocimiento cero), el pack de reglas por defecto caza el slop típico, y un canal de feeds añade las reglas curadas del gremio el primer día. Entrenar no es lo que lo hace *funcionar*: es lo que lo hace *tuyo*: medido sobre el corpus de evaluación, el juez sin entrenar (solo reglas) cazó todo lo que cazó el entrenado; lo que añade el entrenamiento es robustez ante las variantes que TU sitio recibe.

## Qué se hace público, qué se queda privado

Este repo (y el paquete npm) entrega el **motor**: algoritmos, formato del sello, mecánica de reglas, fixtures de demo (sintéticos). NO entrega: y tú nunca deberías commitear:

- **Tu corpus**: los ejemplos reales de `ham/` y `spam/` entrenados desde tu sitio. Contienen datos personales de tus usuarios y son tu defensa adaptativa: los spammers no deben poder probar su slop contra tu juez offline.
- **Tu modelo entrenado** (`spamcha.json`) y tus **packs de reglas de producción**: inteligencia por sitio, como un feed de firmas de ClamAV: el motor es abierto, las firmas más frescas no.

Eso es el principio de Kerckhoffs, la base de la criptografía moderna: el candado puede estar en el escaparate: lo que no se puede copiar es tu llave y lo que tu portero aprendió de tu puerta. Esconder el truco del honeypot no protege nada (es conocimiento público de hace 20 años); tu secreto HMAC y tu juez entrenado localmente son las partes que no se pueden evadir leyendo un GitHub.

Añade a tu `.gitignore` en cualquier sitio que entrene:

```
spamcha.json
spamcha-quarantine.jsonl
spamcha-log.jsonl
ham/
spam/
eval-ham/
eval-spam/
```

## Límites honestos

- El bayes ingenuo no es magia: entrénalo con ejemplos reales de *tus* formularios (el comando `eval` mide cómo va: precisión/recall contra carpetas de ejemplos no vistos).
- El pack por defecto es un punto de partida para formularios de contacto en español; ajusta `rules-es.json` por sitio. Una regla con `field` solo se aplica a ese campo.
- El juez lee texto. No hace reputación de IP, límite de ritmo externo ni señales de comportamiento: eso vive en las otras capas de la pila.
- El modelo es un archivo JSON plano: portable, inspeccionable, amigable con git (y justo por eso debería quedarse fuera de repos públicos). La persistencia usa `node:fs`; en el navegador usa las funciones puras (`tokenize`, `probability`, `judge`) con un modelo servido como JSON.

## Serve: tu servicio local de veredictos (para PHP, Python, WordPress…)

El pipeline como servicio HTTP: cualquier backend de la caja le pregunta:

```sh
spamcha serve --port 8788 --secret "…"    # escucha en 127.0.0.1 por defecto
```

| Endpoint | Qué |
|---|---|
| `GET /stamp` | emite un sello (`?format=html` → los dos campos ocultos) |
| `POST /verdict` | campos urlencoded o JSON `{"fields":{…},"ip","now"}` → veredicto JSON (siempre 200; el campo `decision` gobierna tu código) |
| `GET /panel` · `GET\|POST /revision` | el panel + revisión de cuarentena |
| `GET /feeds` · `GET /health` | canales en vigor · vida |

`--cors` habilita clientes cross-origin (webs estáticas); el panel sigue leyendo datos privados: mantén el servicio en localhost o detrás de tu auth. Un **Dockerfile** viene en el repo (el volumen `/datos` guarda tu modelo/cuarentena/log/feeds privados).

## WordPress

Un plugin puente viene en [`integrations/wordpress/`](integrations/wordpress/README.md): protección de comentarios
(rechazar / retener en moderación / pasar), página de ajustes con estado del servicio, enlace al panel y
`spamcha_verdict( $fields )` para tus propios formularios.

## web-bot-auth (EXPERIMENTAL)

Los agentes de IA firmados (draft-ietf-webbotauth) se saltan las puertas del sello: el juez sigue leyendo el contenido:

```ts
createGatekeeper({ secret, webBotAuth: { authority: "misitio.es" } });
// review(fields, { ip, headers }): una petición con Signature-Agent válida
// recibe la señal `wba:verified`; las inválidas se rechazan como `wba:invalid`
```

Cubre el perfil Ed25519 / `@authority` del draft; trátalo como experimental hasta que sea RFC.

## Hoja de ruta (documentado como pendiente)

- Corpus público de benchmark (`spamcha-bench`), modelo inicial, packs de feeds por sector.


### Postura de seguridad (lo que la auditoría fuerza)

- Los sellos son de **un solo uso**: un nonce repetido se rechaza hasta que el sello caduca (caché en memoria).
- Los campos se truncan antes de juzgar (`maxFieldLength`, 20.000 por defecto) y los bodies se limitan (413 por encima de ~256 KB): sin banquetes de regex.
- Los canales de feed son entrada externa aunque estén firmados: las reglas con cuantificadores anidados (la forma clásica de ReDoS), patrones que no compilan, pesos sin techo o umbrales insanos **se descartan al fusionar**.
- Los directorios web-bot-auth se descargan **solo por https** (la URI del agente viene en las cabeceras de la petición: vector SSRF si no).
- Tus ficheros privados (modelo, cuarentena, log) se escriben con modo **0600**.
- El servicio escucha en 127.0.0.1, los POST de revisión rechazan orígenes cruzados, y `feed add` fija la clave del canal por defecto.
- Secretos: pásalos por entorno (`SPAMCHA_SECRET`), no por argv (se ven en las listas de procesos).

### Modo stealth: cero huellas en tu HTML

Una granja de bots publica evasiones para la config POPULAR, no para tu sitio. Las únicas
dos cadenas que un bot ve en tu HTML son el campo sello y el campo trampa: así que
`spamcha init` genera **nombres aleatorios por sitio** para ambos (`spamcha.config.json`,
auto-cargado por `spamcha serve`, sobreescribible con `--stamp-field` / `--honeypot-field`).
El honeypot recibe un nombre *creíble* de un pool (`empresa37`, `company_website42`…)
para que los bots tontos lo rellenen con ganas. Esto no es la seguridad en sí: el sello
sigue siendo HMAC y el código es público: es convertir cada web en un target a medida
en vez de una receta.

### Los mutantes

`test/mutantes.test.ts` es un zoológico de estrategias de ataque: POSTs directos,
render-relámpago, relleno de honeypot, ráfagas de replay, adivinadores de campos,
guest-posting pulido, spam de plantilla, industrias de replay: contra el portero
en el día 0 y otra vez tras el feedback del dueño. El marcador forma parte de la
suite: 7 de 8 mueren en el día 0, el que escapa muere con el clic 3, y el spam de
plantilla cae 10/10 tras una marca.

## Desarrollo

```sh
npm install
npm test        # vitest, 110 tests
npm run build   # tsc → dist/
npm run demo    # servidor de contacto local en :8787
```

MIT. Construido como la capa que faltaba en una pila antispam sin prueba humana.
