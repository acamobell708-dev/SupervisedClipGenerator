import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ClipDiscoveryService } from '../src/services/clipDiscoveryService.js';
import { CommentUpdates } from '../src/client/commentUpdates.js';
import { getReviewClips, mergeCommentUpdate, applyRefinedClip } from '../src/domain/reviewClips.js';
import { YtDlpClient } from '../src/services/ytDlpClient.js';
import { createApp } from '../src/app.js';

const id = 'M7lc1UVf-VE';
const raw = {duration: 120, heatmap: Array.from({length: 120}, (_, i) => ({start_time:i,end_time:i+1,value:i<18?1:.05}))};
const comments = [{id:'late-comment',text:'0:45 was the best part! More text.',likes:20,author:'Viewer'}];
const tick = () => new Promise(resolve => setImmediate(resolve));

test('comments arriving after the fast wait append to the shortlist without another metadata lookup or speech processing', async t => {
  let finish, commentSignal, metadataCalls = 0;
  const service = new ClipDiscoveryService({commentTimeoutMs: 10, smartEndingService: {register: async result => {
    for (const comment of result.timestampComments) comment.smartEnding = {...comment.smartEnding, status: 'not-needed'};
  }}, ytDlpClient: {getVideo: async () => {metadataCalls++;return raw;},
    getTopComments: (_id,_limit,{signal}) => {commentSignal = signal; return new Promise(resolve => {finish=resolve;});}}});
  t.after(() => service.close());
  const first = await service.analyse(id,{smartEnding:true});
  assert.equal(first.commentsStatus.state,'loading');
  assert.equal(first.timestampComments.length,0);
  assert.equal(commentSignal.aborted,false); // The six-second wait must not cancel retrieval.
  assert.equal((await service.commentsFor(first.commentsStatus.token)).commentsStatus.state,'loading');
  finish(comments); await tick();
  const patch = await service.commentsFor(first.commentsStatus.token);
  assert.equal(patch.commentsStatus.state,'ready');
  assert.equal(patch.timestampComments[0].atSeconds,45);
  assert.equal(patch.sources.sampledCommentCount,1);
  assert.equal(metadataCalls,1);
  const approved = new Set([first.clips[0].id]);
  const refinedReplay = {...getReviewClips(first)[0], endSeconds:17.8};
  const before = applyRefinedClip(first,refinedReplay);
  const merged = mergeCommentUpdate(before,patch,approved);
  assert.equal(merged.clips[0].endSeconds,17.8);
  assert.equal(approved.has(merged.clips[0].id),true);
  const card = getReviewClips(merged).find(clip=>clip.sourceKind==='timestamp-comment');
  assert.equal(card.comment.excerpt,'0:45 was the best part!');
  assert.equal(card.startSeconds,45);
});

test('real retrieval failure is distinct from a valid empty sample, and retry refreshes comments only', async t => {
  let calls=0, metadataCalls=0, cleared=0;
  const service = new ClipDiscoveryService({commentTimeoutMs:10,ytDlpClient:{getVideo:async()=>{metadataCalls++;return raw;},
    getTopComments:async()=>{if(++calls===1) throw new Error('Temporary failure');return comments;},clearComments:()=>{cleared++;}}});
  t.after(()=>service.close());
  const first=await service.analyse(id);
  assert.equal(first.commentsStatus.state,'unavailable');
  assert.match(first.commentsStatus.message,/retrieved/);
  assert.ok(!first.warnings.some(warning=>warning.startsWith('No timestamped')));
  const retry=await service.commentsFor(first.commentsStatus.token,{retry:true});
  assert.equal(retry.commentsStatus.state,'loading');
  await tick();
  const ready=await service.commentsFor(first.commentsStatus.token);
  assert.equal(ready.timestampComments.length,1);
  assert.equal(metadataCalls,1);assert.equal(calls,2);assert.equal(cleared,1);
  service.ytDlp.getTopComments=async()=>[];
  await service.commentsFor(first.commentsStatus.token,{retry:true}); await tick();
  const empty=await service.commentsFor(first.commentsStatus.token);
  assert.equal(empty.commentsStatus.state,'ready');assert.equal(empty.timestampComments.length,0);
});

