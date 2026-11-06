import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTopClips, normaliseHeatmap} from '../src/domain/heatmapRanker.js';

test('selects up to five strong, non-overlapping ten-second windows', () => {
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
    assert.equal(clips[i].durationSeconds,10);
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
