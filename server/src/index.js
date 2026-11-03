import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './db.js';
import { authenticate } from './auth.js';
import { HttpError } from './http.js';
import { runMigrations } from './migrate.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import providerRoutes from './routes/providers.js';
import storyRoutes from './routes/stories.js';
import studentRoutes from './routes/students.js';
import { encryptSecret } from './security.js';
import { startScheduler } from './scheduler.js';

const port = Number(process.env.PORT || 3001);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use((request, _response, next) => {
    request.body ||= {};
    next();
  });
  app.use(cookieParser());
  app.use((request, _response, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin) {
      if (request.headers.origin !== clientOrigin) {
        next(new HttpError(403, 'מקור הבקשה אינו מורשה.'));
        return;
      }
    }
    next();
  });

  app.get('/api/health', async (_request, response) => {
    try {
      await pool.query('SELECT 1');
      response.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error('Database health check failed:', error);
      response.status(503).json({
        status: 'error',
        database: 'disconnected',
        message: 'מסד הנתונים אינו זמין. בדקו את החיבור ואת הגדרות הסביבה.',
      });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/students', studentRoutes);
  app.use('/api/stories', storyRoutes);
  app.use('/api/admin', authenticate, adminRoutes);
  app.use('/api/admin/ai-providers', authenticate, providerRoutes);

  app.use((_request, _response, next) => {
    next(new HttpError(404, 'הכתובת המבוקשת לא נמצאה.'));
  });

  app.use((error, _request, response, _next) => {
    if (error.code === 'ER_DUP_ENTRY') {
      response.status(409).json({ message: 'רשומה עם פרטים אלה כבר קיימת.' });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ message: 'גוף הבקשה אינו JSON תקין.' });
      return;
    }
    if (error.status) {
      response.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Unhandled API request error:', error);
    response.status(500).json({ message: 'אירעה שגיאה בשרת. נסו שוב מאוחר יותר.' });
  });

  return app;
}

function validateConfiguration() {
  if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD || !process.env.MYSQL_DATABASE) {
    throw new Error('Set MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE in the project .env file.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  let origin;
  try {
    origin = new URL(clientOrigin);
  } catch {
    throw new Error('CLIENT_ORIGIN must be a valid localhost or HTTPS origin.');
  }
  if (
    origin.origin !== clientOrigin
    || (origin.protocol !== 'https:' && origin.hostname !== 'localhost' && origin.hostname !== '127.0.0.1')
    || origin.username || origin.password
  ) {
    throw new Error('CLIENT_ORIGIN must be a localhost or HTTPS origin.');
  }
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  }
  encryptSecret('startup configuration validation');
}

let server;
let stopScheduler;
let shuttingDown = false;

async function shutDown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopScheduler?.();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    await pool.end();
    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to close the database pool:', error);
    process.exitCode = 1;
  }
}

async function start() {
  validateConfiguration();
  await pool.query('SELECT 1');
  await runMigrations();
  server = createApp().listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });
  stopScheduler = startScheduler();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', shutDown);
  process.on('SIGTERM', shutDown);

  start().catch(async (error) => {
    console.error('Failed to start the API server:', error);
    try {
      await pool.end();
    } catch (shutdownError) {
      console.error('Failed to close the database pool:', shutdownError);
    }
    process.exitCode = 1;
  });
}
