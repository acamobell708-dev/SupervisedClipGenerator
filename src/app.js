import express from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFixture } from './services/demoFixture.js';
import { AppError } from './utils/AppError.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp({service, config}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', rateLimit({windowMs: 60_000, limit: 15, standardHeaders:'draft-7', legacyHeaders:false}));
  app.use(express.json({limit:'8kb'}));
  app.get('/api/health', (_req,res) => res.json({
    status:'ok', mode:'localhost',
    keylessDiscovery:true,
    officialCommentApiConfigured: Boolean(config.youtubeApiKey),
    ytDlpExecutable:config.ytDlpPath,
  }));
  app.get('/api/demo', (_req,res) => res.json(demoFixture()));
  app.post('/api/analyse', async (req,res,next) => {
    try {
      if (typeof req.body?.url !== 'string') throw new AppError('Supply a YouTube video URL in the url field.',400,'INVALID_URL');
      const result = await service.analyse(req.body.url);
      res.json(result);
    } catch(error) {next(error);}
  });
  app.use(express.static(publicDir, {index:'index.html', fallthrough:true}));
  app.use('/api', (_req,res) => res.status(404).json({error:'API route not found.',code:'NOT_FOUND'}));
  app.use((error,req,res,_next) => {
    if (req.path.startsWith('/api')) {
      const status = error instanceof AppError ? error.status : 500;
      res.status(status).json({error: status===500?'Unexpected server error.':error.message, code:error.code || 'INTERNAL_ERROR'});
      return;
    }
    res.status(500).send('Server error');
  });
  return app;
}
