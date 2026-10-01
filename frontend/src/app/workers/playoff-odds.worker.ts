/// <reference lib="webworker" />

import { OddsInput, playoffOdds } from '../utils/playoff-odds';

addEventListener('message', ({ data }: MessageEvent<OddsInput>) => {
  postMessage(playoffOdds(data));
});
