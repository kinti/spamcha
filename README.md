# spamcha

**En español:** [README.es.md](./README.es.md) — spamcha is born in English; Spanish ships as a first-class locale (`--locale es`).

**The invisible antispam for web forms — local, trainable, zero runtime dependencies.** A signed render stamp + server-side time floor + honeypot + a local content judge (Bayesian + declarative rules). Your form content never leaves your server, and no human ever sees a challenge.

The missing piece of the invisible antispam stack. Proof-of-work captchas (ALTCHA, Cap) stop cheap bots but judge *behavior*. Cloud judges (Akismet, Formspree, CleanTalk) judge *content* — but your visitors' text gets shipped to someone else's cloud. There is no maintained, trainable, 100% local content classifier for forms. In any language. This is that piece.

```
human → form → invisible stamp → gatekeeper → judge → ✓ inbox
bot   → form → (no stamp | slop)            → judge → ✗ quarantine / reject
```

No human ever sees a challenge. No content ever leaves the box.

**Idiomas / Languages:** `spamcha` is born in English — the API, CLI default and pack descriptions. Spanish ships as a first-class translation (`--locale es` or `SPAMCHA_LOCALE=es`), Spanish-language spam patterns included in the default pack. Verdict codes (`stamp:missing`, `rule:dense-links`…) are immutable and never translated — the pattern of SpamAssassin's `lang xx describe` directive and ALTCHA's i18n.

## Install

```sh
npm install spamcha
```

Requires Node ≥ 20. Zero runtime dependencies.

## Quick start (CLI)

```sh
# 1. Scaffold an empty model + the default rule pack (es)
spamcha init

# 2. Feed it real examples (folders of .txt or .json {field: value} files)
spamcha train --spam spam/ --ham ham/

# 3. Measure against unseen examples
spamcha eval --spam eval-spam/ --ham eval-ham/

# 4. Judge anything (alias: juzgar)
spamcha judge "check my cheap seo backlinks http://a.xyz http://b.xyz ..."
```

Commands: `init · train · eval · judge · version`. Flags: `--model`, `--rules`, `--dir`, `--spam`, `--ham`, `--locale es|en` (env `SPAMCHA_LOCALE`).

## Library

```ts
import { loadModel, judge, trainFields } from 'spamcha';

const model = loadModel('./spamcha.json');

// Accepts a plain string or the form fields object as-is:
const verdict = judge(
  { nombre: 'anna', mensaje: 'check my cheap seo backlinks http://a.xyz …' },
  model,
);

if (verdict.decision === 'reject') {
  // silently drop
} else if (verdict.decision === 'quarantine') {
  // hold: double opt-in, moderation queue… you decide
} else {
  // pass: process as normal
}
```

The verdict is always structured and always explains itself:

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

## The full pipeline (stamp + gates + judge)

`verifySubmission` is the whole gatekeeper. Give it every form field as they arrive from the POST body — it extracts its own stamp and honeypot, runs the gates, then judges the rest:

```ts
import { issueStamp, verifySubmission, loadModel } from 'spamcha';

const model = loadModel('./spamcha.json');
const SECRET = process.env.SPAMCHA_SECRET; // long random phrase

// GET /contact — embed the stamp when rendering the form:
const token = await issueStamp(SECRET);
// <input type="hidden" name="spamcha" value="${token}">
// <input type="text" name="website" value="" style="display:none" tabindex="-1" aria-hidden="true">
// (or use the ready-made helper: stampFieldsHtml(token))

// POST /submit — every field, straight from the body:
const verdict = await verifySubmission(body, model, { secret: SECRET });
```

The gates, in order — any failure is an instant, silent `reject`:

1. **`stamp`** — HMAC-SHA256-signed token issued at render time (`payloadB64url.signatureB64url`, hand-rolled JWT-lite). Wrong signature, tampered payload, expired (30 min TTL) or wrong form id → gone.
2. **`time`** — the issue timestamp is *inside* the signature, so the server compares against its own clock on arrival: a submission younger than 3 seconds was never typed by a human. Unfakeable without client cooperation — this is what catches bots that POST straight at your handler without ever rendering the page.
3. **`honeypot`** — the honeypot field must exist and be empty. Missing field = nobody rendered your HTML.

Only then does the **judge** read the content. The verdict gains a `signals` array alongside the judge's `reasons`:

```json
{ "decision": "reject", "signals": [{ "code": "stamp:missing" }] }
```

The stamp format is documented and dependency-free — a PHP or Python backend can emit and verify the exact same token (HMAC-SHA256 over `JSON {v,f,i,e,n}`).

### ALTCHA adapter

Already running ALTCHA for proof-of-work? Verify its solutions with the same secret, no altcha-lib required:

```ts
import { verifyAltchaSolution } from 'spamcha';
const v = await verifyAltchaSolution(fields.altcha, SECRET);
// { ok: true } | { ok: false, reason: 'altcha:invalid' | 'altcha:unsolved' | 'altcha:expired' }
```

