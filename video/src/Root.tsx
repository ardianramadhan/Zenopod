import React from 'react';
import { Composition } from 'remotion';
import { SHORT } from './Promo';
import { FULL } from './PromoFull';

// Zenopod = 30 detik (6 fitur), ZenopodFull = 60 detik (18 fitur). Keduanya vertikal 1080×1920.
export const Root: React.FC = () => (
  <>
    <Composition id="Zenopod" component={SHORT.Component} durationInFrames={SHORT.frames} fps={30} width={1080} height={1920} />
    <Composition id="ZenopodFull" component={FULL.Component} durationInFrames={FULL.frames} fps={30} width={1080} height={1920} />
  </>
);
