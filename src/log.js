import pino from 'pino';

// One structured JSON logger for the whole app. Render keeps stdout as the service log.
// Photos, cookies and tokens are never logged.
export const log = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT ? 'silent' : 'info'),
  redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  base: { app: 'beanstalk' },
});
