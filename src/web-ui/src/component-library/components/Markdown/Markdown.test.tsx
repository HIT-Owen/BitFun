// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Markdown, LOCAL_IMAGE_REVALIDATE_THROTTLE_MS } from './Markdown';

const mocks = vi.hoisted(() => ({
  getCurrentWorkspacePath: vi.fn(),
  revealInExplorer: vi.fn(),
  readFileContent: vi.fn(),
  getFileMetadata: vi.fn(),
  openExternal: vi.fn(),
  renderMath: vi.fn(),
}));

vi.mock('../../../infrastructure/api', () => ({
  globalAPI: {
    getCurrentWorkspacePath: (...args: unknown[]) => mocks.getCurrentWorkspacePath(...args),
  },
  workspaceAPI: {
    revealInExplorer: (...args: unknown[]) => mocks.revealInExplorer(...args),
    readFileContent: (...args: unknown[]) => mocks.readFileContent(...args),
    getFileMetadata: (...args: unknown[]) => mocks.getFileMetadata(...args),
  },
  systemAPI: {
    openExternal: (...args: unknown[]) => mocks.openExternal(...args),
  },
}));

vi.mock('@/infrastructure/i18n', () => ({
  i18nService: {
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  },
}));

vi.mock('@/infrastructure/appearance', () => ({
  useAppearance: () => ({ current: { mode: 'dark' } }),
}));

vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./MermaidBlock', () => ({
  MermaidBlock: () => <div data-testid="mermaid-block" />,
}));

vi.mock('./ReproductionStepsBlock', () => ({
  ReproductionStepsBlock: () => <div data-testid="reproduction-steps" />,
}));

vi.mock('./MarkdownMathRenderer', () => ({
  default: ({ markdownContent }: { markdownContent: string }) => {
    mocks.renderMath(markdownContent);
    return <span data-testid="markdown-math-renderer">{markdownContent}</span>;
  },
}));

