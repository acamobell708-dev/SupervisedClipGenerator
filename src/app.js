import express from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFixture } from './services/demoFixture.js';
import { AppError } from './utils/AppError.js';
import { validateClipDownload } from './services/clipDownloadService.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp({service, downloadService, lowerVideoLibrary, smartEndingService, config}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', rateLimit({windowMs: 60_000, limit: 60, standardHeaders:'draft-7', legacyHeaders:false}));
  app.use(express.json({limit:'8kb'}));
  app.get('/api/health', (_req,res) => res.json({
    status:'ok', mode:'localhost',
    keylessDiscovery:true,
    officialCommentApiConfigured: Boolean(config.youtubeApiKey),
    ytDlpExecutable:config.ytDlpPath,
  }));
  app.get('/api/demo', (req,res,next) => {
    if (req.query.smartEnding !== undefined && !['true','false'].includes(req.query.smartEnding)) {
      return next(new AppError('smartEnding must be true or false.',400,'INVALID_SMART_ENDING_OPTION'));
    }
    res.json(demoFixture({smartEnding: req.query.smartEnding !== 'false'}));
  });
  app.get('/api/lower-videos', async (_req,res,next) => {
    try {
      if (!lowerVideoLibrary) throw new AppError('Lower videos are unavailable. Restart the app.', 503, 'LOWER_VIDEO_UNAVAILABLE');
      res.set('Cache-Control', 'no-store').json(await lowerVideoLibrary.catalogue());
    } catch (error) { next(error); }
  });
  app.post('/api/analyse', async (req,res,next) => {
    const controller = new AbortController();
    const onClose = () => {if (!res.writableFinished) controller.abort();};
    res.once('close', onClose);
    try {
      if (typeof req.body?.url !== 'string') throw new AppError('Supply a YouTube video URL in the url field.',400,'INVALID_URL');
      if (req.body.smartEnding !== undefined && typeof req.body.smartEnding !== 'boolean') throw new AppError('smartEnding must be true or false.',400,'INVALID_SMART_ENDING_OPTION');
      const result = await service.analyse(req.body.url, {smartEnding: req.body.smartEnding ?? true, signal: controller.signal});
      if (!controller.signal.aborted) {
        if (result.timings) res.set('Server-Timing', Object.entries(result.timings).filter(([, value]) => Number.isFinite(value)).map(([name,value]) => `${name};dur=${value}`).join(', '));
        res.set('Cache-Control', 'no-store').json(result);
      }
    } catch(error) {if (!res.destroyed) next(error);}
    finally {res.off('close', onClose);}
  });
  app.post('/api/clips/refine-ending', rateLimit({windowMs: 60000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false}), async (req,res,next) => {
    const controller = new AbortController();
    const onClose = () => {if (!res.writableFinished) controller.abort();};
    res.once('close', onClose);
    try {
      if (!smartEndingService) throw new AppError('Ending checks are unavailable. Restart the app.', 503, 'ENDING_CHECK_UNAVAILABLE');
      const result = await smartEndingService.refineToken(req.body?.token, {signal: controller.signal});
      if (!controller.signal.aborted) res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {if (!res.destroyed) next(error);}
    finally {res.off('close', onClose);}
  });
  for (const method of ['get','post']) app[method]('/api/analyses/:token/comments', async (req,res,next) => {
    const controller = new AbortController();
    const onClose = () => {if (!res.writableFinished) controller.abort();};
    res.once('close', onClose);
    try {
      const patch = await service.commentsFor(req.params.token, {retry: method === 'post', signal: controller.signal});
      if (!controller.signal.aborted) res.status(patch.commentsStatus.state === 'loading' ? 202 : 200).set('Cache-Control','no-store').json(patch);
    } catch (error) {if (!res.destroyed) next(error);}
    finally {res.off('close', onClose);}
  });
  app.post('/api/clips/download', async (req,res,next) => {
    const controller = new AbortController();
    const onClose = () => { if (!res.writableFinished) controller.abort(); };
    res.once('close', onClose);
    let clip;
    try {
      const selection = validateClipDownload(req.body);
      if (!downloadService) throw new AppError('Test downloads are unavailable. Restart the app.', 503, 'DOWNLOAD_UNAVAILABLE');
      clip = await downloadService.prepare(selection, {signal: controller.signal});
      if (controller.signal.aborted) return;
      res.set('Cache-Control', 'no-store');
      if (clip.lowerVideo) res.set('X-Lower-Video', encodeURIComponent(JSON.stringify(clip.lowerVideo)));
      await new Promise((resolve, reject) => {
        res.download(clip.filePath, clip.filename, error => error ? reject(error) : resolve());
      });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) next(error);
    } finally {
      res.off('close', onClose);
      if (clip) await clip.cleanup();
    }
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
