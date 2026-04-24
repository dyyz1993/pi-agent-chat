import { describe, test, expect } from 'bun:test';
import { RPCServer, RPCClient, InMemoryTransport, AuthMiddleware, LocalAuthMiddleware } from '../src/index';
import type { RequestContext, Middleware, RPCMessage } from '../src/index';

describe('LocalAuthMiddleware', () => {
  test('auto-injects local context', () => {
    const middleware = new LocalAuthMiddleware({ userId: 'local-user' });
    const message: RPCMessage = { id: '1', type: 'request', method: 'test' };
    const result = middleware.process(message);
    expect(result.allowed).toBe(true);
    expect(result.context?.source).toBe('local');
    expect(result.context?.userId).toBe('local-user');
  });

  test('passes through response messages with context', () => {
    const middleware = new LocalAuthMiddleware();
    const message: RPCMessage = { id: '1', type: 'response', result: 'ok' };
    const result = middleware.process(message);
    expect(result.allowed).toBe(true);
    expect(result.context?.source).toBe('local');
  });

  test('passes through event messages with context', () => {
    const middleware = new LocalAuthMiddleware();
    const message: RPCMessage = { id: '1', type: 'event', eventType: 'test', payload: {} };
    const result = middleware.process(message);
    expect(result.allowed).toBe(true);
    expect(result.context?.source).toBe('local');
  });

  test('uses default local context when no overrides', () => {
    const middleware = new LocalAuthMiddleware();
    const message: RPCMessage = { id: '1', type: 'request', method: 'test' };
    const result = middleware.process(message);
    expect(result.context?.source).toBe('local');
    expect(result.context?.userId).toBe('local-user');
    expect(result.context?.role).toBe('admin');
  });
});

describe('AuthMiddleware', () => {
  test('rejects messages without context', () => {
    const middleware = new AuthMiddleware();
    const message: RPCMessage = { id: '1', type: 'request', method: 'test' };
    const result = middleware.process(message);
    expect(result.allowed).toBe(false);
    expect(result.error?.code).toBe(401);
  });

  test('allows local context by default', () => {
    const middleware = new AuthMiddleware();
    const message: RPCMessage = {
      id: '1', type: 'request', method: 'test',
      context: { source: 'local', userId: 'local-user' }
    };
    const result = middleware.process(message);
    expect(result.allowed).toBe(true);
    expect(result.context?.source).toBe('local');
  });

  test('allows remote context', () => {
    const middleware = new AuthMiddleware();
    const message: RPCMessage = {
      id: '1', type: 'request', method: 'test',
      context: { source: 'remote', userId: 'user-1' }
    };
    const result = middleware.process(message);
    expect(result.allowed).toBe(true);
    expect(result.context?.source).toBe('remote');
  });

  test('rejects local context when localBypass is false', () => {
    const middleware = new AuthMiddleware({ localBypass: false });
    const message: RPCMessage = {
      id: '1', type: 'request', method: 'test',
      context: { source: 'local', userId: 'local-user' }
    };
    const result = middleware.process(message);
    expect(result.allowed).toBe(false);
  });

  test('allows response messages without context', () => {
    const middleware = new AuthMiddleware();
    const message: RPCMessage = { id: '1', type: 'response', result: 'ok' };
    const result = middleware.process(message);
    expect(result.allowed).toBe(true);
  });

  test('allows event messages without context', () => {
    const middleware = new AuthMiddleware();
    const message: RPCMessage = { id: '1', type: 'event', eventType: 'test', payload: {} };
    const result = middleware.process(message);
    expect(result.allowed).toBe(true);
  });
});

