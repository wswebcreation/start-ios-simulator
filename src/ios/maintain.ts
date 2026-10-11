import type { RuntimeImage } from "./runtimes.ts";

/** The iOS runtimes nobody needs: one that is unusable, or without a simulator that runs on it. */
export function unusedRuntimes(images: RuntimeImage[], usedRuntimes: Set<string>): RuntimeImage[] {
  return images.filter((image) => !image.usable || !usedRuntimes.has(image.identifier));
}

export function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export const runtimeLabel = (image: RuntimeImage) => `iOS ${image.version} runtime, ${formatSize(image.sizeBytes)}${image.usable ? "" : ", unusable"}`;
