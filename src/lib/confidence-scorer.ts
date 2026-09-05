/**
 * Client-only half of the confidence engine.
 *
 * The scoring itself is in server/confidence.ts so the queue consumer scores a
 * document the same way the browser does — it previously could not reach this
 * file at all and stored every field at confidence 0. Only the canvas-based image
 * measurement is left here, because only the browser has the image.
 */

export {
  calculateFieldConfidence,
  calculateDocumentOverallConfidence,
  extractModelConfidence,
  validateFieldMath,
  type ConfidenceDetails,
  type ImageQualityMetrics,
  type MathWarning,
} from "../../server/confidence";

import type { ImageQualityMetrics } from "../../server/confidence";

/**
 * Client-side Canvas Image Quality Analyzer
 * Evaluates resolution, contrast, and edge sharpness (blur) from an uploaded image File.
 */
export async function analyzeImageQuality(file: File): Promise<ImageQualityMetrics> {
  const metrics: ImageQualityMetrics = {
    fileSizeBytes: file.size,
  };

  if (!file.type.startsWith("image/")) {
    return metrics;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      metrics.width = img.naturalWidth || img.width;
      metrics.height = img.naturalHeight || img.height;

      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Scale down for fast pixel analysis
          const sampleW = Math.min(200, metrics.width);
          const sampleH = Math.min(200, metrics.height);
          canvas.width = sampleW;
          canvas.height = sampleH;
          ctx.drawImage(img, 0, 0, sampleW, sampleH);

          const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
          const pixels = imgData.data;

          // Calculate Contrast RMS
          let sumGrayscale = 0;
          const grayscaleVals: number[] = [];
          for (let i = 0; i < pixels.length; i += 4) {
            const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            sumGrayscale += gray;
            grayscaleVals.push(gray);
          }
          const avgGray = sumGrayscale / grayscaleVals.length;
          let variance = 0;
          for (const g of grayscaleVals) {
            variance += Math.pow(g - avgGray, 2);
          }
          const rmsContrast = Math.sqrt(variance / grayscaleVals.length);
          // Normalized contrast: 0 (flat/low contrast) to 1 (high contrast)
          metrics.contrastScore = Math.min(1, Math.max(0, rmsContrast / 75));

          // Estimate Edge Sharpness (Blur Detection via horizontal pixel diff)
          let edgeDiffSum = 0;
          for (let y = 0; y < sampleH; y++) {
            for (let x = 0; x < sampleW - 1; x++) {
              const idx1 = (y * sampleW + x) * 4;
              const idx2 = (y * sampleW + x + 1) * 4;
              const g1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
              const g2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
              edgeDiffSum += Math.abs(g1 - g2);
            }
          }
          const avgEdgeDiff = edgeDiffSum / (sampleW * sampleH);
          // Sharpness score: values < 5 indicate blurry / low contrast text edges
          metrics.blurScore = Math.min(1, Math.max(0, avgEdgeDiff / 15));
        }
      } catch (e) {
        console.warn("Image canvas analysis skipped:", e);
      } finally {
        URL.revokeObjectURL(url);
        resolve(metrics);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(metrics);
    };

    img.src = url;
  });
}

