import { selectTopClips } from '../domain/heatmapRanker.js';
import { selectTimestampComments } from '../domain/timestampComments.js';

/** Synthetic offline example. Never display as actual YouTube evidence. */
export function demoFixture() {
  const videoId = 'M7lc1UVf-VE';
  const durationSeconds = 240;
  const peaks = [23, 74, 118, 165, 214];
  const heatmap = Array.from({length: 120}, (_,index) => {
    const at = index * 2;
    const value = Math.min(1, 0.14 + peaks.reduce((sum,peak,rank) => sum + (0.86 - rank * 0.075) * Math.exp(-(((at-peak)/8)**2)), 0));
    return {start_time: at, end_time: at+2, value};
  });
  const comments = [
    {id:'demo1', author:'Demo commenter A', text:'The moment at 0:23 was the highlight!', likes: 921},
    {id:'demo2', author:'Demo commenter B', text:'1:14 is my favourite bit.', likes: 547},
    {id:'demo3', author:'Demo commenter C', text:'I came back for 2:45 again.', likes: 311},
  ];
  return {
    status:'demo', generatedAt: new Date().toISOString(),
    video:{id:videoId, url:`https://www.youtube.com/watch?v=${videoId}`, title:'Example video — synthetic replay and comment data', channel:'Offline demo / not real analytics', durationSeconds, thumbnail:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, viewCount:null, embeddable:true},
    clips:selectTopClips(heatmap,durationSeconds).map(clip=>({...clip,url:`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(clip.startSeconds)}s`})),
    timestampComments:selectTimestampComments(comments,durationSeconds).map(c=>({...c,url:`https://www.youtube.com/watch?v=${videoId}&t=${c.atSeconds}s`})),
    sources:{replay:'synthetic-demo',comments:'synthetic-demo',sampledCommentCount:3,accuracy:'Demonstration data only. Not YouTube replay or comment measurements.'},
    warnings:['DEMO MODE: Heatmap, clips and comments are synthetic. Use Analyse video to get real public YouTube data.'],
  };
}
