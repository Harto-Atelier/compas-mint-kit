import 'dotenv/config';

import { loadConfig } from './config';
import { createSafeLogger } from './logger';
import { buildRouteClients } from './routes';
import { createServer } from './server';

const config = loadConfig();
const logger = createSafeLogger(config.logLevel);
const routeClients = buildRouteClients(config);
const server = createServer({ config, routeClients, logger });

server.listen(config.port, () => {
  logger.info('compas fast relay listening', { port: config.port, routeCount: routeClients.length });
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function shutdown(signal: string): void {
  logger.info('shutdown requested', { signal });
  server.close(() => process.exit(0));
}
