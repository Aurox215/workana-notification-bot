// Run in one process so Electron's bundled Node can also execute verification.
require('./integrations.test.cjs');
require('./proposal-prompt.test.cjs');
require('./telegram.test.cjs');
require('./workana-api.test.cjs');
require('./browser-smoke.cjs');
