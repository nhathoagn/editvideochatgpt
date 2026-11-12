# Mã nguồn đầy đủ — Dashboard 2.0

Đọc README_VI.md trước khi cài. Mỗi mục dưới đây là toàn bộ nội dung của một file.


## server/server.js

```js
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {createRequire} = require('node:module');

const PROJECT = process.env.VIDEO_PROJECT || path.resolve(__dirname, '../skill1/03_PROJECT/my-editor');
const requireProject = createRequire(path.join(PROJECT, 'package.json'));
const SCENES = path.join(PROJECT, 'src/scenes.json');
const CONFIG = path.join(PROJECT, 'src/video-config.json');
const OUTPUT = path.join(PROJECT, 'out/video.mp4');
const PORT = Number(process.env.PORT || 3001);
const app = express();
let busy = false;
let job = null;

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
function readScenes() {
  const raw = fs.readFileSync(SCENES, 'utf8');
  const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const scenes = Array.isArray(data) ? data : data.scenes;
  if (!Array.isArray(scenes)) throw fail('scenes.json phải là [...] hoặc {scenes: [...]}');
  const ids = new Set();
  for (const scene of scenes) {
    if (!scene || !['string', 'number'].includes(typeof scene.id) || ids.has(String(scene.id)) ||
      typeof scene.text !== 'string' || !Number.isFinite(scene.start) || !Number.isFinite(scene.end) ||
      scene.start < 0 || scene.end <= scene.start) throw fail('Cảnh sai dữ liệu hoặc trùng ID');
    ids.add(String(scene.id));
  }
  return {data, scenes, revision: hash(raw)};
}
function readConfig() {
  const config = readJson(CONFIG);
  for (const key of ['width', 'height', 'durationInFrames']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw fail(`video-config.json: ${key} không hợp lệ`);
  }
  if (!Number.isFinite(config.fps) || config.fps <= 0) throw fail('fps không hợp lệ');
  return config;
}
function state() {
  const {scenes, revision} = readScenes();
  return {scenes, revision, config: readConfig(), job};
}
function atomicWrite(data) {
  const temp = `${SCENES}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, SCENES);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
const ranges = {
  fontSize: [16, 160], positionX: [0, 100], maxWidth: [20, 100],
  backgroundOpacity: [0, 1], strokeWidth: [0, 8],
};
const enums = {
  fontFamily: ['Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman'],
  effect: ['none', 'fade', 'pop', 'slide'], fontWeight: [400, 700, 900],
};
function cleanPatch(update, config) {
  if (!update || !['string', 'number'].includes(typeof update.id)) throw fail('Thiếu ID cảnh');
  const patch = {};
  const limits = {...ranges, positionY: [0, config.height - 40]};
  for (const [key, value] of Object.entries(update)) {
    if (key === 'id') continue;
    if (key === 'text') {
      if (typeof value !== 'string' || value.length > 10000) throw fail('Lời thoại quá dài hoặc sai kiểu');
    } else if (limits[key]) {
      const [min, max] = limits[key];
      if (!Number.isFinite(value) || value < min || value > max) throw fail(`${key}: cần từ ${min} đến ${max}`);
    } else if (enums[key]) {
      if (!enums[key].includes(value)) throw fail(`${key} không hợp lệ`);
    } else if (['color', 'backgroundColor', 'strokeColor'].includes(key)) {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw fail(`${key}: dùng mã #RRGGBB`);
    } else throw fail(`Không cho phép sửa trường ${key}`);
    patch[key] = value;
  }
  return patch;
}
function saveUpdates(body) {
  const current = readScenes();
  if (body?.revision !== current.revision) {
    throw fail('Dữ liệu đã đổi ở tab/Studio khác. Sao chép lời thoại đang sửa rồi bấm Tải lại.', 409);
  }
  if (!Array.isArray(body.updates)) throw fail('updates phải là mảng');
  const config = readConfig();
  const seen = new Set();
  for (const update of body.updates) {
    const patch = cleanPatch(update, config);
    const id = String(update.id);
    if (seen.has(id)) throw fail(`Trùng cập nhật ${id}`);
    seen.add(id);
    const scene = current.scenes.find((item) => String(item.id) === id);
    if (!scene) throw fail(`Không tìm thấy cảnh ${id}`, 404);
    Object.assign(scene, patch); // Keep timing and unknown metadata unchanged.
  }
  if (body.updates.length) atomicWrite(current.data);
  return state();
}

