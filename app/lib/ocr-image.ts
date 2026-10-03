// OCR の前処理（PLAN §7 の 3）。グレースケール → 拡大 → ぼかし → コントラスト補正 → 二値化（大津の方法）。
// 画素の処理は純粋関数にして、Canvas に触る部分は cropAndPrepare だけにする。

/** 切り出す範囲。元画像の幅・高さに対する割合（0〜1） */
export type CropRect = { x: number; y: number; w: number; h: number };

/** 手配書の下部パネルがありそうな範囲の初期値（画面の下半分より少し上まで） */
export const DEFAULT_CROP: CropRect = { x: 0.05, y: 0.55, w: 0.9, h: 0.43 };

/** OCR に渡す画像の高さの目安。小さい文字を読みやすくするため、これより小さければ拡大する */
const TARGET_HEIGHT = 480;
const MAX_SCALE = 3;
const MAX_WIDTH = 2400;

export function toGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  }
  return gray;
}

/** 3×3 の箱型ぼかしを radius 回かける（モニターを撮ったときのモアレを均す） */
export function blur(gray: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  let src = gray;
  for (let r = 0; r < radius; r++) {
    const dst = new Uint8ClampedArray(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
            sum += src[yy * width + xx];
            n++;
          }
        }
        dst[y * width + x] = Math.round(sum / n);
      }
    }
    src = dst;
  }
  return src;
}

/** 輝度の 1〜99 パーセンタイルが 0〜255 に広がるように伸ばす */
export function stretchContrast(gray: Uint8ClampedArray): Uint8ClampedArray {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]++;
  const cut = gray.length * 0.01;
  let acc = 0;
  let lo = 0;
  for (; lo < 255; lo++) {
    acc += hist[lo];
    if (acc > cut) break;
  }
  acc = 0;
  let hi = 255;
  for (; hi > 0; hi--) {
    acc += hist[hi];
    if (acc > cut) break;
  }
  if (hi - lo < 8) return gray;
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = Math.round(((gray[i] - lo) * 255) / (hi - lo));
  return out;
}

/** 大津の方法で二値化のしきい値を求める */
export function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * 二値化して、文字が黒・背景が白になるようにそろえる。
 * 手配書のパネルは暗い背景に明るい文字なので、多いほうの色を背景とみなして反転を決める。
 */
export function binarize(gray: Uint8ClampedArray): Uint8ClampedArray {
  const t = otsuThreshold(gray);
  let bright = 0;
  for (const v of gray) if (v > t) bright++;
  const backgroundIsBright = bright >= gray.length / 2;
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const isBright = gray[i] > t;
    out[i] = isBright === backgroundIsBright ? 255 : 0;
  }
  return out;
}

/** グレースケールの画素列を RGBA に戻す */
function grayToRgba(gray: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    rgba[i * 4] = gray[i];
    rgba[i * 4 + 1] = gray[i];
    rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export type PrepareOptions = {
  /** ぼかしの回数（スマホ撮影は 1、スクリーンショットは 0） */
  blurRadius: number;
};

export type DrawableSource = CanvasImageSource & { width?: number; height?: number };

/** ソース画像の大きさ（ImageBitmap・video・canvas のいずれも） */
export function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  const s = source as { width: number; height: number };
  return { width: s.width, height: s.height };
}

/** 範囲を切り出し、前処理した OCR 用の canvas を返す */
export function cropAndPrepare(source: CanvasImageSource, crop: CropRect, options: PrepareOptions): HTMLCanvasElement {
  const { width, height } = sourceSize(source);
  const sx = Math.max(0, Math.round(crop.x * width));
  const sy = Math.max(0, Math.round(crop.y * height));
  const sw = Math.max(1, Math.min(width - sx, Math.round(crop.w * width)));
  const sh = Math.max(1, Math.min(height - sy, Math.round(crop.h * height)));

  const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_HEIGHT / sh), MAX_WIDTH / sw);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas を使えません");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);

  const image = ctx.getImageData(0, 0, dw, dh);
  let gray = toGray(image.data);
  if (options.blurRadius > 0) gray = blur(gray, dw, dh, options.blurRadius);
  gray = stretchContrast(gray);
  const bin = binarize(gray);
  ctx.putImageData(new ImageData(grayToRgba(bin), dw, dh), 0, 0);
  return canvas;
}
