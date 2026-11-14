# Changelog

## 0.9.4 — the mutant zoo
- `test/mutantes.test.ts`: a zoo of attacker strategies (raw POSTs, render-flash,
  honeypot-fillers, replay bursts, field-guessers, polished guest-posting,
  template spam) run on day 0 and after feedback. Scoreboard in the suite.

## 0.9.3 — the learning loop, measured
- Green-phase booster: a small but convinced bayes quarantines novel families
  (`bayes-arranque`).
- `autoHam`: clean passes weak-train ham automatically — the corpus builds itself.
- Measured learning curve documented in both READMEs (0/6 → 6/6 after 3 marks, 0 FP).
- Corrected an overclaimed "one click teaches" to the measured reality.

## 0.9.2 — stealth names
- Per-site random field names (`spamcha.config.json`): no fingerprints in your HTML.
- Plausible honeypot names from a pool; `--no-stealth` keeps classic names.

## 0.9.1 — security hardening
- Single-use stamps (replay cache), body/field size caps, feed ReDoS guard,
  SSRF https-only agent, CSRF origin check on mutations, private files 0600,
  trust-proxy opt-in.

## 0.9.0 — serve + WordPress + web-bot-auth + Docker
- `spamcha serve`: local verdict HTTP service (PHP/Python/anything).
- WordPress bridge plugin (comment protection + `spamcha_verdict()`).
- web-bot-auth verifier (EXPERIMENTAL, Ed25519 @authority profile).
- Dockerfile; landing page; npm package contents finalized.

## 0.8.0 — the panel + installable guard
- `createGatekeeper` factory: model, quarantine, rate limiter, stamps in one object.
- `middlewareExpress` / `middlewareHono`; panelHtml (what arrived, review buttons).
- Quarantine store + `resolveQuarantine` feedback loop; autoHam.

## 0.7.0 — born in English
- English-first API, CLI and pack descriptions; Spanish ships as a first-class
  locale (`--locale es`). Immutable verdict codes.

## 0.6.0 — feeds: the shared bloodstream
- Signed Ed25519 feed channels (OpenWRT-style): keygen/sign/add/list/update;
  merge into the judge with traceable `feed:<channel>:<id>` reason codes.

## 0.5.0 — the full pipeline
- HMAC-SHA256 render stamp with unfakeable server-side time floor; honeypot
  gate; ALTCHA solution adapter; gatekeeper pipeline.

## 0.3.0 — the judge
- Graham-style Bayesian classifier + declarative rule packs, gradual fusion,
  dual-locale, CLI (init/train/eval/judge), zero runtime dependencies.