### Live demo

```sh
npm run demo   # → http://localhost:8787
```

Three buttons on one page: a real form (type slowly, submit → `pass`), a bot that POSTs without a stamp (`stamp:missing`), a bot that fills the honeypot (`honeypot:filled`) — plus **`/revision`**, the quarantine review page where the judge learns (below).

## Install in 5 lines: the guard + middleware

`createGatekeeper` is the installed product: one object owning the model (load-or-create, autosave), the quarantine store, the rate limiter and the stamp issuer.

```ts
import { createGatekeeper } from 'spamcha';

const guard = createGatekeeper({
  secret: process.env.SPAMCHA_SECRET,        // long random phrase
  modelPath: './spamcha.json',               // your private model
  quarantinePath: './spamcha-quarantine.jsonl',
  rateLimit: { max: 10, windowMs: 60_000 },  // per-IP, in-memory
});

// GET /contact — the stamp, ready-made for the form:
app.get('/contact', async (c) => c.html(`<form method="post" action="/submit">${await guard.stampHtml()}…`));

// POST /submit — every framework field, straight through:
const verdict = await guard.review(fields, { ip });
```

Prefer middleware? Both flavors included, zero framework imports:

```ts
import { middlewareExpress, middlewareHono } from 'spamcha';

app.post('/submit', middlewareExpress(guard), (req, res) => { /* req.spamcha.verdict */ });
app.post('/submit', middlewareHono(guard), (c) => { /* c.get('spamcha') */ });
```

Behavior: `reject` → the middleware answers 403 with the verdict JSON and your handler never runs; anything else flows through with the verdict attached. Next.js needs no adapter — call `guard.review()` in the route handler.

## The feedback loop: the "this was garbage" button

This is the part nobody else ships: the quarantined submissions get stored locally, the site owner reviews them, and **the judge trains on the spot**.

```ts
guard.listQuarantine();          // held submissions awaiting review
guard.resolveQuarantine(id, 'spam'); // trains the live model + autosaves + clears
guard.resolveQuarantine(id, 'ham');  // it was legit — that teaches too
guard.discardQuarantine(id);         // delete without teaching
```

`npm run demo` includes a ready-made review page (`/revision`) with the three buttons — open it, mark a held submission as garbage, and watch the model stats change. Each site's corpus stays in its own JSONL file and its own model: your users' words never leave the server.

## Feeds: the shared bloodstream (OpenWRT-style channels)

Local learning + shared recipes. Each site trains its own bayes (private, stays home), but nobody has to discover the same spam wave alone: curated **rule channels** — signed JSON files at a URL — get pulled, verified and fused into the judge.

What travels through a feed: hand-written **rules** and **spam link domains**. What never travels: your bayes model, your corpus, your users' content.

```sh
# Producer (the channel owner, e.g. you for your own fleet):
spamcha feed keygen --privada .claves/feed-es.priv.b64 --publica feeds/oficial-es.pub.b64
# …edit feeds/oficial-es.json (rules + domains + version + expiresAt)…
spamcha feed sign --archivo feeds/oficial-es.json --privada .claves/feed-es.priv.b64
# host the file anywhere static (spamcha.com/feeds/… works fine)

# Consumer (every site):
spamcha feed add --nombre oficial-es --url https://spamcha.com/feeds/oficial-es.json \
  --publica feeds/oficial-es.pub.b64
spamcha feed update        # cron this: fetch + verify signature + version check
```

**The pinned key is required**: `feed add` demands `--public` unless you pass `--unsigned` explicitly. Without a pinned key, `update` would cache anything the URL serves — that's the trust anchor of the whole channel model.

