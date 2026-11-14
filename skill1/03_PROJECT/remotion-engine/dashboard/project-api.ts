/// <reference lib="dom" />

import type {Scene} from '../src/editor-model';

export type VideoConfig = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

export type ProjectData = {
  project: {
    id: string;
    sourceFile: string;
  };
  scenes: Scene[];
  config: VideoConfig;
  mediaPath: string;
};

export type VideoProject = ProjectData & {
  videoSrc: string;
};

function errorMessage(data: unknown): string | undefined {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error;
  }
  return undefined;
}

// T là kiểu phản hồi mong đợi từ API.
export async function api<T>(
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        }),
  });

  const raw = await response.text();
  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `HTTP ${response.status}: phản hồi không phải JSON`,
    );
  }

  if (!response.ok) {
    throw new Error(
      errorMessage(data) || `HTTP ${response.status}`,
    );
  }

  return data as T;
}

export async function getVideoProject(
  id: string,
): Promise<VideoProject> {
  const state = await api<ProjectData>(
    `/api/projects/${encodeURIComponent(id)}`,
  );

  if (
    !state.project?.id ||
    !state.mediaPath ||
    !state.config ||
    !Array.isArray(state.scenes)
  ) {
    throw new Error('API trả về dữ liệu dự án không hợp lệ.');
  }

  return {
    ...state,
    videoSrc: new URL(
      state.mediaPath,
      window.location.origin,
    ).href,
  };
}

export async function createVideoProject(
  fileName: string,
): Promise<VideoProject> {
  const created = await api<{id: string}>('/api/projects', {
    file: fileName,
  });

  if (!created.id || typeof created.id !== 'string') {
    throw new Error('API không trả về mã dự án hợp lệ.');
  }

  return getVideoProject(created.id);
}