/** Split an Annex-B buffer into NAL units, without start codes. */
export function splitAnnexB(data: Uint8Array): Uint8Array[] {
  const ranges: Array<{ code: number; nal: number }> = [];
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;
    if (data[i + 2] === 1) {
      ranges.push({ code: i, nal: i + 3 });
      i += 2;
      continue;
    }
    if (data[i + 2] === 0 && data[i + 3] === 1) {
      ranges.push({ code: i, nal: i + 4 });
      i += 3;
    }
  }
  const nals: Uint8Array[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const begin = ranges[i].nal;
    const end = i + 1 < ranges.length ? ranges[i + 1].code : data.length;
    if (end > begin) nals.push(data.subarray(begin, end));
  }
  return nals;
}

export function nalType(nal: Uint8Array): number {
  return nal.length > 0 ? nal[0] & 0x1f : 0;
}

/**
 * `avc1.PPCCLL` from an SPS NAL that still includes its header byte.
 * Bytes 1..3 are profile, constraint flags, and level.
 */
export function h264CodecString(sps: Uint8Array): string | null {
  if (sps.length < 4 || nalType(sps) !== 7) return null;
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

/** AVCDecoderConfigurationRecord (avcC) from the first SPS and PPS in an access unit. */
export function buildAvcDecoderConfig(accessUnit: Uint8Array): Uint8Array | null {
  const nals = splitAnnexB(accessUnit);
  const sps = nals.find((nal) => nalType(nal) === 7);
  const pps = nals.find((nal) => nalType(nal) === 8);
  if (!sps || !pps || sps.length < 4) return null;
  const out = new Uint8Array(11 + sps.length + pps.length);
  out[0] = 1;
  out[1] = sps[1];
  out[2] = sps[2];
  out[3] = sps[3];
  out[4] = 0xff;
  out[5] = 0xe1;
  out[6] = (sps.length >>> 8) & 0xff;
  out[7] = sps.length & 0xff;
  out.set(sps, 8);
  const ppsAt = 8 + sps.length;
  out[ppsAt] = 1;
  out[ppsAt + 1] = (pps.length >>> 8) & 0xff;
  out[ppsAt + 2] = pps.length & 0xff;
  out.set(pps, ppsAt + 3);
  return out;
}

/**
 * 4-byte length-prefixed VCL (and SEI) for VideoDecoder.
 * SPS (7), PPS (8), and AUD (9) stay in the avcC description instead.
 */
export function annexBToLengthPrefixed(accessUnit: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const nal of splitAnnexB(accessUnit)) {
    const type = nalType(nal);
    if (nal.length === 0 || type === 7 || type === 8 || type === 9) continue;
    parts.push(nal);
    total += 4 + nal.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const nal of parts) {
    const length = nal.length;
    out[offset] = (length >>> 24) & 0xff;
    out[offset + 1] = (length >>> 16) & 0xff;
    out[offset + 2] = (length >>> 8) & 0xff;
    out[offset + 3] = length & 0xff;
    out.set(nal, offset + 4);
    offset += 4 + length;
  }
  return out;
}
