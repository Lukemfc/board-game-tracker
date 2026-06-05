/**
 * Thin client for the BoardGameGeek XML API v2.
 *
 * All external BGG HTTP lives here (the bot never calls BGG directly). Handles
 * the collection endpoint's `202 Accepted` queueing quirk, parses XML, caches
 * search/detail responses, and maps failures onto friendly `HttpError`s.
 */
import { XMLParser } from 'fast-xml-parser';
import type { BggGameDetail, BggSearchResult } from '@meeple/shared';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

const BASE = 'https://boardgamegeek.com/xmlapi2';
const CACHE_TTL_MS = 5 * 60 * 1000;
const COLLECTION_MAX_ATTEMPTS = 5;
const COLLECTION_RETRY_MS = 2000;

// BGG's XML API requires a registered application's Bearer token (mandatory
// since Oct 2025); without it the API answers 401. The descriptive User-Agent
// is also requested by BGG's API etiquette. `BGG_API_TOKEN` is set in env.
const BGG_HEADERS: Record<string, string> = {
  accept: 'text/xml',
  'user-agent': 'MeepleLedger/0.1 (+https://github.com/meeple-ledger; board-game-night tracker)',
  ...(config.BGG_API_TOKEN ? { authorization: `Bearer ${config.BGG_API_TOKEN}` } : {}),
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: true,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface CacheEntry<T> {
  value: T;
  expires: number;
}
const searchCache = new Map<string, CacheEntry<BggSearchResult[]>>();
const detailCache = new Map<number, CacheEntry<BggGameDetail>>();

function fromCache<K, V>(cache: Map<K, CacheEntry<V>>, key: K): V | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

const unavailable = () =>
  new HttpError(
    503,
    'bgg_unavailable',
    'BoardGameGeek is unreachable right now — try again shortly.',
  );

// XML helpers ---------------------------------------------------------------

/** A node that's either a string or an object carrying a `value`/`#text`. */
type XmlNode = string | Record<string, unknown> | undefined;

function ensureArray(v: unknown): XmlNode[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as XmlNode[];
}

/** Read an attribute (e.g. `value="3"`) off a node. */
function attr(node: XmlNode, name: string): string | undefined {
  if (node && typeof node === 'object') {
    const v = (node as Record<string, unknown>)[name];
    return v == null ? undefined : String(v);
  }
  return undefined;
}

/** Read the text content of a node, whether it's a bare string or `{ '#text' }`. */
function text(node: XmlNode): string | undefined {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') {
    const v = (node as Record<string, unknown>)['#text'];
    return v == null ? undefined : String(v);
  }
  return undefined;
}

function toInt(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) || n === 0 ? null : n;
}

/** Pick the primary name from a `thing` item's `name` field (string or array). */
function primaryName(nameField: unknown): string | undefined {
  const names = ensureArray(nameField as XmlNode | XmlNode[]);
  const primary = names.find((n) => attr(n, 'type') === 'primary') ?? names[0];
  return attr(primary, 'value') ?? text(primary);
}

// Fetching ------------------------------------------------------------------

/** Log the real upstream status + a snippet so we can diagnose blocks. */
async function logBggFailure(url: string, res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  console.warn(
    `[bgg] ${url} -> ${res.status} ${res.statusText} ` +
      `server=${res.headers.get('server') ?? '?'} cf-ray=${res.headers.get('cf-ray') ?? '-'} ` +
      `www-authenticate=${res.headers.get('www-authenticate') ?? '-'} body=${JSON.stringify(body.slice(0, 200))}`,
  );
  return body;
}

async function getXml(url: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: BGG_HEADERS });
  } catch {
    throw unavailable();
  }
  if (!res.ok) {
    await logBggFailure(url, res);
    if (res.status === 403) {
      throw new HttpError(
        403,
        'bgg_private',
        'That BGG collection is private. Make it public at boardgamegeek.com → Profile → Account Settings, then try again.',
      );
    }
    if (res.status === 401) {
      throw new HttpError(
        502,
        'bgg_blocked',
        'BoardGameGeek rejected the request (401). The BGG_API_TOKEN is missing or invalid — register the app at boardgamegeek.com/using_the_xml_api and set the token.',
      );
    }
    throw unavailable();
  }
  const body = await res.text();
  return parser.parse(body) as Record<string, unknown>;
}

// Public API ----------------------------------------------------------------

