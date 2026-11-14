#!/usr/bin/env node
// spamcha CLI: init · train · eval · judge · feed. Zero dependencies.
// Logic lives in `run` (testable); `main` only prints and sets the exit code.
// Born in English: default locale is `en`; Spanish ships as a translation
// (`--locale es` / SPAMCHA_LOCALE=es). `juzgar` survives as a judge alias.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createModel } from './bayes.js';
import type { BayesModel } from './bayes.js';
import { createGatekeeper } from './guard.js';
import { generateFeedKeyPair, mergeFeedChannels, signFeed, verifyFeed } from './feed.js';
import type { FeedChannel } from './feed.js';
import { judge, trainFields } from './judge.js';
import { isLocale, DEFAULT_LOCALE, translate } from './locales.js';
import { generateStealthNames } from './stealth.js';
import type { Locale } from './locales.js';
import { loadModel, saveModel } from './storage.js';
import { defaultRulePack } from './rules-default.js';
import { createServeServer } from './serve.js';
import type { Label, RulePack } from './types.js';

const DEFAULT_MODEL = 'spamcha.json';
const DEFAULT_RULES_FILE = 'rules.json';
const DEFAULT_FEEDS_CONFIG = 'spamcha.feeds.json';
const DEFAULT_FEEDS_DIR = 'feeds';
const DEFAULT_STEALTH_CONFIG = 'spamcha.config.json';

interface FileEntry {
  path: string;
  content: string;
  isJson: boolean;
}

function collect(path: string): FileEntry[] {
  const st = statSync(path);
  if (st.isDirectory()) {
    const out: FileEntry[] = [];
    for (const name of readdirSync(path).sort()) {
      if (name.startsWith('.')) continue;
      out.push(...collect(join(path, name)));
    }
    return out;
  }
  if (!/\.(txt|json)$/i.test(path)) return [];
  return [{ path, content: readFileSync(path, 'utf8'), isJson: path.toLowerCase().endsWith('.json') }];
}

interface Args {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parse(args: string[]): Args {
  const command = args[0] ?? '';
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i] as string;
    if (a.startsWith('--')) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[a.slice(2)] = next;
        i++;
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, flags, positional };
}

