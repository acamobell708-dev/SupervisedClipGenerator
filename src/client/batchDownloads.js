import { selectionManifest } from './reviewClips.js';

export async function fetchClipBlob(videoId, clip, signal, {subtitles = false} = {}) {
  const response = await fetch('/api/clips/download', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, signal,
    body: JSON.stringify({videoId, startSeconds: clip.startSeconds, endSeconds: clip.endSeconds, ...(subtitles ? {subtitles: true} : {})}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Unable to download this clip. Please retry.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('The downloaded clip was empty. Please retry.');
  return blob;
}

const crcTable = Array.from({length: 256}, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

// Store already-compressed MP4s in one standard ZIP, without recompressing them.
export async function createClipZip(files, signal) {
  const chunks = [], directory = [];
  let offset = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    const name = new TextEncoder().encode(file.name);
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 filenames; compression method 0 (stored).
    header.setUint16(12, 33, true); // 1980-01-01, valid DOS date.
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, file.blob);
    const central = new Uint8Array(46 + name.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 33, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);
    offset += local.length + bytes.length;
  }
  signal?.throwIfAborted();
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directory.reduce((total, entry) => total + entry.length, 0), true);
  footer.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], {type: 'application/zip'});
}

export async function prepareApprovedDownload({result, approved, signal, subtitles = false, onProgress = () => {}, fetchClip = fetchClipBlob}) {
  // Capture approvals once so toggles during preparation cannot alter the batch.
  const manifest = selectionManifest(result, approved);
  manifest.renderOptions = {subtitles};
  if (!manifest.selectedClips.length) throw new Error('Approve at least one clip first.');
  const files = [];
  for (const [index, clip] of manifest.selectedClips.entries()) {
    signal?.throwIfAborted();
    onProgress({index: index + 1, total: manifest.selectedClips.length, clip});
    const blob = await fetchClip(result.video.id, clip, signal, {subtitles});
    signal?.throwIfAborted();
    files.push({name: `${String(index + 1).padStart(2, '0')}-${clip.sourceKind}-${clip.startSeconds}-${clip.endSeconds}${subtitles ? '-subtitled' : ''}.mp4`, blob});
  }
  files.push({name: 'selections.json', blob: new Blob([JSON.stringify(manifest, null, 2)], {type: 'application/json'})});
  onProgress({index: manifest.selectedClips.length, total: manifest.selectedClips.length, packing: true});
  return createClipZip(files, signal);
}
