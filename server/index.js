import { config } from './config.js';
import { createApp } from './app.js';

const { app } = createApp();
app.listen(config.port, () => {
  const mode = config.wikiSource === 'fixture' ? 'offline fixture catalog' : `${config.lang}.wikipedia.org`;
  console.log(`WikiCollect listening on http://localhost:${config.port} (cards from ${mode})`);
});
