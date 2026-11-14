/**
 * Real in-browser face recognition using @vladmandic/face-api (TensorFlow.js) with the pretrained
 * TinyFaceDetector + 68-point landmark net + FaceRecognitionNet (ResNet-128 descriptor).
 * Model files are copied from the npm package to /models by scripts/copy-models.mjs (runs on postinstall/prebuild).
 *
 * Nothing here is a "success flag" the server trusts: the 128-number descriptor is sent to the server,
 * which does the identity comparison itself.
 */
import * as faceapi from '@vladmandic/face-api';

let loading: Promise<void> | null = null;
export function loadFaceModels(): Promise<void> {
  if (!loading) {
    const url = '/models';
    loading = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(url),
      faceapi.nets.faceLandmark68Net.loadFromUri(url),
      faceapi.nets.faceRecognitionNet.loadFromUri(url),
    ]).then(() => undefined).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export interface FaceFrame {
  faceCount: number;
  box: { x: number; y: number; width: number; height: number } | null;
  descriptor: number[] | null; // 128 numbers, only when exactly one face
  ear: number | null; // eye aspect ratio (both eyes averaged)
  yaw: number | null; // ~0.5 facing camera, <0.5 / >0.5 head turned
  score: number;
  brightness: number; // 0-255 inside the face box
  sharpness: number; // variance of Laplacian inside the face box (higher = sharper)
  videoWidth: number;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
function eyeEar(p: { x: number; y: number }[]): number {
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
}

function quality(video: HTMLVideoElement, canvas: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }) {
  const S = 96;
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { brightness: 128, sharpness: 100 };
  ctx.drawImage(video, Math.max(0, box.x), Math.max(0, box.y), box.width, box.height, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  const g = new Float32Array(S * S);
  let sum = 0;
  for (let i = 0; i < S * S; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; }
  let m = 0, m2 = 0, n = 0;
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const l = 4 * g[y * S + x] - g[y * S + x - 1] - g[y * S + x + 1] - g[(y - 1) * S + x] - g[(y + 1) * S + x];
    m += l; m2 += l * l; n++;
  }
  return { brightness: sum / (S * S), sharpness: m2 / n - (m / n) ** 2 };
}

const opts = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

export async function analyzeFrame(video: HTMLVideoElement, scratch: HTMLCanvasElement): Promise<FaceFrame> {
  const empty: FaceFrame = { faceCount: 0, box: null, descriptor: null, ear: null, yaw: null, score: 0, brightness: 0, sharpness: 0, videoWidth: video.videoWidth };
  if (!video.videoWidth) return empty;
  const dets = await faceapi.detectAllFaces(video, opts()).withFaceLandmarks().withFaceDescriptors();
  if (dets.length === 0) return empty;
  if (dets.length > 1) return { ...empty, faceCount: dets.length };
  const d = dets[0];
  const p = d.landmarks.positions;
  const ear = (eyeEar(p.slice(36, 42)) + eyeEar(p.slice(42, 48))) / 2;
  const yaw = (p[30].x - p[0].x) / Math.max(1, p[16].x - p[0].x);
  const b = d.detection.box;
  const box = { x: b.x, y: b.y, width: b.width, height: b.height };
  const q = quality(video, scratch, box);
  return { faceCount: 1, box, descriptor: Array.from(d.descriptor), ear, yaw, score: d.detection.score, videoWidth: video.videoWidth, ...q };
}

/** Blink = eyes open -> clearly closed (EAR drops well below the person's own open baseline) -> open again. */
export class BlinkDetector {
  private baseline = 0;
  private closed = false;
  public blinks = 0;
  public minEar = 1;
  public maxEar = 0;
  reset() { this.baseline = 0; this.closed = false; this.blinks = 0; this.minEar = 1; this.maxEar = 0; }
  update(ear: number) {
    this.minEar = Math.min(this.minEar, ear);
    this.maxEar = Math.max(this.maxEar, ear);
    if (!this.closed && ear > 0.18) this.baseline = this.baseline ? 0.92 * this.baseline + 0.08 * ear : ear;
    if (!this.baseline) return;
    if (!this.closed && ear < this.baseline * 0.72) this.closed = true;
    else if (this.closed && ear > this.baseline * 0.87) { this.closed = false; this.blinks++; }
  }
  get passed() { return this.blinks >= 1; }
}

export const QUALITY_LIMITS = { minScore: 0.8, minBrightness: 60, maxBrightness: 210, minSharpness: 12, minFaceFraction: 0.25 };
export function frameQualityIssue(f: FaceFrame): string | null {
  if (f.faceCount !== 1 || !f.box) return f.faceCount > 1 ? 'Only one person may be in the frame.' : 'No face detected.';
  if (f.score < QUALITY_LIMITS.minScore) return 'Face not clear enough. Face the camera.';
  if (f.brightness < QUALITY_LIMITS.minBrightness) return 'Too dark. Move to a brighter place.';
  if (f.brightness > QUALITY_LIMITS.maxBrightness) return 'Too bright / glare. Avoid direct light on your face.';
  if (f.sharpness < QUALITY_LIMITS.minSharpness) return 'Image is blurry. Hold the device steady.';
  if (f.box.width / f.videoWidth < QUALITY_LIMITS.minFaceFraction) return 'Move closer to the camera.';
  return null;
}
