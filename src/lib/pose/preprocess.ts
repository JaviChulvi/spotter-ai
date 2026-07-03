// Letterbox a video frame into a 640x640, NCHW, [0,1] Float32 tensor for YOLO,
// and provide the inverse mapping back to source-video pixel coordinates.
import { MODEL_INPUT_SIZE } from "../config";

export interface Letterbox {
  scale: number;
  padX: number;
  padY: number;
  size: number;
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function letterbox(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  ctx: Ctx2D,
): { data: Float32Array; lb: Letterbox } {
  const size = MODEL_INPUT_SIZE;
  const scale = Math.min(size / srcW, size / srcH);
  const nw = Math.round(srcW * scale);
  const nh = Math.round(srcH * scale);
  const padX = Math.floor((size - nw) / 2);
  const padY = Math.floor((size - nh) / 2);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgb(114,114,114)"; // YOLO gray padding
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(source, padX, padY, nw, nh);

  const img = ctx.getImageData(0, 0, size, size).data; // RGBA
  const area = size * size;
  const data = new Float32Array(area * 3);
  for (let i = 0; i < area; i++) {
    data[i] = img[i * 4] / 255; // R plane
    data[area + i] = img[i * 4 + 1] / 255; // G plane
    data[2 * area + i] = img[i * 4 + 2] / 255; // B plane
  }
  return { data, lb: { scale, padX, padY, size } };
}

/** Map a keypoint from 640-letterbox space back to source-video pixels. */
export function unletterbox(
  x: number,
  y: number,
  lb: Letterbox,
): { x: number; y: number } {
  return { x: (x - lb.padX) / lb.scale, y: (y - lb.padY) / lb.scale };
}
