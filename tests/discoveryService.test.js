import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipDiscoveryService} from '../src/services/clipDiscoveryService.js';
import {demoFixture} from '../src/services/demoFixture.js';

const id='dQw4w9WgXcQ';
test('service returns real-source clips, public comment evidence, no tokens',async()=>{
  const ytDlpClient={getVideo:async()=>({title:'Mock video',duration:90,view_count:10,heatmap:Array.from({length:90},(_,i)=>({start_time:i,end_time:i+1,value:i/90}))}),getTopComments:async()=>[{id:'x',text:'0:45',likes:7}]};
  const service=new ClipDiscoveryService({ytDlpClient,commentsClient:{apiKey:'',getTopComments:async()=>{throw new Error('Not expected');}}, now:()=>new Date('2026-11-06T00:00:00Z')});
  const result=await service.analyse(`https://youtu.be/${id}`);
  assert.equal(result.video.id,id);
  assert.equal(result.sources.comments,'yt-dlp-public');
  assert.equal(result.timestampComments[0].atSeconds,45);
  assert.ok(result.clips.length>0 && result.clips.length<=5);
  assert.ok(result.clips.every(clip => clip.durationSeconds === 25));
  assert.ok(result.warnings.some(warning => warning.includes('target 25 seconds')));
  assert.equal(result.generatedAt,'2026-11-06T00:00:00.000Z');
});
test('missing heatmap and failing comments are explicitly unavailable',async()=>{
  const service=new ClipDiscoveryService({ytDlpClient:{getVideo:async()=>({duration:120,title:'Missing'}),getTopComments:async()=>{throw new Error('Blocked');}}});
  const result=await service.analyse(id);
  assert.deepEqual(result.clips,[]);
  assert.equal(result.sources.comments,'unavailable');
  assert.ok(result.warnings.some(x=>x.includes('Most Replayed')));
});
test('demo fixture is unmistakeably synthetic and has five clip previews',()=>{
  const fixture=demoFixture();
  assert.equal(fixture.status,'demo');
  assert.equal(fixture.clips.length,5);
  assert.equal(fixture.timestampComments.length,3);
  assert.equal(fixture.sources.replay,'synthetic-demo');
});
