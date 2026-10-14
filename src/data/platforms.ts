/**
 * The desktop platforms as the hang data names them (the Glean client_info.os
 * value), with the names people use for them.
 */

export const PLATFORMS = ["Windows", "Darwin", "Linux"] as const;
export type Platform = (typeof PLATFORMS)[number];

const LABELS: Record<string, string> = {
  Windows: "Windows",
  Darwin: "macOS",
  Linux: "Linux",
};

export function platformLabel(os: string): string {
  return LABELS[os] ?? os;
}

export function isPlatform(value: string | null): value is Platform {
  return !!value && (PLATFORMS as readonly string[]).includes(value);
}