Then `judge`, `eval` and the guard fuse the channels automatically (`--feeds-dir` / `feedsDir`). Trust model: **Ed25519 signatures with the public key pinned locally** (a compromised feed host can't poison you), monotonic versions, and feeds **expire on purpose** — stale intel is a liability, producers must refresh.

A quarantine reason always says who sent the rule: `rule:feed:oficial/es:seo-slop-es`.

## The panel: what arrived, at a glance

Trust needs eyes. With `logPath` configured, the guard records **every** submission's outcome (pass, quarantine, reject — rotated, newest kept), and `panelHtml` renders it: totals, last-24h, model state, most-active rules, spam domains seen, the latest submissions with their codes, and the quarantine review buttons inline.

```ts
const guard = createGatekeeper({ secret, logPath: './spamcha-log.jsonl' });

// Any server, any framework — one call returns the whole page:
app.get('/panel', (c) => c.html(panelHtml(guard)));
```

Zero JavaScript, server-rendered, XSS-escaped. **Security note: the panel reads your private data and has no built-in auth — serve it on localhost or behind your own auth** (Cloudflare Access fits naturally).

## How it decides

Two signals, fused:

1. **Rules** — a declarative pack (JSON, editable per site). Three rule types over regexes: `count` (min matches), `ratio` (matched character share), `density` (matches per 1000 chars). Each hit adds a weight. The default pack ships tuned for Spanish-language sites: spam keywords, link density, pasted HTML/BBCode, shouting, foreign-alphabet floods.
2. **Bayes** — a per-token smoothed classifier (Graham-style, as proven in 20 years of email filtering). It learns *your* site's spam from your own feedback. Unseen text stays neutral instead of guessing.

The fusion is deliberately asymmetric in one way: **the bayes earns its voice as its corpus grows** (full weight at ~50 documents per class). With a green corpus the rules decide; a naive model must never veto a rule that just saw six links. Cold start works rules-only, from minute zero.

Bands: `probability ≥ 0.85 → reject`, `≥ 0.5 → quarantine`, else `pass`. Configurable.

**Cold start works from minute zero — no training required to be useful.** The gates kill content-independent bots (a POST without a stamp needs zero spam knowledge to reject), the default rule pack catches typical slop, and a feed channel adds the guild's curated rules on day one. Training doesn't make it *work* — it makes it *yours*: measured on the eval corpus, the untrained rules-only judge caught everything the trained one did; what training adds is robustness to the variants your site specifically receives.

## What goes public, what stays private

This repo (and the npm package) ships the **engine**: algorithms, stamp format, rule mechanics, demo fixtures (synthetic). It does NOT ship — and you should never commit:

- **Your corpus** — the real `ham/` and `spam/` examples trained from your site. They contain your users' personal data and they are your adaptive defense: spammers must not be able to test their slop against your judge offline.
- **Your trained model** (`spamcha.json`) and your **production rule packs** — per-site intelligence, like a ClamAV signature feed: the engine is open, the freshest signatures are not.

That's Kerckhoffs' principle, the base of modern cryptography: the lock can sit in the shop window — what can't be copied is your key and what your doorman learned about your door. Hiding the honeypot trick protects nothing (it's 20-year-old public knowledge); your HMAC secret and your locally-trained judge are the parts that cannot be evaded from a GitHub read.

Add to your `.gitignore` on any site that trains:

```
spamcha.json
spamcha-quarantine.jsonl
spamcha-log.jsonl
ham/
spam/
eval-ham/
eval-spam/
```

## Honest limits

- Naive Bayes is not magic: train it with real examples from *your* forms (the `eval` command measures how it's doing — precision/recall against folders of unseen examples).
- The default rule pack is a starting point for Spanish-language contact forms; tune `rules-es.json` per site. A rule with `field` only fires on that field.
- The judge reads text. It does not do IP reputation, rate limiting or behavioral signals — those live in the other layers of the stack.
- The model is a plain JSON file: portable, inspectable, git-friendly (and exactly why it should stay out of public repos). Persistence uses `node:fs`; in the browser use the pure functions (`tokenize`, `probability`, `judge`) with a model served as JSON.

## Serve: your local verdict service (for PHP, Python, WordPress…)

The pipeline as an HTTP service — any backend on the box just asks it:

```sh
spamcha serve --port 8788 --secret "…"    # binds to 127.0.0.1 by default
```

| Endpoint | What |
|---|---|
| `GET /stamp` | issue a stamp (`?format=html` → the two hidden inputs) |
| `POST /verdict` | urlencoded fields or JSON `{"fields":{…},"ip","now"}` → verdict JSON (always 200; `decision` drives your code) |
| `GET /panel` · `GET\|POST /revision` | the panel + quarantine review |
| `GET /feeds` · `GET /health` | channels in force · liveness |

`--cors` enables cross-origin clients (static sites); the panel still reads private data — keep the service on localhost or behind your own auth. A **Dockerfile** ships in the repo (volume `/datos` holds your private model/quarantine/log/feeds).

## WordPress

A bridge plugin ships in [`integrations/wordpress/`](integrations/wordpress/README.md): comment protection
(reject / hold-for-moderation / pass), a settings page with service status, panel link, and
`spamcha_verdict( $fields )` for your own forms.

## web-bot-auth (EXPERIMENTAL)

Signed AI agents (draft-ietf-webbotauth) skip the stamp gates — content still gets judged:

```ts
createGatekeeper({ secret, webBotAuth: { authority: "mysite.com" } });
// review(fields, { ip, headers }) — a request with a valid Signature-Agent
// gets signal `wba:verified`; invalid ones are rejected as `wba:invalid`
```

Covers the Ed25519 / `@authority` profile of the draft; treat as experimental until it becomes an RFC.

## Roadmap (documented as pending)

- Public benchmark corpus (`spamcha-bench`), starter model, sector feed packs.

## Development

```sh
npm install
npm test        # vitest, 110 tests
npm run build   # tsc → dist/
npm run demo    # local contact server on :8787
```

MIT. Built as the missing layer of a no-human-verification antispam stack.
