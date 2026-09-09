/**
 * The named line icons a project or initiative can be drawn as.
 *
 * Stored as `icon:<name>` beside the emoji a person might have typed instead, so the same
 * `icon` column carries both and every reader tells them apart with one prefix check
 * (`isIconToken`). The alternative — a second column, or a JSON shape — would have put a
 * migration behind a feature that is, on the wire, a 20-character string.
 *
 * ## Why these are hand-written and not a library
 *
 * The obvious move is an icon package: thousands of glyphs, a search index, a font. But a
 * package's icons are `currentColor` only by convention, come at 24px and re-scale badly to
 * the 14px a table row draws at, and pull a dependency that ships a few hundred kilobytes for
 * the hundred icons a workspace actually chooses from. The set below is the set Linear's
 * picker offers, drawn on the same 16×16 grid `features/projects/glyphs.tsx` already uses, at
 * the same 1.5px stroke — so an icon in a row looks like the milestone diamond beside it.
 *
 * Every entry is a single `path` string on a `0 0 16 16` viewBox, `fill="none"`, stroked with
 * `currentColor`, which is what lets `EntityIcon` tint the whole thing with the row's colour.
 * Circles are arcs for that reason: one element, one attribute, no per-icon component.
 *
 * Keywords are what search matches beyond the name. They are a few words each and English;
 * a person typing "money" should reach `dollar`, and "settings" should reach `gear`.
 */

export interface IconGlyph {
  /** The token's name: `icon:${name}`. Lower-case, hyphenated, stable — it is stored. */
  readonly name: string;
  readonly keywords: readonly string[];
  /** SVG path data on a 16×16 grid. */
  readonly path: string;
}

/** The stored form of a named icon. `icon:rocket`, never a bare `rocket`. */
export const ICON_TOKEN_PREFIX = 'icon:';

/**
 * The colour an entity has when nobody has chosen one.
 *
 * The same value the `project.color` and `initiative.color` columns default to, so a row
 * drawn before its first sync looks like the row that comes back. Here rather than in each
 * feature because both entities and every reader of `color` need the same answer.
 */
export const DEFAULT_ENTITY_COLOR = '#6b7280';

