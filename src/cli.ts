#!/usr/bin/env node
// spamcha CLI: init · train · eval · judge. Zero dependencies.
// Logic lives in `run` (testable); `main` only prints and sets the exit code.
// Locale: --locale es|en, or the SPAMCHA_LOCALE env var. Spanish is native;
// English ships as translation. Command names are international; `juzgar`
// survives as an alias out of respect for muscle memory.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createModel } from './bayes.js';
import type { BayesModel } from './bayes.js';
import { generateFeedKeyPair, mergeFeedChannels, signFeed, verifyFeed } from './feed.js';
import type { FeedChannel } from './feed.js';
import { judge, trainFields } from './judge.js';
import { isLocale, DEFAULT_LOCALE, translate } from './locales.js';
import type { Locale } from './locales.js';
import { loadModel, saveModel } from './storage.js';
import { defaultRulePack } from './rules-es.js';
import type { Label, RulePack } from './types.js';

const DEFAULT_MODEL = 'spamcha.json';
const DEFAULT_RULES_FILE = 'rules-es.json';
const DEFAULT_FEEDS_CONFIG = 'spamcha.feeds.json';
const DEFAULT_FEEDS_DIR = 'feeds';

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

// ─── Feeds: canales de inteligencia firmados ────────────────────────────────

interface CanalConfig {
  nombre: string;
  url: string;
  publicKey?: string;
}

function rutaCanales(flags: Record<string, string | boolean>): string {
  return pathOf(flags, 'config', DEFAULT_FEEDS_CONFIG);
}

function leerCanales(ruta: string): CanalConfig[] {
  if (!existsSync(ruta)) return [];
  const parsed = JSON.parse(readFileSync(ruta, 'utf8')) as CanalConfig[];
  if (!Array.isArray(parsed)) throw new Error(`File ${ruta} is not a channel list`);
  return parsed;
}

function escribirCanales(ruta: string, canales: CanalConfig[]): void {
  if (canales.length > 0) mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify(canales, null, 2), 'utf8');
}

/** Carga los feeds descargados del directorio; omite los caducados (avisando).
 *  La firma ya se verificó contra la clave fijada en `feed update` — aquí solo
 *  se re-chequea la caducidad (síncrono, sin promesas en el arranque). */
function feedsCargados(dirFeeds: string, idioma: Locale): { channels: FeedChannel[]; avisos: string[] } {
  const avisos: string[] = [];
  if (!existsSync(dirFeeds)) return { channels: [], avisos };
  const channels: FeedChannel[] = [];
  const ahora = Date.now();
  for (const nombre of readdirSync(dirFeeds).sort()) {
    if (!nombre.endsWith('.json')) continue;
    try {
      const ch = JSON.parse(readFileSync(join(dirFeeds, nombre), 'utf8')) as FeedChannel;
      const caducado = Number.isNaN(Date.parse(ch.expiresAt)) || ahora >= Date.parse(ch.expiresAt);
      if (caducado) {
        avisos.push(translate('cli.feed.skipped-expired', { locale: idioma, vars: { channel: ch.channel ?? nombre } }));
        continue;
      }
      channels.push(ch);
    } catch {
      avisos.push(translate('cli.feed.skipped-expired', { locale: idioma, vars: { channel: nombre } }));
    }
  }
  return { channels, avisos };
}

function packEfectivo(flags: Record<string, string | boolean>, idioma: Locale): { pack: RulePack; avisos: string[] } {
  const base = packOf(flags);
  const { channels, avisos } = feedsCargados(pathOf(flags, 'feeds-dir', DEFAULT_FEEDS_DIR), idioma);
  return { pack: mergeFeedChannels(base, channels), avisos };
}

