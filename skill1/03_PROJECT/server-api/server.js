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
const FINAL_DIR = path.resolve(__dirname, '../../05_FINAL');
const PORT = Number(process.env.PORT || 3001);
const app = express();
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);

const SKILL_DIR = path.resolve(__dirname, '../../');
const SOURCE_DIR = path.join(SKILL_DIR, '01_SOURCE');
const PROJECTS_DIR = path.join(SKILL_DIR, '00_SHARED_WORKSPACE', 'projects');
const ACTIVE_PROJECT_FILE = path.join(
  SKILL_DIR, '00_SHARED_WORKSPACE', 'active-project.json'
);

// Tự động tạo thư mục nếu chưa có
fs.mkdirSync(SOURCE_DIR, {recursive: true});
fs.mkdirSync(PROJECTS_DIR, {recursive: true});

// Hàm tạo đường dẫn an toàn cho project
function projectDir(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error('projectId không hợp lệ'); // Dùng new Error thay cho fail() nếu bạn chưa có hàm fail()
  }
  return path.join(PROJECTS_DIR, id);
}
function projectOutput(id) {
  projectDir(id); // Dùng lại kiểm tra ID hiện có.
  return path.join(FINAL_DIR, id, 'video.mp4');
}

function projectDownloadUrl(id) {
  return `/download/projects/${encodeURIComponent(id)}/video.mp4`;
}

app.use(express.static(path.join(__dirname, '../web-dashboard/public')));
let busy = false;
let job = null;

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
function readScenes(file = SCENES) {
  const raw = fs.readFileSync(file, 'utf8');
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
function readConfig(file = CONFIG) {
  const config = readJson(file);
  for (const key of ['width', 'height', 'durationInFrames']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw fail(`video-config.json: ${key} không hợp lệ`);
  }
  if (!Number.isFinite(config.fps) || config.fps <= 0) throw fail('fps không hợp lệ');
  return config;
}
function activeProjectId() {
  if (!fs.existsSync(ACTIVE_PROJECT_FILE)) return null;
  const {id} = readJson(ACTIVE_PROJECT_FILE);
  projectDir(id); // Kiểm tra ID trước khi sử dụng.
  return id;
}

function projectState(id) {
  const dir = projectDir(id);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw fail('Không tìm thấy dự án', 404);
  }

  const raw = fs.readFileSync(path.join(dir, 'scenes.json'), 'utf8');
  const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const scenes = Array.isArray(data) ? data : data.scenes;
  if (!Array.isArray(scenes)) throw fail('Dữ liệu cảnh không hợp lệ');

  return {
    project: readJson(manifestPath),
    scenes,
    revision: hash(raw),
    config: readJson(path.join(dir, 'config.json')),
    mediaPath: `/media/projects/${id}`,
    downloadUrl: fs.existsSync(projectOutput(id)) ? projectDownloadUrl(id) : null,
    job,
  };
}
function state() {
  const id = activeProjectId();
  if (id) return projectState(id);

  return {
    project: null,
    scenes: [],
    revision: '',
    config: readConfig(),
    mediaPath: null,
    job,
  };
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
  const projectId = activeProjectId();
  if (!projectId || body?.projectId !== projectId) {
    throw fail('Dự án đang mở đã thay đổi. Hãy tải lại Dashboard.', 409);
  }

  const dir = projectDir(projectId);
  const scenesFile = path.join(dir, 'scenes.json');
  const current = readScenes(scenesFile);

  if (body.revision !== current.revision) {
    throw fail(
      'Phụ đề đã thay đổi ở tab khác. Sao chép phần đang sửa rồi bấm Tải lại.',
      409
    );
  }

  if (!Array.isArray(body.updates)) {
    throw fail('updates phải là mảng');
  }

  const config = readConfig(path.join(dir, 'config.json'));
  const scenesById = new Map(current.scenes.map(scene => [String(scene.id), scene]));
  const seen = new Set();

  for (const update of body.updates) {
    const patch = cleanPatch(update, config);
    const id = String(update.id);

    if (seen.has(id)) throw fail(`Trùng cập nhật ${id}`);
    seen.add(id);

    const scene = scenesById.get(id);
    if (!scene) throw fail(`Không tìm thấy cảnh ${id}`, 404);
    Object.assign(scene, patch);
  }

  if (body.updates.length > 0) {
    const temp = `${scenesFile}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(current.data, null, 2) + '\n', 'utf8');
      fs.renameSync(temp, scenesFile);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }

  return projectState(projectId);
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

app.get('/api/active-project', (req, res) => {
  res.json({id: activeProjectId()});
});

app.post('/api/active-project', (req, res) => {
  const data = projectState(req.body?.id);
  const sourceFile = data.project.sourceFile;

  if (
    typeof sourceFile !== 'string' ||
    path.basename(sourceFile) !== sourceFile ||
    !fs.existsSync(path.join(SOURCE_DIR, sourceFile))
  ) {
    throw fail('Không tìm thấy video nguồn trong 01_SOURCE', 404);
  }

  const temp = `${ACTIVE_PROJECT_FILE}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({id: data.project.id}), 'utf8');
    fs.renameSync(temp, ACTIVE_PROJECT_FILE);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }

  res.json(state());
});
app.get('/api/state', (req, res) => res.json(state()));
app.get('/api/scenes', (req, res) => {res.json({scenes: state().scenes});});
app.get('/api/job', (req, res) => res.json({job}));
app.post('/api/save', (req, res) => res.json(saveUpdates(req.body)));
app.get('/api/sources', (req, res) => {
  const files = fs.readdirSync(SOURCE_DIR, {withFileTypes: true})
    .filter((item) => item.isFile())
    .filter((item) => /\.(mp4|mov|mkv|webm)$/i.test(item.name))
    .map((item) => ({name: item.name}));

  res.json({files});
});
app.post('/api/projects', async (req, res, next) => {
  let dir;
  try {
    const file = req.body?.file;
    const available = fs.readdirSync(SOURCE_DIR, {withFileTypes: true});
    if (typeof file !== 'string' || !available.some(
      item => item.isFile() && item.name === file
    )) throw fail('Video nguồn không tồn tại', 404);

    const source = path.join(SOURCE_DIR, file);
    const {stdout} = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
      '-of', 'json', source
    ], {windowsHide: true, timeout: 15000});

    const metadata = JSON.parse(stdout);
    const seconds = Number(metadata.format?.duration);
    if (!metadata.streams?.some(s => s.codec_type === 'video') ||
        !Number.isFinite(seconds) || seconds <= 0) {
      throw fail('Không đọc được video hoặc thời lượng');
    }

    const id = crypto.randomUUID();
    dir = projectDir(id);
    fs.mkdirSync(dir);
    const files = {
      'manifest.json': {id, sourceFile: file, createdAt: new Date().toISOString()},
      'transcript.json': {segments: []},
      'scenes.json': {scenes: []},
      'config.json': {
        width: 1080, height: 1920, fps: 30,
        durationInFrames: Math.ceil(seconds * 30)
      }
    };
    for (const [name, data] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
    }
    res.status(201).json({id, sourceFile: file});
  } catch (error) {
    next(error);
  }
});
app.get('/api/projects/:id', (req, res) => {
  const dir = projectDir(req.params.id);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Không tìm thấy dự án');

  const manifest = readJson(manifestPath); // Đảm bảo bạn đã có hàm readJson() đọc file
  res.json({
    project: manifest,
    scenes: readJson(path.join(dir, 'scenes.json')).scenes,
    config: readJson(path.join(dir, 'config.json')),
    mediaPath: `/media/projects/${req.params.id}`
  });
});

