import { describe, expect, it } from 'vitest';
import { getWorkspaceAccentColor, WORKSPACE_ACCENT_PALETTE } from './workspaceAccentColor';

describe('workspaceAccentColor', () => {
  it('only references existing appearance tokens', () => {
    for (const color of WORKSPACE_ACCENT_PALETTE) {
      expect(color).toMatch(/^var\(--bf-appearance-token-[a-z0-9-]+\)$/);
      expect(color).not.toContain('error');
    }
  });

  it('returns a stable color for the same workspace identity', () => {
    const workspace = { rootPath: 'E:/projects/bitfun', id: 'ws-1', name: 'bitfun' };
    expect(getWorkspaceAccentColor(workspace)).toBe(getWorkspaceAccentColor(workspace));
  });

  it('prefers rootPath over id and name when assigning the color', () => {
    const byRoot = getWorkspaceAccentColor({ rootPath: 'E:/a', id: 'ws-1', name: 'one' });
    const sameRoot = getWorkspaceAccentColor({ rootPath: 'E:/a', id: 'ws-2', name: 'two' });
    expect(byRoot).toBe(sameRoot);
  });

  it('falls back to id and then name when rootPath is empty', () => {
    const byId = getWorkspaceAccentColor({ rootPath: '', id: 'ws-9', name: 'fallback' });
    expect(WORKSPACE_ACCENT_PALETTE).toContain(byId);

    const byName = getWorkspaceAccentColor({ rootPath: '', id: '', name: 'only-name' });
    expect(WORKSPACE_ACCENT_PALETTE).toContain(byName);
    expect(byName).toBe(getWorkspaceAccentColor({ rootPath: '', id: '', name: 'only-name' }));
  });

  it('spreads distinct workspaces across multiple palette entries', () => {
    const colors = new Set(
      Array.from({ length: 24 }, (_, index) =>
        getWorkspaceAccentColor({ rootPath: `E:/projects/project-${index}`, id: `ws-${index}`, name: `p${index}` }),
      ),
    );
    expect(colors.size).toBeGreaterThan(3);
  });
});
