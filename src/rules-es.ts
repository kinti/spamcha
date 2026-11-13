// Default rule pack, tuned for Spanish-language contact forms.
// Built to BOOTSTRAP (cold model): the rules carry the weight while the bayes
// has no corpus. The site owner should edit this pack for THEIR site.
// Weight philosophy: a single rule rarely reaches quarantine (0.5);
// two or three together do. Rejection demands serious cause.
// Descriptions are written in Spanish (the native locale); English lives in
// strings-en.ts under `rule.<id>`.

import type { RulePack } from './types.js';

const BAIT = 'viagra|cialis|casino|porn[oó]|escort|payday|crypto\\s*(?:wallet|invest|coin)|nft\\s*giveaway|seo\\s*services|backlinks|free\\s*money|loan\\s*offer|forex\\s*signals';

export const defaultRulePack: RulePack = {
  name: 'default-es',
  rules: [
    {
      id: 'spam-words',
      type: 'count',
      pattern: BAIT,
      threshold: 1,
      weight: 3,
      description: 'Palabras típicas de spam',
    },
    {
      id: 'spam-words-heavy',
      type: 'count',
      pattern: BAIT,
      threshold: 4,
      weight: 5,
      description: 'Lluvia de palabras típicas de spam',
    },
    {
      id: 'many-links',
      type: 'count',
      pattern: 'https?://|www\\.',
      threshold: 5,
      weight: 3,
      description: 'Más de 5 enlaces en el envío',
    },
    {
      id: 'dense-links',
      type: 'density',
      pattern: 'https?://',
      threshold: 4,
      minLength: 300,
      weight: 3,
      description: 'Textos largos saturados de enlaces',
    },
    {
      id: 'injected-html',
      type: 'count',
      pattern: '<a\\s+href|<iframe|<script',
      threshold: 1,
      weight: 3,
      description: 'HTML incrustado en el texto',
    },
    {
      id: 'bbcode',
      type: 'count',
      pattern: '\\[(?:url|link)=',
      threshold: 1,
      weight: 3,
      description: 'BBCode de foros incrustado',
    },
    {
      id: 'shouting',
      type: 'ratio',
      pattern: '\\p{Lu}',
      threshold: 0.6,
      minLength: 30,
      weight: 2,
      description: 'Gritos: la mayoría del texto en mayúsculas',
    },
    {
      id: 'foreign-alphabet',
      type: 'ratio',
      pattern: '\\p{Script=Cyrillic}|\\p{Script=Han}|\\p{Script=Arabic}',
      threshold: 0.3,
      minLength: 20,
      weight: 3,
      description: 'Gran parte del texto en un alfabeto ajeno al sitio',
    },
  ],
};