app.use(express.json({limit: '4mb'}));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // Local API: reject browser requests from other origins, including file://.
  if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) {
    return res.status(403).json({error: 'Host không hợp lệ'});
  }
  const origin = req.headers.origin;
  if (origin && ![`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(origin)) {
    return res.status(403).json({error: 'Origin không hợp lệ'});
  }
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({error: 'Cần Content-Type: application/json'});
  }
  if (busy && req.method !== 'GET') return res.status(409).json({error: 'Server đang xử lý. Vui lòng chờ.'});
  next();
});
app.get('/api/state', (req, res) => res.json(state()));
app.get('/api/scenes', (req, res) => res.json(readScenes().data));
app.get('/api/job', (req, res) => res.json({job}));
app.post('/api/save', (req, res) => res.json(saveUpdates(req.body)));

function startJob(kind, executable, args, onSuccess) {
  busy = true;
  job = {id: crypto.randomUUID(), kind, status: 'running', startedAt: Date.now(), log: ''};
  const active = job;
  let completed = false;
  function finish(error) {
    if (completed) return;
    completed = true;
    if (!error) {
      try {onSuccess?.();} catch (cause) {error = cause;}
    }
    active.status = error ? 'error' : 'done';
    active.error = error ? error.message : null;
    active.finishedAt = Date.now();
    if (!error && kind === 'render') active.output = OUTPUT;
    busy = false;
  }
  try {
    const child = spawn(executable, args, {cwd: PROJECT, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']});
    const log = (chunk) => {active.log = (active.log + chunk.toString()).slice(-6000);};
    child.stdout.on('data', log);
    child.stderr.on('data', log);
    child.on('error', finish);
    child.on('close', (code) => finish(code === 0 ? null : new Error(`Tác vụ kết thúc với mã ${code}. Xem log.`)));
  } catch (error) {finish(error);}
  return active;
}
app.post('/api/render', (req, res) => {
  // Saving and locking happen in one request: another tab cannot edit between them.
  fs.mkdirSync(path.dirname(OUTPUT), {recursive: true});
  if (!fs.existsSync(path.join(PROJECT, 'public/input.mp4'))) throw fail('Thiếu public/input.mp4');
  const cli = path.join(path.dirname(requireProject.resolve('@remotion/cli/package.json')), 'remotion-cli.js');
  const saved = saveUpdates(req.body);
  const tempOutput = path.join(PROJECT, 'out/video-rendering.mp4');
  const active = startJob('render', process.execPath,
    [cli, 'render', 'MyComposition', tempOutput, '--codec=h264'], () => {
      if (!fs.existsSync(tempOutput) || !fs.statSync(tempOutput).size) throw fail('Không tạo được MP4');
      fs.renameSync(tempOutput, OUTPUT);
    });
  res.status(202).json({...saved, job: active});
});
app.post('/api/sync', (req, res) => {
  if (req.body?.revision !== readScenes().revision) throw fail('Dữ liệu đã thay đổi. Hãy tải lại trước khi đồng bộ.', 409);
  const backupDir = path.join(PROJECT, 'out/backups');
  fs.mkdirSync(backupDir, {recursive: true});
  fs.copyFileSync(SCENES, path.join(backupDir, `scenes-${Date.now()}.json`));
  const active = startJob('sync', process.env.PYTHON_EXE || 'python',
    [path.join(PROJECT, 'build_scenes.py')], () => {readScenes();});
  res.status(202).json({job: active});
});
app.get('/download/video.mp4', (req, res, next) => {
  if (!fs.existsSync(OUTPUT)) return res.status(404).send('Chưa có video xuất');
  res.download(OUTPUT, 'video.mp4', (error) => {if (error) next(error);});
});
app.use('/api', (req, res) => res.status(404).json({error: 'API không tồn tại'}));
app.use('/media', express.static(path.join(PROJECT, 'public')));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false, setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));
app.use((error, req, res, next) => {
  console.error(error);
  if (!res.headersSent) res.status(error.status || 500).json({error: error.message});
});

async function main() {
  // Bundle the React dashboard locally; no CDN or separate frontend server required.
  const esbuild = requireProject('esbuild');
  await esbuild.build({
    entryPoints: [path.join(PROJECT, 'dashboard/App.tsx')], bundle: true,
    outfile: path.join(__dirname, 'public/dashboard.js'), platform: 'browser',
    format: 'iife', jsx: 'automatic', target: ['chrome110'], minify: true,
    nodePaths: requireProject.resolve.paths('react') || [],
    define: {'process.env.NODE_ENV': '"production"'},
  });
  state();
  app.listen(PORT, '127.0.0.1', () => console.log(`Dashboard 2.0: http://127.0.0.1:${PORT}`))
    .on('error', (error) => {console.error(error.message); process.exitCode = 1;});
}
if (require.main === module) main().catch((error) => {console.error(error); process.exitCode = 1;});
module.exports = {app, cleanPatch, saveUpdates, readScenes};
```


## server/public/index.html

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Video Dashboard 2.0</title>
  <link rel="stylesheet" href="/dashboard.css">
</head>
<body>
  <div id="root"><p style="padding:24px">Đang tải Dashboard 2.0…</p></div>
  <script src="/dashboard.js" defer></script>
</body>
</html>
```


## server/public/dashboard.css

```css
:root{color-scheme:dark;font-family:Segoe UI,Arial,sans-serif;color:#dce5f3;background:#090f1c;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}button,input,textarea,select{font:inherit}button,a,input,select,textarea{-webkit-tap-highlight-color:transparent}
button{border:1px solid #2d3d56;border-radius:8px;background:#1b2940;color:#e7efff;padding:9px 13px;cursor:pointer;font-size:13px}
button:hover{background:#273b59}button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}
a{color:#7dd3fc;font-size:13px}header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid #25344c;background:#0f192a}
.brand{font-weight:850;letter-spacing:1px;margin-right:auto;display:flex;align-items:center;gap:6px}.brand span{color:#38bdf8}.brand small{font-size:10px;letter-spacing:1.5px;color:#859bb8;margin-left:12px}
.primary{background:#2563eb;border-color:#3977ff;font-weight:650}.primary:hover{background:#3977ff}.badge{font-size:12px;background:#142b34;color:#7ae3cb;border:1px solid #26515b;border-radius:30px;padding:6px 10px}
.status{min-height:38px;display:flex;gap:20px;align-items:center;padding:9px 20px;font-size:12px;color:#8fb5d4;border-bottom:1px solid #25344c;overflow-wrap:anywhere}.status.error{color:#fda4af}
main{height:calc(100dvh - 105px);min-height:500px;display:grid;grid-template-columns:310px minmax(320px,1fr) 280px}
aside,.preview{min-width:0;min-height:0;display:flex;flex-direction:column}aside{background:#0e1727}.script{border-right:1px solid #25344c}.inspector{border-left:1px solid #25344c}
.section-title{min-height:52px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid #25344c;font-size:14px}.section-title span{color:#7e93af;font-size:12px}
.scene-list{overflow-y:auto;padding:12px}.scene{border:1px solid #283950;border-radius:10px;background:#142137;padding:10px;margin-bottom:10px;cursor:pointer;position:relative}
.scene.selected{border-color:#38bdf8;background:#142b43}.scene.playing:before{content:'';position:absolute;left:-7px;top:14px;width:3px;height:20px;background:#34d399;border-radius:2px}
.scene-title{display:flex;width:100%;justify-content:space-between;align-items:center;border:0;padding:3px 0 10px;background:transparent;text-align:left}.scene-title span{font-size:11px;color:#95adc9}.scene-title:hover{background:transparent;color:#7dd3fc}
textarea{width:100%;min-height:94px;resize:vertical;color:#dce5f3;background:#0c1728;border:1px solid #293e59;border-radius:6px;padding:9px;font-size:13px;line-height:1.65}
.preview{background:radial-gradient(ellipse at 50% 30%,#1a2840,#090f1c);overflow-y:auto}.stage-area{display:flex;justify-content:center;align-items:center;padding:14px 16px 8px;min-height:0}.stage-area>div{flex:none;box-shadow:0 20px 70px #0007}
.transport{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:8px}.transport span{font-size:12px;color:#a1b4cd;font-variant-numeric:tabular-nums}.mode-on{color:#7dd3fc;border-color:#1684b1}
.hint{font-size:11px;line-height:1.65;color:#7f95b0;margin:8px 16px;text-align:center}.player-error{background:#451727;color:white;padding:16px;font-size:14px}
fieldset{border:0;margin:0;padding:16px;overflow-y:auto}fieldset>button{width:100%;margin-top:10px;font-size:12px}.control{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;font-size:12px;color:#aebed3}.control>span{display:flex;justify-content:space-between}.control output{color:#75d5f9;font-variant-numeric:tabular-nums}
select{width:100%;padding:8px;border:1px solid #31445e;border-radius:6px;background:#142137;color:#eef5ff;font-size:13px}input[type=range]{width:100%;accent-color:#38bdf8;margin:0}input[type=color]{display:block;width:100%;height:30px;border:1px solid #31445e;border-radius:6px;padding:2px;background:#142137;cursor:pointer}
.color-row{display:flex;gap:12px;margin-bottom:16px}.color-row label{flex:1;min-width:0;font-size:11px;color:#aebed3;line-height:2.2}details{margin:10px 16px;font-size:12px;color:#a1b4cd}pre{max-height:180px;overflow:auto;white-space:pre-wrap;font-size:11px;background:#050a13;padding:10px}
@media(max-width:1080px){main{grid-template-columns:260px minmax(250px,1fr) 240px}.brand small{display:none}header{gap:7px;padding:10px}.brand{font-size:14px}}
@media(max-width:800px){main{display:flex;flex-direction:column;height:auto;min-height:0}.script{max-height:42vh;order:1}.preview{order:0}.inspector{order:2}.stage-area>div{max-width:330px}header{position:static}.section-title{min-height:45px}.badge{display:none}.status{min-height:45px}.scene-list{max-height:33vh}}
```


## skill1/03_PROJECT/my-editor/dashboard/App.tsx

```tsx
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '@remotion/player';
import type {PlayerRef} from '@remotion/player';
import {MyComposition} from '../src/Composition';
import {clamp, defaultStyle, fonts, isActive, sceneFrame, styleOf} from '../src/editor-model';
import type {CaptionStyle, Scene} from '../src/editor-model';

type Config = {width: number; height: number; fps: number; durationInFrames: number};
type Job = {id: string; kind: string; status: string; startedAt: number; log: string; error?: string; output?: string};
type State = {scenes: Scene[]; revision: string; config: Config; job: Job | null};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {cache: 'no-store',
    ...(body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})});
  const raw = await response.text();
  let data;
  try {data = JSON.parse(raw);} catch {throw new Error(`HTTP ${response.status}: phản hồi không phải JSON`);}
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function App() {
  const player = useRef<PlayerRef>(null);
  const working = useRef(true);
  const alive = useRef(true);
  const [config, setConfig] = useState<Config | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [saved, setSaved] = useState<Scene[]>([]);
  const [revision, setRevision] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editMode, setEditMode] = useState(true);
  const [frame, setFrame] = useState(0);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Đang tải cảnh…');
  const [error, setError] = useState(false);
  const [log, setLog] = useState('');
  const [download, setDownload] = useState(false);
  const selected = scenes.find((scene) => String(scene.id) === selectedId);
  const currentStyle = selected ? styleOf(selected) : defaultStyle;
  const dirty = useMemo(() => scenes.filter((scene, index) =>
    JSON.stringify(scene) !== JSON.stringify(saved[index])), [scenes, saved]);

  function accept(data: State) {
    setConfig(data.config); setScenes(data.scenes); setSaved(data.scenes); setRevision(data.revision);
    setSelectedId((id) => data.scenes.some((scene) => String(scene.id) === id) ? id : String(data.scenes[0]?.id ?? ''));
  }
  async function pollJob(id: string) {
    while (alive.current) {
      const {job} = await api<{job: Job | null}>('/api/job');
      if (!job || job.id !== id) throw new Error('Không còn tìm thấy tác vụ. Kiểm tra server và thư mục out.');
      setLog(job.log || '');
      if (job.status === 'error') throw new Error(job.error || 'Tác vụ thất bại; xem log.');
      if (job.status === 'done') {
        if (job.kind === 'render') setDownload(true);
        return job;
      }
      setMessage(`${job.kind === 'render' ? 'Đang xuất MP4' : 'Đang đồng bộ Python'}… ${Math.floor((Date.now() - job.startedAt) / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    throw new Error('Trang đã đóng');
  }
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(false);
    player.current?.pause();
    try {await task();} catch (cause) {setMessage((cause as Error).message); setError(true);}
    finally {working.current = false; setBusy(false);}
  }
  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const data = await api<State>('/api/state');
        accept(data);
        if (data.job?.status === 'running') {
          await pollJob(data.job.id);
          accept(await api<State>('/api/state'));
        }
        setMessage('Sẵn sàng · Chọn một cảnh để nhảy tới đầu câu.');
      } catch (cause) {setMessage((cause as Error).message); setError(true);}
      finally {working.current = false; setBusy(false);}
    })();
    return () => {alive.current = false;};
  }, []);
  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const update = (event: {detail: {frame: number}}) => setFrame(event.detail.frame);
    const playing = () => setEditMode(false);
    instance.addEventListener('frameupdate', update);
    instance.addEventListener('play', playing);
    return () => {instance.removeEventListener('frameupdate', update); instance.removeEventListener('play', playing);};
  }, [config]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty.length || busy) {event.preventDefault(); event.returnValue = '';}
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty.length, busy]);

  const patchScene = useCallback((id: string, patch: Partial<Scene>) => {
    if (working.current) return;
    setScenes((items) => items.map((scene) => String(scene.id) === id ? {...scene, ...patch} : scene));
  }, []);
  const pickCaption = useCallback((id: string) => {
    if (working.current) return;
    player.current?.pause(); setSelectedId(id);
  }, []);
  function chooseScene(scene: Scene) {
    if (busy || !config) return;
    const wanted = sceneFrame(scene, config.fps);
    const target = clamp(wanted, 0, config.durationInFrames - 1);
    player.current?.pause(); player.current?.seekTo(target);
    setFrame(target); setSelectedId(String(scene.id)); setEditMode(true);
    setError(wanted !== target);
    setMessage(wanted !== target ? 'Cảnh nằm ngoài thời lượng Composition. Sửa src/video-config.json rồi khởi động lại server.'
      : `Cảnh ${scene.id} · ${scene.start.toFixed(2)}s → frame ${target}`);
  }
  const inputProps = useMemo(() => ({scenes, videoSrc: '/media/input.mp4',
    editingId: editMode && !busy ? selectedId : undefined,
    onSelect: editMode && !busy ? pickCaption : undefined,
    onChange: editMode && !busy ? patchScene : undefined,
  }), [scenes, selectedId, editMode, busy, pickCaption, patchScene]);

  const updates = () => dirty.map((scene) => ({id: scene.id, text: scene.text, ...styleOf(scene)}));
  function saveAll() {
    void run(async () => {
      setMessage('Đang lưu lời thoại và định dạng…');
      accept(await api<State>('/api/save', {revision, updates: updates()}));
      setMessage('Đã lưu tất cả thay đổi.');
    });
  }
  function renderVideo() {
    void run(async () => {
      setMessage('Đang lưu và bắt đầu xuất MP4…'); setLog(''); setDownload(false);
      const data = await api<State>('/api/render', {revision, updates: updates()});
      accept(data);
      if (!data.job) throw new Error('Không nhận được mã tác vụ');
      const result = await pollJob(data.job.id);
      setMessage(`Hoàn tất! ${result.output}`);
    });
  }
  function reload() {
    if (dirty.length && !confirm('Bỏ các thay đổi chưa lưu và tải lại?')) return;
    void run(async () => {
      const data = await api<State>('/api/state'); accept(data);
      if (data.job?.status === 'running') {await pollJob(data.job.id); accept(await api<State>('/api/state'));}
      setMessage('Đã tải dữ liệu mới nhất.');
    });
  }
  function syncPython() {
    if (!confirm('Python sẽ tạo lại cảnh từ Whisper, thay lời thoại và định dạng. Server sao lưu scenes.json hiện tại vào out/backups. Thay đổi CHƯA LƯU sẽ bị bỏ. Tiếp tục?')) return;
    void run(async () => {
      setMessage('Đang đồng bộ Python…'); setLog('');
      const data = await api<{job: Job}>('/api/sync', {revision});
      await pollJob(data.job.id); accept(await api<State>('/api/state'));
      setMessage('Đồng bộ xong. Bản trước đồng bộ nằm trong out/backups.');
    });
  }
  function changeStyle(patch: Partial<CaptionStyle>) {
    if (selected) patchScene(String(selected.id), patch);
  }
  function slider(label: string, key: keyof CaptionStyle, min: number, max: number, step = 1, unit = '') {
    return <label className="control"><span>{label}<output>{currentStyle[key]}{unit}</output></span>
      <input aria-label={label} type="range" min={min} max={max} step={step}
        value={Number(currentStyle[key])} onChange={(event) => changeStyle({[key]: Number(event.target.value)})} />
    </label>;
  }

  return <>
    <header><div className="brand">VIDEO<span>STUDIO</span><small>LOCAL / 2.0</small></div>
      <span className="badge">{dirty.length ? `${dirty.length} cảnh chưa lưu` : 'Đã lưu'}</span>
      <button disabled={busy} onClick={reload}>↻ Tải lại</button>
      <button disabled={busy || !config} onClick={syncPython}>Đồng bộ Python</button>
      <button disabled={busy || !dirty.length} onClick={saveAll}>Lưu tất cả</button>
      <button className="primary" disabled={busy || !config} onClick={renderVideo}>↗ Xuất MP4</button>
    </header>
    <div className={`status ${error ? 'error' : ''}`} role="status">{message}
      {download && <a href="/download/video.mp4">Tải video.mp4</a>}
    </div>
    <main>
      <aside className="script"><div className="section-title"><strong>Kịch bản</strong><span>{scenes.length} cảnh</span></div>
        <div className="scene-list">{scenes.map((scene) => {
          const id = String(scene.id);
          const active = config && isActive(scene, frame, config.fps);
          const changed = dirty.some((item) => String(item.id) === id);
          return <article key={id} className={`scene ${id === selectedId ? 'selected' : ''} ${active ? 'playing' : ''}`}
            onClick={() => chooseScene(scene)}>
            <button className="scene-title" disabled={busy} onClick={(event) => {event.stopPropagation(); chooseScene(scene);}}>
              <b>{id}{changed ? ' *' : ''}</b><span>{scene.start.toFixed(2)} → {scene.end.toFixed(2)}s</span>
            </button>
            <textarea aria-label={`Lời thoại ${id}`} disabled={busy} value={scene.text}
              onClick={(event) => {event.stopPropagation(); if (id !== selectedId) chooseScene(scene);}}
              onFocus={() => {if (id !== selectedId) chooseScene(scene);}}
              onChange={(event) => patchScene(id, {text: event.target.value})} />
          </article>;
        })}</div>
      </aside>
      <section className="preview"><div className="section-title"><strong>Xem trước</strong>
        <a href="http://127.0.0.1:3000/MyComposition" target="_blank" rel="noreferrer">Mở Studio ↗</a></div>
        <div className="stage-area">{config && <Player ref={player} component={MyComposition}
          inputProps={inputProps} durationInFrames={config.durationInFrames} fps={config.fps}
          compositionWidth={config.width} compositionHeight={config.height}
          controls clickToPlay={false} doubleClickToFullscreen={false}
          spaceKeyToPlayOrPause={false} moveToBeginningWhenEnded={false}
          style={{width: `min(100%, calc((100dvh - 255px) * ${config.width / config.height}))`, borderRadius: 12}}
          errorFallback={({error: cause}) => <div className="player-error">{cause.message}<br />Kiểm tra public/input.mp4 và tải lại trang.</div>}
        />}</div>
        <div className="transport">
          <button disabled={busy || !config} onClick={() => {player.current?.pause(); player.current?.seekTo(Math.max(0, frame - 1));}}>−1 frame</button>
          <span>{config ? (frame / config.fps).toFixed(2) : '0.00'}s · frame {frame}</span>
          <button disabled={busy || !config} onClick={() => {player.current?.pause(); player.current?.seekTo(Math.min((config?.durationInFrames || 1) - 1, frame + 1));}}>+1 frame</button>
          <button className={editMode ? 'mode-on' : ''} disabled={busy || !config}
            onClick={() => {player.current?.pause(); setEditMode(!editMode);}}>{editMode ? '✓ Chỉnh vị trí' : 'Chỉnh vị trí'}</button>
        </div>
        <p className="hint">Kéo chữ để di chuyển · Kéo ô xanh để đổi cỡ chữ.<br />Khi chỉnh vị trí, chữ được hiện rõ. Bấm Play để xem hiệu ứng thật.</p>
        {log && <details><summary>Log tác vụ</summary><pre>{log}</pre></details>}
      </section>
      <aside className="inspector"><div className="section-title"><strong>Định dạng phụ đề</strong><span>{selectedId || '—'}</span></div>
        <fieldset disabled={busy || !selected}>
          <label className="control">Font chữ<select aria-label="Font chữ" value={currentStyle.fontFamily}
            onChange={(event) => changeStyle({fontFamily: event.target.value})}>{fonts.map((font) => <option key={font}>{font}</option>)}</select></label>
          <label className="control">Độ đậm<select aria-label="Độ đậm" value={currentStyle.fontWeight}
            onChange={(event) => changeStyle({fontWeight: Number(event.target.value)})}><option value={400}>Thường</option><option value={700}>Đậm</option><option value={900}>Rất đậm</option></select></label>
          {slider('Cỡ chữ', 'fontSize', 16, 160, 1, ' px')}
          {slider('Vị trí ngang', 'positionX', 0, 100, 0.1, '%')}
          {slider('Cách đáy', 'positionY', 0, (config?.height || 1920) - 40, 1, ' px')}
          {slider('Chiều rộng khung', 'maxWidth', 20, 100, 1, '%')}
          <div className="color-row">{([['Màu chữ', 'color'], ['Màu nền', 'backgroundColor'], ['Màu viền', 'strokeColor']] as const).map(([label, key]) =>
            <label key={key}>{label}<input aria-label={label} type="color" value={currentStyle[key]} onChange={(event) => changeStyle({[key]: event.target.value})} /></label>)}</div>
          {slider('Độ đậm nền', 'backgroundOpacity', 0, 1, 0.05)}
          {slider('Độ dày viền', 'strokeWidth', 0, 8, 0.5, ' px')}
          <label className="control">Hiệu ứng xuất hiện<select aria-label="Hiệu ứng xuất hiện" value={currentStyle.effect}
            onChange={(event) => changeStyle({effect: event.target.value as CaptionStyle['effect']})}>
            <option value="none">Không hiệu ứng</option><option value="fade">Hiện dần</option><option value="pop">Phóng nhẹ</option><option value="slide">Trượt lên</option>
          </select></label>
          <button onClick={() => changeStyle(defaultStyle)}>Đặt lại định dạng cảnh</button>
          <button onClick={() => {
            if (!selected || !confirm('Áp dụng định dạng cảnh này cho tất cả cảnh? Lời thoại và thời gian được giữ nguyên.')) return;
            setScenes((items) => items.map((scene) => ({...scene, ...currentStyle})));
          }}>Áp dụng kiểu này cho tất cả</button>
          <p className="hint">Mỗi cảnh có định dạng riêng. Bấm Lưu tất cả hoặc Xuất MP4 để ghi vào scenes.json.</p>
        </fieldset>
      </aside>
    </main>
  </>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
