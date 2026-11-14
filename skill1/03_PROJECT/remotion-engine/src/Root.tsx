/// <reference lib="dom" />

import {Composition} from 'remotion';
import type {CalculateMetadataFunction} from 'remotion';
import {MyComposition} from './Composition';
import type {VideoProps} from './Composition';
import type {Scene} from './editor-model';

const API = 'http://127.0.0.1:3001';

type StudioState = {
  project: {id: string; sourceFile: string} | null;
  scenes: Scene[];
  mediaPath: string | null;
  config: {
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
  };
};

const metadata: CalculateMetadataFunction<VideoProps> = async ({
  props,
  abortSignal,
}) => {
  const response = await fetch(`${API}/studio-state`, {
    cache: 'no-store',
    signal: abortSignal,
  });

  if (!response.ok) {
    throw new Error(`Không đọc được dự án: HTTP ${response.status}`);
  }

  const data = await response.json() as StudioState;

  return {
    width: data.config.width,
    height: data.config.height,
    fps: data.config.fps,
    durationInFrames: data.config.durationInFrames,
    props: {
      ...props,
      scenes: data.scenes,
      videoSrc: data.mediaPath
        ? new URL(data.mediaPath, API).href
        : '',
    },
  };
};

export const RemotionRoot = () => (
  <Composition
    id="MyComposition"
    component={MyComposition}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={1}
    defaultProps={{scenes: [], videoSrc: ''}}
    calculateMetadata={metadata}
  />
);