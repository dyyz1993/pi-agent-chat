import { describe, test, expect, beforeEach } from 'bun:test';
import { RPCServer, RPCClient, InMemoryTransport, CompositeTransport } from '../src/index';
import type { RPCEvent } from '../src/index';

describe('CompositeTransport', () => {
  let composite: CompositeTransport;
  let ipcServer: InMemoryTransport;
  let ipcClient: InMemoryTransport;
  let wsServer: InMemoryTransport;
  let wsClient: InMemoryTransport;

  beforeEach(() => {
    composite = new CompositeTransport();

    ipcServer = new InMemoryTransport();
    ipcClient = new InMemoryTransport();
    ipcServer.pair(ipcClient);

    wsServer = new InMemoryTransport();
    wsClient = new InMemoryTransport();
    wsServer.pair(wsClient);

    composite.addTransport('ipc', ipcServer);
    composite.addTransport('ws', wsServer);
  });

  test('isConnected when any transport is connected', () => {
    expect(composite.isConnected()).toBe(true);
  });

  test('isConnected false when all transports disconnected', () => {
    ipcServer.close();
    wsServer.close();
    expect(composite.isConnected()).toBe(false);
  });

  test('isConnected true when one transport still connected', () => {
    ipcServer.close();
    expect(composite.isConnected()).toBe(true);
  });

  test('messages from any transport reach handlers', () => {
    const received: unknown[] = [];
    composite.onMessage((msg) => { received.push(msg); });

    ipcClient.send({ type: 'request', id: '1', method: 'test' });
    expect(received.length).toBe(1);

    wsClient.send({ type: 'request', id: '2', method: 'test' });
    expect(received.length).toBe(2);
  });

  test('response routes to correct transport', async () => {
    let ipcReceived: unknown = null;
    let wsReceived: unknown = null;
    ipcClient.onMessage((msg) => { ipcReceived = msg; });
    wsClient.onMessage((msg) => { wsReceived = msg; });

    ipcClient.send({ type: 'request', id: 'req-1', method: 'test' });
    await composite.send({ type: 'response', id: 'req-1', result: 'ipc-result' });

    expect(ipcReceived).toEqual({ type: 'response', id: 'req-1', result: 'ipc-result' });
    expect(wsReceived).toBeNull();
  });

  test('response from ws client routes to ws only', async () => {
    let ipcReceived: unknown = null;
    let wsReceived: unknown = null;
    ipcClient.onMessage((msg) => { ipcReceived = msg; });
    wsClient.onMessage((msg) => { wsReceived = msg; });

    wsClient.send({ type: 'request', id: 'req-2', method: 'test' });
    await composite.send({ type: 'response', id: 'req-2', result: 'ws-result' });

    expect(wsReceived).toEqual({ type: 'response', id: 'req-2', result: 'ws-result' });
    expect(ipcReceived).toBeNull();
  });

  test('event broadcasts to all subscribed transports', async () => {
    let ipcReceived: unknown = null;
    let wsReceived: unknown = null;
    ipcClient.onMessage((msg) => { ipcReceived = msg; });
    wsClient.onMessage((msg) => { wsReceived = msg; });

    ipcClient.send({ type: 'subscribe', id: 'sub-1', eventType: 'heartbeat', filter: {} });
    wsClient.send({ type: 'subscribe', id: 'sub-2', eventType: 'heartbeat', filter: {} });

    await composite.send({ type: 'event', eventType: 'heartbeat', payload: { time: 123 } });

    expect(ipcReceived).not.toBeNull();
    expect(wsReceived).not.toBeNull();
    expect((ipcReceived as RPCEvent).payload).toEqual({ time: 123 });
    expect((wsReceived as RPCEvent).payload).toEqual({ time: 123 });
  });

  test('event only sent to transports with subscription', async () => {
    let ipcReceived: unknown = null;
    let wsReceived: unknown = null;
    ipcClient.onMessage((msg) => { ipcReceived = msg; });
    wsClient.onMessage((msg) => { wsReceived = msg; });

    ipcClient.send({ type: 'subscribe', id: 'sub-1', eventType: 'heartbeat', filter: {} });

    await composite.send({ type: 'event', eventType: 'heartbeat', payload: { time: 456 } });

    expect(ipcReceived).not.toBeNull();
    expect(wsReceived).toBeNull();
  });

  test('removeTransport removes transport from composite', () => {
    expect(composite.isConnected()).toBe(true);
    composite.removeTransport('ipc');
    expect(composite.getTransport('ipc')).toBeUndefined();
    expect(composite.getTransport('ws')).toBeDefined();
  });

  test('getTransport returns correct transport', () => {
    const ipc = composite.getTransport<InMemoryTransport>('ipc');
    expect(ipc).toBe(ipcServer);
  });
});

