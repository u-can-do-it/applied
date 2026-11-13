// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SW_URL } from '@/features/notifications/push-browser';
import { ServiceWorker } from '@/features/shell/service-worker';

// <ServiceWorker> against a stand-in browser: the worker registered, and the notifications still
// showing taken down when the app is opened or come back to.

type Shown = { close: ReturnType<typeof vi.fn> };
let showing: Shown[];
let visibility: DocumentVisibilityState;
const register = vi.fn(() => Promise.resolve({}));
const getNotifications = vi.fn(() => Promise.resolve(showing));

/** a push arrived: one more notification showing */
function notify(): Shown {
  const notification = { close: vi.fn() };
  showing = [...showing, notification];
  return notification;
}

function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  showing = [];
  visibility = 'visible';
  register.mockClear();
  getNotifications.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.stubGlobal('PushManager', {});
  vi.stubGlobal('Notification', {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, getRegistration: () => Promise.resolve({ getNotifications }) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(document, 'visibilityState');
});

it('opened: registers the worker and takes down the notifications still showing', async () => {
  const [first, second] = [notify(), notify()];
  render(<ServiceWorker />);
  expect(register).toHaveBeenCalledWith(SW_URL, expect.objectContaining({ scope: '/' }));
  await vi.waitFor(() => expect(second.close).toHaveBeenCalled());
  expect(first.close).toHaveBeenCalled();
});

it('come back to: the ones that arrived meanwhile go; while it’s in the background they stay', async () => {
  render(<ServiceWorker />);
  await vi.waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(1));
  show('hidden');
  const arrived = notify();
  await Promise.resolve();
  expect(getNotifications).toHaveBeenCalledTimes(1);
  expect(arrived.close).not.toHaveBeenCalled();
  show('visible');
  await vi.waitFor(() => expect(arrived.close).toHaveBeenCalled());
});

it('one that arrives while you’re looking at the app stays', async () => {
  render(<ServiceWorker />);
  await vi.waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(1));
  const arrived = notify();
  await Promise.resolve();
  expect(arrived.close).not.toHaveBeenCalled();
});

it('opened in the background (a tab not looked at yet): nothing is taken down', async () => {
  visibility = 'hidden';
  const waiting = notify();
  render(<ServiceWorker />);
  await Promise.resolve();
  expect(getNotifications).not.toHaveBeenCalled();
  expect(waiting.close).not.toHaveBeenCalled();
});

it('off the page: stops listening', async () => {
  const { unmount } = render(<ServiceWorker />);
  await vi.waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(1));
  unmount();
  show('hidden');
  show('visible');
  await Promise.resolve();
  expect(getNotifications).toHaveBeenCalledTimes(1);
});

it('a browser without push: no worker, nothing to take down', async () => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  render(<ServiceWorker />);
  await Promise.resolve();
  expect(register).not.toHaveBeenCalled();
  expect(getNotifications).not.toHaveBeenCalled();
});
