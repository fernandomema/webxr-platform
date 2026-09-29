import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerLink } from '../src/lib/xr/net/peerConnection.ts';

class FakeDataChannel {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  frames = [];
  constructor(label) { this.label = label; }
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
