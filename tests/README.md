# Darts and VIP regression checks

This repository is a static HTML/CSS/JavaScript application. It has no package.json or build step.

## Syntax

```sh
node --check script.js
node --check tests/browser.cjs
git diff --check
```

All commands passed with exit code 0 on 2026-11-09.

## Browser

Requires Node.js, Playwright and Chromium (the verification environment already provided them). Run `python3 -m http.server 8000` from the repository. Store the app's existing CDN libraries as `/tmp/supabase.js`, `/tmp/lottie.js` and `/tmp/pako.js`:

```sh
curl -fsSL 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2' -o /tmp/supabase.js
curl -fsSL 'https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js' -o /tmp/lottie.js
curl -fsSL 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js' -o /tmp/pako.js
node tests/browser.cjs
```

`BROWSER_FIXTURES` overrides `/tmp`; `TEST_BASE_URL` overrides `http://127.0.0.1:8000`. The test mocks Telegram authentication and every external API request. It never places a real bet or claims a real reward. Local animations are played normally.

Verified: VIP loading, seven rank buttons, milestone eligibility and claim, touch open/close, retry after an API error, no horizontal overflow at 320/390/600px; darts Sector/Center icons for two and three throws, yellow pending result after center in Adjacent, and green final win after ring 5. Screenshots are written to `/tmp/vip-fixed.png` and `/tmp/darts-pending.png`.

Known existing issue: the trailing `balanceSync` IIFE reads `setUIBalance` outside its scope and throws `setUIBalance is not defined`. This was reproduced with the unchanged script from baseline commit `bb2f6328bddab9c92bc533268013ca4b12556b33`. The browser test allows precisely this existing error and rejects additional page errors. It was left unchanged because it is outside the requested darts/VIP fixes. To reproduce the baseline check, run `BASELINE=1 node tests/browser.cjs`.

## SQL

Execute `tests/darts.sql` in one database session. It creates only `pg_temp` test functions and rolls back. It reads the existing pure `_emoji_coef` function, replaces authentication/randomness/balance writes only in the temporary test copy, and never changes production functions or player records.

Verified all 3354 outcomes across 34 modes: actual winning counts equal the configured probability numerators, and all error/coefficient/final-verdict mismatch counts are zero. All twelve named prefix/adjacency checks returned true.

The production patch is recorded in `supabase/sql/fix_darts.sql`; the original function is preserved in `supabase/sql/emoji_play.before.sql`. The patch was applied to project `nkovsjhwinbbapsqvpnu` after isolated verification. Its baseline hash guard deliberately rejects a repeat application or an intervening change. It preserves authentication, payouts, coefficients and other games, adds a private pure verdict helper and per-prefix `verdicts`, and changes adjacency to neighboring radial hits 2–6 (no bounce or wraparound).

Post-deployment read-only checks passed for center pending, center/ring-5 win, rejection of 2/5 wraparound, private helper permissions and rejection of unsigned Telegram authentication. Supabase security advisory counts did not increase. Existing unrelated advisories include [mutable function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) and [public SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable); a separate audit should inspect their intended authorization.

Actual Telegram WebView behavior and real-money transactions were not exercised.
