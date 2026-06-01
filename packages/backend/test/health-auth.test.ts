import { afterAll, describe, expect, it } from 'vitest';
import { authHeaders, getApp, teardown } from './helpers';

afterAll(teardown);

describe('health & auth', () => {
  it('GET /health needs no auth and reports ok', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    expect(typeof res.json().uptime).toBe('number');
  });

  it('rejects API calls without a service token', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/players' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('rejects API calls with a wrong service token', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/players',
      headers: { authorization: 'Bearer nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts API calls with the correct service token', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/players', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
