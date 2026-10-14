// Import recent games from Lichess by username (public API, no login needed).

export async function fetchLichessGames(username, max = 20) {
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username.trim())}?max=${max}&pgnInJson=true&moves=true&clocks=false&evals=false&opening=true`;
  const r = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
  if (r.status === 404) throw new Error(`Lichess has no player called "${username}".`);
  if (r.status === 429) throw new Error('Lichess is asking us to slow down. Try again in a minute.');
  if (!r.ok) throw new Error(`Lichess said no (error ${r.status}).`);
  const text = await r.text();
  const games = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const g = JSON.parse(line);
      if (!g.pgn || g.variant !== 'standard') continue;
      const white = g.players?.white?.user?.name || (g.players?.white?.aiLevel ? `Stockfish level ${g.players.white.aiLevel}` : 'White');
      const black = g.players?.black?.user?.name || (g.players?.black?.aiLevel ? `Stockfish level ${g.players.black.aiLevel}` : 'Black');
      const hero = white.toLowerCase() === username.trim().toLowerCase() ? 'w' : 'b';
      games.push({
        id: g.id,
        pgn: g.pgn,
        white,
        black,
        hero,
        result: g.winner ? (g.winner === 'white' ? '1-0' : '0-1') : g.status === 'draw' || g.status === 'stalemate' ? '½-½' : '*',
        date: new Date(g.createdAt).toISOString().slice(0, 10),
        speed: g.speed,
        opening: g.opening?.name || '',
      });
    } catch { /* skip bad line */ }
  }
  return games;
}
