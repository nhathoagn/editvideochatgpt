const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {createRequire} = require('node:module');

const PROJECT = process.env.VIDEO_PROJECT || path.resolve(__dirname, '../remotion-engine');
const requireProject = createRequire(path.join(PROJECT, 'package.json'));
const SCENES = path.join(PROJECT, 'src/scenes.json');
const CONFIG = path.join(PROJECT, 'src/video-config.json');
const OUTPUT = path.resolve(__dirname, '../../05_FINAL/video.mp4');
const PORT = Number(process.env.PORT || 3001);
const app = express();
app.use(express.static(path.join(__dirname, '../web-dashboard/public')));
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

function main() {
  state();
  app.listen(PORT, '127.0.0.1', () => console.log(`Dashboard Studio 2.1: http://127.0.0.1:${PORT}`))
    .on('error', (error) => {console.error(error.message); process.exitCode = 1;});
}
if (require.main === module) {
  try {main();} catch (error) {console.error(error); process.exitCode = 1;}
}
module.exports = {app, cleanPatch, saveUpdates, readScenes};