describe('CompositeTransport + RPCServer multi-client sync', () => {
  let composite: CompositeTransport;
  let ipcServer: InMemoryTransport;
  let ipcClient: InMemoryTransport;
  let wsServer: InMemoryTransport;
  let wsClient: InMemoryTransport;
  let server: RPCServer;
  let ipcRpcClient: RPCClient;
  let wsRpcClient: RPCClient;

  beforeEach(() => {
    composite = new CompositeTransport();

    ipcServer = new InMemoryTransport();
    ipcClient = new InMemoryTransport();
    ipcServer.pair(ipcClient);

    wsServer = new InMemoryTransport();
    wsClient = new InMemoryTransport();
    wsServer.pair(wsClient);

    composite.addTransport('ipc', ipcServer);
    composite.addTransport('ws', wsServer);

    server = new RPCServer(composite);
    server.register('hello', async (params) => {
      const p = params as { name?: string };
      return { message: `Hello ${p?.name || 'World'}!` };
    });

    ipcRpcClient = new RPCClient({ transport: ipcClient, timeout: 5000 });
    wsRpcClient = new RPCClient({ transport: wsClient, timeout: 5000 });
  });

  test('both clients can call methods', async () => {
    const ipcResult = await ipcRpcClient.call<{ message: string }>('hello', { name: 'Desktop' });
    const wsResult = await wsRpcClient.call<{ message: string }>('hello', { name: 'Web' });

    expect(ipcResult.message).toBe('Hello Desktop!');
    expect(wsResult.message).toBe('Hello Web!');
  });

  test('concurrent calls from different clients', async () => {
    const results = await Promise.all([
      ipcRpcClient.call<{ message: string }>('hello', { name: 'IPC' }),
      wsRpcClient.call<{ message: string }>('hello', { name: 'WS' }),
    ]);

    expect(results[0].message).toBe('Hello IPC!');
    expect(results[1].message).toBe('Hello WS!');
  });

  test('events sync to both clients', async () => {
    const ipcEvents: unknown[] = [];
    const wsEvents: unknown[] = [];

    ipcRpcClient.subscribe('heartbeat', {}, (event) => { ipcEvents.push(event); });
    wsRpcClient.subscribe('heartbeat', {}, (event) => { wsEvents.push(event); });

    await new Promise(r => setTimeout(r, 10));

    await server.emitEvent('heartbeat', { serverTime: 1000 }, { server: 'test', platform: 'desktop' });

    await new Promise(r => setTimeout(r, 10));

    expect(ipcEvents.length).toBe(1);
    expect(wsEvents.length).toBe(1);
    expect((ipcEvents[0] as RPCEvent).payload).toEqual({ serverTime: 1000 });
    expect((wsEvents[0] as RPCEvent).payload).toEqual({ serverTime: 1000 });
  });

  test('event only received by subscribed client', async () => {
    const ipcEvents: unknown[] = [];
    const wsEvents: unknown[] = [];

    ipcRpcClient.subscribe('heartbeat', {}, (event) => { ipcEvents.push(event); });

    await new Promise(r => setTimeout(r, 10));

    await server.emitEvent('heartbeat', { serverTime: 2000 });

    await new Promise(r => setTimeout(r, 10));

    expect(ipcEvents.length).toBe(1);
    expect(wsEvents.length).toBe(0);
  });

  test('multiple events sync to both clients', async () => {
    const ipcEvents: unknown[] = [];
    const wsEvents: unknown[] = [];

    ipcRpcClient.subscribe('heartbeat', {}, (event) => { ipcEvents.push(event); });
    wsRpcClient.subscribe('heartbeat', {}, (event) => { wsEvents.push(event); });

    await new Promise(r => setTimeout(r, 10));

    await server.emitEvent('heartbeat', { serverTime: 100 });
    await server.emitEvent('heartbeat', { serverTime: 200 });
    await server.emitEvent('heartbeat', { serverTime: 300 });

    await new Promise(r => setTimeout(r, 10));

    expect(ipcEvents.length).toBe(3);
    expect(wsEvents.length).toBe(3);
  });

  test('response does not leak to other client', async () => {
    let wsUnexpected: unknown = null;
    wsClient.onMessage((msg) => {
      const m = msg as Record<string, unknown>;
      if (m.type === 'response') wsUnexpected = msg;
    });

    await ipcRpcClient.call('hello', { name: 'Private' });

    expect(wsUnexpected).toBeNull();
  });
});
