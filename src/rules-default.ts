// Default rule pack, tuned for Spanish-language contact forms (the patterns
// match Spanish spam; the descriptions are English: Spanish translations live
// in strings-es.ts under `rule.<id>`). Built to BOOTSTRAP (cold model): the
// rules carry the weight while the bayes has no corpus. The site owner should
// edit this pack for THEIR site.
// Weight philosophy: a single rule rarely reaches quarantine (0.5);
// two or three together do. Rejection demands serious cause.

import type { RulePack } from './types.js';

const BAIT = 'viagra|cialis|casino|porn[oó]|escort|payday|crypto\\s*(?:wallet|invest|coin)|nft\\s*giveaway|seo\\s*services|backlinks|free\\s*money|loan\\s*offer|forex\\s*signals';

export const defaultRulePack: RulePack = {
  name: 'default',
  rules: [
    {
      id: 'spam-words',
      type: 'count',
      pattern: BAIT,
      threshold: 1,
      weight: 3,
      description: 'Classic spam keywords',
    },
    {
      id: 'spam-words-heavy',
      type: 'count',
      pattern: BAIT,
      threshold: 4,
      weight: 5,
      description: 'A flood of classic spam keywords',
    },
    {
      id: 'many-links',
      type: 'count',
      pattern: 'https?://|www\\.',
      threshold: 5,
      weight: 3,
      description: 'More than 5 links in a single submission',
    },
    {
      id: 'dense-links',
      type: 'density',
      pattern: 'https?://',
      threshold: 4,
      minLength: 300,
      weight: 3,
      description: 'Long text saturated with links',
    },
    {
      id: 'injected-html',
      type: 'count',
      pattern: '<a\\s+href|<iframe|<script',
      threshold: 1,
      weight: 3,
      description: 'HTML embedded in the text',
    },
    {
      id: 'bbcode',
      type: 'count',
      pattern: '\\[(?:url|link)=',
      threshold: 1,
      weight: 3,
      description: 'Forum BBCode embedded',
    },
    {
      id: 'shouting',
      type: 'ratio',
      pattern: '\\p{Lu}',
      threshold: 0.6,
      minLength: 30,
      weight: 2,
      description: 'Shouting: most of the text is uppercase',
    },
    {
      id: 'foreign-alphabet',
      type: 'ratio',
      pattern: '\\p{Script=Cyrillic}|\\p{Script=Han}|\\p{Script=Arabic}',
      threshold: 0.3,
      minLength: 20,
      weight: 3,
      description: 'Much of the text in a foreign alphabet',
    },
  ],
};
