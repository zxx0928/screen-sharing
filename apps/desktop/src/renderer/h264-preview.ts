import { annexBToLengthPrefixed, buildAvcDecoderConfig, h264CodecString, nalType, splitAnnexB } from "../main/annexb";

export type H264Preview = {
  push(annexb: Uint8Array, keyframe: boolean): void;
  close(): void;
};

/**
 * Decode Annex-B access units onto the offscreen canvas that `captureStream` reads.
 * A decode error waits for the next keyframe instead of painting a broken delta.
 */
export function createH264Preview(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  requestFrame: (() => void) | null,
): H264Preview {
  let decoder: VideoDecoder | null = null;
  let configured = false;
  let waitKey = true;
  let closed = false;
  let timestamp = 0;
  let warned = false;

  const reset = (): void => {
    waitKey = true;
    configured = false;
    const current = decoder;
    decoder = null;
    if (current && current.state !== "closed") {
      try {
        current.close();
      } catch {
        // The decoder may already be closed by the error path.
      }
    }
  };

  const ensure = (annexb: Uint8Array): boolean => {
    if (configured && decoder && decoder.state === "configured") return true;
    if (typeof VideoDecoder === "undefined") {
      if (!warned) {
        warned = true;
        console.warn("[capture] WebCodecs VideoDecoder is missing; H.264 frames will not paint");
      }
      return false;
    }
    const description = buildAvcDecoderConfig(annexb);
    const sps = splitAnnexB(annexb).find((nal) => nalType(nal) === 7);
    const codec = sps ? h264CodecString(sps) : null;
    if (!description || !codec) return false;
    reset();
    const slot: { current: VideoDecoder | null } = { current: null };
    slot.current = new VideoDecoder({
      output: (frame) => {
        if (closed || decoder !== slot.current) {
          frame.close();
          return;
        }
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0);
        frame.close();
        requestFrame?.();
      },
      error: (error) => {
        if (decoder !== slot.current) return;
        console.warn("[capture] H.264 decoder reset", error);
        reset();
      },
    });
    decoder = slot.current;
    try {
      decoder.configure({
        codec,
        description,
        optimizeForLatency: true,
        hardwareAcceleration: "no-preference",
      });
      configured = true;
      return true;
    } catch (error) {
      console.warn("[capture] H.264 decoder configure failed", error);
      reset();
      return false;
    }
  };

  return {
    push(annexb, keyframe) {
      if (closed || annexb.byteLength === 0) return;
      const idr = splitAnnexB(annexb).some((nal) => nalType(nal) === 5);
      const isKey = keyframe || idr;
      if (waitKey && !isKey) return;
      if (!ensure(annexb)) return;
      const data = annexBToLengthPrefixed(annexb);
      if (data.byteLength === 0 || !decoder || decoder.state !== "configured") return;
      timestamp += 33_333;
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: isKey ? "key" : "delta",
            timestamp,
            data,
          }),
        );
        waitKey = false;
      } catch (error) {
        console.warn("[capture] H.264 decode rejected", error);
        reset();
      }
    },
    close() {
      closed = true;
      reset();
    },
  };
}
