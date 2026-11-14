// Cached feed loader, shared by the guard and the CLI (node:fs — this module
// is server-only). Signature verification happened at `feed update` download
// time against the pinned key; here we only re-check expiry, synchronously.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedChannel } from './feed.js';

export interface LoadedFeeds {
  channels: FeedChannel[];
  /** Cache files that were skipped (expired or corrupt), by file name. */
  skipped: string[];
}

export function loadCachedFeeds(feedsDir: string): LoadedFeeds {
  if (!existsSync(feedsDir)) return { channels: [], skipped: [] };
  const channels: FeedChannel[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  for (const name of readdirSync(feedsDir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const ch = JSON.parse(readFileSync(join(feedsDir, name), 'utf8')) as FeedChannel;
      const expired = Number.isNaN(Date.parse(ch.expiresAt)) || now >= Date.parse(ch.expiresAt);
      if (expired) {
        skipped.push(ch.channel ?? name);
        continue;
      }
      channels.push(ch);
    } catch {
      skipped.push(name);
    }
  }
  return { channels, skipped };
}
