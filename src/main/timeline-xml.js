// Kolbo Studio - FCP7 XML (xmeml v5) timeline writer.
// Imports into Premiere Pro and DaVinci Resolve. One video track per camera,
// one audio track group per file, linked so clips move together.

const path = require('path');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pathUrl(file) {
  const abs = path.resolve(file).replace(/\\/g, '/');
  const encoded = abs.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
  return 'file://localhost/' + encoded.replace(/^\//, '');
}

const rate = (fps) => {
  const ntsc = Math.abs(fps - Math.round(fps)) > 1e-3;
  return `<rate><timebase>${Math.round(fps)}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
};

/**
 * @param {{ name: string, fps?: number, items: Array<{file, info, offset, synced}> }} seq
 *   items are the synced items from audio-sync-handler.analyze(); unsynced ones are skipped.
 * @returns {string} xml
 */
function buildXmeml(seq) {
  const items = seq.items.filter((i) => i.synced && i.info);
  const firstVideo = items.find((i) => i.info.hasVideo);
  const fps = seq.fps || (firstVideo && firstVideo.info.fps) || 25;
  const minOffset = Math.min(...items.map((i) => i.offset));
  const w = firstVideo ? firstVideo.info.width : 1920, h = firstVideo ? firstVideo.info.height : 1080;

  let clipId = 0;
  let videoTracks = '', audioTracks = '', seqEnd = 0;

  items.forEach((it, fileIdx) => {
    const clipFps = it.info.hasVideo && it.info.fps ? it.info.fps : fps;
    const start = Math.round((it.offset - minOffset) * fps);
    const seqDur = Math.round(it.info.duration * fps);
    const clipDur = Math.round(it.info.duration * clipFps);
    seqEnd = Math.max(seqEnd, start + seqDur);
    const fileId = `file-${fileIdx + 1}`;
    const name = path.basename(it.file);
    const chans = Math.max(1, Math.min(it.info.channels || 1, 2));

    const fileDef = `<file id="${fileId}"><name>${esc(name)}</name><pathurl>${esc(pathUrl(it.file))}</pathurl>${rate(clipFps)}<duration>${clipDur}</duration><media>` +
      (it.info.hasVideo ? `<video><samplecharacteristics>${rate(clipFps)}<width>${it.info.width}</width><height>${it.info.height}</height></samplecharacteristics></video>` : '') +
      `<audio><samplecharacteristics><depth>16</depth><samplerate>${it.info.sampleRate || 48000}</samplerate></samplecharacteristics><channelcount>${chans}</channelcount></audio></media></file>`;
    const fileRef = `<file id="${fileId}"/>`;

    // ids for linking
    const ids = { video: it.info.hasVideo ? `clipitem-${++clipId}` : null, audio: [] };
    for (let c = 0; c < chans; c++) ids.audio.push(`clipitem-${++clipId}`);
    const members = [...(ids.video ? [{ id: ids.video, type: 'video', ti: 1 }] : []), ...ids.audio.map((id, c) => ({ id, type: 'audio', ti: c + 1 }))];
    const links = members.map((m) => `<link><linkclipref>${m.id}</linkclipref><mediatype>${m.type}</mediatype><trackindex>${m.ti}</trackindex><clipindex>1</clipindex>${m.type === 'audio' ? '<groupindex>1</groupindex>' : ''}</link>`).join('');

    const clip = (id, fileXml, extra) => `<clipitem id="${id}"><name>${esc(name)}</name><duration>${clipDur}</duration>${rate(clipFps)}<start>${start}</start><end>${start + seqDur}</end><in>0</in><out>${clipDur}</out>${fileXml}${extra}${links}</clipitem>`;

    let first = true;
    const nextFile = () => { const x = first ? fileDef : fileRef; first = false; return x; };
    if (ids.video) videoTracks += `<track>${clip(ids.video, nextFile(), '')}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
    ids.audio.forEach((id, c) => {
      audioTracks += `<track>${clip(id, nextFile(), `<sourcetrack><mediatype>audio</mediatype><trackindex>${c + 1}</trackindex></sourcetrack>`)}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5"><sequence id="sequence-1"><name>${esc(seq.name)}</name><duration>${seqEnd}</duration>${rate(fps)}<timecode>${rate(fps)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><format><samplecharacteristics>${rate(fps)}<width>${w}</width><height>${h}</height></samplecharacteristics></format>${videoTracks}</video><audio><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>${audioTracks}</audio></media></sequence></xmeml>
`;
}

module.exports = { buildXmeml, pathUrl };