function pathOf(flags: Record<string, string | boolean>, key: string, fallback: string): string {
  const v = flags[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function localeOf(flags: Record<string, string | boolean>): Locale {
  const raw = typeof flags['locale'] === 'string' ? flags['locale'] : process.env.SPAMCHA_LOCALE;
  const value = raw ?? DEFAULT_LOCALE;
  if (!isLocale(value)) {
    throw new Error(translate('cli.error.locale', { vars: { locale: value } }));
  }
  return value;
}

function packOf(flags: Record<string, string | boolean>): RulePack {
  const v = flags['rules'];
  if (typeof v === 'string' && v.length > 0) {
    const parsed = JSON.parse(readFileSync(v, 'utf8')) as RulePack;
    if (!Array.isArray(parsed.rules)) throw new Error(`File ${v} is not a valid rule pack`);
    return parsed;
  }
  return defaultRulePack;
}

// ─── Feeds: signed intelligence channels ───────────────────────────────────

interface ChannelConfig {
  name: string;
  url: string;
  publicKey?: string;
}

function channelsConfigPath(flags: Record<string, string | boolean>): string {
  return pathOf(flags, 'config', DEFAULT_FEEDS_CONFIG);
}

function readChannels(path: string): ChannelConfig[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ChannelConfig[];
  if (!Array.isArray(parsed)) throw new Error(`File ${path} is not a channel list`);
  return parsed;
}

function writeChannels(path: string, channels: ChannelConfig[]): void {
  if (channels.length > 0) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(channels, null, 2), 'utf8');
}

/** Loads downloaded feeds from the directory; skips expired ones (with a warning).
 *  Signatures were already verified against the pinned key at `feed update` —
 *  here we only re-check expiry (synchronous, no promises at startup). */
function loadedFeeds(feedsDir: string, locale: Locale): { channels: FeedChannel[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!existsSync(feedsDir)) return { channels: [], warnings };
  const channels: FeedChannel[] = [];
  const now = Date.now();
  for (const name of readdirSync(feedsDir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const ch = JSON.parse(readFileSync(join(feedsDir, name), 'utf8')) as FeedChannel;
      const expired = Number.isNaN(Date.parse(ch.expiresAt)) || now >= Date.parse(ch.expiresAt);
      if (expired) {
        warnings.push(translate('cli.feed.skipped-expired', { locale, vars: { channel: ch.channel ?? name } }));
        continue;
      }
      channels.push(ch);
    } catch {
      warnings.push(translate('cli.feed.skipped-expired', { locale, vars: { channel: name } }));
    }
  }
  return { channels, warnings };
}

function effectivePack(flags: Record<string, string | boolean>, locale: Locale): { pack: RulePack; warnings: string[] } {
  const base = packOf(flags);
  const { channels, warnings } = loadedFeeds(pathOf(flags, 'feeds-dir', DEFAULT_FEEDS_DIR), locale);
  return { pack: mergeFeedChannels(base, channels), warnings };
}

async function cmdFeed(flags: Record<string, string | boolean>, sub: string, locale: Locale): Promise<string> {
  const t = (code: string, vars?: Record<string, string | number>): string => translate(code, { locale, vars });
  const configPath = channelsConfigPath(flags);
  switch (sub) {
    case 'keygen': {
      const pair = await generateFeedKeyPair();
      const privatePath = pathOf(flags, 'private', 'feed-es.private.b64');
      const publicPath = pathOf(flags, 'public', 'feed-es.public.b64');
      mkdirSync(dirname(privatePath), { recursive: true });
      mkdirSync(dirname(publicPath), { recursive: true });
      writeFileSync(privatePath, pair.private, 'utf8');
      writeFileSync(publicPath, pair.public, 'utf8');
      return t('cli.feed.keygen', { privada: privatePath, publica: publicPath });
    }
    case 'sign': {
      const file = pathOf(flags, 'file', '');
      if (file.length === 0) throw new Error('sign needs --file feed.json');
      const privateKeyPath = pathOf(flags, 'private', 'feed-es.private.b64');
      const channel = JSON.parse(readFileSync(file, 'utf8')) as FeedChannel;
      if (typeof channel.channel !== 'string' || !Array.isArray(channel.rules)) {
        throw new Error(`File ${file} is not a feed channel`);
      }
      const { signature, ...rest } = channel;
      const signed = await signFeed(rest, readFileSync(privateKeyPath, 'utf8').trim());
      writeFileSync(file, JSON.stringify(signed, null, 2) + '\n', 'utf8');
      return t('cli.feed.firmado', { path: file, version: signed.version, expiresAt: signed.expiresAt });
    }
    case 'add': {
      const name = typeof flags['name'] === 'string' ? flags['name'] : '';
      const url = typeof flags['url'] === 'string' ? flags['url'] : '';
      if (name.length === 0 || url.length === 0) throw new Error('add needs --name N --url URL');
      // The pinned key is the trust anchor: without it, `update` would cache
      // anything the URL serves. Opting out demands the explicit flag.
      const unsigned = flags['unsigned'] === true;
      const publicKey = typeof flags['public'] === 'string' ? readFileSync(flags['public'], 'utf8').trim() : undefined;
      if (!publicKey && !unsigned) {
        throw new Error('add needs --public k.pub.b64 to pin the channel key (or --unsigned to accept unsigned channels)');
      }
      const channels = readChannels(configPath);
      const updated = channels.filter((c) => c.name !== name).concat({ name, url, publicKey });
      writeChannels(configPath, updated);
      const aviso = publicKey ? '' : '\n' + t('cli.feed.unsigned-warning', { nombre: name });
      return t('cli.feed.added', { nombre: name, url }) + aviso;
    }
    case 'list': {
      const channels = readChannels(configPath);
      if (channels.length === 0) return t('cli.feed.empty');
      return channels
        .map((c) => t('cli.feed.listed', { nombre: c.name, url: c.url, clave: c.publicKey ? ' [key pinned]' : '' }))
        .join('\n');
    }
    case 'update': {
      const channels = readChannels(configPath);
      if (channels.length === 0) return t('cli.feed.empty');
      const feedsDir = pathOf(flags, 'dir', DEFAULT_FEEDS_DIR);
      mkdirSync(feedsDir, { recursive: true });
      const lines: string[] = [];
      for (const channel of channels) {
        // sanitize the cache file name: a channel name like ../x must not escape feedsDir
        const safeName = channel.name.replace(/[^a-z0-9/_-]/gi, '') || 'unnamed';
        const response = await fetch(channel.url);
        if (!response.ok) {
          lines.push(t('cli.feed.http', { nombre: channel.name, status: String(response.status) }));
          continue;
        }
        const ch = (await response.json()) as FeedChannel;
        const verification = await verifyFeed(ch, channel.publicKey);
        if (!verification.ok) {
          lines.push(
            verification.reason === 'feed:expired'
              ? t('cli.feed.updated-caducado', { nombre: channel.name, expiresAt: ch.expiresAt })
              : t('cli.feed.bad-signature', { nombre: channel.name }),
          );
          continue;
        }
        const target = join(feedsDir, `${safeName}.json`);
        const cached = existsSync(target) ? (JSON.parse(readFileSync(target, 'utf8')) as FeedChannel) : null;
        if (cached && cached.version >= ch.version) {
          lines.push(t('cli.feed.unchanged', { nombre: channel.name, version: ch.version }));
          continue;
        }
        writeFileSync(target, JSON.stringify(ch, null, 2) + '\n', 'utf8');
        lines.push(
          t('cli.feed.updated', { nombre: channel.name, version: ch.version, rules: ch.rules.length, domains: ch.domains?.length ?? 0 }),
        );
      }
      return lines.join('\n');
    }
    case 'help': case '': return t('cli.feed.help');
    default: throw new Error(`Unknown feed subcommand: ${sub}\n${t('cli.feed.help')}`);
  }
}

function inputText(flags: Record<string, string | boolean>, positional: string[]): string {
  if (positional.length > 0) return positional.join(' ');
  return readFileSync(0, 'utf8'); // stdin
}

async function cmdInit(flags: Record<string, string | boolean>, locale: Locale): Promise<string> {
  const t = (code: string, vars?: Record<string, string | number>): string => translate(code, { locale, vars });
  const dir = pathOf(flags, 'dir', '.');
  const modelPath = join(dir, DEFAULT_MODEL);
  const rulesPath = join(dir, DEFAULT_RULES_FILE);
  const configPath = join(dir, DEFAULT_STEALTH_CONFIG);
  const lines: string[] = [];
  if (existsSync(modelPath)) {
    lines.push(t('cli.init.skipped', { path: modelPath }));
  } else {
    saveModel(createModel(), modelPath);
    lines.push(t('cli.init.created', { path: modelPath }));
  }
  if (existsSync(rulesPath)) {
    lines.push(t('cli.init.skipped', { path: rulesPath }));
  } else {
    writeFileSync(rulesPath, JSON.stringify(defaultRulePack, null, 2), 'utf8');
    lines.push(t('cli.init.created', { path: rulesPath }));
  }
  // Stealth names: the two strings a bot can see in your HTML, random per site.
  const stealthPath = join(dir, DEFAULT_STEALTH_CONFIG);
  if (existsSync(stealthPath)) {
    lines.push(t('cli.init.skipped', { path: stealthPath }));
  } else {
    const stealth = flags['no-stealth'] === true
      ? { stampField: 'spamcha', honeypotField: 'website' }
      : generateStealthNames();
    writeFileSync(stealthPath, JSON.stringify(stealth, null, 2) + '\n', 'utf8');
    lines.push(t('cli.init.created', { path: stealthPath }));
    lines.push(`  stampField: ${stealth.stampField} · honeypotField: ${stealth.honeypotField}`);
  }
  lines.push('');
  lines.push(t('cli.init.next'));
  return lines.join('\n');
}

function trainFolder(model: BayesModel, path: string, label: Label): number {
  const files = collect(path);
  for (const f of files) {
    const input = f.isJson ? (JSON.parse(f.content) as Record<string, string>) : f.content;
    trainFields(model, input, label);
  }
  return files.length;
}

async function cmdTrain(flags: Record<string, string | boolean>, locale: Locale): Promise<string> {
  const t = (code: string, vars?: Record<string, string | number>): string => translate(code, { locale, vars });
  const modelPath = pathOf(flags, 'model', DEFAULT_MODEL);
  const model: BayesModel = existsSync(modelPath) ? loadModel(modelPath) : createModel();

  const nSpam = typeof flags['spam'] === 'string' ? trainFolder(model, flags['spam'], 'spam') : 0;
  const nHam = typeof flags['ham'] === 'string' ? trainFolder(model, flags['ham'], 'ham') : 0;
  if (nSpam + nHam === 0) throw new Error(t('cli.train.empty'));

  saveModel(model, modelPath);
  return [
    t('cli.train.done', { spam: nSpam, ham: nHam }),
    t('cli.train.model', { path: modelPath, docsSpam: model.docs.spam, docsHam: model.docs.ham, vocabulary: model.vocabulary }),
  ].join('\n');
}

async function cmdEval(flags: Record<string, string | boolean>, locale: Locale): Promise<string> {
  const t = (code: string, vars?: Record<string, string | number>): string => translate(code, { locale, vars });
  const model = loadModel(pathOf(flags, 'model', DEFAULT_MODEL));
  const { pack, warnings } = effectivePack(flags, locale);
  const spamDir = flags['spam'];
  const hamDir = flags['ham'];
  if (typeof spamDir !== 'string' || typeof hamDir !== 'string') {
    throw new Error(t('cli.eval.needs'));
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const mistakes: string[] = [];
  const check = (files: FileEntry[], truth: Label): void => {
    for (const f of files) {
      const input = f.isJson ? (JSON.parse(f.content) as Record<string, string>) : f.content;
      const v = judge(input, model, { rulePack: pack });
      const predicted = v.decision !== 'pass' ? 'spam' : 'ham';
      if (truth === 'spam' && predicted === 'spam') tp++;
      else if (truth === 'spam' && predicted === 'ham') { fn++; mistakes.push(`  · ${f.path} → ${v.decision} (${v.probability.toFixed(2)})`); }
      else if (truth === 'ham' && predicted === 'ham') tn++;
      else { fp++; mistakes.push(`  · ${f.path} → ${v.decision} (${v.probability.toFixed(2)})`); }
    }
  };

  check(collect(spamDir), 'spam');
  check(collect(hamDir), 'ham');

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const lines = [
    t('cli.eval.truth', { spam: tp + fn, ham: tn + fp }),
    t('cli.eval.correct', { tp, tn }),
    t('cli.eval.mistakes', { fp, fn }),
    t('cli.eval.metrics', { precision: (precision * 100).toFixed(1), recall: (recall * 100).toFixed(1), f1: f1.toFixed(3) }),
  ];
  if (mistakes.length > 0) lines.push(t('cli.eval.errors'), ...mistakes);
  if (warnings.length > 0) lines.push('', ...warnings);
  return lines.join('\n');
}

async function cmdJudge(flags: Record<string, string | boolean>, positional: string[], locale: Locale): Promise<string> {
  const model = loadModel(pathOf(flags, 'model', DEFAULT_MODEL));
  const { pack } = effectivePack(flags, locale);
  const text = inputText(flags, positional);
  const verdict = judge(text, model, { rulePack: pack, locale });
  return JSON.stringify(verdict, null, 2);
}

/** Long-running: the verdict pipeline as a local HTTP service (mode-2 universality). */
async function cmdServe(flags: Record<string, string | boolean>, locale: Locale): Promise<string> {
  const secret = typeof flags['secret'] === 'string' ? flags['secret'] : process.env.SPAMCHA_SECRET;
  if (!secret) throw new Error('serve needs a secret: --secret "…" or SPAMCHA_SECRET env');
  let stampField: string | undefined;
  let honeypotField: string | undefined;
  const stealthPath = join(pathOf(flags, 'dir', '.'), DEFAULT_STEALTH_CONFIG);
  if (existsSync(stealthPath)) {
    const stealth = JSON.parse(readFileSync(stealthPath, 'utf8')) as { stampField?: string; honeypotField?: string };
    stampField = stealth.stampField;
    honeypotField = stealth.honeypotField;
  }
  stampField = (typeof flags['stamp-field'] === 'string' ? flags['stamp-field'] : stampField) || undefined;
  honeypotField = (typeof flags['honeypot-field'] === 'string' ? flags['honeypot-field'] : honeypotField) || undefined;

  const guard = createGatekeeper({
    secret,
    stampField,
    honeypotField,
    modelPath: pathOf(flags, 'model', DEFAULT_MODEL),
    quarantinePath: pathOf(flags, 'quarantine', 'spamcha-quarantine.jsonl'),
    logPath: pathOf(flags, 'log', 'spamcha-log.jsonl'),
    feedsDir: pathOf(flags, 'feeds-dir', DEFAULT_FEEDS_DIR),
    locale,
    rateLimit: { max: 30, windowMs: 60_000 },
    webBotAuth: flags['web-bot-auth'] === true
      ? { authority: typeof flags['authority'] === 'string' ? flags['authority'] : undefined }
      : undefined,
  });
  const port = Number(flags['port'] ?? process.env.SPAMCHA_PORT ?? 8788);
  const host = pathOf(flags, 'host', '127.0.0.1'); // localhost by default: it reads private data
  const server = createServeServer(guard, { cors: flags['cors'] === true, trustProxy: flags['trust-proxy'] === true });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const argvSecretNote = typeof flags['secret'] === 'string'
    ? '  ⚠ secret passed as a CLI flag: visible in process lists — prefer SPAMCHA_SECRET env'
    : '';
  return [
    `spamcha service listening on http://${host}:${port}`,
    ...(argvSecretNote ? [argvSecretNote] : []),
    `  POST /verdict   fields (urlencoded) or {"fields":{…}} → verdict JSON`,
    `  GET  /stamp     ?format=html → hidden inputs for your form`,
    `  GET  /panel · GET|POST /revision · GET /feeds · GET /health`,
    `  model: docs spam=${guard.model.docs.spam} ham=${guard.model.docs.ham} · quarantine ${guard.listQuarantine().length} pending`,
    '  (Ctrl-C to stop)',
  ].join('\n');
}

export async function run(args: string[]): Promise<string> {
  const { command, flags, positional } = parse(args);
  const locale = localeOf(flags);
  const t = (code: string, vars?: Record<string, string | number>): string => translate(code, { locale, vars });
  switch (command) {
    case 'init': return cmdInit(flags, locale);
    case 'train': return cmdTrain(flags, locale);
    case 'eval': return cmdEval(flags, locale);
    case 'judge': case 'juzgar': return cmdJudge(flags, positional, locale);
    case 'feed': return cmdFeed(flags, positional[0] ?? 'help', locale);
    case 'serve': return cmdServe(flags, locale);
    case 'version': {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
      return `spamcha v${pkg.version}`;
    }
    case 'help': case '--help': case '-h': case '': return t('cli.help');
    default: throw new Error(`${t('cli.error.command', { command })}\n${t('cli.help')}`);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    console.log(await run(argv));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
