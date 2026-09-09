/**
 * The emoji the picker offers, and the words that find them.
 *
 * The set is curated for the same reason it always was: there is no emoji library in this
 * application, a full keyboard is a few thousand glyphs and a search index in every language
 * the product ships, and what people actually choose for a project is a small, boring set.
 * What this file adds over the four hard-coded rows it replaces is a *name* for each glyph,
 * so the search box can find 🚀 by typing "launch" instead of by typing 🚀 — which is the
 * one thing a grid of pictures cannot do for itself.
 *
 * Every entry is a single code point, or a single code point plus U+FE0F to ask for the
 * colour presentation. No ZWJ sequences, no skin tones, no flags: a sequence a platform has
 * not composed falls apart into two or three characters at exactly the size where it is
 * smallest, which is a broken sidebar row rather than a slightly wrong picture.
 *
 * The forty glyphs the previous grid offered are all still here, in the same reading order,
 * so nothing anybody has already chosen has disappeared from the panel that chose it.
 */

export interface EmojiGlyph {
  readonly glyph: string;
  /** What it is called, in one or two words. Matched by search, and never shown. */
  readonly name: string;
  readonly keywords: readonly string[];
}

export const EMOJI_GLYPHS: readonly EmojiGlyph[] = [
  // Work
  { glyph: '🚀', name: 'rocket', keywords: ['launch', 'ship', 'space', 'fast', 'start'] },
  { glyph: '🎯', name: 'target', keywords: ['goal', 'aim', 'bullseye', 'focus', 'darts'] },
  { glyph: '🛠️', name: 'tools', keywords: ['build', 'fix', 'hammer', 'wrench', 'platform'] },
  { glyph: '⚙️', name: 'gear', keywords: ['settings', 'config', 'infra', 'engine', 'cog'] },
  { glyph: '🧩', name: 'puzzle', keywords: ['piece', 'integration', 'plugin', 'fit'] },
  { glyph: '📦', name: 'package', keywords: ['box', 'release', 'shipping', 'bundle'] },
  { glyph: '🗂️', name: 'files', keywords: ['folder', 'dividers', 'organise', 'archive'] },
  { glyph: '📝', name: 'memo', keywords: ['note', 'write', 'docs', 'spec', 'draft'] },
  { glyph: '📊', name: 'chart', keywords: ['analytics', 'metrics', 'data', 'report', 'bar'] },
  { glyph: '🔍', name: 'search', keywords: ['find', 'magnifier', 'discovery', 'research'] },
  // Signals
  { glyph: '⭐', name: 'star', keywords: ['favourite', 'favorite', 'important', 'quality'] },
  { glyph: '🔥', name: 'fire', keywords: ['hot', 'urgent', 'flame', 'burn', 'incident'] },
  { glyph: '⚡', name: 'bolt', keywords: ['lightning', 'fast', 'power', 'performance'] },
  { glyph: '💡', name: 'idea', keywords: ['lightbulb', 'insight', 'proposal', 'innovation'] },
  { glyph: '🔔', name: 'bell', keywords: ['notification', 'alert', 'reminder', 'ring'] },
  { glyph: '🚧', name: 'roadblock', keywords: ['blocked', 'construction', 'wip', 'barrier'] },
  { glyph: '🐛', name: 'bug', keywords: ['defect', 'issue', 'error', 'insect', 'fix'] },
  { glyph: '🩹', name: 'bandage', keywords: ['patch', 'hotfix', 'heal', 'plaster', 'repair'] },
  { glyph: '🧪', name: 'experiment', keywords: ['test', 'lab', 'science', 'beta', 'trial'] },
  { glyph: '🧭', name: 'compass', keywords: ['direction', 'navigate', 'strategy', 'explore'] },
  // Things
  { glyph: '🌍', name: 'world', keywords: ['earth', 'globe', 'international', 'global'] },
  { glyph: '🌱', name: 'seedling', keywords: ['growth', 'new', 'plant', 'sprout', 'green'] },
  { glyph: '🏗️', name: 'construction', keywords: ['build', 'crane', 'infrastructure'] },
  { glyph: '🏛️', name: 'institution', keywords: ['bank', 'legal', 'government', 'classic'] },
  { glyph: '🔐', name: 'security', keywords: ['lock', 'auth', 'private', 'key', 'secure'] },
  { glyph: '💳', name: 'billing', keywords: ['card', 'payment', 'money', 'checkout', 'pay'] },
  { glyph: '📱', name: 'mobile', keywords: ['phone', 'ios', 'android', 'app', 'device'] },
  { glyph: '💻', name: 'laptop', keywords: ['desktop', 'computer', 'web', 'client', 'code'] },
  { glyph: '📡', name: 'satellite', keywords: ['signal', 'broadcast', 'antenna', 'telemetry'] },
  { glyph: '🎨', name: 'design', keywords: ['palette', 'art', 'brand', 'colour', 'ui'] },
  // Direction
  { glyph: '📈', name: 'growth', keywords: ['up', 'increase', 'chart', 'revenue', 'trend'] },
  { glyph: '📉', name: 'decline', keywords: ['down', 'decrease', 'chart', 'loss', 'churn'] },
  { glyph: '➡️', name: 'arrow', keywords: ['next', 'forward', 'migration', 'move', 'right'] },
  { glyph: '🔁', name: 'repeat', keywords: ['loop', 'cycle', 'recurring', 'sync', 'retry'] },
  { glyph: '🏁', name: 'finish', keywords: ['flag', 'race', 'done', 'launch', 'end'] },
  { glyph: '🧱', name: 'brick', keywords: ['wall', 'foundation', 'block', 'platform'] },
  { glyph: '🪜', name: 'ladder', keywords: ['step', 'climb', 'levels', 'progression'] },
  { glyph: '🗺️', name: 'map', keywords: ['roadmap', 'plan', 'territory', 'geo', 'atlas'] },
  { glyph: '⏱️', name: 'timer', keywords: ['stopwatch', 'time', 'speed', 'deadline', 'perf'] },
  { glyph: '🤝', name: 'partnership', keywords: ['handshake', 'deal', 'sales', 'agreement'] },
  // People and places
  { glyph: '👥', name: 'people', keywords: ['team', 'users', 'group', 'members', 'community'] },
  { glyph: '👤', name: 'person', keywords: ['user', 'profile', 'account', 'customer', 'solo'] },
  { glyph: '🏠', name: 'home', keywords: ['house', 'main', 'start', 'dashboard'] },
  { glyph: '🏢', name: 'office', keywords: ['building', 'company', 'enterprise', 'work'] },
  { glyph: '🏭', name: 'factory', keywords: ['industry', 'manufacturing', 'pipeline', 'plant'] },
  { glyph: '🏦', name: 'bank', keywords: ['finance', 'money', 'institution', 'treasury'] },
  { glyph: '🏥', name: 'hospital', keywords: ['health', 'medical', 'care', 'clinic'] },
  { glyph: '🎓', name: 'education', keywords: ['learning', 'school', 'onboarding', 'course'] },
  { glyph: '🧑', name: 'individual', keywords: ['human', 'contributor', 'person', 'someone'] },
  { glyph: '👋', name: 'wave', keywords: ['hello', 'welcome', 'greeting', 'onboarding'] },
  // Communication
  { glyph: '📣', name: 'announcement', keywords: ['megaphone', 'marketing', 'launch', 'news'] },
  { glyph: '💬', name: 'chat', keywords: ['comment', 'message', 'talk', 'support', 'feedback'] },
  { glyph: '📮', name: 'inbox', keywords: ['mail', 'post', 'submit', 'triage', 'queue'] },
  { glyph: '✉️', name: 'email', keywords: ['mail', 'envelope', 'message', 'send'] },
  { glyph: '📞', name: 'call', keywords: ['phone', 'support', 'voice', 'contact'] },
  { glyph: '📺', name: 'broadcast', keywords: ['tv', 'media', 'video', 'stream', 'channel'] },
  { glyph: '🎙️', name: 'microphone', keywords: ['podcast', 'record', 'voice', 'audio'] },
  { glyph: '📰', name: 'news', keywords: ['press', 'article', 'blog', 'publication'] },
  { glyph: '🔗', name: 'link', keywords: ['url', 'chain', 'connect', 'integration'] },
  { glyph: '🏷️', name: 'label', keywords: ['tag', 'category', 'price', 'mark'] },
  // Systems
  { glyph: '🗄️', name: 'database', keywords: ['storage', 'cabinet', 'data', 'records'] },
  { glyph: '☁️', name: 'cloud', keywords: ['hosting', 'aws', 'infra', 'sky', 'saas'] },
  { glyph: '🖥️', name: 'server', keywords: ['backend', 'host', 'machine', 'monitor'] },
  { glyph: '🔌', name: 'plug', keywords: ['integration', 'connect', 'power', 'socket', 'api'] },
  { glyph: '🔋', name: 'battery', keywords: ['power', 'energy', 'charge', 'capacity'] },
  { glyph: '🧮', name: 'abacus', keywords: ['calculate', 'maths', 'numbers', 'accounting'] },
  { glyph: '🖨️', name: 'printer', keywords: ['print', 'paper', 'output', 'hardware'] },
  { glyph: '💾', name: 'save', keywords: ['disk', 'floppy', 'storage', 'backup', 'legacy'] },
  { glyph: '🧰', name: 'toolbox', keywords: ['tools', 'kit', 'utilities', 'platform'] },
  { glyph: '🪝', name: 'hook', keywords: ['webhook', 'catch', 'attach', 'integration'] },
  // Nature and weather
  { glyph: '🌲', name: 'tree', keywords: ['forest', 'nature', 'evergreen', 'wood'] },
  { glyph: '🌊', name: 'ocean', keywords: ['wave', 'water', 'sea', 'flow', 'surf'] },
  { glyph: '☀️', name: 'sun', keywords: ['day', 'light', 'bright', 'summer', 'weather'] },
  { glyph: '🌙', name: 'moon', keywords: ['night', 'dark', 'sleep', 'evening'] },
  { glyph: '❄️', name: 'snowflake', keywords: ['winter', 'cold', 'freeze', 'ice'] },
  { glyph: '🌈', name: 'rainbow', keywords: ['colour', 'pride', 'spectrum', 'weather'] },
  { glyph: '🍀', name: 'clover', keywords: ['luck', 'four leaf', 'fortune', 'green'] },
  { glyph: '🌸', name: 'blossom', keywords: ['flower', 'spring', 'bloom', 'cherry'] },
  { glyph: '🔮', name: 'crystal ball', keywords: ['future', 'predict', 'forecast', 'magic'] },
  { glyph: '🌋', name: 'volcano', keywords: ['eruption', 'incident', 'pressure', 'mountain'] },
  // Animals
  { glyph: '🐳', name: 'whale', keywords: ['docker', 'big', 'sea', 'animal'] },
  { glyph: '🐙', name: 'octopus', keywords: ['git', 'tentacles', 'sea', 'many'] },
  { glyph: '🦊', name: 'fox', keywords: ['clever', 'animal', 'orange'] },
  { glyph: '🐝', name: 'bee', keywords: ['busy', 'worker', 'swarm', 'honey'] },
  { glyph: '🦉', name: 'owl', keywords: ['wisdom', 'night', 'bird', 'knowledge'] },
  { glyph: '🐢', name: 'turtle', keywords: ['slow', 'steady', 'patience', 'animal'] },
  { glyph: '🦋', name: 'butterfly', keywords: ['change', 'transform', 'migration'] },
  { glyph: '🐧', name: 'penguin', keywords: ['linux', 'cold', 'bird', 'animal'] },
  { glyph: '🦄', name: 'unicorn', keywords: ['rare', 'magic', 'startup', 'special'] },
  { glyph: '🐌', name: 'snail', keywords: ['slow', 'performance', 'latency', 'animal'] },
  // Objects
  { glyph: '🔧', name: 'wrench', keywords: ['fix', 'tool', 'maintenance', 'repair'] },
  { glyph: '🔨', name: 'hammer', keywords: ['build', 'tool', 'construct', 'smash'] },
  { glyph: '🪄', name: 'wand', keywords: ['magic', 'automation', 'ai', 'transform'] },
  { glyph: '🧲', name: 'magnet', keywords: ['attract', 'acquisition', 'pull', 'leads'] },
  { glyph: '🗝️', name: 'key', keywords: ['access', 'unlock', 'auth', 'secret'] },
  { glyph: '🧿', name: 'amulet', keywords: ['protection', 'eye', 'charm', 'ward'] },
  { glyph: '⚓', name: 'anchor', keywords: ['stable', 'sea', 'foundation', 'hold'] },
  { glyph: '🪁', name: 'kite', keywords: ['fly', 'wind', 'play', 'lift'] },
  { glyph: '🎁', name: 'gift', keywords: ['present', 'reward', 'bonus', 'perk'] },
  { glyph: '🎉', name: 'celebration', keywords: ['party', 'launch', 'confetti', 'success'] },
  // Status and quality
  { glyph: '✅', name: 'done', keywords: ['check', 'tick', 'complete', 'approved', 'yes'] },
  { glyph: '❌', name: 'no', keywords: ['cross', 'fail', 'reject', 'cancel', 'error'] },
  { glyph: '⚠️', name: 'warning', keywords: ['caution', 'risk', 'alert', 'danger'] },
  { glyph: '🛡️', name: 'shield', keywords: ['security', 'protect', 'defence', 'trust'] },
  { glyph: '🏆', name: 'trophy', keywords: ['win', 'award', 'goal', 'champion'] },
  { glyph: '🥇', name: 'first', keywords: ['medal', 'gold', 'winner', 'priority', 'best'] },
  { glyph: '💎', name: 'gem', keywords: ['diamond', 'premium', 'quality', 'value'] },
  { glyph: '👑', name: 'crown', keywords: ['king', 'premium', 'vip', 'royal', 'admin'] },
  { glyph: '🧊', name: 'ice', keywords: ['frozen', 'cold', 'on hold', 'paused', 'cube'] },
  { glyph: '♻️', name: 'recycle', keywords: ['reuse', 'refactor', 'sustainability', 'loop'] },
  // Fun
  { glyph: '🧠', name: 'brain', keywords: ['ai', 'think', 'intelligence', 'research', 'mind'] },
  { glyph: '🤖', name: 'robot', keywords: ['bot', 'automation', 'ai', 'agent', 'machine'] },
  { glyph: '👻', name: 'ghost', keywords: ['spooky', 'hidden', 'invisible', 'halloween'] },
  { glyph: '🎲', name: 'dice', keywords: ['random', 'chance', 'game', 'luck'] },
  { glyph: '🎮', name: 'game', keywords: ['play', 'controller', 'console', 'fun'] },
  { glyph: '🎵', name: 'music', keywords: ['note', 'audio', 'sound', 'song'] },
  { glyph: '☕', name: 'coffee', keywords: ['cafe', 'break', 'morning', 'drink'] },
  { glyph: '🍕', name: 'pizza', keywords: ['food', 'slice', 'lunch', 'party'] },
  { glyph: '🍿', name: 'popcorn', keywords: ['film', 'watch', 'entertainment', 'snack'] },
  { glyph: '🎪', name: 'circus', keywords: ['tent', 'event', 'show', 'chaos'] },
];

/**
 * The emoji a query matches, in registry order. An empty query is the whole set.
 *
 * Matching is a substring of the name or of any keyword, and — deliberately — of the glyph
 * itself, so pasting an emoji into the search box finds it in the grid instead of returning
 * nothing.
 */
export function searchEmoji(query: string): readonly EmojiGlyph[] {
  const q = query.trim().toLowerCase();
  if (q === '') return EMOJI_GLYPHS;
  return EMOJI_GLYPHS.filter(
    (entry) =>
      entry.glyph === q ||
      entry.name.includes(q) ||
      entry.keywords.some((word) => word.includes(q)),
  );
}
