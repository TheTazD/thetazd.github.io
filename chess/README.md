# Chess Tutor

A mobile-first chess coach for the family. Pillars 1–4 of 5: **review and explanations**, **themed puzzles**, **adaptive matches** and a **diagnostic curriculum**.

Load a game, step through it, and the app flags weak moves quietly. Tap **Why?** for a one-line reason, **Tell me more** for what happens next and what was better, or **I meant that** to say what you were going for and have the engine test your idea.

## What's in Pillar 1

- **Three ways in:** replay a game on the board (for Duolingo or over-the-board games), paste a PGN, or pull recent games from Lichess by username.
- **Whole-game analysis** with Stockfish 18 (lite, runs in the browser). Moves are graded best / good / inaccuracy / mistake / blunder by how much they change your winning chances.
- **Layered explanations:** flag only → "Why?" → "Tell me more", with the board showing your move against the better one, and lines you can play through step by step.
- **Have a go first:** before the better move is revealed, you can try to find it yourself.
- **"I meant that":** pick what you were going for (threaten something, win material, attack the king, sacrifice, stop a threat, trade, develop), optionally show the follow-up you planned, and get a verdict: *your reasoning holds*, *right idea but not the whole story*, or *the idea doesn't work here*.
- **Archive:** every game, its analysis and your "I meant that" notes are kept per player.
- **My look:** each player picks board colours and a piece set (`js/look.js`, `js/look-ui.js`, route `#/look`). Some are free; others unlock with learning milestones — 7- and 30-day puzzle streaks, 5 library entries read, 10 matches, 100 puzzles solved, a Coach weakness fixed. Unlocks are recorded in `look.unlocked` and stay unlocked.
- **Profiles:** pick who's playing on open. No passwords. Each player can pick an avatar (an icon on a coloured circle) — offered the first time they open the app, changed any time with the ✎ button on "Who's playing?". It's kept in the player's `progress` record (`look`), so it follows them across devices; `js/avatars.js` holds the icons, colours and picker.

## What's in Pillar 2 (themed puzzles)