vi.mock('./AsyncPrismSyntaxHighlighter', () => ({
  AsyncPrismSyntaxHighlighter: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

vi.mock('@/shared/context-menu-system/core/ContextMenuController', () => ({
  contextMenuController: {
    show: vi.fn(),
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/shared/utils/startupTrace', () => ({
  isStartupRenderTraceEnabled: () => false,
  recordReactRenderProfile: vi.fn(),
  startupTrace: {},
}));

const EXAMPLE_WORKSPACE = 'C:\\ExampleWorkspace';
const EXAMPLE_ABSOLUTE_README = 'D:\\SampleDocs\\Guides\\README.md';

describe('Markdown file links', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onFileViewRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    onFileViewRequest = vi.fn();
    mocks.getCurrentWorkspacePath.mockReset();
    mocks.revealInExplorer.mockReset();
    mocks.readFileContent.mockReset();
    mocks.getFileMetadata.mockReset();
    mocks.openExternal.mockReset();
    mocks.renderMath.mockReset();
    mocks.getCurrentWorkspacePath.mockResolvedValue(EXAMPLE_WORKSPACE);
    mocks.readFileContent.mockResolvedValue('cmVsdS1wbmc=');
    mocks.getFileMetadata.mockResolvedValue({
      path: 'C:/ExampleWorkspace/image.png',
      modified: 1000,
      size: 100,
      isFile: true,
      isDir: false,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('does not resolve workspace path for markdown without local file links', async () => {
    await act(async () => {
      root.render(
        <Markdown
          content={'Plain answer without file links.\n\n```ts\nconst value = 1;\n```'}
          onFileViewRequest={onFileViewRequest}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.getCurrentWorkspacePath).not.toHaveBeenCalled();
  });

  it('opens chat http links in the built-in browser by default', async () => {
    container.className = 'bitfun-session-scene modern-flowchat-container';
    const onCreateTab = vi.fn();
    window.addEventListener('agent-create-tab', onCreateTab);

    try {
      await act(async () => {
        root.render(<Markdown content={'[Example](https://example.com/docs)'} />);
        await Promise.resolve();
      });

      const link = container.querySelector<HTMLAnchorElement>('a[href="https://example.com/docs"]');
      expect(link).not.toBeNull();

      await act(async () => {
        link?.click();
        await Promise.resolve();
      });

      expect(mocks.openExternal).not.toHaveBeenCalled();
      expect(onCreateTab).toHaveBeenCalledTimes(1);
      const event = onCreateTab.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toMatchObject({
        type: 'browser',
        data: { url: 'https://example.com/docs' },
        duplicateCheckKey: 'browser-panel:https://example.com/docs',
        replaceExisting: false,
      });
    } finally {
      window.removeEventListener('agent-create-tab', onCreateTab);
    }
  });

  it('expands a collapsed right panel before creating a browser tab', async () => {
    vi.useFakeTimers();
    container.className = 'bitfun-session-scene modern-flowchat-container';
    (window as any).__BITFUN_LAYOUT_STATE__ = { rightPanelCollapsed: true };
    const onExpandPanel = vi.fn();
    const onCreateTab = vi.fn();
    window.addEventListener('expand-right-panel', onExpandPanel);
    window.addEventListener('agent-create-tab', onCreateTab);

    try {
      await act(async () => {
        root.render(<Markdown content={'[Example](https://example.com/docs)'} />);
        await Promise.resolve();
      });

      const link = container.querySelector<HTMLAnchorElement>('a[href="https://example.com/docs"]');
      expect(link).not.toBeNull();

      act(() => {
        link?.click();
      });

      expect(onExpandPanel).toHaveBeenCalledTimes(1);
      expect(onCreateTab).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onCreateTab).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as any).__BITFUN_LAYOUT_STATE__;
      window.removeEventListener('expand-right-panel', onExpandPanel);
      window.removeEventListener('agent-create-tab', onCreateTab);
      vi.useRealTimers();
    }
  });

  it('opens modified chat link clicks in the external browser', async () => {
    container.className = 'bitfun-session-scene modern-flowchat-container';
    const onCreateTab = vi.fn();
    window.addEventListener('agent-create-tab', onCreateTab);

    try {
      await act(async () => {
        root.render(<Markdown content={'[Example](https://example.com/docs)'} />);
        await Promise.resolve();
      });

      const link = container.querySelector<HTMLAnchorElement>('a[href="https://example.com/docs"]');
      expect(link).not.toBeNull();

      await act(async () => {
        link?.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }));
        await Promise.resolve();
      });

      expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/docs');
      expect(onCreateTab).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('agent-create-tab', onCreateTab);
    }
  });

  it('routes same-label relative, absolute, and computer links independently', async () => {
    const content = [
      '1. [README.md](.\\README.md)',
      `2. [README.md](${EXAMPLE_ABSOLUTE_README})`,
      '3. [README.md](computer://README.md)',
      `4. [README.md](computer://${EXAMPLE_ABSOLUTE_README})`,
      '5. [deck.pptx](computer://deck.pptx)',
    ].join('\n');

    await act(async () => {
      root.render(
        <Markdown
          content={content}
          onFileViewRequest={onFileViewRequest}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button.file-link'));
    expect(buttons).toHaveLength(5);

    await act(async () => {
      buttons[0].click();
      await Promise.resolve();
    });

    expect(onFileViewRequest).toHaveBeenNthCalledWith(1, '.\\README.md', 'README.md', undefined);
    expect(mocks.revealInExplorer).not.toHaveBeenCalled();

    await act(async () => {
      buttons[1].click();
      await Promise.resolve();
    });

    expect(onFileViewRequest).toHaveBeenNthCalledWith(2, EXAMPLE_ABSOLUTE_README, 'README.md', undefined);
    expect(mocks.revealInExplorer).not.toHaveBeenCalled();

    await act(async () => {
      buttons[2].click();
      await Promise.resolve();
    });

    expect(onFileViewRequest).toHaveBeenNthCalledWith(3, 'README.md', 'README.md', undefined);
    expect(mocks.revealInExplorer).not.toHaveBeenCalled();

    await act(async () => {
      buttons[3].click();
      await Promise.resolve();
    });

    expect(onFileViewRequest).toHaveBeenNthCalledWith(4, EXAMPLE_ABSOLUTE_README, 'README.md', undefined);
    expect(mocks.revealInExplorer).not.toHaveBeenCalled();

    await act(async () => {
      buttons[4].click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.revealInExplorer).toHaveBeenNthCalledWith(1, `${EXAMPLE_WORKSPACE}\\deck.pptx`);
    expect(onFileViewRequest).toHaveBeenCalledTimes(4);
  });

  it('does not load the math renderer for ordinary markdown', async () => {
    await act(async () => {
      root.render(
        <Markdown
          content={'Plain answer with **bold** text and a table-like sentence.'}
          onFileViewRequest={onFileViewRequest}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Plain answer with');
    expect(container.querySelector('[data-testid="markdown-math-renderer"]')).toBeNull();
    expect(mocks.renderMath).not.toHaveBeenCalled();
  });

  it('keeps math markdown visible while the math renderer loads', async () => {
    act(() => {
      root.render(
        <Markdown
          content={'Formula: $x + y$'}
          onFileViewRequest={onFileViewRequest}
        />,
      );
    });

    expect(container.textContent).toContain('Formula:');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="markdown-math-renderer"]')).not.toBeNull();
    expect(mocks.renderMath).toHaveBeenCalledWith('Formula: $x + y$');
  });

  it('loads relative markdown images from the provided base path', async () => {
    await act(async () => {
      root.render(
        <Markdown
          content={'![ReLU 图像](relu.png)'}
          basePath={EXAMPLE_WORKSPACE}
          onFileViewRequest={onFileViewRequest}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const image = container.querySelector<HTMLImageElement>('img[alt="ReLU 图像"]');
    expect(image).not.toBeNull();
    expect(mocks.readFileContent).toHaveBeenCalledWith(
      `${EXAMPLE_WORKSPACE}/relu.png`,
      'base64',
      undefined,
    );
    expect(image?.src).toBe('data:image/png;base64,cmVsdS1wbmc=');
    expect(mocks.getCurrentWorkspacePath).not.toHaveBeenCalled();
  });

  it('routes remote markdown image reads through the session connection', async () => {
    await act(async () => {
      root.render(
        <Markdown
          content={'![Remote chart](artifacts/chart.png)'}
          basePath={'/srv/project'}
          remoteConnectionId={'remote-connection-1'}
          onFileViewRequest={onFileViewRequest}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.readFileContent).toHaveBeenCalledWith(
      '/srv/project/artifacts/chart.png',
      'base64',
      'remote-connection-1',
    );
    // Remote sessions have no local file stat: images are treated as
    // immutable for the session and never revalidated.
    expect(mocks.getFileMetadata).not.toHaveBeenCalled();
  });

  it('reloads a cached local image after the file changes on disk', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      mocks.readFileContent.mockResolvedValue('dmVyc2lvbi0x');
      mocks.getFileMetadata.mockResolvedValue({
        path: `${EXAMPLE_WORKSPACE}/chart.svg`,
        modified: 1000,
        size: 10,
        isFile: true,
        isDir: false,
      });

      await act(async () => {
        root.render(
          <Markdown
            content={'![Chart](chart.svg)'}
            basePath={EXAMPLE_WORKSPACE}
            onFileViewRequest={onFileViewRequest}
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector<HTMLImageElement>('img[alt="Chart"]')?.src).toBe(
        'data:image/svg+xml;base64,dmVyc2lvbi0x',
      );
      expect(mocks.readFileContent).toHaveBeenCalledTimes(1);

      // The agent rewrites the file: new mtime, size, and content.
      mocks.readFileContent.mockResolvedValue('dmVyc2lvbi0y');
      mocks.getFileMetadata.mockResolvedValue({
        path: `${EXAMPLE_WORKSPACE}/chart.svg`,
        modified: 2000,
        size: 12,
        isFile: true,
        isDir: false,
      });

      // Remount past the revalidation throttle, as virtualized scrolling does.
      await act(async () => {
        root.unmount();
      });
      act(() => {
        vi.advanceTimersByTime(LOCAL_IMAGE_REVALIDATE_THROTTLE_MS + 1000);
      });
      root = createRoot(container);
      await act(async () => {
        root.render(
          <Markdown
            content={'![Chart](chart.svg)'}
            basePath={EXAMPLE_WORKSPACE}
            onFileViewRequest={onFileViewRequest}
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector<HTMLImageElement>('img[alt="Chart"]')?.src).toBe(
        'data:image/svg+xml;base64,dmVyc2lvbi0y',
      );
      expect(mocks.readFileContent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps serving the cached image while the file is unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      mocks.readFileContent.mockResolvedValue('dmVyc2lvbi0x');
      mocks.getFileMetadata.mockResolvedValue({
        path: `${EXAMPLE_WORKSPACE}/banner.svg`,
        modified: 1000,
        size: 10,
        isFile: true,
        isDir: false,
      });

      await act(async () => {
        root.render(
          <Markdown
            content={'![Banner](banner.svg)'}
            basePath={EXAMPLE_WORKSPACE}
            onFileViewRequest={onFileViewRequest}
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        root.unmount();
      });
      root = createRoot(container);

      // Remount after the throttle window with unchanged mtime/size: the
      // cached data URL is served and the file is not re-read.
      act(() => {
        vi.advanceTimersByTime(LOCAL_IMAGE_REVALIDATE_THROTTLE_MS + 1000);
      });
      await act(async () => {
        root.render(
          <Markdown
            content={'![Banner](banner.svg)'}
            basePath={EXAMPLE_WORKSPACE}
            onFileViewRequest={onFileViewRequest}
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector<HTMLImageElement>('img[alt="Banner"]')?.src).toBe(
        'data:image/svg+xml;base64,dmVyc2lvbi0x',
      );
      expect(mocks.readFileContent).toHaveBeenCalledTimes(1);
      expect(mocks.getFileMetadata).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
