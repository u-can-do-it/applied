import { watchSlow } from '@/components/slow-requests';

// Runs before hydration (Next's file convention): every fetch from here on is timed.
window.fetch = watchSlow(window.fetch.bind(window));