- **Ten themes**, each drilling one idea: mate in one, free pieces, forks, pins, skewers, back-rank mates, discovered attacks, mate in two, trapped pieces, promotion. Each has a short "how it works" page.
- **Sets of six**, Duolingo-style. Most are *find the move*; two in each set are *spot the threat*: you name what your opponent is threatening, then find a move that stops it — so every theme is practised from both sides.
- **Layered explanations**, quiet by default: a wrong move gets *Why not?* then *Tell me more* (the same engine as game review); a solved puzzle gets *Why does it work?* (naming exactly what's forked, pinned or left loose) and the full line to step through.
- **Fair marking:** any checkmate counts, and a different move that still wins big gets "not bad — but there's something stronger" instead of a fail.
- **Pitched at your level:** each player picks a starting level once; a puzzle rating then moves with every first attempt, and puzzles are chosen a little below it.
- **Spaced repetition:** missed puzzles come back after 1, 3, 7, 16 and 35 days. Once a theme is strong it gets refresher sets at growing gaps; if it slips, it goes back to learning.
- **Today's practice:** a mixed set built from what's due, what's fading and the weakest theme. A daily streak counts the days you finish a set.
- **Archive:** every attempt is saved as a short game starting from the puzzle position, so it opens in the normal review screen.
- **Puzzles** come from the Lichess puzzle database (CC0). Every theme ships with the app: mate in one, free pieces and forks in `data/puzzles.json` (60 each), the other seven in one small file each under `data/themes/`, loaded only when that theme is opened. When a theme runs low at your level, more are fetched from Lichess and kept on the device.

## What's in Pillar 3 (adaptive match)

- **Full games against "Coach bot"**, pitched at the player's match rating. It's Stockfish weakened to play like a person: a shallow search, a weighted choice among its top few moves, and the odd slip. Tested at ~1050, it makes the 2–4 blunders and a few mistakes per game typical of that level.
- **Rating on quality, not just results.** Each game scores half on the result and half on accuracy compared with the bot in the same game, so a lucky sloppy win barely moves you up and a well-played loss costs very little. The result screen says which happened.
- **Keeps it fair:** the bot follows your rating, varies ±40 for variety, eases off after two losses in a row and pushes harder after three wins.
- **Resign, offer a draw** (the bot accepts when it's level after move 15 or it's worse), no take-backs. The game saves after every move, so you can leave and resume.
- **Every match goes into the archive** with its analysis, ready for the Pillar 1 review screen.
- **Assessment match**: the first game, then every 8 games (or 14 days). Afterwards you get a report by phase — opening, middlegame, endgame, under pressure — over your last 10 games, your biggest mistakes explained, and the puzzle themes they point to. Those themes go to the front of Today's practice until they're strong.
- **Progress**: rating and accuracy charts, win/draw/loss record, recent matches.

`js/bot.js` is the opponent, `js/match.js` the rating and assessment logic, `js/match-ui.js` the screens. Match data lives in the same per-player `progress` record as puzzles.

## What's in Pillar 4 (diagnostic curriculum)

- **Evidence from every analysed game** — matches, and any game opened in review. Each of your mistakes is checked for the tactic behind it, from both sides: what you *walked into* (their fork, pin, mate threat…) and what you *missed* (your own fork, free piece, mate…). This uses the stored analysis, so it costs no extra engine time. Puzzle results add to it: spot-the-threat misses count towards the "walked into" side, find-the-move misses towards the "missed" side.
- **"Your top weakness is X"**: twenty weaknesses (ten themes × two sides), ranked by how often they cost you in your last 20 games plus how you do on the matching puzzles. Each has an evidence page.
- **One at a time, in four steps:** *Learn* (how it works, the habit that prevents it, and positions from your own games where you tap the move before it's revealed) → *Drill* (focused sets: mostly spot-the-threat for "walked into", mostly find-the-move for "missed"; 75%+ over 2+ sets moves you on) → *Prove it* (3 later games where it stops happening, plus a check-up set at least 2 days later) → *Fixed*.
- **If it doesn't stick**, it goes back to drilling (round 2). Fixed weaknesses get re-tests after 7, 21, 45, 90 and 180 days, and go back on the list if a re-test fails or they creep back into games.
- **Linked to the other pillars:** the current weakness and due re-tests go first in Today's practice; match results say when a game confirmed a fix; lesson examples open the exact move in the review screen.

`js/motifs.js` names the tactic behind a mistake, `js/curriculum.js` holds the evidence, ranking and the learn → drill → verify loop, `js/coach-ui.js` the screens. Curriculum data lives in the same per-player `progress` record.

## Running it

It's a static site with no build step. Any static host works, including GitHub Pages:

1. Put these files in the repo's root on the `main` branch.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)` → Save.
3. After a minute it's live at `https://<username>.github.io/<repo>/`.

On a phone, open it in the browser and use **Add to Home Screen** to get an app icon.

To run it locally: `python3 -m http.server` in this folder, then open `http://localhost:8000`.

## Saving across devices (Supabase)

Until Supabase is connected, everything is saved in the browser on the device you're using.

1. Create a free project at supabase.com.
2. Open **SQL Editor → New query**, paste in `supabase/schema.sql`, and press **Run**.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into `js/config.js`. (Done — the family project is connected.)
4. Commit and push. The first time the app opens with Supabase switched on, it copies any games saved on that device up to the cloud.

Pillar 2 adds a `progress` table (puzzle rating, streak, repetition schedule). It's in `schema.sql`; re-running the whole file is safe. Until it exists, progress is kept on each device and is copied up automatically once the table is there.

The family setup has no passwords, so anyone with both the site address and the key could read the data. Don't store anything private in it. Logins can be added later.

## How the explanations work

- `js/engine.js` runs Stockfish in a background worker.
- `js/analysis.js` evaluates every position and grades each move.
- `js/explain.js` takes a closer look at one move and turns it into plain English. It checks, in order: allowing mate, missing mate, losing material (hanging pieces, forks, undefended pieces, a defender moved away), missing a win of material, then positional reasons (castling, development, king safety, loose pieces, pawn structure, mobility). When nothing fits, it says so and shows the engine's line rather than inventing a reason.
- `js/intent.js` tests a stated idea by letting the opponent "pass" and checking whether the follow-up really wins something, then whether the opponent's best reply stops it.

## How the puzzles work

- `js/themes.js` — the themes and their "how it works" text.
- `js/puzzles.js` — puzzle bank (bundled pack + Lichess top-ups), choosing puzzles near the player's rating, rating updates, spaced repetition, theme mastery and the streak.
- `js/puzzle-explain.js` — explains a solution in plain English: forks, pins, skewers, discovered attacks, free pieces, mates.
- `js/puzzle-ui.js` — the puzzle screens.

## Licences

- Stockfish.js: GPLv3 (`engine/STOCKFISH-LICENSE.txt`). Because the engine ships with the app, the app is GPLv3 too (`LICENSE`).
- Puzzles: Lichess puzzle database, CC0.
- chess.js: BSD-2-Clause (`vendor/CHESSJS-LICENSE.txt`).
- Piece images: "cburnett" set by Colin M.L. Burnett, CC BY-SA 3.0.
- Other piece sets (from the Lichess collection, chosen per player under **My look**): Merida — Armando Hernandez Marroquin, GPLv2+; Chessnut — Alexis Luengas, Apache 2.0; Bold ("totoy") — Kosal Sen, CC BY 4.0; Celtic, Spatial, Fantasy — Maurizio Monge, MIT; Warm ("rhosgfx") — RhosGFX, CC0; Papercut — Nikolay Anzarov, CC BY 4.0; Gold ("Firi") — James Faure, CC BY 4.0. Files in `img/pieces/<set>/`.

## Next pillars

4. Diagnostic curriculum · 5. Reference library. See the project's master spec.
