/// <reference lib="dom" />

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '@remotion/player';
import type {PlayerRef} from '@remotion/player';
import {MyComposition} from '../src/Composition';
import {
  clamp,
  defaultStyle,
  fonts,
  isActive,
  sceneFrame,
  styleOf,
} from '../src/editor-model';
import type {CaptionStyle, Scene} from '../src/editor-model';
import {
  api,
  createVideoProject,
  getVideoProject,
} from './project-api';
import type {VideoConfig, VideoProject} from './project-api';

type Job = {
  id: string;
  kind: string;
  status: string;
  startedAt: number;
  log: string;
  error?: string;
  output?: string;
};

type State = {
  scenes: Scene[];
  revision: string;
  config: VideoConfig;
  job: Job | null;
};

type SourceFile = {name: string};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function App() {
  const player = useRef<PlayerRef>(null);
  const working = useRef(true);
  const alive = useRef(true);

  const [config, setConfig] = useState<VideoConfig | null>(null);
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

  const [sources, setSources] = useState<SourceFile[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [videoSrc, setVideoSrc] = useState('/media/input.mp4');
  const [playerVersion, setPlayerVersion] = useState(0);

  const legacyMode = projectId === null;
  const selected = scenes.find(
    (scene) => String(scene.id) === selectedId,
  );
  const currentStyle = selected ? styleOf(selected) : defaultStyle;

  const dirty = useMemo(
    () => scenes.filter(
      (scene, index) =>
        JSON.stringify(scene) !== JSON.stringify(saved[index]),
    ),
    [scenes, saved],
  );

  function accept(data: State) {
    setConfig(data.config);
    setScenes(data.scenes);
    setSaved(data.scenes);
    setRevision(data.revision);
    setSelectedId((id) =>
      data.scenes.some((scene) => String(scene.id) === id)
        ? id
        : String(data.scenes[0]?.id ?? ''),
    );
  }

  function acceptProject(data: VideoProject) {
    setProjectId(data.project.id);
    setProjectName(data.project.sourceFile);
    setVideoSrc(data.videoSrc);
    setConfig(data.config);
    setScenes(data.scenes);
    setSaved(data.scenes);
    setRevision('');
    setSelectedId(String(data.scenes[0]?.id ?? ''));
    setFrame(0);
    setEditMode(false);
    setLog('');
    setDownload(false);
    setPlayerVersion((value) => value + 1);
  }

  async function pollJob(id: string) {
    while (alive.current) {
      const {job} = await api<{job: Job | null}>('/api/job');

      if (!job || job.id !== id) {
        throw new Error('Không tìm thấy tác vụ. Kiểm tra Server API.');
      }

      setLog(job.log || '');

      if (job.status === 'error') {
        throw new Error(job.error || 'Tác vụ thất bại; xem log.');
      }

      if (job.status === 'done') {
        if (job.kind === 'render') setDownload(true);
        return job;
      }

      const label = job.kind === 'render'
        ? 'Đang xuất MP4'
        : 'Đang đồng bộ Python';
      const elapsed = Math.floor(
        (Date.now() - job.startedAt) / 1000,
      );

      setMessage(`${label}… ${elapsed}s`);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 800);
      });
    }

    throw new Error('Trang đã đóng.');
  }

  async function run(task: () => Promise<void>) {
    if (working.current) return;

    working.current = true;
    setBusy(true);
    setError(false);
    player.current?.pause();

    try {
      await task();
    } catch (cause) {
      setMessage(messageOf(cause));
      setError(true);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    alive.current = true;

    void (async () => {
      try {
        const data = await api<State>('/api/state');
        if (!alive.current) return;
        accept(data);

        if (data.job?.status === 'running') {
          await pollJob(data.job.id);
          if (!alive.current) return;
          accept(await api<State>('/api/state'));
        }

        setMessage('Sẵn sàng · Chọn một cảnh để nhảy tới đầu câu.');
      } catch (cause) {
        if (alive.current) {
          setMessage(messageOf(cause));
          setError(true);
        }
      } finally {
        if (alive.current) {
          working.current = false;
          setBusy(false);
        }
      }
    })();

    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;

    const update = (event: {detail: {frame: number}}) => {
      setFrame(event.detail.frame);
    };
    const playing = () => setEditMode(false);

    instance.addEventListener('frameupdate', update);
    instance.addEventListener('play', playing);

    return () => {
      instance.removeEventListener('frameupdate', update);
      instance.removeEventListener('play', playing);
    };
  }, [config, projectId, playerVersion]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty.length || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty.length, busy]);

  function loadSources() {
    void run(async () => {
      setMessage('Đang đọc video trong 01_SOURCE…');
      const data = await api<{files: SourceFile[]}>('/api/sources');

      if (!Array.isArray(data.files)) {
        throw new Error('API /api/sources không trả về danh sách files.');
      }

      setSources(data.files);
      setSourceName((current) =>
        data.files.some((file) => file.name === current)
          ? current
          : data.files[0]?.name ?? '',
      );
      setMessage(
        data.files.length
          ? `Tìm thấy ${data.files.length} video. Chọn video rồi tạo dự án.`
          : 'Chưa có video. Hãy đặt video vào skill1/01_SOURCE.',
      );
    });
  }

  function createSelectedProject() {
    if (working.current || !sourceName) return;
    if (
      dirty.length &&
      !window.confirm('Bỏ thay đổi chưa lưu để mở video mới?')
    ) return;

    void run(async () => {
      setMessage('Đang đọc video và tạo dự án…');
      const data = await createVideoProject(sourceName);
      acceptProject(data);
      setMessage(
        `Đã mở ${data.project.sourceFile}. Hiện chỉ xem trước; chưa bóc băng.`,
      );
    });
  }

  function backToLegacy() {
    if (working.current) return;
    if (
      dirty.length &&
      !window.confirm('Bỏ thay đổi chưa lưu và về dự án cũ?')
    ) return;

    void run(async () => {
      const data = await api<State>('/api/state');

      setProjectId(null);
      setProjectName('');
      setVideoSrc('/media/input.mp4');
      setFrame(0);
      setEditMode(true);
      setDownload(false);
      setLog('');
      setPlayerVersion((value) => value + 1);
      accept(data);

      if (data.job?.status === 'running') {
        await pollJob(data.job.id);
        accept(await api<State>('/api/state'));
      }

      setMessage('Đã quay về dự án cũ.');
    });
  }

  const patchScene = useCallback(
    (id: string, patch: Partial<Scene>) => {
      if (working.current || !legacyMode) return;

      setScenes((items) => items.map((scene) =>
        String(scene.id) === id ? {...scene, ...patch} : scene,
      ));
    },
    [legacyMode],
  );

  const pickCaption = useCallback((id: string) => {
    if (working.current) return;
    player.current?.pause();
    setSelectedId(id);
  }, []);

  function chooseScene(scene: Scene) {
    if (busy || !config) return;

    const wanted = sceneFrame(scene, config.fps);
    const target = clamp(wanted, 0, config.durationInFrames - 1);

    player.current?.pause();
    player.current?.seekTo(target);
    setFrame(target);
    setSelectedId(String(scene.id));
    setEditMode(legacyMode);
    setError(wanted !== target);
    setMessage(
      wanted !== target
        ? 'Cảnh nằm ngoài thời lượng video. Kiểm tra cấu hình dự án.'
        : `Cảnh ${scene.id} · ${scene.start.toFixed(2)}s → frame ${target}`,
    );
  }

  const inputProps = useMemo(() => ({
    scenes,
    videoSrc,
    editingId: legacyMode && editMode && !busy
      ? selectedId
      : undefined,
    onSelect: legacyMode && editMode && !busy
      ? pickCaption
      : undefined,
    onChange: legacyMode && editMode && !busy
      ? patchScene
      : undefined,
  }), [
    scenes, videoSrc, selectedId, editMode,
    busy, legacyMode, pickCaption, patchScene,
  ]);

  const updates = () => dirty.map((scene) => ({
    id: scene.id,
    text: scene.text,
    ...styleOf(scene),
  }));

  function saveAll() {
    if (!legacyMode) return;

    void run(async () => {
      setMessage('Đang lưu lời thoại và định dạng…');
      accept(await api<State>('/api/save', {
        revision,
        updates: updates(),
      }));
      setMessage('Đã lưu tất cả thay đổi.');
    });
  }

  function renderVideo() {
    if (!legacyMode) return;

    void run(async () => {
      setMessage('Đang lưu và bắt đầu xuất MP4…');
      setLog('');
      setDownload(false);

      const data = await api<State>('/api/render', {
        revision,
        updates: updates(),
      });
      accept(data);

      if (!data.job) throw new Error('Không nhận được mã tác vụ.');

      const result = await pollJob(data.job.id);
      setMessage(`Hoàn tất! ${result.output || 'Đã xuất video.'}`);
    });
  }

  function reload() {
    if (working.current) return;
    if (
      dirty.length &&
      !window.confirm('Bỏ các thay đổi chưa lưu và tải lại?')
    ) return;

    void run(async () => {
      if (projectId !== null) {
        acceptProject(await getVideoProject(projectId));
      } else {
        const data = await api<State>('/api/state');
        accept(data);

        if (data.job?.status === 'running') {
          await pollJob(data.job.id);
          accept(await api<State>('/api/state'));
        }
      }

      setMessage('Đã tải dữ liệu mới nhất.');
    });
  }

  function syncPython() {
    if (!legacyMode || working.current) return;
    if (!window.confirm(
      'Python sẽ tạo lại cảnh từ Whisper, thay lời thoại và định dạng. ' +
      'Thay đổi chưa lưu sẽ bị bỏ. Tiếp tục?',
    )) return;

    void run(async () => {
      setMessage('Đang đồng bộ Python…');
      setLog('');

      const data = await api<{job: Job}>('/api/sync', {revision});
      await pollJob(data.job.id);
      accept(await api<State>('/api/state'));
      setMessage('Đồng bộ Python hoàn tất.');
    });
  }

  function changeStyle(patch: Partial<CaptionStyle>) {
    if (selected) patchScene(String(selected.id), patch);
  }

  function slider(
    label: string,
    key: keyof CaptionStyle,
    min: number,
    max: number,
    step = 1,
    unit = '',
  ) {
    return (
      <label className="control">
        <span>
          {label}
          <output>{currentStyle[key]}{unit}</output>
        </span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number(currentStyle[key])}
          onChange={(event) =>
            changeStyle({[key]: Number(event.currentTarget.value)})
          }
        />
      </label>
    );
  }

  return (
    <>
      <header>
        <div className="brand">
          VIDEO<span>STUDIO</span><small>LOCAL / 2.0</small>
        </div>
        <span className="badge">
          {dirty.length ? `${dirty.length} cảnh chưa lưu` : 'Đã lưu'}
        </span>
        <button disabled={busy} onClick={reload}>
          ↻ Tải lại
        </button>
        <button
          disabled={busy || !config || !legacyMode}
          onClick={syncPython}
        >
          Đồng bộ Python
        </button>
        <button
          disabled={busy || !dirty.length || !legacyMode}
          onClick={saveAll}
        >
          Lưu tất cả
        </button>
        <button
          className="primary"
          disabled={busy || !config || !legacyMode}
          onClick={renderVideo}
        >
          ↗ Xuất MP4
        </button>
      </header>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '12px 20px',
        background: '#101827',
        borderBottom: '1px solid #334155',
      }}>
        <button disabled={busy} onClick={loadSources}>
          Đọc video từ 01_SOURCE
        </button>

        <select
          aria-label="Chọn video nguồn"
          disabled={busy || !sources.length}
          value={sourceName}
          onChange={(event) => setSourceName(event.currentTarget.value)}
          style={{
            maxWidth: 320,
            padding: 10,
            background: '#172033',
            color: '#fff',
          }}
        >
          <option value="">— Chọn video —</option>
          {sources.map((file) => (
            <option key={file.name} value={file.name}>
              {file.name}
            </option>
          ))}
        </select>

        <button
          disabled={busy || !sourceName}
          onClick={createSelectedProject}
        >
          Tạo dự án từ video
        </button>

        {!legacyMode && (
          <button disabled={busy} onClick={backToLegacy}>
            Về dự án cũ
          </button>
        )}

        <span style={{color: '#94a3b8', fontSize: 13}}>
          {legacyMode
            ? 'Đang mở: dự án cũ'
            : `Đang mở: ${projectName} · Chỉ xem trước`}
        </span>
      </div>

      <div className={`status ${error ? 'error' : ''}`} role="status">
        {message}
        {download && legacyMode && (
          <a href="/download/video.mp4">Tải video.mp4</a>
        )}
      </div>

      <main>
        <aside className="script">
          <div className="section-title">
            <strong>Kịch bản</strong>
            <span>{scenes.length} cảnh</span>
          </div>
          <div className="scene-list">
            {!scenes.length && (
              <p className="hint">
                Chưa có cảnh. Video mới chưa được bóc băng.
              </p>
            )}
            {scenes.map((scene) => {
              const id = String(scene.id);
              const active = config && isActive(scene, frame, config.fps);
              const changed = dirty.some((item) => String(item.id) === id);

              return (
                <article
                  key={id}
                  className={`scene ${
                    id === selectedId ? 'selected' : ''
                  } ${active ? 'playing' : ''}`}
                  onClick={() => chooseScene(scene)}
                >
                  <button
                    className="scene-title"
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      chooseScene(scene);
                    }}
                  >
                    <b>{id}{changed ? ' *' : ''}</b>
                    <span>
                      {scene.start.toFixed(2)} → {scene.end.toFixed(2)}s
                    </span>
                  </button>
                  <textarea
                    aria-label={`Lời thoại ${id}`}
                    disabled={busy || !legacyMode}
                    value={scene.text}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (id !== selectedId) chooseScene(scene);
                    }}
                    onFocus={() => {
                      if (id !== selectedId) chooseScene(scene);
                    }}
                    onChange={(event) =>
                      patchScene(id, {text: event.currentTarget.value})
                    }
                  />
                </article>
              );
            })}
          </div>
        </aside>

        <section className="preview">
          <div className="section-title">
            <strong>Xem trước</strong>
            {legacyMode ? (
              <a
                href="http://127.0.0.1:3000/MyComposition"
                target="_blank"
                rel="noreferrer"
              >
                Mở Studio ↗
              </a>
            ) : (
              <span>Video nguồn từ 01_SOURCE</span>
            )}
          </div>

          <div className="stage-area">
            {config && (
              <Player
                key={`${projectId ?? 'legacy'}-${playerVersion}`}
                ref={player}
                component={MyComposition}
                inputProps={inputProps}
                durationInFrames={config.durationInFrames}
                fps={config.fps}
                compositionWidth={config.width}
                compositionHeight={config.height}
                controls
                clickToPlay={false}
                doubleClickToFullscreen={false}
                spaceKeyToPlayOrPause={false}
                moveToBeginningWhenEnded={false}
                style={{
                  width: `min(100%, calc((100dvh - 330px) * ${
                    config.width / config.height
                  }))`,
                  borderRadius: 12,
                }}
                errorFallback={({error: cause}) => (
                  <div className="player-error">
                    {cause.message}
                    <br />
                    Không đọc được video. Kiểm tra video nguồn và Server API.
                  </div>
                )}
              />
            )}
          </div>

          <div className="transport">
            <button
              disabled={busy || !config}
              onClick={() => {
                player.current?.pause();
                player.current?.seekTo(Math.max(0, frame - 1));
              }}
            >
              −1 frame
            </button>
            <span>
              {config ? (frame / config.fps).toFixed(2) : '0.00'}s
              {' · '}frame {frame}
            </span>
            <button
              disabled={busy || !config}
              onClick={() => {
                player.current?.pause();
                player.current?.seekTo(
                  Math.min((config?.durationInFrames || 1) - 1, frame + 1),
                );
              }}
            >
              +1 frame
            </button>
            <button
              className={editMode ? 'mode-on' : ''}
              disabled={busy || !config || !legacyMode}
              onClick={() => {
                player.current?.pause();
                setEditMode((value) => !value);
              }}
            >
              {editMode ? '✓ Chỉnh vị trí' : 'Chỉnh vị trí'}
            </button>
          </div>

          <p className="hint">
            {legacyMode ? (
              <>
                Kéo chữ để di chuyển · Kéo ô xanh để đổi cỡ chữ.
                <br />
                Bấm Play để xem hiệu ứng thật.
              </>
            ) : (
              'Dự án mới hiện hỗ trợ xem trước. Bóc băng, lưu và render sẽ được nối API ở bước tiếp theo.'
            )}
          </p>

          {log && (
            <details>
              <summary>Log tác vụ</summary>
              <pre>{log}</pre>
            </details>
          )}
        </section>

        <aside className="inspector">
          <div className="section-title">
            <strong>Định dạng phụ đề</strong>
            <span>{selectedId || '—'}</span>
          </div>

          <fieldset disabled={busy || !selected || !legacyMode}>
            <label className="control">
              Font chữ
              <select
                aria-label="Font chữ"
                value={currentStyle.fontFamily}
                onChange={(event) =>
                  changeStyle({fontFamily: event.currentTarget.value})
                }
              >
                {fonts.map((font) => <option key={font}>{font}</option>)}
              </select>
            </label>

            <label className="control">
              Độ đậm
              <select
                aria-label="Độ đậm"
                value={currentStyle.fontWeight}
                onChange={(event) =>
                  changeStyle({
                    fontWeight: Number(event.currentTarget.value),
                  })
                }
              >
                <option value={400}>Thường</option>
                <option value={700}>Đậm</option>
                <option value={900}>Rất đậm</option>
              </select>
            </label>

            {slider('Cỡ chữ', 'fontSize', 16, 160, 1, ' px')}
            {slider('Vị trí ngang', 'positionX', 0, 100, 0.1, '%')}
            {slider(
              'Cách đáy', 'positionY',
              0, (config?.height || 1920) - 40, 1, ' px',
            )}
            {slider('Chiều rộng khung', 'maxWidth', 20, 100, 1, '%')}

            <div className="color-row">
              {([
                ['Màu chữ', 'color'],
                ['Màu nền', 'backgroundColor'],
                ['Màu viền', 'strokeColor'],
              ] as const).map(([label, key]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={label}
                    type="color"
                    value={currentStyle[key]}
                    onChange={(event) =>
                      changeStyle({[key]: event.currentTarget.value})
                    }
                  />
                </label>
              ))}
            </div>

            {slider('Độ đậm nền', 'backgroundOpacity', 0, 1, 0.05)}
            {slider('Độ dày viền', 'strokeWidth', 0, 8, 0.5, ' px')}

            <label className="control">
              Hiệu ứng xuất hiện
              <select
                aria-label="Hiệu ứng xuất hiện"
                value={currentStyle.effect}
                onChange={(event) =>
                  changeStyle({
                    effect: event.currentTarget.value as CaptionStyle['effect'],
                  })
                }
              >
                <option value="none">Không hiệu ứng</option>
                <option value="fade">Hiện dần</option>
                <option value="pop">Phóng nhẹ</option>
                <option value="slide">Trượt lên</option>
              </select>
            </label>

            <button onClick={() => changeStyle(defaultStyle)}>
              Đặt lại định dạng cảnh
            </button>
            <button onClick={() => {
              if (
                working.current ||
                !legacyMode ||
                !selected ||
                !window.confirm(
                  'Áp dụng định dạng cảnh này cho tất cả cảnh? ' +
                  'Lời thoại và thời gian được giữ nguyên.',
                )
              ) return;

              setScenes((items) => items.map((scene) => ({
                ...scene,
                ...currentStyle,
              })));
            }}>
              Áp dụng kiểu này cho tất cả
            </button>

            <p className="hint">
              Mỗi cảnh có định dạng riêng. Bấm Lưu tất cả
              hoặc Xuất MP4 để ghi vào scenes.json.
            </p>
          </fieldset>
        </aside>
      </main>
    </>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);