/** Search BGG; returns up to 10 board games. Cached for 5 minutes per query. */
export async function searchGames(query: string): Promise<BggSearchResult[]> {
  const key = query.trim().toLowerCase();
  const cached = fromCache(searchCache, key);
  if (cached) return cached;

  const url = `${BASE}/search?query=${encodeURIComponent(query)}&type=boardgame`;
  const parsed = await getXml(url);
  const items = ensureArray((parsed.items as Record<string, unknown> | undefined)?.item as XmlNode);

  const seen = new Set<number>();
  const results: BggSearchResult[] = [];
  for (const item of items) {
    const bggId = toInt(attr(item, 'id'));
    const name = attr((item as Record<string, unknown>)?.name as XmlNode, 'value');
    if (bggId == null || !name || seen.has(bggId)) continue;
    seen.add(bggId);
    results.push({
      bggId,
      name,
      yearPublished: toInt(
        attr((item as Record<string, unknown>).yearpublished as XmlNode, 'value'),
      ),
    });
    if (results.length >= 10) break;
  }

  searchCache.set(key, { value: results, expires: Date.now() + CACHE_TTL_MS });
  return results;
}

/** Fetch full details for one BGG game. Cached for 5 minutes. */
export async function getGameDetail(bggId: number): Promise<BggGameDetail> {
  const cached = fromCache(detailCache, bggId);
  if (cached) return cached;

  const url = `${BASE}/thing?id=${bggId}&stats=1`;
  const parsed = await getXml(url);
  const item = ensureArray(
    (parsed.items as Record<string, unknown> | undefined)?.item as XmlNode,
  )[0];
  if (!item) throw new HttpError(404, 'bgg_not_found', `BGG game ${bggId} not found.`);

  const obj = item as Record<string, unknown>;
  const detail: BggGameDetail = {
    bggId,
    name: primaryName(obj.name) ?? `BGG #${bggId}`,
    minPlayers: toInt(attr(obj.minplayers as XmlNode, 'value')),
    maxPlayers: toInt(attr(obj.maxplayers as XmlNode, 'value')),
    yearPublished: toInt(attr(obj.yearpublished as XmlNode, 'value')),
    thumbnail: text(obj.thumbnail as XmlNode) ?? null,
    description: cleanDescription(text(obj.description as XmlNode)),
  };

  detailCache.set(bggId, { value: detail, expires: Date.now() + CACHE_TTL_MS });
  return detail;
}

/** Confirm a BGG username exists and has a (public) collection. */
export async function collectionExists(username: string): Promise<boolean> {
  // A successful fetch (even an empty collection) means the username is valid.
  await getCollection(username);
  return true;
}

/**
 * Fetch a user's owned board games. Polls through `202 Accepted` while BGG
 * builds the response. Returns the bare data found in the collection feed
 * (BGG does not include player counts here — those come from `getGameDetail`).
 */
export async function getCollection(username: string): Promise<BggSearchResult[]> {
  const url = `${BASE}/collection?username=${encodeURIComponent(username)}&own=1&subtype=boardgame`;
  let parsed: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < COLLECTION_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: BGG_HEADERS });
    } catch {
      throw unavailable();
    }
    if (res.status === 202) {
      await sleep(COLLECTION_RETRY_MS);
      continue;
    }
    if (!res.ok) {
      await logBggFailure(url, res);
      if (res.status === 403) {
        throw new HttpError(
          403,
          'bgg_private',
          'Your BGG collection is private. Make it public at boardgamegeek.com → Profile → Account Settings, then try again.',
        );
      }
      if (res.status === 401) {
        throw new HttpError(
          502,
          'bgg_blocked',
          'BoardGameGeek refused the request (401). The server may be blocked or rate-limited by BGG — try again shortly.',
        );
      }
      throw unavailable();
    }
    parsed = parser.parse(await res.text()) as Record<string, unknown>;
    break;
  }

  if (!parsed) {
    throw new HttpError(
      503,
      'bgg_timeout',
      'BoardGameGeek is still preparing that collection. Give it a minute and try again.',
    );
  }

  if (parsed.errors) {
    throw new HttpError(
      404,
      'bgg_user_not_found',
      `No public BGG collection found for that username.`,
    );
  }

  const items = ensureArray(
    (parsed.collection as Record<string, unknown> | undefined)?.item as XmlNode,
  );
  const results: BggSearchResult[] = [];
  for (const item of items) {
    const obj = item as Record<string, unknown>;
    const bggId = toInt(attr(obj, 'objectid'));
    const name = text(obj.name as XmlNode) ?? attr(obj.name as XmlNode, 'value');
    if (bggId == null || !name) continue;
    results.push({
      bggId,
      name,
      yearPublished: toInt(attr(obj.yearpublished as XmlNode, 'value')),
    });
  }
  return results;
}

/** Tidy a BGG description for Discord: collapse whitespace, cap length. */
function cleanDescription(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > 500 ? `${cleaned.slice(0, 497)}…` : cleaned;
}
