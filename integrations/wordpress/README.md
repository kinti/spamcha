# spamcha — WordPress plugin (bridge)

Minimal bridge between WordPress and your own `spamcha serve` instance.
WordPress renders the stamp, every comment goes through your local judge,
quarantined ones land in moderation, and **the content never leaves your server**
(the service runs on the same box or your LAN).

## Install

1. Run the service on the same machine (or LAN):
   ```sh
   spamcha serve --port 8788 --secret "a long random phrase"
   ```
   (or the Docker image; keep it bound to localhost/127.0.0.1)
2. Copy this `spamcha/` folder to `wp-content/plugins/` and activate **spamcha**.
3. Settings → **spamcha**: set the service URL (`http://127.0.0.1:8788`), enable comment protection.
4. The page shows ✓/✗ service status and a link to your **panel**.

## What it protects

- **Comments** (out of the box): stamp hidden fields on the form, judged via `preprocess_comment` —
  `reject` → 403 page, `quarantine` → held for moderation (review both in WP and in the spamcha panel;
  marking garbage in the panel trains your local judge).
- **Any form you own**: call `spamcha_verdict( $fields )` — returns the full verdict array
  (`['decision' => 'pass|quarantine|reject', 'reasons' => …]`).

## Honest limits

- Fail-open: if the service is down, comments pass (never block real people on our own outage — the
  settings page shows the service status so you notice).
- Form-builder forms (Elementor/CF7/Divi) need their own hook wiring via `spamcha_verdict()`.
- The stamp transient is cached for 10 minutes; stamps live 30 — comfortable margins.