async function cmdFeed(flags: Record<string, string | boolean>, sub: string, idioma: Locale): Promise<string> {
  const t = (code: string, vars?: Record<string, string | number>): string => translate(code, { locale: idioma, vars });
  const rutaConfig = rutaCanales(flags);
  switch (sub) {
    case 'keygen': {
      const par = await generateFeedKeyPair();
      const rutaPrivada = pathOf(flags, 'privada', 'feed-es.priv.b64');
      const rutaPublica = pathOf(flags, 'publica', 'feed-es.pub.b64');
      mkdirSync(dirname(rutaPrivada), { recursive: true });
      mkdirSync(dirname(rutaPublica), { recursive: true });
      writeFileSync(rutaPrivada, par.private, 'utf8');
      writeFileSync(rutaPublica, par.public, 'utf8');
      return t('cli.feed.keygen', { privada: rutaPrivada, publica: rutaPublica });
    }
    case 'sign': {
      const archivo = pathOf(flags, 'archivo', '');
      if (archivo.length === 0) throw new Error('sign necesita --archivo feed.json');
      const privada = pathOf(flags, 'privada', 'feed-es.priv.b64');
      const canal = JSON.parse(readFileSync(archivo, 'utf8')) as FeedChannel;
      if (typeof canal.channel !== 'string' || !Array.isArray(canal.rules)) {
        throw new Error(`File ${archivo} is not a feed channel`);
      }
      const { signature, ...resto } = canal;
      const firmado = await signFeed(resto, readFileSync(privada, 'utf8').trim());
      writeFileSync(archivo, JSON.stringify(firmado, null, 2) + '\n', 'utf8');
      return t('cli.feed.firmado', { path: archivo, version: firmado.version, expiresAt: firmado.expiresAt });
    }
    case 'add': {
      const nombre = typeof flags['nombre'] === 'string' ? flags['nombre'] : '';
      const url = typeof flags['url'] === 'string' ? flags['url'] : '';
      if (nombre.length === 0 || url.length === 0) throw new Error('add necesita --nombre N --url URL');
      const canales = leerCanales(rutaConfig);
      const publicKey = typeof flags['publica'] === 'string' ? readFileSync(flags['publica'], 'utf8').trim() : undefined;
      const nuevos = canales.filter((c) => c.nombre !== nombre).concat({ nombre, url, publicKey });
      escribirCanales(rutaConfig, nuevos);
      return t('cli.feed.added', { nombre, url });
    }
    case 'list': {
      const canales = leerCanales(rutaConfig);
      if (canales.length === 0) return t('cli.feed.empty');
      return canales
        .map((c) => t('cli.feed.listed', { nombre: c.nombre, url: c.url, clave: c.publicKey ? ' [clave fijada]' : '' }))
        .join('\n');
    }
    case 'update': {
      const canales = leerCanales(rutaConfig);
      if (canales.length === 0) return t('cli.feed.empty');
      const dirFeeds = pathOf(flags, 'dir', DEFAULT_FEEDS_DIR);
      mkdirSync(dirFeeds, { recursive: true });
      const lineas: string[] = [];
      for (const canal of canales) {
        const respuesta = await fetch(canal.url);
        if (!respuesta.ok) {
          lineas.push(t('cli.feed.bad-signature', { nombre: `${canal.nombre} (HTTP ${respuesta.status})` }));
          continue;
        }
        const ch = (await respuesta.json()) as FeedChannel;
        const verificacion = await verifyFeed(ch, canal.publicKey);
        if (!verificacion.ok) {
          lineas.push(
            verificacion.reason === 'feed:caducado'
              ? t('cli.feed.updated-caducado', { nombre: canal.nombre, expiresAt: ch.expiresAt })
              : t('cli.feed.bad-signature', { nombre: canal.nombre }),
          );
          continue;
        }
        const destino = join(dirFeeds, `${canal.nombre}.json`);
        const cacheado = existsSync(destino) ? (JSON.parse(readFileSync(destino, 'utf8')) as FeedChannel) : null;
        if (cacheado && cacheado.version >= ch.version) {
          lineas.push(t('cli.feed.unchanged', { nombre: canal.nombre, version: ch.version }));
          continue;
        }
        writeFileSync(destino, JSON.stringify(ch, null, 2) + '\n', 'utf8');
        lineas.push(
          t('cli.feed.updated', { nombre: canal.nombre, version: ch.version, rules: ch.rules.length, domains: ch.domains?.length ?? 0 }),
        );
      }
      return lineas.join('\n');
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
  const { pack, avisos } = packEfectivo(flags, locale);
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
  if (avisos.length > 0) lines.push('', ...avisos);
  return lines.join('\n');
}

async function cmdJudge(flags: Record<string, string | boolean>, positional: string[], locale: Locale): Promise<string> {
  const model = loadModel(pathOf(flags, 'model', DEFAULT_MODEL));
  const { pack } = packEfectivo(flags, locale);
  const text = inputText(flags, positional);
  const verdict = judge(text, model, { rulePack: pack, locale });
  return JSON.stringify(verdict, null, 2);
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
