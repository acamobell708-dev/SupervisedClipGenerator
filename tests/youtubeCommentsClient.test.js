import test from 'node:test';
import assert from 'node:assert/strict';
import {YouTubeCommentsClient} from '../src/services/youtubeCommentsClient.js';

test('public comment reader uses api key, relevance and plainText without OAuth',async()=>{
  let request;
  const client=new YouTubeCommentsClient({apiKey:'dummy-local-test-key',sampleLimit:10,fetchImpl:async (url,options)=>{
    request={url:new URL(url),options};
    return {ok:true,json:async()=>({items:[{id:'thread1',snippet:{topLevelComment:{id:'top1',snippet:{authorDisplayName:'A',textDisplay:'1:23 wow',likeCount:22}}}}]})};
  }});
  const comments=await client.getTopComments('dQw4w9WgXcQ');
  assert.equal(request.url.searchParams.get('videoId'),'dQw4w9WgXcQ');
  assert.equal(request.url.searchParams.get('order'),'relevance');
  assert.equal(request.url.searchParams.get('textFormat'),'plainText');
  assert.equal(request.url.searchParams.get('key'),'dummy-local-test-key');
  assert.equal(request.options.headers,undefined);
  assert.deepEqual(comments,[{id:'top1',author:'A',text:'1:23 wow',likes:22}]);
});
