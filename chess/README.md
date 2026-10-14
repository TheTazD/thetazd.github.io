# Chess Tutor

A mobile-first chess coach for the family. Pillar 1 of 5: **review and explanations**.

Load a game, step through it, and the app flags weak moves quietly. Tap **Why?** for a one-line reason, **Tell me more** for what happens next and what was better, or **I meant that** to say what you were going for and have the engine test your idea.

## What's in Pillar 1

- **Three ways in:** replay a game on the board (for Duolingo or over-the-board games), paste a PGN, or pull recent games from Lichess by username.
- **Whole-game analysis** with Stockfish 18 (lite, runs in the browser). Moves are graded best / good / inaccuracy / mistake / blunder by how much they change your winning chances.
- **Layered explanations:** flag only → "Why?" → "Tell me more", with the board showing your move against the better one, and lines you can play through step by step.
- **Have a go first:** before the better move is revealed, you can try to find it yourself.
- **"I meant that":** pick what you were going for (threaten something, win material, attack the king, sacrifice, stop a threat, trade, develop), optionally show the follow-up you planned, and get a verdict: *your reasoning holds*, *right idea but not the whole story*, or *the idea doesn't work here*.
- **Archive:** every game, its analysis and your "I meant that" notes are kept per player.
- **Profiles:** pick who's playing on open. No passwords.

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
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into `js/config.js`.
4. Commit and push. The first time the app opens with Supabase switched on, it copies any games saved on that device up to the cloud.

The family setup has no passwords, so anyone with both the site address and the key could read the data. Don't store anything private in it. Logins can be added later.

## How the explanations work

- `js/engine.js` runs Stockfish in a background worker.
- `js/analysis.js` evaluates every position and grades each move.
- `js/explain.js` takes a closer look at one move and turns it into plain English. It checks, in order: allowing mate, missing mate, losing material (hanging pieces, forks, undefended pieces, a defender moved away), missing a win of material, then positional reasons (castling, development, king safety, loose pieces, pawn structure, mobility). When nothing fits, it says so and shows the engine's line rather than inventing a reason.
- `js/intent.js` tests a stated idea by letting the opponent "pass" and checking whether the follow-up really wins something, then whether the opponent's best reply stops it.

## Licences

- Stockfish.js: GPLv3 (`engine/STOCKFISH-LICENSE.txt`). Because the engine ships with the app, the app is GPLv3 too (`LICENSE`).
- chess.js: BSD-2-Clause (`vendor/CHESSJS-LICENSE.txt`).
- Piece images: "cburnett" set by Colin M.L. Burnett, CC BY-SA 3.0.

## Next pillars

2. Themed puzzles · 3. Adaptive match · 4. Diagnostic curriculum · 5. Reference library. See the project's master spec.