test('background comment deadline aborts hung retrieval and server shutdown aborts outstanding jobs', async t => {
  let signal;
  const service=new ClipDiscoveryService({commentTimeoutMs:5,commentFetchTimeoutMs:25,
    ytDlpClient:{getVideo:async()=>raw,getTopComments:(_id,_limit,options)=>{signal=options.signal;return new Promise(()=>{});}}});
  t.after(()=>service.close());
  const result=await service.analyse(id);
  await service.commentJobs.get(id).promise;
  assert.equal(signal.aborted,true);
  assert.equal((await service.commentsFor(result.commentsStatus.token)).commentsStatus.state,'unavailable');
  await service.commentsFor(result.commentsStatus.token,{retry:true}); await tick(); service.close(); await tick();
  assert.equal(signal.aborted,true);
});

test('client polling appends delayed comments, deduplicates polling and ignores old-video responses', async () => {
  const updates=[];let calls=0;
  const client=new CommentUpdates({intervalMs:1,onUpdate:patch=>updates.push(patch),fetchImpl:async()=>new Response(JSON.stringify(++calls===1
    ? {commentsStatus:{state:'loading',token:'one'}} : {commentsStatus:{state:'ready',token:'one'},timestampComments:comments,sources:{comments:'yt-dlp-public',sampledCommentCount:1},warnings:[]}))});
  const pending=client.watch('one',{id,durationSeconds:120});
  assert.equal(client.watch('one',{id}),pending);
  await pending;
  assert.equal(updates.at(-1).commentsStatus.state,'ready');assert.equal(updates.at(-1).timestampComments.length,1);
  let finish;
  client.fetchImpl=()=>new Promise(resolve=>{finish=resolve;});
  const old=client.watch('old',{id});client.reset();
  finish(new Response(JSON.stringify({commentsStatus:{state:'ready',token:'old'},timestampComments:comments})));
  await old;
  assert.equal(updates.at(-1).commentsStatus.token,'one');
});

test('comment-only updates preserve approved comment timings and reject stale analysis tokens', () => {
  const result={video:{id,durationSeconds:120},clips:[],timestampComments:[{...comments[0],atSeconds:45,endSeconds:65}],
    commentsStatus:{state:'ready',token:'current'},sources:{comments:'yt-dlp-public'},warnings:[]};
  const card=getReviewClips(result)[0];
  const patch={commentsStatus:{state:'ready',token:'current'},timestampComments:[{...result.timestampComments[0],endSeconds:70}],sources:{comments:'yt-dlp-public'},warnings:[]};
  assert.equal(mergeCommentUpdate(result,patch,new Set([card.id])).timestampComments[0].endSeconds,65);
  assert.equal(mergeCommentUpdate(result,{...patch,commentsStatus:{state:'ready',token:'old'}}),result);
});

test('yt-dlp comments have an independent longer timeout while metadata retains the fast limit', async () => {
  const captured=[];
  const client=new YtDlpClient({timeoutMs:22000,run:async(_binary,_args,options)=>{captured.push(options.timeoutMs);return JSON.stringify({...raw,comments:[]});}});
  await client.getVideo(id);await client.getTopComments(id,100,{timeoutMs:45000});
  assert.deepEqual(captured,[22000,45000]);
});

test('comment polling API returns pending then timestamp cards and supports comments-only retry', async t => {
  let finish;
  const service=new ClipDiscoveryService({commentTimeoutMs:5,ytDlpClient:{getVideo:async()=>raw,
    getTopComments:()=>new Promise(resolve=>{finish=resolve;})}});
  t.after(()=>service.close());
  const server=createApp({service,config:{}}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${base}/api/analyse`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:id})});
  const result=await response.json();
  const url=`${base}/api/analyses/${result.commentsStatus.token}/comments`;
  assert.equal((await fetch(url)).status,202);
  finish(comments);await tick();
  const loaded=await fetch(url);assert.equal(loaded.status,200);assert.equal(loaded.headers.get('cache-control'),'no-store');
  assert.equal((await loaded.json()).timestampComments[0].atSeconds,45);
  assert.equal((await fetch(url,{method:'POST'})).status,202);
  finish([]);
  assert.equal((await fetch(`${base}/api/analyses/unknown/comments`)).status,410);
});