describe('Custom Middleware', () => {
  test('middleware chain runs in order', async () => {
    const order: number[] = [];

    const mw1: Middleware = {
      process: () => { order.push(1); return { allowed: true, context: { source: 'local', step: 1 } }; }
    };
    const mw2: Middleware = {
      process: () => { order.push(2); return { allowed: true, context: { source: 'local', step: 2 } }; }
    };

    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    const server = new RPCServer(st, { middleware: [mw1, mw2] });
    server.register('test', async () => 'ok');

    const client = new RPCClient({ transport: ct, timeout: 5000 });
    await client.call('test');

    expect(order).toEqual([1, 2]);
  });

  test('middleware can block requests', async () => {
    const blockingMw: Middleware = {
      process: () => ({ allowed: false, error: { code: 403, message: 'Blocked' } })
    };

    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    const server = new RPCServer(st, { middleware: [blockingMw] });
    server.register('test', async () => 'ok');

    const client = new RPCClient({ transport: ct, timeout: 5000 });
    try {
      await client.call('test');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain('Blocked');
    }
  });

  test('later middleware not called if earlier blocks', async () => {
    let mw2Called = false;
    const mw1: Middleware = { process: () => ({ allowed: false, error: { code: 403, message: 'Nope' } }) };
    const mw2: Middleware = { process: () => { mw2Called = true; return { allowed: true }; } };

    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    const server = new RPCServer(st, { middleware: [mw1, mw2] });
    server.register('test', async () => 'ok');

    const client = new RPCClient({ transport: ct, timeout: 5000 });
    try { await client.call('test'); } catch { /* expected */ }

    expect(mw2Called).toBe(false);
  });
});

describe('Context in RPCServer', () => {
  test('handler receives context from middleware', async () => {
    const localAuth = new LocalAuthMiddleware({ userId: 'test-user' });

    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    let receivedContext: RequestContext | undefined;

    const server = new RPCServer(st, { middleware: [localAuth] });
    server.register('whoami', async (_params, context) => {
      receivedContext = context;
      return { userId: context?.userId, source: context?.source };
    });

    const client = new RPCClient({ transport: ct, timeout: 5000 });
    const result = await client.call<{ userId: string; source: string }>('whoami');

    expect(result.userId).toBe('test-user');
    expect(result.source).toBe('local');
    expect(receivedContext?.userId).toBe('test-user');
  });

  test('handler receives context from message', async () => {
    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    let receivedContext: RequestContext | undefined;

    const server = new RPCServer(st);
    server.register('whoami', async (_params, context) => {
      receivedContext = context;
      return { userId: context?.userId };
    });

    const client = new RPCClient({ transport: ct, timeout: 5000 });
    const result = await client.call<{ userId: string }>('whoami');

    expect(result.userId).toBeUndefined();
    expect(receivedContext).toBeUndefined();
  });

  test('blocked request returns error to client', async () => {
    const authMw = new AuthMiddleware();

    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    const server = new RPCServer(st, { middleware: [authMw] });
    server.register('secret', async () => 'classified');

    const client = new RPCClient({ transport: ct, timeout: 5000 });
    try {
      await client.call('secret');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain('Authentication required');
    }
  });

  test('allowed request with context proceeds normally', async () => {
    const localAuth = new LocalAuthMiddleware();

    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    const server = new RPCServer(st, { middleware: [localAuth] });
    server.register('hello', async (_params, context) => `Hello from ${context?.source}`);

    const client = new RPCClient({ transport: ct, timeout: 5000 });
    const result = await client.call<string>('hello');
    expect(result).toBe('Hello from local');
  });

  test('subscribe with context stores context per subscription', async () => {
    const localAuth = new LocalAuthMiddleware({ userId: 'sub-user' });

    const st = new InMemoryTransport();
    const ct = new InMemoryTransport();
    st.pair(ct);

    const server = new RPCServer(st, { middleware: [localAuth] });
    const client = new RPCClient({ transport: ct, timeout: 5000 });

    const events: unknown[] = [];
    client.subscribe('test', {}, (event) => { events.push(event); });

    await new Promise(r => setTimeout(r, 10));
    await server.emitEvent('test', { value: 1 });
    await new Promise(r => setTimeout(r, 10));

    expect(events.length).toBe(1);
  });
});
