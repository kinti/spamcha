// spamcha's public API. Isomorphic library: stamp, judge and bayes run in
// Node, Bun, Deno, Workers and the browser; storage.ts (node:fs) and demo.ts
// are the exceptions.

export type {
  Decision,
  JudgeOptions,
  Label,
  Reason,
  Rule,
  RulePack,
  Thresholds,
  Verdict,
} from './types.js';

export { normalize, tokenize } from './tokenizer.js';
export { createModel, probability, train } from './bayes.js';
export type { BayesModel } from './bayes.js';
export { evaluateRules } from './rules.js';
export { defaultRulePack } from './rules-default.js';
export { judge, toFields, toText, trainFields } from './judge.js';
export { loadModel, saveModel } from './storage.js';

// The full stack: stamp + gatekeeper + ALTCHA adapter
export { issueStamp, stampFieldsHtml, verifyStamp } from './stamp.js';
export type {
  IssueStampOptions,
  StampPayload,
  StampReason,
  StampVerification,
  VerifyStampOptions,
} from './stamp.js';
export { verifySubmission } from './gatekeeper.js';
export type { QuarantineNotification } from './gatekeeper.js';
export type { GatekeeperOptions, SubmissionVerdict } from './gatekeeper.js';
export { createGatekeeper } from './guard.js';
export type { Gatekeeper, GatekeeperConfig, ReviewMeta } from './guard.js';
export { canonical, generateFeedKeyPair, mergeFeedChannels, signFeed, verifyFeed } from './feed.js';
export type { FeedChannel, FeedToSign, FeedVerification } from './feed.js';
export { VerdictLog } from './log.js';
export type { LogEntry } from './log.js';
export { panelHtml } from './panel.js';
export type { PanelOptions } from './panel.js';
export { generateStealthNames, isStealthName } from './stealth.js';
export type { StealthNames } from './stealth.js';
export { middlewareExpress, middlewareHono } from './adapters.js';
export { verifyAltchaSolution } from './altcha.js';
export type { AltchaOptions, AltchaPayload, AltchaVerification } from './altcha.js';
export { QuarantineStore } from './quarantine.js';
export type { QuarantineEntry } from './quarantine.js';
export { createRateLimiter } from './rate-limit.js';
export type { RateLimitOptions, RateLimiter } from './rate-limit.js';

// Locales: Spanish native, English translated; codes immutable
export { DEFAULT_LOCALE, isLocale, LOCALES, ruleText, stringsFor, translate } from './locales.js';
export type { Locale } from './locales.js';
export { stringsEs } from './strings-es.js';
export { stringsEn } from './strings-en.js';
