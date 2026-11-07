import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTopClips, normaliseHeatmap} from '../src/domain/heatmapRanker.js';

test('selects up to five strong, non-overlapping 25-second windows', () => {
  const peaks=[20,65,105,150,195];
  const heatmap=Array.from({length:120},(_,i)=>{
    const center=i*2+1;
    const value=0.08+peaks.reduce((sum,peak,index)=>sum+(0.9-index*.08)*Math.exp(-(((center-peak)/8)**2)),0);
    return {start_time:i*2,end_time:i*2+2,value};
  });
  const clips=selectTopClips(heatmap,240);
  assert.equal(clips.length,5);
  assert.ok(clips[0].replayIntensity >= clips[1].replayIntensity);
  for (let i=0;i<5;i++) {
    assert.equal(clips[i].durationSeconds,25);
    assert.ok(clips[i].startSeconds>=0 && clips[i].endSeconds<=240);
    for(let j=i+1;j<5;j++) assert.ok(clips[i].endSeconds<=clips[j].startSeconds || clips[j].endSeconds<=clips[i].startSeconds);
  }
});
test('missing data cannot fabricate peaks',()=>{
  assert.deepEqual(selectTopClips([],360),[]);
  assert.deepEqual(selectTopClips(null,360),[]);
  assert.deepEqual(selectTopClips([{start_time:20,end_time:10,value:4}],360),[]);
});
test('heatmap rejects invalid rows and clamps to duration',()=>{
  assert.deepEqual(normaliseHeatmap([{start_time:0,end_time:30,value:2}],20),[{start:0,end:20,intensity:1}]);
});
test('video shorter than 5 seconds has no eligible clip',()=>assert.deepEqual(selectTopClips([{start_time:0,end_time:3,value:1}],3),[]));

test('longer windows are rescored so a sustained replay peak beats a shorter isolated spike', () => {
  const heatmap = Array.from({length: 120}, (_, second) => ({start_time: second, end_time: second + 1,
    value: second >= 60 && second < 85 ? 0.8 : second >= 5 && second < 10 ? 1 : 0.01}));
  const [best] = selectTopClips(heatmap, 120);
  assert.equal(best.startSeconds, 60);
  assert.equal(best.endSeconds, 85);
  assert.equal(best.replayIntensity, 0.8);
});

test('window alignments include bucket edges and keep short sources within their actual duration', () => {
  const [best] = selectTopClips([{start_time: 0, end_time: 17, value: 0.1},
    {start_time: 17, end_time: 42, value: 1}, {start_time: 42, end_time: 80, value: 0.1}], 80);
  assert.deepEqual([best.startSeconds, best.endSeconds], [17, 42]);
  const [short] = selectTopClips([{start_time: 0, end_time: 18.06, value: 1}], 18.06);
  assert.equal(short.startSeconds, 0);
  assert.equal(short.endSeconds, 18.06);
  const [capped] = selectTopClips([{start_time: 0, end_time: 80, value: 1}], 80, {clipLength: 90});
  assert.equal(capped.durationSeconds, 30);
});
