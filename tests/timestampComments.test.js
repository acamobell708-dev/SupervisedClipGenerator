import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTimestamps, selectTimestampComments} from '../src/domain/timestampComments.js';

test('parses and validates minute-second and hour-minute-second timestamps',()=>{
  assert.deepEqual(extractTimestamps('At 0:23 then 12:34 then 1:02:03 or 25:99',4000),[23,754,3723]);
  assert.deepEqual(extractTimestamps('A mention of 1:30 in a 1 minute video',60),[]);
});
test('keeps three liked timestamped comments with distinct times',()=>{
  const comments=[
    {id:'x',text:'0:20 amazing',likes:10},
    {id:'y',text:'0:22 near the same',likes:9},
    {id:'z',text:'1:10 great',likes:8},
    {id:'q',text:'2:15 fantastic',likes:7},
    {id:'low',text:'2:49 fun',likes:0},
  ];
  assert.deepEqual(selectTimestampComments(comments,200).map(x=>x.id),['x','z','q']);
});
test('ignores comments dominated by chapter listings',()=>{
  assert.deepEqual(selectTimestampComments([{text:'00:01 00:02 00:03 00:04 00:05',likes:999}],100),[]);
});
