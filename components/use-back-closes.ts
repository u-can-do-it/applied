'use client';

import { useEffect, useEffectEvent } from 'react';

// A window that's open is a step in the history, named in the URL's hash (/applied#application, and
// with a question over it #application/confirm): Back (a phone's back button or gesture) closes the
// window on top instead of leaving the page, or the app. Closed any other way (Escape, the X, a click
// elsewhere), its step goes, as Back would take it. Written with the History API, which Next's router
// follows without asking the server for the page again.
// One list for the whole app, the windows in the order they opened.

const LAYERS = ['offer', 'application', 'add-application', 'scraper', 'profile', 'confirm', 'calendar'] as const;
export type Layer = (typeof LAYERS)[number];
const NAMES: readonly string[] = LAYERS;

type Open = { name: Layer; back: () => unknown };

const open: Open[] = [];
/** the page's URL under the windows' steps (Back to it closes them all), when they were added here */
let base: string | null = null;
let going = false; // our own history.go() is on its way: its popstate isn't a Back
let scheduled = false;
let listening = false;

const page = () => window.location.pathname + window.location.search;
const hashOf = (layers: Open[]) => (layers.length ? `#${layers.map((layer) => layer.name).join('/')}` : '');

/** how many windows the URL has open: the leading names of its hash (another hash, an anchor, has none) */
export function depthOf(hash: string) {
  const names = hash.replace(/^#/, '').split('/');
  const known = names.findIndex((name) => !NAMES.includes(name));
  return known === -1 ? names.length : known;
}

/** The history made to match the windows open: a step added for each new one, taken for each closed one. */
function sync() {
  scheduled = false;
  if (going) return;
  const depth = depthOf(window.location.hash);
  if (depth > open.length) {
    if (base === page()) {
      going = true;
      window.history.go(open.length - depth);
    } else {
      // the page's URL changed under the window (a filter, another tab) or its step is from before a
      // reload: going back would undo that, so this step stays, the window out of its URL
      window.history.replaceState(null, '', page() + hashOf(open));
    }
    return;
  }
  if (depth === 0 && open.length) base = page();
  for (let shown = depth + 1; shown <= open.length; shown++)
    window.history.pushState(null, '', page() + hashOf(open.slice(0, shown)));
  // a window shown in place of another (the next application): its name, in the same step
  if (window.location.hash !== hashOf(open) && depth === open.length && depth)
    window.history.replaceState(null, '', page() + hashOf(open));
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // once the render that opened or closed windows is done: one closing as another opens is a switch
  queueMicrotask(sync);
}

function onPopState() {
  if (going) {
    going = false;
    schedule(); // a window that opened meanwhile gets its step
    return;
  }
  // Back: the windows above the step closed, the top one first; one that stays (back() false) gets its step again
  const closing = open.splice(depthOf(window.location.hash)).reverse();
  const staying = closing.filter((layer) => layer.back() === false);
  open.push(...staying.reverse());
  if (staying.length) schedule();
}

/**
 * While `isOpen`, the window is a step in the history, `name` in the URL: Back calls `onBack`, which
 * closes it (what Escape does: a form open in it may close instead, returning false to keep the window).
 */
export function useBackCloses(isOpen: boolean, name: Layer, onBack: () => unknown) {
  const back = useEffectEvent(onBack);
  useEffect(() => {
    if (!isOpen) return;
    if (!listening) {
      listening = true;
      window.addEventListener('popstate', onPopState);
    }
    const layer: Open = { name, back };
    open.push(layer);
    schedule();
    return () => {
      const at = open.indexOf(layer);
      if (at !== -1) open.splice(at, 1);
      schedule();
    };
  }, [isOpen, name]);
}
