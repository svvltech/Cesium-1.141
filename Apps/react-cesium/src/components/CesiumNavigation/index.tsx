import React from 'react';
import { Viewer } from 'cesium';
import Compass from './Compass';
import ZoomControls from './ZoomControls';
import DistanceLegend from './DistanceLegend';
// @ts-ignore
import './Navigation.css';

interface CesiumNavigationProps {
  viewer: Viewer;
  enableCompass?: boolean;
  enableZoomControls?: boolean;
  enableDistanceLegend?: boolean;
}

export default function CesiumNavigation({
  viewer,
  enableCompass = true,
  enableZoomControls = false,
  enableDistanceLegend = false
}: CesiumNavigationProps) {
  return (
    <>
      {enableCompass && <Compass viewer={viewer} />}
      {enableZoomControls && <ZoomControls viewer={viewer} />}
      {enableDistanceLegend && <DistanceLegend viewer={viewer} />}
    </>
  );
}