```


## skill1/03_PROJECT/my-editor/src/Composition.tsx

```tsx
import {useRef} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {
  AbsoluteFill, OffthreadVideo, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate,
} from 'remotion';
import scenesData from './scenes.json';
import {clamp, sceneFrame, styleOf} from './editor-model';
import type {CaptionStyle, Scene} from './editor-model';

type Editing = {
  editingId?: string;
  onSelect?: (id: string) => void;
  onChange?: (id: string, patch: Partial<CaptionStyle>) => void;
};
export type VideoProps = Editing & {scenes?: Scene[]; videoSrc?: string};

const savedScenes: Scene[] = Array.isArray(scenesData) ? scenesData : scenesData.scenes;

function Caption({scene, editingId, onSelect, onChange}: Editing & {scene: Scene}) {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const s = styleOf(scene);
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number; x: number; y: number; scale: number;
    mode: 'move' | 'size'; initial: CaptionStyle;
  } | null>(null);
  const editable = Boolean(onChange);
  const selected = editable && editingId === String(scene.id);
  // The selected caption stays fully visible while positioning it.
  // Play mode and MP4 use the same frame-based animation below.
  const ramp = Math.max(1, Math.min(Math.round(fps * 0.2), Math.floor(durationInFrames / 2)));
  const progress = selected ? 1 : interpolate(frame, [0, ramp], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const alpha = s.effect === 'fade' || s.effect === 'slide' ? progress : 1;
  const zoom = s.effect === 'pop' ? 0.82 + 0.18 * progress : 1;
  const offset = s.effect === 'slide' ? 45 * (1 - progress) : 0;
  const hex = s.backgroundColor;
  const background = `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${s.backgroundOpacity})`;

  function begin(event: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'size') {
    if (!editable || event.button !== 0 || !layer.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(String(scene.id));
    const scale = layer.current.getBoundingClientRect().width / width;
    if (!scale) return;
    drag.current = {pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      scale, mode, initial: s};
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    const dx = (event.clientX - d.x) / d.scale;
    const dy = (event.clientY - d.y) / d.scale;
    onChange?.(String(scene.id), d.mode === 'size'
      ? {fontSize: Math.round(clamp(d.initial.fontSize + dx / 4, 16, 160))}
      : {positionX: +clamp(d.initial.positionX + dx / width * 100, 0, 100).toFixed(2),
          positionY: Math.round(clamp(d.initial.positionY - dy, 0, height - 40))});
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return <AbsoluteFill ref={layer} style={{pointerEvents: 'none'}}>
    <div style={{position: 'absolute', left: `${s.positionX}%`, bottom: s.positionY,
      width: `${s.maxWidth}%`, transform: 'translateX(-50%)', textAlign: 'center'}}>
      <div
        data-caption-id={String(scene.id)}
        onPointerDown={(event) => begin(event, 'move')}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onLostPointerCapture={() => {drag.current = null;}}
        style={{display: 'inline-block', position: 'relative', maxWidth: '100%',
          boxSizing: 'border-box', padding: '16px 24px', borderRadius: 16,
          fontFamily: `${s.fontFamily}, sans-serif`, fontSize: s.fontSize,
          fontWeight: s.fontWeight, color: s.color, backgroundColor: background,
          lineHeight: 1.35, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          WebkitTextStroke: `${s.strokeWidth}px ${s.strokeColor}`, paintOrder: 'stroke fill',
          textShadow: '0 2px 6px rgba(0,0,0,.8)', opacity: alpha,
          transform: `translateY(${offset}px) scale(${zoom})`,
          outline: selected ? '4px solid #38bdf8' : undefined,
          pointerEvents: editable ? 'auto' : 'none',
          cursor: editable ? 'move' : 'default', touchAction: 'none', userSelect: 'none'}}>
        {scene.text || (selected ? 'Nhập lời thoại…' : '')}
        {selected && <div data-resize-handle title="Kéo ngang để đổi cỡ chữ"
          onPointerDown={(event) => begin(event, 'size')}
          onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          style={{position: 'absolute', right: -16, bottom: -16, width: 32, height: 32,
            background: '#38bdf8', border: '3px solid white', borderRadius: 5,
            cursor: 'ew-resize', touchAction: 'none'}} />}
      </div>
    </div>
  </AbsoluteFill>;
}

export const MyComposition = ({scenes = savedScenes, videoSrc,
  editingId, onSelect, onChange}: VideoProps) => {
  const {fps} = useVideoConfig();
  return <AbsoluteFill style={{backgroundColor: '#000'}}>
    <OffthreadVideo src={videoSrc ?? staticFile('input.mp4')} volume={1}
      style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
    {scenes.map((scene) => {
      const from = sceneFrame(scene, fps);
      const duration = Math.round(scene.end * fps) - from;
      if (duration <= 0) return null;
      return <Sequence key={scene.id} name={`Phụ đề ${scene.id}`} from={from}
        durationInFrames={duration} premountFor={fps}>
        <Caption scene={scene} editingId={editingId} onSelect={onSelect} onChange={onChange} />
      </Sequence>;
    })}
  </AbsoluteFill>;
};
```


## skill1/03_PROJECT/my-editor/src/Root.tsx

```tsx
import {Composition} from 'remotion';
import {MyComposition} from './Composition';
import config from './video-config.json';

export const RemotionRoot = () => <Composition
  id="MyComposition" component={MyComposition}
  width={config.width} height={config.height}
  fps={config.fps} durationInFrames={config.durationInFrames}
/>;
```


## skill1/03_PROJECT/my-editor/src/editor-model.ts

```ts
export type CaptionStyle = {
  fontSize: number;
  positionX: number;
  positionY: number;
  maxWidth: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  strokeWidth: number;
  strokeColor: string;
  effect: 'none' | 'fade' | 'pop' | 'slide';
};

export type Scene = Partial<CaptionStyle> & {
  id: string | number;
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
};

export const defaultStyle: CaptionStyle = {
  fontSize: 52, positionX: 50, positionY: 220, maxWidth: 87,
  fontFamily: 'Arial', fontWeight: 700, color: '#ffffff',
  backgroundColor: '#000000', backgroundOpacity: 0.55,
  strokeWidth: 0, strokeColor: '#000000', effect: 'none',
};

export const fonts = ['Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman'];
export const styleOf = (scene: Scene): CaptionStyle => {
  const result = {...defaultStyle};
  for (const key of Object.keys(defaultStyle) as (keyof CaptionStyle)[]) {
    if (scene[key] !== undefined) Object.assign(result, {[key]: scene[key]});
  }
  return result;
};
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function sceneFrame(scene: Scene, fps: number) {
  return Math.round(scene.start * fps);
}

export function isActive(scene: Scene, frame: number, fps: number) {
  return frame >= sceneFrame(scene, fps) && frame < Math.round(scene.end * fps);
}
```


## skill1/03_PROJECT/my-editor/src/video-config.json

```json
{
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationInFrames": 1148
}
```


## setup_v2.bat

```bat
@echo off
setlocal
cd /d "%~dp0skill1\03_PROJECT\my-editor"
if errorlevel 1 goto fail
if not exist "node_modules\remotion\package.json" (
  echo ERROR: Run this file from the EXISTING D:\editvideochatgpt project after copying the upgrade.
  goto fail
)
for /f "delims=" %%V in ('node -p "require('./node_modules/remotion/package.json').version"') do set "REMOTION_VERSION=%%V"
for /f "delims=" %%V in ('node -p "require('./node_modules/react/package.json').version.split('.')[0]"') do set "REACT_MAJOR=%%V"
if not defined REMOTION_VERSION goto fail
if not defined REACT_MAJOR goto fail
call npm install --save-exact @remotion/player@%REMOTION_VERSION%
if errorlevel 1 goto fail
call npm install --save-dev esbuild @types/react-dom@%REACT_MAJOR%
if errorlevel 1 goto fail
call npx tsc --noEmit
if errorlevel 1 goto fail
echo.
echo Setup complete. Start your existing run_dashboard.bat.
pause
exit /b 0
:fail
echo.
echo Setup failed. Read the error above before continuing.
pause
exit /b 1
```
