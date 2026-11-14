// NATIVE string pack: English. spamcha is born in English — this pack is the
// source the CLI and verdicts speak by default. Spanish ships as a translation
// (strings-es.ts). Codes are screws: they never get translated.

export const stringsEn: Record<string, string> = {
  // CLI
  'cli.help':
    'spamcha — local spam judge for web forms\n' +
    'Usage:\n' +
    '  spamcha init [--dir D]                    empty model + default rules in D\n' +
    '  spamcha train --model R [--spam DIR] [--ham DIR]\n' +
    '  spamcha eval --model R [--rules R] --spam DIR --ham DIR\n' +
    '  spamcha judge [--model R] [--rules R] "text…"   (or text via stdin)\n' +
    '  spamcha feed help                         signed intelligence channels\n' +
    '  spamcha version\n' +
    'Language: --locale es|en (default en; also SPAMCHA_LOCALE)',
  'cli.init.created': 'Created  {path}',
  'cli.init.skipped': 'Skipped {path} (already exists)',
  'cli.init.next': 'Next step: fill ham/ and spam/ folders with real examples, then run train.',
  'cli.train.done': 'Trained: {spam} spam document(s), {ham} ham document(s)',
  'cli.train.model': 'Model {path}: docs spam={docsSpam} ham={docsHam} · vocabulary {vocabulary} tokens',
  'cli.train.empty': 'Nothing to train on: pass --spam DIR and/or --ham DIR',
  'cli.eval.truth': 'Ground truth spam: {spam} · ground truth ham: {ham}',
  'cli.eval.correct': 'Correct: {tp} spam caught, {tn} ham passed',
  'cli.eval.mistakes': 'False positives (ham thrown away): {fp} · False negatives (spam passed): {fn}',
  'cli.eval.metrics': 'Precision {precision}% · Recall {recall}% · F1 {f1}',
  'cli.eval.errors': 'Mistakes:',
  'cli.eval.needs': 'eval needs --spam DIR and --ham DIR',
  'cli.error.command': 'Unknown command: {command}',
  'cli.error.locale': 'Unsupported language: {locale} (available: es, en)',

  // Feeds (signed intelligence channels, OpenWRT-style)
  'cli.feed.keygen': 'Ed25519 key pair generated:\n  private (do NOT share): {privada}\n  public (pin on the sites): {publica}',
  'cli.feed.firmado': 'Channel signed: {path} (version {version}, expires {expiresAt})',
  'cli.feed.added': 'Channel {nombre} added → {url}',
  'cli.feed.listed': '{nombre} → {url}{clave}',
  'cli.feed.empty': 'No subscribed channels. Add one: spamcha feed add --name oficial-es --url …',
  'cli.feed.updated': '{nombre}: version {version} ({rules} rules, {domains} domains)',
  'cli.feed.updated-caducado': '{nombre}: EXPIRED, skipped (expired {expiresAt})',
  'cli.feed.unchanged': '{nombre}: unchanged (version {version})',
  'cli.feed.bad-signature': '{nombre}: INVALID SIGNATURE — channel rejected (wrong key or tampered file?)',
  'cli.feed.skipped-expired': 'Expired feed skipped: {channel}',
  'cli.feed.http': '{nombre}: the channel URL answered HTTP {status} — skipped',
  'cli.feed.unsigned-warning': '⚠ {nombre}: channel accepted WITHOUT a pinned key — feed update will not verify its signature',
  'cli.feed.help':
    'Feeds — signed intelligence channels:\n' +
    '  spamcha feed keygen --privada k.b64 --publica k.pub.b64\n' +
    '  spamcha feed sign --archivo feed.json --privada k.b64\n' +
    '  spamcha feed add --nombre N --url URL [--publica k.pub.b64] [--config C]\n' +
    '  spamcha feed list [--config C]\n' +
    '  spamcha feed update [--config C] [--dir feeds/]',

  // Panel
  'panel.title': 'Panel — what arrived',
  'panel.stats': 'Total {total} · pass {pass} · quarantine {quarantine} · reject {reject} · last 24h: {horas24}',
  'panel.model': 'Model: spam={spam} ham={ham} · vocabulary {vocabulary} · phase {phase}',
  'panel.pending': 'Quarantine pending: {n}',
  'panel.top-rules': 'Most active rules',
  'panel.top-domains': 'Domains seen in filtered content',
  'panel.none': 'Nothing yet.',
  'panel.quarantine-title': 'Quarantine — teach the judge',
  'panel.quarantine-empty': 'Quarantine is empty.',
  'panel.btn-spam': '🗑 It is garbage (train spam)',
  'panel.btn-ham': '✓ It is legit (train ham)',
  'panel.btn-delete': 'Delete without teaching',
  'panel.recent': 'Latest submissions',
  'panel.empty': 'No submissions yet.',
  'panel.th-time': 'When',
  'panel.th-decision': 'Verdict',
  'panel.th-prob': 'Prob.',
  'panel.th-content': 'Content',
  'panel.th-codes': 'Codes',

  // Silent signals
  'stamp:missing': 'No stamp was attached: POST straight at the server without rendering the form',
  'stamp:invalid': 'The stamp is not valid (tampered signature or format)',
  'stamp:expired': 'The stamp has expired',
  'stamp:wrong-form': 'The stamp belongs to a different form',
  'time:too-fast': 'Submitted too fast to be a human',
  'honeypot:filled': 'The honeypot field is filled: a classic bot',
  'honeypot:missing': 'Honeypot field missing: the form was never rendered',
  'stamp:valid': 'Valid stamp',
  'honeypot:empty': 'Honeypot empty',
  'rate:limited': 'Too many submissions from that address: try again later',

  // Default-pack rule descriptions
  'rule.spam-words': 'Classic spam keywords',
  'rule.spam-words-heavy': 'A flood of classic spam keywords',
  'rule.many-links': 'More than 5 links in a single submission',
  'rule.dense-links': 'Long text saturated with links',
  'rule.injected-html': 'HTML embedded in the text',
  'rule.bbcode': 'Forum BBCode embedded',
  'rule.shouting': 'Shouting: most of the text is uppercase',
  'rule.foreign-alphabet': 'Much of the text in a foreign alphabet',
};
