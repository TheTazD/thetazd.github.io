# Set & Pulse

Family training log for Tiago, Jacinta, Victoria and Duarte. It's a plain static site (`index.html` + `app.js`) that stores data in the same Supabase project as the Chess Tutor, in tables starting with `fit_`.

## Setup (once)
1. In Supabase, open the SQL Editor and run `supabase-setup.sql`, then `supabase-seed-tiago.sql`.
2. Upload this `training` folder to the GitHub Pages repo. The app is then at https://thetazd.github.io/training/.
3. On each phone, open that link in Safari, tap Share, then **Add to Home Screen**.

## Security
- The website's public key can only call the `fit_*` functions. The tables are closed to it.
- Each person has a 4-digit PIN. Five wrong tries locks that person out for 15 minutes.
- Tiago (admin) can reset a forgotten PIN under **Me**.

## Import file format (rows from Ergzone, or programmes)
```json
{"format":"setpulse-import",
 "rows":[{"source":"Ergzone","extId":"<ergzone result id>","title":"...","startedAt":<ms>,
          "seconds":1500,"distance":2230,"avgSpm":18,"avgHr":133,"maxHr":142,"calories":138,
          "hr":[sec,bpm, sec,bpm, ...], "spm":[sec,spm, ...], "dist":[sec,m, ...]}],
 "programmes":[ <programme objects, same shape as fit_programmes.data> ]}
```
- `extId` stops the same row being imported twice.
- Rows are matched to the programme's row session scheduled that day. If none is scheduled that day, they go to the first row session still open that week.
- The sample arrays are flat pairs, taken every 5 seconds. Seconds count from the start of the row.
