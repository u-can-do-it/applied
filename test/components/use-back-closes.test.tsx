// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { depthOf, useBackCloses, type Layer } from '@/components/use-back-closes';

// History traversal (Back, history.go) is asynchronous: done once its popstate has fired
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const pressBack = async () => {
  window.history.back();
  await settle();
};

type Props = { layers: { name: Layer; open: boolean; onBack: () => unknown }[] };
const setup = (layers: Props['layers']) =>
  renderHook(
    ({ layers }: Props) => {
      for (const layer of layers) useBackCloses(layer.open, layer.name, layer.onBack); // eslint-disable-line react-hooks/rules-of-hooks -- a fixed count per test
    },
    { initialProps: { layers } },
  );

afterEach(async () => {
  cleanup();
  await settle();
  window.history.replaceState(null, '', '/');
});

describe('useBackCloses', () => {
  it('puts an open window in the URL, and Back closes it', async () => {
    const onBack = vi.fn();
    const hook = setup([{ name: 'offer', open: true, onBack }]);
    await settle();
    expect(window.location.hash).toBe('#offer');
    await pressBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
    hook.rerender({ layers: [{ name: 'offer', open: false, onBack }] }); // the window closes
    await settle();
    expect(window.location.hash).toBe('');
  });

  it('takes the step back when the window closes any other way', async () => {
    const onBack = vi.fn();
    const hook = setup([{ name: 'offer', open: true, onBack }]);
    await settle();
    const steps = window.history.length;
    hook.rerender({ layers: [{ name: 'offer', open: false, onBack }] });
    await settle();
    expect(window.location.hash).toBe('');
    expect(onBack).not.toHaveBeenCalled();
    // the next window reuses the place: no step left behind for Back to land on
    hook.rerender({ layers: [{ name: 'offer', open: true, onBack }] });
    await settle();
    expect(window.history.length).toBe(steps);
  });

  it('closes only the top window on Back', async () => {
    const sheet = vi.fn();
    const question = vi.fn();
    const hook = setup([
      { name: 'application', open: true, onBack: sheet },
      { name: 'confirm', open: false, onBack: question },
    ]);
    await settle();
    hook.rerender({
      layers: [
        { name: 'application', open: true, onBack: sheet },
        { name: 'confirm', open: true, onBack: question },
      ],
    });
    await settle();
    expect(window.location.hash).toBe('#application/confirm');
    await pressBack();
    expect(question).toHaveBeenCalledTimes(1);
    expect(sheet).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#application');
  });

  it('keeps a window that stays on Back (a form in it closed instead), with its step', async () => {
    const onBack = vi.fn(() => false);
    setup([{ name: 'application', open: true, onBack }]);
    await settle();
    await pressBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#application');
    await pressBack();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('shows a window in place of another in the same step', async () => {
    const hook = setup([
      { name: 'offer', open: true, onBack: () => {} },
      { name: 'application', open: false, onBack: () => {} },
    ]);
    await settle();
    const steps = window.history.length;
    hook.rerender({
      layers: [
        { name: 'offer', open: false, onBack: () => {} },
        { name: 'application', open: true, onBack: () => {} },
      ],
    });
    await settle();
    expect(window.location.hash).toBe('#application');
    expect(window.history.length).toBe(steps);
  });

  it("doesn't undo a URL changed under the window: its step stays, the window out of it", async () => {
    const hook = setup([{ name: 'application', open: true, onBack: () => {} }]);
    await settle();
    window.history.replaceState(null, '', `?q=java${window.location.hash}`); // a search typed meanwhile
    hook.rerender({ layers: [{ name: 'application', open: false, onBack: () => {} }] });
    await settle();
    expect(window.location.search).toBe('?q=java');
    expect(window.location.hash).toBe('');
  });
});

describe('depthOf', () => {
  it('counts the windows a hash names, not an anchor', () => {
    expect(depthOf('')).toBe(0);
    expect(depthOf('#offer')).toBe(1);
    expect(depthOf('#application/confirm')).toBe(2);
    expect(depthOf('#health-h')).toBe(0);
  });
});
