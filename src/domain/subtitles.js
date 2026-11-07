import { AppError } from '../utils/AppError.js';
import { MAIN_PANEL_HEIGHT } from './lowerVideos.js';

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function safeText(text) {
  // Prevent transcript text from becoming ASS override commands or forced newlines.
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\\/g, '＼').replace(/{/g, '｛').replace(/}/g, '｝').trim();
}

export function buildSubtitleAss(transcript, duration, {mapTime = seconds => seconds, portraitSafeArea = false, lowerVideo = false} = {}) {
  const width = Number(transcript.width), height = Number(transcript.height);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || !Array.isArray(transcript.words)) {
    throw new AppError('The local transcript is invalid. Please retry.', 502, 'SUBTITLES_INVALID');
  }
  const contentHeight = lowerVideo ? MAIN_PANEL_HEIGHT : height;
  const fontSize = Math.max(14, Math.round(contentHeight * 0.055));
  const horizontalMarginRatio = portraitSafeArea ? 0.12 : 0.08;
  const maxCharacters = Math.max(12, Math.min(42, Math.floor(width * (1 - horizontalMarginRatio * 2) / (fontSize * 0.6))));
  const cues = [];
  let words = [], start = 0, end = 0;
  const flush = () => { if (words.length) cues.push({start, end, text: words.join(' ')}); words = []; };
  for (const word of transcript.words.filter(word => word && typeof word === 'object').sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) continue;
    const text = safeText(word.text);
    const from = Math.max(0, word.start), to = Math.min(duration, word.end);
    if (!text || to <= from || Math.round(to * 100) <= Math.round(from * 100)) continue;
    if (words.length && (words.length >= 6 || [...words, text].join(' ').length > maxCharacters || from - end > 0.45 || to - start > 2.5)) flush();
    if (!words.length) start = Math.max(from, cues.at(-1)?.end ?? 0);
    if (to <= start) continue;
    words.push(text);
    end = to;
    if (/[.!?。！？]$/.test(text)) flush();
  }
  flush();
  if (!cues.length) throw new AppError('No speech was detected. Turn off white subtitles to download the original clip.', 422, 'SUBTITLES_NO_SPEECH');
  const margin = Math.round(width * horizontalMarginRatio);
  const bottom = lowerVideo ? height - MAIN_PANEL_HEIGHT + 60 : Math.round(height * (portraitSafeArea ? 0.16 : 0.07));
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(height * 0.004))},1,2,${margin},${margin},${bottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.map(cue => `Dialogue: 0,${assTime(mapTime(cue.start))},${assTime(mapTime(cue.end))},Default,,0,0,0,,${cue.text}`).join('\n')}
`;
}
