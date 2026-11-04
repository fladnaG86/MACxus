import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProbeOutput, refusalOutputFailed } from './probe-output.mjs';

const result = capture => ({ code: 0, timedOut: false, ...capture.snapshot() });

test('privacy gate fails when a response marker follows the retained output limit', () => {
  for (const chunks of [
    ['x'.repeat(512000), 'RESPONSE_BODY_MUST_STAY_PRIVATE'],
    ['x'.repeat(512000) + 'RESPONSE_BODY_MUST_STAY_PRIVATE'],
    ['x'.repeat(511990), 'RESPONSE_BODY_', 'MUST_STAY_PRIVATE'],
  ]) {
    const capture = createProbeOutput();
    for (const chunk of chunks) capture.collect(Buffer.from(chunk));
    assert.equal(capture.snapshot().output.length, 512000);
    assert.equal(capture.snapshot().outputTruncated, true);
    assert.equal(refusalOutputFailed(result(capture)), true);
  }
});

test('markers split between collected chunks are still detected', () => {
  for (const marker of ['RESPONSE_BODY_MUST_STAY_PRIVATE', 'response-private.example.test']) {
    for (let split = 1; split < marker.length; split++) {
      const capture = createProbeOutput();
      capture.collect(Buffer.from(marker.slice(0, split)));
      capture.collect(Buffer.from(marker.slice(split)));
      assert.equal(refusalOutputFailed(result(capture)), true);
    }
  }
});

test('bounded clean output passes; incomplete, failed and timed-out probes fail', () => {
  const capture = createProbeOutput(5);
  capture.collect(Buffer.from('clean'));
  assert.deepEqual(capture.snapshot(), { output: 'clean', outputTruncated: false });
  assert.equal(refusalOutputFailed(result(capture)), false);
  assert.equal(refusalOutputFailed({ ...result(capture), code: 1 }), true);
  assert.equal(refusalOutputFailed({ ...result(capture), timedOut: true }), true);
  capture.collect(Buffer.from('!'));
  capture.collect(Buffer.from('additional output'));
  assert.deepEqual(capture.snapshot(), { output: 'clean', outputTruncated: true });
  assert.equal(refusalOutputFailed(result(capture)), true);
});
