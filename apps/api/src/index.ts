import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);
const server = createServer(app);

// Roadmap: attach the Socket.IO gateway (src/realtime) with the Redis adapter.

server.listen(config.PORT, () => {
  console.log(`SplitPay API listening on :${config.PORT}`);
});