function removeRenderTemps(files) {
  for (const file of files) {
    try {
      fs.rmSync(file, {force: true});
    } catch (error) {
      console.warn(`Không dọn được file tạm ${path.basename(file)}: ${error.message}`);
    }
  }
}

function startJob(kind, executable, args, onSuccess, temporaryFiles = []) {
  busy = true;
  job = {id: crypto.randomUUID(), kind, status: 'running', startedAt: Date.now(), log: ''};
  const active = job;
  let completed = false;
  function finish(error) {
    if (completed) return;
    completed = true;
    if (!error) {
      try {
        onSuccess?.(active);
      } catch (cause) {
        error = cause;
      }
    }

    removeRenderTemps(temporaryFiles);
    active.status = error ? 'error' : 'done';
    active.error = error ? error.message : null;
    active.finishedAt = Date.now();
    busy = false;
  }
  try {
    const child = spawn(executable, args, {cwd: PROJECT, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const log = (chunk) => {active.log = (active.log + chunk.toString()).slice(-6000);};
    child.stdout.on('data', log);
    child.stderr.on('data', log);
    child.on('error', finish);
    child.on('close', (code) => finish(code === 0 ? null : new Error(`Tác vụ kết thúc với mã ${code}. Xem log.`)));
  } catch (error) {finish(error);}
  return active;
}
app.post('/api/render', (req, res) => {
  // saveUpdates kiểm tra projectId và revision trước khi ghi.
  const saved = saveUpdates(req.body);
  const projectId = req.body.projectId;
  const sourceFile = saved.project.sourceFile;

  if (typeof sourceFile !== 'string' ||
      !sourceFile ||
      path.basename(sourceFile) !== sourceFile) {
    throw fail('Tên video trong manifest không hợp lệ.');
  }

  const source = path.join(SOURCE_DIR, sourceFile);
  if (!fs.statSync(source, {throwIfNoEntry: false})?.isFile()) {
    throw fail('Không tìm thấy video nguồn trong 01_SOURCE.', 404);
  }

  const cliPackage = requireProject.resolve('@remotion/cli/package.json');
  const cli = path.join(path.dirname(cliPackage), 'remotion-cli.js');
  const output = projectOutput(projectId);
  const outputDir = path.dirname(output);
  fs.mkdirSync(outputDir, {recursive: true});

  const suffix = crypto.randomUUID();
  const propsFile = path.join(outputDir, `.render-${suffix}.json`);
  const tempOutput = path.join(outputDir, `.render-${suffix}.mp4`);

  const {width, height, fps, durationInFrames} = saved.config;
  const props = {
    videoSrc: new URL(saved.mediaPath, `http://127.0.0.1:${PORT}`).href,
    scenes: saved.scenes,
    renderConfig: {width, height, fps, durationInFrames},
  };

  try {
    fs.writeFileSync(propsFile, JSON.stringify(props), 'utf8');
  } catch (error) {
    removeRenderTemps([propsFile]);
    throw error;
  }

  const active = startJob(
    'render',
    process.execPath,
    [cli, 'render', 'MyComposition', tempOutput, '--codec=h264', `--props=${propsFile}`],
    (finishedJob) => {
      const file = fs.statSync(tempOutput, {throwIfNoEntry: false});
      if (!file?.isFile() || file.size === 0) {
        throw fail('Remotion chưa tạo được file MP4.', 500);
      }

      fs.renameSync(tempOutput, output);
      finishedJob.output = output;
      finishedJob.downloadUrl = projectDownloadUrl(projectId);
    },
    [propsFile, tempOutput]
  );

  active.projectId = projectId;
  res.status(202).json({...saved, job: active});
});
// Hai endpoint dùng chung một luồng bóc băng.
app.post(['/api/transcribe', '/api/sync'], (req, res) => {
  const id = activeProjectId();
  if (!id) throw fail('Hãy chọn và mở một dự án trước.', 400);

  // Tránh tab cũ yêu cầu xử lý nhầm dự án vừa được tab khác mở.
  if (req.body?.projectId !== id) {
    throw fail('Dự án đang mở đã thay đổi. Hãy tải lại Dashboard.', 409);
  }

  const current = projectState(id);
  if (req.body?.revision !== current.revision) {
    throw fail('Kịch bản đã thay đổi. Hãy tải lại trước khi bóc băng.', 409);
  }

  const file = current.project.sourceFile;
  if (typeof file !== 'string' || !file || path.basename(file) !== file) {
    throw fail('Tên video trong manifest không hợp lệ.');
  }

  const video = path.join(SOURCE_DIR, file);
  if (!fs.existsSync(video) || !fs.statSync(video).isFile()) {
    throw fail('Không tìm thấy video nguồn trong 01_SOURCE.', 404);
  }

  const script = path.resolve(__dirname, '../python-scripts/boc_bang.py');
  if (!fs.existsSync(script)) {
    throw fail('Không tìm thấy python-scripts/boc_bang.py.', 500);
  }

  const active = startJob(
    'transcribe',
    process.env.PYTHON_EXE || 'py',
    ['-u', script, video, projectDir(id)],
    () => {
      const transcript = readJson(
        path.join(projectDir(id), 'transcript.json')
      );
      const updated = projectState(id);

      if (!Array.isArray(transcript.segments) || !updated.scenes.length) {
        throw fail('Python kết thúc nhưng dữ liệu kết quả chưa hợp lệ.', 500);
      }
    }
  );

  active.projectId = id;
  res.status(202).json({projectId: id, job: active});
});
app.get('/download/projects/:id/video.mp4', (req, res, next) => {
  const output = projectOutput(req.params.id);
  if (!fs.statSync(output, {throwIfNoEntry: false})?.isFile()) {
    return res.status(404).send('Dự án này chưa có video xuất.');
  }

  res.set('Cache-Control', 'no-store');
  res.download(output, 'video.mp4', (error) => {
    if (error) next(error);
  });
});
app.use('/api', (req, res) => res.status(404).json({error: 'API không tồn tại'}));
// Chỉ cho Studio local đọc dữ liệu và video qua trình duyệt.
app.use(['/studio-state', '/media/projects'], (req, res, next) => {
  const allowed = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  res.vary('Origin');
  if (allowed.includes(req.headers.origin)) {
    res.set('Access-Control-Allow-Origin', req.headers.origin);
  }
  next();
});

app.get('/studio-state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(state());
});
app.get('/media/projects/:id', (req, res, next) => {
  const manifestPath = path.join(projectDir(req.params.id), 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw fail('Không tìm thấy dự án', 404);

  const {sourceFile} = readJson(manifestPath);
  if (typeof sourceFile !== 'string' || path.basename(sourceFile) !== sourceFile) {
    throw fail('Tên nguồn không hợp lệ');
  }

  res.sendFile(sourceFile, {root: SOURCE_DIR, dotfiles: 'deny'}, error => {
    if (error) next(error);
  });
});
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