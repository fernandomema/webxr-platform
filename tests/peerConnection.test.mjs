import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerLink } from '../src/lib/xr/net/peerConnection.ts';

class FakeDataChannel {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  frames = [];
  constructor(label) { this.label = label; this.binaryType = 'blob'; }
  send(frame) { this.frames.push(frame); }
  close() { this.readyState = 'closed'; }
}

class FakePeerConnection {
  channels = [];
  createDataChannel(label) {
    const channel = new FakeDataChannel(label);
    this.channels.push(channel);
    return channel;
  }
  close() {}
}

globalThis.RTCPeerConnection = FakePeerConnection;

test('large world snapshots are chunked and reassembled without changing payload', () => {
  const received = [];
  const sender = new PeerLink({ iceServers: [], onData: () => {} }, true);
  const receiver = new PeerLink({ iceServers: [], onData: (data, channel) => received.push({ data, channel }) }, true);
  const senderChannel = sender.pc.channels[0];
  const receiverChannel = receiver.pc.channels[0];
  const payload = { kind: 'scene-snapshot', tree: [{ code: 'x'.repeat(150_000) }] };
  sender.send(payload);
  assert.ok(senderChannel.frames.length > 1);
  assert.ok(senderChannel.frames.every((frame) => frame.length < 16_000));
  for (const frame of senderChannel.frames) receiverChannel.onmessage({ data: frame });
  assert.deepEqual(received, [{ data: payload, channel: 'reliable' }]);
  sender.close(); receiver.close();
});

test('oversized transform batches fall back to reliable transport', () => {
  const received = [];
  const sender = new PeerLink({ iceServers: [], onData: () => {} }, true);
  const receiver = new PeerLink({ iceServers: [], onData: (data, channel) => received.push({ data, channel }) }, true);
  const senderChannel = sender.pc.channels[0];
  const receiverChannel = receiver.pc.channels[0];
  const payload = { kind: 'scene-state', revision: 4, transforms: [{ id: 'x'.repeat(10_000) }] };
  sender.sendState(payload);
  for (const frame of senderChannel.frames) receiverChannel.onmessage({ data: frame });
  assert.deepEqual(received, [{ data: payload, channel: 'state' }]);
  sender.close(); receiver.close();
});

test('the binary asset channel carries frames untouched and reports them as bytes', () => {
  const got = [];
  const sender = new PeerLink({ iceServers: [], onData: () => {} }, true);
  const receiver = new PeerLink({ iceServers: [], onData: () => {}, onBinary: (data) => got.push(data) }, true);
  assert.deepEqual(sender.pc.channels.map((c) => c.label), ['world-sync', 'world-state', 'asset-data']);
  const out = sender.pc.channels[2];
  assert.equal(out.binaryType, 'arraybuffer');
  const frame = new Uint8Array([1, 2, 3, 4]);
  sender.sendBinary(frame);
  assert.deepEqual(out.frames, [frame]);
  receiver.pc.channels[2].onmessage({ data: frame.buffer });
  assert.deepEqual(got, [frame]);
  // Text on the binary channel is ignored, and does not disturb the JSON channels.
  receiver.pc.channels[2].onmessage({ data: 'not binary' });
  assert.equal(got.length, 1);
  sender.close(); receiver.close();
});

test('binary frames wait for the channel to drain instead of piling up', async () => {
  const sender = new PeerLink({ iceServers: [], onData: () => {} }, true);
  const out = sender.pc.channels[2];
  out.bufferedAmount = 600_000; // already above the high-water mark
  let delivered = false;
  const sent = sender.sendBinary(new Uint8Array(10)).then(() => (delivered = true));
  await Promise.resolve();
  assert.equal(out.frames.length, 0);
  assert.equal(delivered, false);
  out.bufferedAmount = 0;
  out.onbufferedamountlow();
  await sent;
  assert.equal(out.frames.length, 1);
  sender.close();
});

test('closing the link releases anyone waiting on a queued binary frame', async () => {
  const link = new PeerLink({ iceServers: [], onData: () => {} }, true);
  link.pc.channels[2].bufferedAmount = 900_000;
  const waiting = link.sendBinary(new Uint8Array(4));
  link.close();
  await waiting; // must resolve, not hang
});

test('an unknown channel label never replaces the reliable channel', () => {
  const got = [];
  const guest = new PeerLink({ iceServers: [], onData: (data) => got.push(data) }, false);
  const reliable = new FakeDataChannel('world-sync');
  guest.pc.ondatachannel({ channel: reliable });
  guest.pc.ondatachannel({ channel: new FakeDataChannel('something-new') });
  reliable.onmessage({ data: JSON.stringify({ kind: 'ping' }) });
  assert.deepEqual(got, [{ kind: 'ping' }]);
  guest.send({ kind: 'pong' });
  assert.deepEqual(reliable.frames.map((f) => JSON.parse(f)), [{ kind: 'pong' }], 'replies still use the reliable channel');
});