const C = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${r * 2}a${r} ${r} 0 1 0 0-${r * 2}Z`;

export const ICON_GLYPHS: readonly IconGlyph[] = [
  // Shapes and abstract
  {
    name: 'cube',
    keywords: ['box', 'block', '3d', 'package'],
    path: 'M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Z M8 8v6.5 M2 5l6 3 6-3',
  },
  {
    name: 'smiley',
    keywords: ['smile', 'face', 'happy', 'emoji'],
    path: `${C(8, 8, 6)} M5.5 9.5a3 3 0 0 0 5 0 M6 6h.01 M10 6h.01`,
  },
  {
    name: 'target',
    keywords: ['goal', 'aim', 'bullseye', 'focus'],
    path: `${C(8, 8, 6)} ${C(8, 8, 3)} M8 8h.01`,
  },
  {
    name: 'rocket',
    keywords: ['launch', 'ship', 'space', 'fast', 'start'],
    path: 'M8 2c2.5 1.5 4 4 4 7l-2 2H6l-2-2c0-3 1.5-5.5 4-7Z M6 11l-1 3 3-1.5L11 14l-1-3 M8 6h.01',
  },
  {
    name: 'bug',
    keywords: ['insect', 'issue', 'defect', 'error'],
    path: 'M5 7h6v3a3 3 0 0 1-6 0V7Z M6 4.5a2 2 0 0 1 4 0V7H6V4.5Z M2.5 8H5 M11 8h2.5 M3 12l2-1 M13 12l-2-1 M3.5 4 5.5 5.5 M12.5 4 10.5 5.5',
  },
  {
    name: 'code',
    keywords: ['brackets', 'developer', 'programming', 'engineering'],
    path: 'M6 4 2 8l4 4 M10 4l4 4-4 4',
  },
  {
    name: 'database',
    keywords: ['storage', 'data', 'sql', 'db'],
    path: 'M8 2c3.3 0 6 .9 6 2s-2.7 2-6 2-6-.9-6-2 2.7-2 6-2Z M2 4v8c0 1.1 2.7 2 6 2s6-.9 6-2V4 M2 8c0 1.1 2.7 2 6 2s6-.9 6-2',
  },
  {
    name: 'cloud',
    keywords: ['weather', 'hosting', 'sky', 'upload'],
    path: 'M5 13h6.5a3 3 0 0 0 .5-6 4.5 4.5 0 0 0-8.5 1A2.5 2.5 0 0 0 5 13Z',
  },
  {
    name: 'lock',
    keywords: ['security', 'private', 'password', 'secure'],
    path: 'M4 7h8v6.5H4V7Z M5.5 7V5a2.5 2.5 0 0 1 5 0v2 M8 10v1',
  },
  {
    name: 'shield',
    keywords: ['security', 'protect', 'safe', 'guard'],
    path: 'M8 2l5 2v4c0 3-2 5-5 6.5C5 13 3 11 3 8V4l5-2Z M6 8l1.5 1.5L10.5 6.5',
  },
  {
    name: 'chart',
    keywords: ['bar', 'graph', 'analytics', 'stats', 'metrics'],
    path: 'M2.5 13.5h11 M4 11V7 M8 11V3.5 M12 11V6',
  },
  {
    name: 'calendar',
    keywords: ['date', 'schedule', 'event', 'month'],
    path: 'M4 3.5h8a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5Z M2.5 6.5h11 M5.5 2v3 M10.5 2v3',
  },
  {
    name: 'flag',
    keywords: ['milestone', 'marker', 'goal', 'finish'],
    path: 'M3.5 14V2.5 M3.5 3h8.5l-2 3 2 3H3.5',
  },
  {
    name: 'star',
    keywords: ['favourite', 'favorite', 'rating', 'important'],
    path: 'M8 2l1.8 3.8 4.2.6-3 2.9.7 4.2L8 11.5l-3.7 2 .7-4.2-3-2.9 4.2-.6L8 2Z',
  },
  {
    name: 'heart',
    keywords: ['love', 'like', 'favourite', 'health'],
    path: 'M8 13.5S2.5 10 2.5 6a3 3 0 0 1 5.5-1.6A3 3 0 0 1 13.5 6c0 4-5.5 7.5-5.5 7.5Z',
  },
  {
    name: 'bolt',
    keywords: ['lightning', 'power', 'energy', 'fast', 'electric'],
    path: 'M9 2 3.5 9H8l-1 5 5.5-7H8l1-5Z',
  },
  {
    name: 'flame',
    keywords: ['fire', 'hot', 'urgent', 'burn'],
    path: 'M8 14c-3 0-5-2-5-4.5C3 7 5 5.5 5.5 4 6.5 5 7 6 7 7c1-1 1.5-3 1-5 2.5 1.5 5 4 5 7.5S11 14 8 14Z',
  },
  {
    name: 'leaf',
    keywords: ['nature', 'green', 'plant', 'eco', 'growth'],
    path: 'M3 13c0-6 4-10 10-10 0 6-4 10-10 10Z M3 13c2-3 4-5 7-7',
  },
  {
    name: 'globe',
    keywords: ['world', 'earth', 'international', 'web', 'planet'],
    path: `${C(8, 8, 6)} M2 8h12 M8 2c2 2 3 4 3 6s-1 4-3 6c-2-2-3-4-3-6s1-4 3-6Z`,
  },
  {
    name: 'home',
    keywords: ['house', 'building', 'start', 'main'],
    path: 'M2.5 8 8 3l5.5 5 M4 7v6.5h8V7 M6.5 13.5V10h3v3.5',
  },
  {
    name: 'mail',
    keywords: ['email', 'envelope', 'message', 'inbox'],
    path: 'M2.5 4h11v8.5h-11V4Z M2.5 4.5 8 9l5.5-4.5',
  },
  {
    name: 'phone',
    keywords: ['mobile', 'call', 'device', 'smartphone'],
    path: 'M5 2h6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z M7 12h2',
  },
  {
    name: 'camera',
    keywords: ['photo', 'picture', 'image', 'media'],
    path: `M2.5 5.5h2.5L6.5 3.5h3l1.5 2h2.5v7.5h-11V5.5Z ${C(8, 9, 2.5)}`,
  },
  {
    name: 'music',
    keywords: ['note', 'audio', 'song', 'sound'],
    path: `M6 12.5V3.5l7-1.5v9 ${C(4, 12.5, 2)} ${C(11, 11, 2)}`,
  },
  {
    name: 'book',
    keywords: ['read', 'docs', 'documentation', 'library', 'manual'],
    path: 'M3 2.5h9.5v11H4.5A1.5 1.5 0 0 1 3 12V2.5Z M3 11.5c0-1 .7-1.5 1.5-1.5h8',
  },
  {
    name: 'briefcase',
    keywords: ['work', 'business', 'job', 'office'],
    path: 'M2.5 6h11v7h-11V6Z M6 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2 M2.5 9.5h11',
  },
  {
    name: 'wrench',
    keywords: ['tool', 'fix', 'repair', 'maintenance', 'settings'],
    path: 'M13.5 4.5a3.5 3.5 0 0 1-4.6 3.3L4.5 12.2a1.4 1.4 0 0 1-2-2l4.4-4.4A3.5 3.5 0 0 1 11.5 2.5l-2 2 .5 1.5 1.5.5 2-2Z',
  },
  {
    name: 'gear',
    keywords: ['settings', 'cog', 'config', 'preferences', 'infrastructure'],
    path: `${C(8, 8, 2)} M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4`,
  },
  {
    name: 'key',
    keywords: ['password', 'access', 'auth', 'login', 'unlock'],
    path: 'M10.5 2.5a3 3 0 1 1-2.8 4L3 11.2V13.5h2.3l.7-.7v-1.3h1.3l.7-.7V9.5h1.3l.7-.7A3 3 0 0 1 10.5 2.5Z M11 5h.01',
  },
  {
    name: 'map',
    keywords: ['location', 'directions', 'geo', 'travel', 'roadmap'],
    path: 'M2 4l4-1.5 4 1.5 4-1.5v10l-4 1.5-4-1.5-4 1.5V4Z M6 2.5v10 M10 4v10',
  },
  {
    name: 'compass',
    keywords: ['navigate', 'direction', 'explore', 'discovery'],
    path: `${C(8, 8, 6)} M10.5 5.5 9.5 9.5 5.5 10.5 6.5 6.5 10.5 5.5Z`,
  },
  {
    name: 'clock',
    keywords: ['time', 'schedule', 'deadline', 'hour', 'timer'],
    path: `${C(8, 8, 6)} M8 4.5V8l2.5 1.5`,
  },
  {
    name: 'bell',
    keywords: ['notification', 'alert', 'reminder', 'ring'],
    path: 'M4.5 11h7l-1-1.5V7a2.5 2.5 0 0 0-5 0v2.5L4.5 11Z M6.5 11a1.5 1.5 0 0 0 3 0 M8 3v1.5',
  },
  {
    name: 'gift',
    keywords: ['present', 'reward', 'bonus', 'birthday'],
    path: 'M2.5 6.5h11V9h-11V6.5Z M3.5 9v4.5h9V9 M8 6.5v7 M8 6.5C6 6.5 4.5 5.5 4.5 4a1.5 1.5 0 0 1 3 0V6.5Z M8 6.5c2 0 3.5-1 3.5-2.5a1.5 1.5 0 0 0-3 0V6.5Z',
  },
  {
    name: 'trophy',
    keywords: ['award', 'win', 'prize', 'champion', 'achievement'],
    path: 'M5 2.5h6v4a3 3 0 0 1-6 0v-4Z M5 4H3v1.5A2 2 0 0 0 5 7.5 M11 4h2v1.5a2 2 0 0 1-2 2 M8 9.5v3 M5.5 13.5h5',
  },
  {
    name: 'puzzle',
    keywords: ['piece', 'integration', 'plugin', 'extension'],
    path: 'M3 4h3a1.5 1.5 0 0 1 3 0h3v3a1.5 1.5 0 0 1 0 3v3H9a1.5 1.5 0 0 1-3 0H3v-3a1.5 1.5 0 0 0 0-3V4Z',
  },
  {
    name: 'layers',
    keywords: ['stack', 'levels', 'design', 'architecture'],
    path: 'M8 2.5 14 5.5 8 8.5 2 5.5l6-3Z M2 8.5l6 3 6-3 M2 11.5l6 3 6-3',
  },
  {
    name: 'box',
    keywords: ['package', 'parcel', 'delivery', 'archive'],
    path: 'M2.5 5.5 8 2.5l5.5 3v5.5L8 13.5l-5.5-2.5V5.5Z M2.5 5.5 8 8l5.5-2.5 M8 8v5.5',
  },
  {
    name: 'folder',
    keywords: ['directory', 'files', 'group', 'organise'],
    path: 'M2.5 4h4l1.5 1.5h5.5v7.5h-11V4Z',
  },
  {
    name: 'file',
    keywords: ['document', 'page', 'paper', 'text'],
    path: 'M4 2.5h5l3.5 3.5v7.5H4V2.5Z M9 2.5V6h3.5',
  },
  {
    name: 'tag',
    keywords: ['label', 'price', 'category', 'mark'],
    path: 'M2.5 2.5h5l6 6-5 5-6-6v-5Z M5.5 5.5h.01',
  },
  {
    name: 'link',
    keywords: ['chain', 'url', 'connect', 'attach'],
    path: 'M6.5 9.5l3-3 M9 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1 M7 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1',
  },
  {
    name: 'users',
    keywords: ['people', 'team', 'group', 'members', 'community'],
    path: `${C(6, 5.5, 2.5)} M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4 M10.5 3.5a2.5 2.5 0 0 1 0 4.5 M12 9.5c1.5.5 2.5 2 2.5 4`,
  },
  {
    name: 'user',
    keywords: ['person', 'profile', 'account', 'customer'],
    path: `${C(8, 5, 3)} M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5`,
  },
  {
    name: 'building',
    keywords: ['office', 'company', 'enterprise', 'city'],
    path: 'M3 13.5V2.5h10v11 M1.5 13.5h13 M6 5h1 M9 5h1 M6 8h1 M9 8h1 M7 13.5v-3h2v3',
  },
  {
    name: 'car',
    keywords: ['vehicle', 'drive', 'auto', 'transport'],
    path: 'M2.5 9.5 4 5.5h8l1.5 4v3h-11v-3Z M2.5 9.5h11 M5 12.5v1 M11 12.5v1 M5 11h.01 M11 11h.01',
  },
  {
    name: 'plane',
    keywords: ['flight', 'travel', 'airplane', 'trip'],
    path: 'M8 1.5 9 6l5.5 3.5v1.5L9 9.5l-.5 3 2 1.5v.5L8 13.5 5.5 14.5V14l2-1.5L7 9.5l-5.5 1.5V9.5L7 6l1-4.5Z',
  },
  {
    name: 'ship',
    keywords: ['boat', 'sea', 'sail', 'shipping', 'release'],
    path: 'M3 8.5 8 7l5 1.5-1.5 4h-7L3 8.5Z M8 2.5v4.5 M5 6.5V4h6v2.5 M2 13.5c1 .7 2 .7 3 0s2-.7 3 0 2 .7 3 0 2-.7 3 0',
  },
  {
    name: 'train',
    keywords: ['rail', 'metro', 'transport', 'track'],
    path: 'M4 2.5h8v9H4v-9Z M4 6.5h8 M6.5 9.5h.01 M9.5 9.5h.01 M5 11.5 3.5 14 M11 11.5l1.5 2.5',
  },
  {
    name: 'bike',
    keywords: ['bicycle', 'cycle', 'ride', 'sport'],
    path: `${C(4, 10, 2.5)} ${C(12, 10, 2.5)} M4 10l2.5-5h3.5L12 10 M6.5 5h-1 M10 5l-.5-1.5H8 M8 10 6.5 5`,
  },
  {
    name: 'sun',
    keywords: ['day', 'light', 'weather', 'bright', 'summer'],
    path: `${C(8, 8, 3)} M8 1.5v1.5 M8 13v1.5 M1.5 8H3 M13 8h1.5 M3.4 3.4l1 1 M11.6 11.6l1 1 M3.4 12.6l1-1 M11.6 4.4l1-1`,
  },
  {
    name: 'moon',
    keywords: ['night', 'dark', 'sleep', 'evening'],
    path: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z',
  },
  {
    name: 'umbrella',
    keywords: ['rain', 'weather', 'cover', 'insurance'],
    path: 'M2 8a6 6 0 0 1 12 0H2Z M8 8v4.5a1.5 1.5 0 0 1-3 0',
  },
  {
    name: 'snowflake',
    keywords: ['winter', 'cold', 'ice', 'freeze', 'snow'],
    path: 'M8 2v12 M3 5l10 6 M3 11l10-6 M6 3l2 1.5L10 3 M6 13l2-1.5 2 1.5',
  },
  {
    name: 'drop',
    keywords: ['water', 'liquid', 'rain', 'drip', 'ink'],
    path: 'M8 2c3 3.5 5 6 5 8.5a5 5 0 0 1-10 0C3 8 5 5.5 8 2Z',
  },
  {
    name: 'mountain',
    keywords: ['peak', 'hike', 'summit', 'challenge', 'outdoors'],
    path: 'M1.5 13.5 6 5l3 5 2-3 3.5 6.5h-13Z',
  },
  {
    name: 'tree',
    keywords: ['forest', 'nature', 'wood', 'christmas'],
    path: 'M8 2 4 8h2.5L3.5 12.5h9L9.5 8H12L8 2Z M8 12.5v2',
  },
  {
    name: 'paw',
    keywords: ['pet', 'animal', 'dog', 'cat'],
    path: `M8 13c-2 0-3.5-1-3.5-2.5S6 8 8 8s3.5 1 3.5 2.5S10 13 8 13Z ${C(4.5, 4.8, 1.2)} ${C(11.5, 4.8, 1.2)} ${C(2.5, 8.3, 1.2)} ${C(13.5, 8.3, 1.2)}`,
  },
  {
    name: 'coffee',
    keywords: ['cup', 'drink', 'cafe', 'break', 'morning'],
    path: 'M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Z M11 7h1.5a1.5 1.5 0 0 1 0 3H11 M5 2.5v1.5 M7 2.5v1.5 M9 2.5v1.5',
  },
  {
    name: 'pizza',
    keywords: ['food', 'slice', 'party', 'lunch'],
    path: 'M8 2 2.5 13.5c3.5 1.5 7.5 1.5 11 0L8 2Z M8 2c-2 2-2.5 5-2.5 8 M8 2c2 2 2.5 5 2.5 8 M7 9h.01 M9.5 12h.01 M6 12h.01',
  },
  {
    name: 'beer',
    keywords: ['drink', 'pub', 'celebrate', 'friday'],
    path: 'M4 4h7v9H4V4Z M11 6h1.5a1.5 1.5 0 0 1 0 3H11 M4 4c0-1.5 1-2 2-2s1.5.5 1.5.5S8 2 9 2s2 .5 2 2 M6.5 7v4 M8.5 7v4',
  },
  {
    name: 'medal',
    keywords: ['award', 'winner', 'first', 'honour', 'badge'],
    path: `${C(8, 10.5, 3.5)} M5.5 7.5 3.5 2h3l1.5 3 M10.5 7.5l2-5.5h-3L8 5`,
  },
  {
    name: 'diamond',
    keywords: ['gem', 'premium', 'jewel', 'value', 'quality'],
    path: 'M4.5 2.5h7l3 4-6.5 7-6.5-7 3-4Z M2 6.5h12 M6 6.5l2 7 M10 6.5l-2 7 M4.5 2.5 6 6.5l2-4 2 4 1.5-4',
  },
  {
    name: 'crown',
    keywords: ['king', 'queen', 'royal', 'premium', 'vip'],
    path: 'M2.5 5.5 5.5 8 8 4l2.5 4 3-2.5-1 7.5h-9l-1-7.5Z M3.5 13h9',
  },
  {
    name: 'ghost',
    keywords: ['spooky', 'halloween', 'boo', 'invisible'],
    path: 'M3 14V7a5 5 0 0 1 10 0v7l-1.7-1.5-1.6 1.5-1.7-1.5-1.7 1.5-1.6-1.5L3 14Z M6.5 7h.01 M9.5 7h.01',
  },
  {
    name: 'robot',
    keywords: ['bot', 'automation', 'ai', 'machine', 'android'],
    path: 'M4 5.5h8v7H4v-7Z M8 2.5v3 M8 2.5h.01 M6.5 8.5h.01 M9.5 8.5h.01 M6.5 10.5h3 M2.5 8v2 M13.5 8v2',
  },
  {
    name: 'alien',
    keywords: ['ufo', 'space', 'extraterrestrial', 'martian'],
    path: 'M8 2c3 0 5 2.5 5 5.5S10.5 14 8 14 3 10.5 3 7.5 5 2 8 2Z M5.5 7.5c.5 1 1 1.3 1.5 1 M10.5 7.5c-.5 1-1 1.3-1.5 1 M7 11.5h2',
  },
  {
    name: 'skull',
    keywords: ['danger', 'dead', 'poison', 'pirate', 'deprecated'],
    path: `M8 2a5 5 0 0 1 5 5c0 1.5-.6 2.5-1.5 3.3V12H4.5v-1.7C3.6 9.5 3 8.5 3 7a5 5 0 0 1 5-5Z ${C(6, 6.5, 1)} ${C(10, 6.5, 1)} M6.5 12v2 M9.5 12v2 M8 9.5l-.7 1.2h1.4L8 9.5Z`,
  },
  {
    name: 'brain',
    keywords: ['mind', 'think', 'idea', 'intelligence', 'ai', 'research'],
    path: 'M8 3v10 M8 3a2 2 0 0 0-3.5 1.5A2 2 0 0 0 3 8a2 2 0 0 0 1 3.5A2 2 0 0 0 8 13 M8 3a2 2 0 0 1 3.5 1.5A2 2 0 0 1 13 8a2 2 0 0 1-1 3.5A2 2 0 0 1 8 13',
  },
  {
    name: 'eye',
    keywords: ['view', 'watch', 'see', 'visibility', 'observe'],
    path: `M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z ${C(8, 8, 2)}`,
  },
  {
    name: 'hand',
    keywords: ['stop', 'wave', 'palm', 'hello', 'help'],
    path: 'M5 8V3.5a1 1 0 0 1 2 0V7 M7 7V2.5a1 1 0 0 1 2 0V7 M9 7V3.5a1 1 0 0 1 2 0V8 M11 8V5a1 1 0 0 1 2 0v4.5c0 2.5-2 4.5-4.5 4.5S4.5 12 4 10L2.5 7.5a1 1 0 0 1 1.7-1L5 8',
  },
  {
    name: 'megaphone',
    keywords: ['announce', 'marketing', 'broadcast', 'loud', 'campaign'],
    path: 'M2.5 6.5v3h2l6 3v-9l-6 3h-2Z M12.5 6a2.5 2.5 0 0 1 0 4 M4.5 9.5l1 4h2l-.5-4',
  },
  {
    name: 'lightbulb',
    keywords: ['idea', 'insight', 'light', 'innovation', 'tip'],
    path: 'M5.5 10.5a4.5 4.5 0 1 1 5 0V12h-5v-1.5Z M6 14h4',
  },
  {
    name: 'magnet',
    keywords: ['attract', 'pull', 'lead', 'acquisition'],
    path: 'M4 2.5v6a4 4 0 0 0 8 0v-6h-3v6a1 1 0 0 1-2 0v-6H4Z M4 5.5h3 M9 5.5h3',
  },
  {
    name: 'scissors',
    keywords: ['cut', 'trim', 'edit', 'snip'],
    path: `${C(5, 4.5, 2)} ${C(5, 11.5, 2)} M6.5 6 13.5 12 M6.5 10 13.5 4`,
  },
  {
    name: 'pen',
    keywords: ['write', 'edit', 'draft', 'author', 'compose'],
    path: 'M11 2.5 13.5 5l-8 8L2 14l1-3.5 8-8Z M9.5 4 12 6.5',
  },
  {
    name: 'brush',
    keywords: ['paint', 'design', 'art', 'style'],
    path: 'M12.5 2.5 6 9l1 1 6.5-6.5-1-1Z M6 9c-1.5 0-2.5 1-2.5 2.5S2.5 13.5 2 13.5c1.5.5 4 .5 5-1S7.5 10 7 10',
  },
  {
    name: 'palette',
    keywords: ['colour', 'color', 'design', 'art', 'theme', 'brand'],
    path: 'M8 2a6 6 0 0 0 0 12h1a1.5 1.5 0 0 0 .5-3 1.5 1.5 0 0 1 1-2.5h1.5A2 2 0 0 0 14 6.5 6 6 0 0 0 8 2Z M5 8h.01 M6 5.5h.01 M9 4.5h.01 M11.5 6.5h.01',
  },
  {
    name: 'hammer',
    keywords: ['build', 'construct', 'tool', 'fix'],
    path: 'M9 4.5 3 10.5l2 2 6-6 M9 4.5l1.5-1.5 3 3L12 7.5 M9 4.5l3 3',
  },
  {
    name: 'anchor',
    keywords: ['sea', 'stable', 'marine', 'hold', 'foundation'],
    path: `${C(8, 4, 1.5)} M8 5.5V14 M2.5 9.5C2.5 12 5 14 8 14s5.5-2 5.5-4.5 M2.5 9.5h2 M11.5 9.5h2 M5.5 8h5`,
  },
  {
    name: 'feather',
    keywords: ['light', 'write', 'quill', 'soft'],
    path: 'M13.5 2.5c-4 0-8 3-8.5 8L3 13.5 M5 10.5h4c2-2 3.5-5 4.5-8 M9 10.5c-.5-2 0-4 1-6',
  },
  {
    name: 'bookmark',
    keywords: ['save', 'mark', 'later', 'read'],
    path: 'M4 2.5h8v11l-4-3-4 3v-11Z',
  },
  {
    name: 'inbox',
    keywords: ['tray', 'incoming', 'mail', 'queue', 'triage'],
    path: 'M2.5 9.5h3l1 2h3l1-2h3 M2.5 9.5v3.5h11V9.5 M2.5 9.5 4.5 3.5h7l2 6',
  },
  {
    name: 'send',
    keywords: ['submit', 'deliver', 'paper plane', 'share', 'outgoing'],
    path: 'M14 2 2 7l5 2 2 5 5-12Z M7 9l7-7',
  },
  {
    name: 'refresh',
    keywords: ['reload', 'sync', 'update', 'retry', 'cycle'],
    path: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9 M13.5 2.5v3h-3',
  },
  {
    name: 'infinity',
    keywords: ['forever', 'loop', 'endless', 'ongoing', 'continuous'],
    path: 'M8 8c-1.5-2-2.5-3-4-3a3 3 0 0 0 0 6c1.5 0 2.5-1 4-3s2.5-3 4-3a3 3 0 0 1 0 6c-1.5 0-2.5-1-4-3Z',
  },
  {
    name: 'hash',
    keywords: ['number', 'tag', 'channel', 'pound'],
    path: 'M6 2.5 4.5 13.5 M11.5 2.5 10 13.5 M2.5 6h11 M2 10h11',
  },
  {
    name: 'at',
    keywords: ['mention', 'email', 'handle', 'address'],
    path: `${C(8, 8, 2.5)} M10.5 5.5v3.5a1.5 1.5 0 0 0 3 0V8a5.5 5.5 0 1 0-2.5 4.6`,
  },
  {
    name: 'percent',
    keywords: ['discount', 'rate', 'ratio', 'sale'],
    path: `M13 3 3 13 ${C(5, 5, 1.5)} ${C(11, 11, 1.5)}`,
  },
  {
    name: 'dollar',
    keywords: ['money', 'finance', 'billing', 'revenue', 'price', 'payment'],
    path: 'M8 1.5v13 M11 4.5H6.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H5',
  },
  {
    name: 'euro',
    keywords: ['money', 'finance', 'currency', 'price', 'europe'],
    path: 'M12.5 3.5A5 5 0 0 0 4.5 8a5 5 0 0 0 8 4.5 M2.5 6.5h7 M2.5 9.5h7',
  },
  {
    name: 'crosshair',
    keywords: ['aim', 'precision', 'focus', 'locate'],
    path: `${C(8, 8, 5.5)} M8 1.5v3 M8 11.5v3 M1.5 8h3 M11.5 8h3`,
  },
  {
    name: 'radar',
    keywords: ['scan', 'detect', 'monitor', 'sonar', 'observability'],
    path: `${C(8, 8, 6)} ${C(8, 8, 3)} M8 8 12.5 3.5`,
  },
  {
    name: 'signal',
    keywords: ['bars', 'strength', 'reception', 'level', 'growth'],
    path: 'M2.5 13v-2 M5.5 13V8 M8.5 13V5 M11.5 13V2.5',
  },
  {
    name: 'wifi',
    keywords: ['wireless', 'network', 'internet', 'connection'],
    path: 'M1.5 6.5a9 9 0 0 1 13 0 M4 9a5.5 5.5 0 0 1 8 0 M6.5 11.5a2 2 0 0 1 3 0 M8 14h.01',
  },
  {
    name: 'battery',
    keywords: ['power', 'charge', 'energy', 'level'],
    path: 'M2.5 5h9v6h-9V5Z M11.5 7h2v2h-2 M4.5 7v2 M7 7v2',
  },
  {
    name: 'plug',
    keywords: ['power', 'connect', 'socket', 'integration', 'electric'],
    path: 'M6 2v3 M10 2v3 M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0V5Z M8 11v3',
  },
  {
    name: 'cpu',
    keywords: ['chip', 'processor', 'hardware', 'compute', 'performance'],
    path: 'M4.5 4.5h7v7h-7v-7Z M6.5 6.5h3v3h-3v-3Z M6 1.5v3 M10 1.5v3 M6 11.5v3 M10 11.5v3 M1.5 6h3 M1.5 10h3 M11.5 6h3 M11.5 10h3',
  },
  {
    name: 'server',
    keywords: ['backend', 'host', 'infrastructure', 'rack', 'api'],
    path: 'M2.5 3h11v4h-11V3Z M2.5 9h11v4h-11V9Z M5 5h.01 M5 11h.01',
  },
  {
    name: 'terminal',
    keywords: ['console', 'shell', 'cli', 'command', 'prompt'],
    path: 'M2.5 3h11v10h-11V3Z M5 6l2.5 2L5 10 M8.5 10h3',
  },
  {
    name: 'git-branch',
    keywords: ['git', 'branch', 'version', 'fork', 'source'],
    path: `${C(4.5, 3, 1.5)} ${C(4.5, 13, 1.5)} ${C(11.5, 6, 1.5)} M4.5 4.5v7 M11.5 7.5c0 2-2 2.5-4 3-1.5.5-3 1-3 1`,
  },
  {
    name: 'search',
    keywords: ['find', 'magnifier', 'lookup', 'discover', 'query'],
    path: `${C(7, 7, 4.5)} M10.5 10.5 14 14`,
  },
  {
    name: 'check',
    keywords: ['done', 'tick', 'complete', 'yes', 'approve'],
    path: 'M3 8.5l3.5 3.5L13 4.5',
  },
  {
    name: 'check-circle',
    keywords: ['done', 'complete', 'success', 'verified'],
    path: `${C(8, 8, 6)} M5.5 8l2 2 3.5-4`,
  },
  {
    name: 'pin',
    keywords: ['location', 'place', 'marker', 'map'],
    path: `M8 14s4.5-4.5 4.5-8a4.5 4.5 0 0 0-9 0c0 3.5 4.5 8 4.5 8Z ${C(8, 6, 1.5)}`,
  },
  {
    name: 'paperclip',
    keywords: ['attach', 'attachment', 'clip', 'file'],
    path: 'M13 7.5 8 12.5a3 3 0 0 1-4.5-4.5l5.5-5.5a2 2 0 0 1 3 3L6.5 11a1 1 0 0 1-1.5-1.5l5-5',
  },
  {
    name: 'image',
    keywords: ['photo', 'picture', 'gallery', 'media', 'asset'],
    path: `M2.5 3h11v10h-11V3Z ${C(5.5, 6, 1.2)} M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5`,
  },
  {
    name: 'video',
    keywords: ['film', 'movie', 'record', 'camera', 'stream'],
    path: 'M2.5 4.5h8v7h-8v-7Z M10.5 7l3-2v6l-3-2',
  },
  {
    name: 'mic',
    keywords: ['microphone', 'voice', 'audio', 'record', 'podcast'],
    path: 'M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2Z M4.5 8a3.5 3.5 0 0 0 7 0 M8 11.5v2.5 M6 14h4',
  },
  {
    name: 'headphones',
    keywords: ['audio', 'support', 'listen', 'music'],
    path: 'M3 9V8a5 5 0 0 1 10 0v1 M3 9h2v4H3V9Z M11 9h2v4h-2V9Z',
  },
  {
    name: 'monitor',
    keywords: ['screen', 'desktop', 'display', 'computer'],
    path: 'M2.5 3h11v8h-11V3Z M6 13.5h4 M8 11v2.5',
  },
  {
    name: 'keyboard',
    keywords: ['type', 'keys', 'input', 'shortcut'],
    path: 'M2.5 4.5h11v7h-11v-7Z M4.5 7h1 M7.5 7h1 M10.5 7h1 M5 9.5h6',
  },
  {
    name: 'printer',
    keywords: ['print', 'paper', 'office', 'document'],
    path: 'M4.5 6V2.5h7V6 M2.5 6h11v5h-2.5v2.5h-6V11H2.5V6Z M5 11h6 M11.5 8.5h.01',
  },
  {
    name: 'wallet',
    keywords: ['money', 'payment', 'finance', 'budget', 'cash'],
    path: 'M2.5 5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10V5Z M2.5 5a1.5 1.5 0 0 1 1.5-1.5h7 M10 9h3.5v2H10a1 1 0 0 1 0-2Z',
  },
  {
    name: 'credit-card',
    keywords: ['payment', 'billing', 'bank', 'purchase', 'checkout'],
    path: 'M2.5 4h11v8h-11V4Z M2.5 7h11 M5 10h2',
  },
  {
    name: 'cart',
    keywords: ['shop', 'shopping', 'store', 'basket', 'ecommerce', 'checkout'],
    path: `M1.5 2.5h2l1.5 8h7l1.5-5.5H4.5 ${C(6, 13, 1)} ${C(11, 13, 1)}`,
  },
  {
    name: 'truck',
    keywords: ['delivery', 'shipping', 'logistics', 'transport'],
    path: `M1.5 4h8v7h-8V4Z M9.5 7h3l2 2.5V11h-5V7Z ${C(4.5, 12, 1.2)} ${C(11.5, 12, 1.2)}`,
  },
  {
    name: 'thumbs-up',
    keywords: ['like', 'approve', 'good', 'yes', 'feedback'],
    path: 'M2.5 7h2.5v6.5H2.5V7Z M5 7l3-5c1 0 1.5.5 1.5 1.5L9 6h3.5a1 1 0 0 1 1 1.2l-1 5.3a1 1 0 0 1-1 .8H5',
  },
  {
    name: 'message',
    keywords: ['chat', 'comment', 'talk', 'conversation', 'support'],
    path: 'M2.5 3h11v8h-6l-3 2.5V11h-2V3Z',
  },
  {
    name: 'sparkles',
    keywords: ['magic', 'new', 'shine', 'ai', 'polish', 'highlight'],
    path: 'M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3L8 2Z M12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z',
  },
  {
    name: 'wand',
    keywords: ['magic', 'automation', 'trick', 'transform'],
    path: 'M2.5 13.5 10 6 M9 4l1 1 M12 3.5l1 .5-.5-1 .5-1-1 .5-1-.5.5 1-.5 1 1-.5Z M13.5 8l-1 .5 M9 12l.5 1',
  },
  {
    name: 'dice',
    keywords: ['game', 'random', 'chance', 'luck', 'play'],
    path: 'M3 3h10v10H3V3Z M5.5 5.5h.01 M10.5 5.5h.01 M8 8h.01 M5.5 10.5h.01 M10.5 10.5h.01',
  },
  {
    name: 'gamepad',
    keywords: ['game', 'controller', 'play', 'console', 'fun'],
    path: 'M5 5h6a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8Z M5 8v2 M4 9h2 M10.5 8.5h.01 M12 10h.01',
  },
  {
    name: 'flask',
    keywords: ['lab', 'experiment', 'science', 'test', 'chemistry', 'beta'],
    path: 'M6.5 2h3 M7 2v4.5L3.5 12a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6.5V2 M5 10h6',
  },
  {
    name: 'atom',
    keywords: ['science', 'physics', 'core', 'react', 'nucleus'],
    path: `${C(8, 8, 1)} M8 2c2 0 3 2.7 3 6s-1 6-3 6-3-2.7-3-6 1-6 3-6Z M2.8 5c1-1.7 3.8-1 6.7.7s4.7 3.9 3.7 5.6-3.8 1-6.7-.7S1.8 6.7 2.8 5Z M13.2 5c-1-1.7-3.8-1-6.7.7S1.8 9.6 2.8 11.3s3.8 1 6.7-.7 4.7-3.9 3.7-5.6Z`,
  },
  {
    name: 'microscope',
    keywords: ['science', 'research', 'lab', 'inspect', 'detail'],
    path: 'M6 2.5 9 5.5 6.5 8 3.5 5 6 2.5Z M8 7l1.5 1.5a3.5 3.5 0 0 1-4 5 M3 13.5h10 M5.5 11H3',
  },
  {
    name: 'telescope',
    keywords: ['space', 'astronomy', 'vision', 'explore', 'future'],
    path: 'M2 9.5l9-5.5 1.5 2.5-9 5.5L2 9.5Z M12 3.5l1.5-1 1 1.5-1.5 1 M7 10.5l-2 3.5 M8.5 10l2 4 M7.5 9.5l.5 1',
  },
  {
    name: 'planet',
    keywords: ['saturn', 'space', 'orbit', 'world', 'universe'],
    path: `${C(8, 8, 4)} M2.5 5.5c-1 1 5 5.5 11 5 M13.5 10.5c1-1-5-5.5-11-5`,
  },
  {
    name: 'satellite',
    keywords: ['space', 'signal', 'orbit', 'antenna', 'broadcast'],
    path: 'M4.5 6.5 6.5 4.5l5 5-2 2-5-5Z M2 9l2.5-2.5 M9.5 11.5 7 14 M11.5 7.5l2-2 M8.5 2.5l2 2 M13 9.5a3.5 3.5 0 0 1-3.5 3.5',
  },
  {
    name: 'pill',
    keywords: ['medicine', 'health', 'capsule', 'pharma', 'drug'],
    path: 'M3.5 9.5 9.5 3.5a2.8 2.8 0 0 1 4 4L7.5 13.5a2.8 2.8 0 0 1-4-4Z M6.5 6.5l4 4',
  },
  {
    name: 'stethoscope',
    keywords: ['health', 'doctor', 'medical', 'diagnose', 'care'],
    path: `M4 2.5v4a3 3 0 0 0 6 0v-4 M7 10a3 3 0 0 0 6 0V8 ${C(13, 6.5, 1.5)} M7 9.5V8.5`,
  },
  {
    name: 'bandage',
    keywords: ['fix', 'patch', 'hotfix', 'heal', 'plaster'],
    path: 'M3.5 9.5 9.5 3.5a2.8 2.8 0 0 1 4 4L7.5 13.5a2.8 2.8 0 0 1-4-4Z M7.5 7.5h.01 M9.5 7.5h.01 M7.5 9.5h.01 M9.5 9.5h.01',
  },
  {
    name: 'activity',
    keywords: ['pulse', 'health', 'monitor', 'heartbeat', 'metrics'],
    path: 'M1.5 8h3l2-4.5 3 9 2-4.5h3',
  },
  {
    name: 'wind',
    keywords: ['air', 'breeze', 'weather', 'flow', 'speed'],
    path: 'M2 6h7.5a1.75 1.75 0 1 0-1.75-1.75 M2 9h10a1.75 1.75 0 1 1-1.75 1.75 M2 12h5a1.25 1.25 0 1 1-1.25 1.25',
  },
  {
    name: 'rainbow',
    keywords: ['colour', 'color', 'pride', 'weather', 'spectrum'],
    path: 'M2 12a6 6 0 0 1 12 0 M4.5 12a3.5 3.5 0 0 1 7 0 M7 12a1 1 0 0 1 2 0',
  },
  {
    name: 'cake',
    keywords: ['birthday', 'celebrate', 'party', 'anniversary', 'dessert'],
    path: 'M3 8h10v5.5H3V8Z M3 10.5c1 .7 2 .7 3 0s2-.7 3 0 2 .7 3 0 .7-.3 1 0 M5.5 8V6 M8 8V5.5 M10.5 8V6 M8 3v1',
  },
  {
    name: 'apple',
    keywords: ['fruit', 'food', 'healthy', 'snack'],
    path: 'M8 5c-1-1-3.5-1-4.5 1S3 12 5 13.5c1 .7 2 .3 3 0 1 .3 2 .7 3 0 2-1.5 2.5-5.5 1.5-7.5S9 4 8 5Z M8 5c0-1.5.5-2.5 2-3',
  },
  {
    name: 'flower',
    keywords: ['plant', 'garden', 'bloom', 'nature', 'spring'],
    path: `${C(8, 8, 1.8)} M8 6.2a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z M8 13.8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z M6.2 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z M13.8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z`,
  },
  {
    name: 'bird',
    keywords: ['animal', 'tweet', 'fly', 'freedom', 'nature'],
    path: 'M13.5 4.5 11 6c-1-1.5-2.5-2-4-1.5S4.5 6.5 4 8l-2 .5 2 1c1 2 3 3 5.5 2.5S13 9 13 6.5l.5-2Z M9 5.5h.01',
  },
  {
    name: 'fish',
    keywords: ['animal', 'sea', 'ocean', 'water', 'aquarium'],
    path: 'M2.5 8c2-3 4.5-4.5 7.5-4.5 1.5 1.5 2.5 3 2.5 4.5s-1 3-2.5 4.5C7 12.5 4.5 11 2.5 8Z M12.5 8l2-2.5v5l-2-2.5 M9.5 7h.01',
  },
  {
    name: 'butterfly',
    keywords: ['insect', 'change', 'transform', 'nature', 'wings'],
    path: 'M8 4v9 M8 6C6.5 3.5 3 2.5 2.5 4.5S4 9 6 9c-2 .5-3.5 2-2.5 3.5S7 12 8 10 M8 6c1.5-2.5 5-3.5 5.5-1.5S12 9 10 9c2 .5 3.5 2 2.5 3.5S9 12 8 10 M7 3l1 1 1-1',
  },
  {
    name: 'bee',
    keywords: ['insect', 'busy', 'honey', 'worker', 'swarm'],
    path: 'M5 8.5a3 2.5 0 1 0 6 0 3 2.5 0 0 0-6 0Z M6.5 6.5v4.5 M9.5 6.5v4.5 M5.5 6C4 4.5 4.5 3 6 3.5S7.5 6 7.5 6 M10.5 6c1.5-1.5 1-3-.5-2.5S8.5 6 8.5 6 M11 11l1.5 1.5 M5 11l-1.5 1.5',
  },
  {
    name: 'egg',
    keywords: ['new', 'hatch', 'beginning', 'breakfast', 'incubate'],
    path: 'M8 2c2.5 0 4.5 4 4.5 7.5a4.5 4.5 0 0 1-9 0C3.5 6 5.5 2 8 2Z',
  },
  {
    name: 'seedling',
    keywords: ['plant', 'grow', 'start', 'new', 'sprout', 'seed'],
    path: 'M8 14V8 M8 8c0-3 2-5 5-5 0 3-2 5-5 5Z M8 10c0-2.5-1.5-4-4.5-4 0 2.5 1.5 4 4.5 4Z',
  },
  {
    name: 'hexagon',
    keywords: ['shape', 'polygon', 'cell', 'honeycomb'],
    path: 'M8 2l5.2 3v6L8 14l-5.2-3V5L8 2Z',
  },
  {
    name: 'circle',
    keywords: ['shape', 'dot', 'round', 'ring'],
    path: C(8, 8, 6),
  },
  {
    name: 'square',
    keywords: ['shape', 'box', 'block', 'stop'],
    path: 'M3 3h10v10H3V3Z',
  },
  {
    name: 'triangle',
    keywords: ['shape', 'warning', 'delta', 'up'],
    path: 'M8 2.5 14 13H2L8 2.5Z',
  },
  {
    name: 'arrow-right',
    keywords: ['next', 'forward', 'go', 'direction', 'migrate'],
    path: 'M2.5 8h11 M9 3.5 13.5 8 9 12.5',
  },
  {
    name: 'arrow-up',
    keywords: ['up', 'grow', 'increase', 'improve', 'upload'],
    path: 'M8 13.5v-11 M3.5 7 8 2.5 12.5 7',
  },
  {
    name: 'trending-up',
    keywords: ['growth', 'increase', 'chart', 'rise', 'revenue'],
    path: 'M1.5 11.5 6 7l3 3 5.5-5.5 M10.5 4.5h4v4',
  },
  {
    name: 'sliders',
    keywords: ['settings', 'filter', 'adjust', 'controls', 'tune'],
    path: 'M3 4.5h10 M3 8h10 M3 11.5h10 M6 3v3 M10.5 6.5v3 M5 10v3',
  },
  {
    name: 'filter',
    keywords: ['funnel', 'sort', 'narrow', 'refine', 'sales'],
    path: 'M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3Z',
  },
  {
    name: 'graduation-cap',
    keywords: ['education', 'learn', 'school', 'onboarding', 'course', 'training'],
    path: 'M1.5 6.5 8 3.5l6.5 3L8 9.5l-6.5-3Z M4 8v3c1 1.3 2.5 2 4 2s3-.7 4-2V8 M14.5 6.5v4',
  },
  {
    name: 'handshake',
    keywords: ['partner', 'deal', 'agreement', 'sales', 'collaboration'],
    path: 'M1.5 6 4 4h3l2 1.5H6.5L5 7l1 1 2-1 3 2.5 1.5-1.5L9 5.5 12 4l2.5 2 M2 8.5l3 3 2-.5 1.5 1.5 1.5-.5 1.5-1.5',
  },
  {
    name: 'balance',
    keywords: ['scale', 'legal', 'justice', 'law', 'compliance', 'fair'],
    path: 'M8 2.5v11 M5.5 13.5h5 M3 5h10 M3 5 1.5 9.5a1.5 1.5 0 0 0 3 0L3 5Z M13 5l-1.5 4.5a1.5 1.5 0 0 0 3 0L13 5Z',
  },
];

const BY_NAME: ReadonlyMap<string, IconGlyph> = new Map(
  ICON_GLYPHS.map((glyph) => [glyph.name, glyph]),
);

/** The glyph a token names, or `undefined` for a name this build does not know. */
export function iconGlyph(name: string): IconGlyph | undefined {
  return BY_NAME.get(name);
}

/** `icon:rocket` → `rocket`. Anything else — an emoji, a letter, empty — is `null`. */
export function iconTokenName(value: string | undefined): string | null {
  if (value === undefined || !value.startsWith(ICON_TOKEN_PREFIX)) return null;
  return value.slice(ICON_TOKEN_PREFIX.length);
}

/** Whether a stored icon value names one of the glyphs above rather than a text glyph. */
export function isIconToken(value: string | undefined): boolean {
  return iconTokenName(value) !== null;
}

/** The stored form of a glyph: `icon:${name}`. */
export function iconToken(name: string): string {
  return `${ICON_TOKEN_PREFIX}${name}`;
}

/**
 * `git-branch` becomes "Git branch": what a grid button is called, and what a rail reads back.
 *
 * Here rather than beside either caller because the picker's grid and the two property rails
 * have to call one glyph one thing. A rail that said "git-branch" while the button that set
 * it said "Git branch" would be two names for one value.
 */
export function iconLabel(name: string): string {
  const words = name.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What a *stored* icon reads as beside the glyph already drawn for it.
 *
 * An emoji says what it is by being drawn, so it is its own label. A token is a wire format
 * and is never shown as one. `null` means nothing is set, and the row offers its verb
 * ("Set icon") instead.
 */
export function iconValueLabel(icon: string | undefined): string | null {
  if (icon === undefined || icon === '') return null;
  const name = iconTokenName(icon);
  return name === null ? icon : iconLabel(name);
}

/**
 * The glyphs a query matches, in registry order. An empty query is the whole registry.
 *
 * A match is a substring of the name or of any keyword: "money" finds `dollar` and `wallet`,
 * "git" finds `git-branch`. Not fuzzy, on purpose — a hundred icons do not need it and a
 * fuzzy "car" that surfaces `credit-card` above `car` is worse than an exact miss.
 */
export function searchIconGlyphs(query: string): readonly IconGlyph[] {
  const q = query.trim().toLowerCase();
  if (q === '') return ICON_GLYPHS;
  return ICON_GLYPHS.filter(
    (glyph) => glyph.name.includes(q) || glyph.keywords.some((word) => word.includes(q)),
  );
}
