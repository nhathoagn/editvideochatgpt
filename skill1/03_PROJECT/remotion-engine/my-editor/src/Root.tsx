import {Composition} from 'remotion';
import {MyComposition} from './Composition';
import config from './video-config.json';

export const RemotionRoot = () => <Composition
  id="MyComposition" component={MyComposition}
  width={config.width} height={config.height}
  fps={config.fps} durationInFrames={config.durationInFrames}
/>;
