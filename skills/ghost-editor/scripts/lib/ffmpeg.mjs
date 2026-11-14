import { spawnSync, spawn } from 'node:child_process';

export function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const fr = v?.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v?.r_frame_rate;
  const [n, d] = (fr || '0/1').split('/').map(Number);
  return {
    duration: Number(j.format.duration),
    video: v ? { w: v.width, h: v.height, fps: d ? n / d : 0 } : null,
    audio: a ? { rate: Number(a.sample_rate), channels: a.channels } : null,
  };
}

// Run ffmpeg, show a compact progress line, return stderr.
export function run(args, { cwd, label = 'ffmpeg', total } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { cwd });
    let err = '';
    p.stderr.on('data', (b) => {
      const s = b.toString();
      err += s;
      if (err.length > 2e6) err = err.slice(-1e6);
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
      if (m && total && process.stderr.isTTY) {
        const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
        process.stderr.write(`\r  ${label}: ${Math.min(100, (100 * t) / total).toFixed(0)}%   `);
      }
    });
    p.on('close', (code) => {
      if (process.stderr.isTTY && total) process.stderr.write('\r' + ' '.repeat(40) + '\r');
      if (code === 0) resolve(err);
      else reject(new Error(`${label} failed (exit ${code}):\n${err.split('\n').slice(-25).join('\n')}`));
    });
  });
}
