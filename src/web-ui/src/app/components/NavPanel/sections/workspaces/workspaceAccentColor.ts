import type { WorkspaceInfo } from '@/shared/types';

/**
 * Categorical accent palette for workspace rows. Reuses existing appearance
 * tokens so the colors stay in sync with the active skin (same approach as the
 * usage-stats charts). Consecutive entries are maximally distinct hues.
 * Deliberately excludes `error` so no workspace reads as "failed", and keeps
 * `info` out because it aliases the accent hue in most themes.
 */
export const WORKSPACE_ACCENT_PALETTE = [
  'var(--bf-appearance-token-color-accent-500)',
  'var(--bf-appearance-token-color-warning)',
  'var(--bf-appearance-token-color-purple-500)',
  'var(--bf-appearance-token-color-success)',
  'var(--bf-appearance-token-color-cyan-500)',
  'var(--bf-appearance-token-color-indigo-500)',
] as const;

/** FNV-1a 32-bit hash; stable across sessions and processes. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Picks a stable accent color for a workspace from its identity. Prefers
 * `rootPath` so the same folder always maps to the same color, falling back to
 * the workspace id and then the display name.
 */
export function getWorkspaceAccentColor(
  workspace: Pick<WorkspaceInfo, 'rootPath' | 'id' | 'name'>,
): string {
  const seed = workspace.rootPath || workspace.id || workspace.name || '';
  const index = hashString(seed) % WORKSPACE_ACCENT_PALETTE.length;
  return WORKSPACE_ACCENT_PALETTE[index];
}
