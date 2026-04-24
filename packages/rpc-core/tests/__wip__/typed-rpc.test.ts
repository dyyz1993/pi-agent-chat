import { describe, test, expect, beforeEach } from 'bun:test';
import { TypedRPCServer, TypedRPCClient, InMemoryTransport, RPCClient } from '../src/index';
import type { RPCMethods, RPCEvents, RPCEvent } from '../src/index';

interface TestMethods extends RPCMethods {
  hello: { params: { name: string }; result: { message: string } };
  add: { params: { a: number; b: number }; result: number };
  ping: { params: undefined; result: { pong: boolean } };
}

interface TestEvents extends RPCEvents {
  heartbeat: { payload: { time: number }; metadata: { source: string } };
}

describe('TypedRPCServer + TypedRPCClient', () => {
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;
  let server: TypedRPCServer<TestMethods, TestEvents>;
  let client: TypedRPCClient<TestMethods, TestEvents>;

  beforeEach(() => {
    serverTransport = new InMemoryTransport();
    clientTransport = new InMemoryTransport();
    serverTransport.pair(clientTransport);

    server = new TypedRPCServer<TestMethods, TestEvents>(serverTransport, {
      methods: {
        hello: async (params) => {
          return { message: `Hello ${params.name}!` };
        },
        add: async (params) => {
          return params.a + params.b;
        },
        ping: async () => {
          return { pong: true };
        },
      },
      events: {
        heartbeat: { payload: { time: 0 }, metadata: { source: '' } },
      },
    });

    client = new TypedRPCClient<TestMethods, TestEvents>({
      transport: clientTransport,
      methods: {
        hello: { params: { name: '' }, result: { message: '' } },
        add: { params: { a: 0, b: 0 }, result: 0 },
        ping: { params: undefined, result: { pong: false } },
      },
      events: {
        heartbeat: { payload: { time: 0 }, metadata: { source: '' } },
      },
      timeout: 5000,
    });
  });

  test('hello with typed params and result', async () => {
    const result = await client.call('hello', { name: 'World' });
    expect(result.message).toBe('Hello World!');
  });

  test('add with typed params and result', async () => {
    const result = await client.call('add', { a: 3, b: 4 });
    expect(result).toBe(7);
  });

  test('ping with no params', async () => {
    const result = await client.call('ping');
    expect(result.pong).toBe(true);
  });

  test('typed event subscription', async () => {
    const events: unknown[] = [];
    client.subscribe('heartbeat', {}, (event) => {
      events.push(event);
    });

    await new Promise(r => setTimeout(r, 10));
    server.emitEvent('heartbeat', { time: 123 }, { source: 'test' });
    await new Promise(r => setTimeout(r, 10));

    expect(events.length).toBe(1);
    expect((events[0] as RPCEvent).payload).toEqual({ time: 123 });
  });

  test('method not found still returns error', async () => {
    const untypedClient = client as unknown as RPCClient;
    try {
      await untypedClient.call('nonexistent');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain('Method not found');
    }
  });

  test('concurrent typed calls', async () => {
    const results = await Promise.all([
      client.call('add', { a: 1, b: 2 }),
      client.call('add', { a: 10, b: 20 }),
      client.call('hello', { name: 'Test' }),
    ]);
    expect(results[0]).toBe(3);
    expect(results[1]).toBe(30);
    expect(results[2].message).toBe('Hello Test!');
  });
});
