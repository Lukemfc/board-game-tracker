import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCollection } from '../src/services/bgg.js';

// Shape captured from the live XML API v2 on 2026-06-12: the root element is
// <items totalitems="…"> (not <collection>) and yearpublished is element text.
const COLLECTION_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<items totalitems="2" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse" pubdate="Fri, 12 Jun 2026 11:34:14 +0000">
  <item objecttype="thing" objectid="1275" subtype="boardgame" collid="105918462">
    <name sortindex="1">221B Baker Street: The Master Detective Game</name>
    <yearpublished>1975</yearpublished>
    <image>https://cf.geekdo-images.com/example/original.png</image>
    <thumbnail>https://cf.geekdo-images.com/example/thumb.png</thumbnail>
    <status own="1" prevowned="0" fortrade="0" want="0" wanttoplay="0" wanttobuy="0" wishlist="0" preordered="0" lastmodified="2023-04-26 06:48:40" />
    <numplays>0</numplays>
  </item>
  <item objecttype="thing" objectid="447707" subtype="boardgame" collid="146420934">
    <name sortindex="1">3 Witches</name>
    <yearpublished>2025</yearpublished>
    <status own="1" prevowned="0" fortrade="0" want="0" wanttoplay="0" wanttobuy="0" wishlist="0" preordered="0" lastmodified="2026-01-02 10:00:00" />
    <numplays>3</numplays>
  </item>
</items>`;

const xmlResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/xml; charset="UTF-8"' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCollection', () => {
  it('parses the real collection feed shape (items root, text yearpublished)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => xmlResponse(COLLECTION_XML)),
    );

    const games = await getCollection('hysen');

    expect(games).toEqual([
      {
        bggId: 1275,
        name: '221B Baker Street: The Master Detective Game',
        yearPublished: 1975,
      },
      { bggId: 447707, name: '3 Witches', yearPublished: 2025 },
    ]);
  });

  it('polls through 202 Accepted until the collection is ready', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(xmlResponse('', 202))
      .mockResolvedValueOnce(xmlResponse(COLLECTION_XML));
    vi.stubGlobal('fetch', fetchMock);

    const games = await getCollection('hysen');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(games).toHaveLength(2);
  }, 15000);

  it('reports an unknown username from the errors payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        xmlResponse(
          `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<errors><error><message>Invalid username specified</message></error></errors>`,
        ),
      ),
    );

    await expect(getCollection('nope')).rejects.toMatchObject({ errorCode: 'bgg_user_not_found' });
  });
});
