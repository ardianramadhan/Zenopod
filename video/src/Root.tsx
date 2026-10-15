import React from 'react';
import { Composition } from 'remotion';
import { Promo, PROMO_FRAMES } from './Promo';

export const Root: React.FC = () => (
  <Composition id="Zenopod" component={Promo} durationInFrames={PROMO_FRAMES} fps={30} width={1080} height={1920} />
);
