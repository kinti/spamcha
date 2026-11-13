// TRANSLATED string pack: English. spamcha is Spanish-native; this pack covers
// CLI + signals + EN descriptions of the default pack's rules (keys `rule.<id>`;
// the site's own custom descriptions always win).

export const stringsEn: Record<string, string> = {
  // CLI
  'cli.help':
    'spamcha — local spam judge for web forms\n' +
    'Usage:\n' +
    '  spamcha init [--dir D]                    empty model + default rules in D\n' +
    '  spamcha train --model R [--spam DIR] [--ham DIR]\n' +
    '  spamcha eval --model R [--rules R] --spam DIR --ham DIR\n' +
    '  spamcha judge [--model R] [--rules R] "text…"   (or text via stdin; alias: juzgar)\n' +
    '  spamcha version\n' +
    'Language: --locale es|en (default es; also SPAMCHA_LOCALE)',
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
