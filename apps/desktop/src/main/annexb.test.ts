import assert from "node:assert/strict";
import test from "node:test";
import { annexBToLengthPrefixed, buildAvcDecoderConfig, h264CodecString, nalType, splitAnnexB } from "./annexb";

const start4 = [0x00, 0x00, 0x00, 0x01];
const sps = [0x67, 0x42, 0x00, 0x1f, 0xaa];
const pps = [0x68, 0xce, 0x06, 0xe2];
const aud = [0x09, 0xf0];
const idr = [0x65, 0x88, 0x84];

function unit(): Uint8Array {
  return Uint8Array.from([...start4, ...aud, ...start4, ...sps, ...start4, ...pps, 0x00, 0x00, 0x01, ...idr]);
}

test("Annex-B splits 3-byte and 4-byte start codes", () => {
  const nals = splitAnnexB(unit());
  assert.deepEqual(nals.map((nal) => nalType(nal)), [9, 7, 8, 5]);
  assert.deepEqual(Array.from(nals[1]), sps);
  assert.deepEqual(Array.from(nals[3]), idr);
});

test("avcC and the codec string come from the SPS and PPS", () => {
  const config = buildAvcDecoderConfig(unit());
  assert.ok(config);
  assert.equal(config[0], 1);
  assert.equal(config[1], 0x42);
  assert.equal(config[2], 0x00);
  assert.equal(config[3], 0x1f);
  assert.equal(config[4], 0xff);
  assert.equal(config[5], 0xe1);
  assert.equal(config[6], 0);
  assert.equal(config[7], sps.length);
  assert.deepEqual(Array.from(config.subarray(8, 8 + sps.length)), sps);
  const ppsAt = 8 + sps.length;
  assert.equal(config[ppsAt], 1);
  assert.equal((config[ppsAt + 1] << 8) | config[ppsAt + 2], pps.length);
  assert.deepEqual(Array.from(config.subarray(ppsAt + 3)), pps);
  assert.equal(h264CodecString(Uint8Array.from(sps)), "avc1.42001f");
  assert.equal(h264CodecString(Uint8Array.from(idr)), null);
  assert.equal(buildAvcDecoderConfig(Uint8Array.from([0, 0, 0, 1, ...idr])), null);
});

test("length-prefixed chunks drop SPS, PPS, and AUD", () => {
  const packed = annexBToLengthPrefixed(unit());
  assert.deepEqual(Array.from(packed), [0, 0, 0, idr.length, ...idr]);
  assert.equal(annexBToLengthPrefixed(Uint8Array.from([...start4, ...aud])).length, 0);
});
