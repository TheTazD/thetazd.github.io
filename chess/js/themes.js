// Puzzle themes, in the order they're suggested. Each one drills one idea.
// `concept` is the "tell me more" paragraph shown after a puzzle of that theme.
export const THEMES = [
  {
    id: 'mateIn1', name: 'Mate in one', icon: '#1',
    blurb: 'Find the move that ends the game.',
    find: 'Find checkmate in one move.',
    concept: 'Checkmate means the king is in check and has no way out: it can\'t step to a safe square, nothing can block the check, and the checking piece can\'t be captured. When you look for mate, check all three escape routes.',
  },
  {
    id: 'hangingPiece', name: 'Free pieces', icon: '+',
    blurb: 'Spot pieces left without protection and take them.',
    find: 'Something has been left unprotected. Find it.',
    concept: 'A "hanging" piece is one that is attacked and not defended, so it can be taken for free. Before every move, ask two questions: what did their last move leave unprotected, and what does my move leave unprotected?',
  },
  {
    id: 'fork', name: 'Forks', icon: '♞',
    blurb: 'One piece attacks two things at once.',
    find: 'Find a fork.',
    concept: 'A fork is one piece attacking two or more targets at the same time. Your opponent can only save one, so you win the other. Knights are the classic forking piece, but queens, pawns and even kings can fork. Look for checks that also attack something.',
  },
  {
    id: 'pin', name: 'Pins', icon: '♝',
    blurb: 'Freeze a piece in front of something more valuable.',
    find: 'Use a pin.',
    concept: 'A pin is an attack along a line (by a bishop, rook or queen) on a piece that can\'t move away without exposing something more valuable behind it. If the piece behind is the king, the pinned piece is not even allowed to move. Pinned pieces make great targets: attack them again.',
  },
  {
    id: 'skewer', name: 'Skewers', icon: '♜',
    blurb: 'Attack a big piece so the one behind it falls.',
    find: 'Find a skewer.',
    concept: 'A skewer is a pin in reverse: you attack a valuable piece (often the king or queen) along a line, it has to move, and you take the piece standing behind it. Look for two of their pieces lined up on the same rank, file or diagonal.',
  },
  {
    id: 'backRankMate', name: 'Back-rank mates', icon: '♚',
    blurb: 'Trap a king behind its own pawns.',
    find: 'The king is stuck on its back rank. Finish it.',
    concept: 'A king hidden behind its own unmoved pawns can be mated by a rook or queen landing on the back rank, because the pawns block every escape square. To guard against it in your own games, make "luft": move one pawn in front of your king so it has a square to run to.',
  },
  {
    id: 'discoveredAttack', name: 'Discovered attacks', icon: '♛',
    blurb: 'Move one piece to unleash another behind it.',
    find: 'Find a discovered attack.',
    concept: 'In a discovered attack you move one piece out of the way and reveal an attack by the piece behind it. The piece that moves can make its own threat at the same time, so you create two threats in one move. Discovered checks are the strongest kind.',
  },
  {
    id: 'mateIn2', name: 'Mate in two', icon: '#2',
    blurb: 'Force checkmate in two moves.',
    find: 'Find checkmate in two moves.',
    concept: 'Mate in two usually starts with a forcing move — a check, a capture or a sacrifice — that leaves your opponent only one reply, and then mates. Look at every check first, even ones that give up material.',
  },
  {
    id: 'trappedPiece', name: 'Trapped pieces', icon: '♝',
    blurb: 'Attack a piece that has nowhere to go.',
    find: 'A piece is short of squares. Trap it.',
    concept: 'A trapped piece is attacked and every square it could move to is also covered. Pieces that wander deep into enemy territory, or bishops hemmed in by pawns, are the usual victims. Before attacking, count the squares the piece could escape to.',
  },
  {
    id: 'promotion', name: 'Promotion', icon: '♟',
    blurb: 'Get a pawn to the last rank.',
    find: 'Find the way to promote.',
    concept: 'A pawn that reaches the far rank becomes a queen (or any other piece). Far-advanced pawns are worth a lot: the opponent often has to give up a piece to stop them. Clearing the path — by deflecting the blocker or the defender — is usually the key.',
  },
];

export const THEME = Object.fromEntries(THEMES.map((t) => [t.id, t]));
export const themeName = (id) => (THEME[id] ? THEME[id].name : 'Mixed');
