import React from 'react';
import { Viewer } from 'cesium';
import Pusula from './Pusula';
import ZoomControls from './ZoomControls';
import DistanceLegend from './DistanceLegend';
// @ts-ignore
import './Navigasyon.css';

interface CesiumNavigasyonProps {
  viewer: Viewer;
  pusula_aktif?: boolean;
  zoom_kontrolleri_aktif?: boolean;
  mesafe_legend_aktif?: boolean;
}

export default function CesiumNavigasyon({
  viewer,
  pusula_aktif = true,
  zoom_kontrolleri_aktif = false,
  mesafe_legend_aktif = false
}: CesiumNavigasyonProps) {
  return (
    <>
      {pusula_aktif && <Pusula viewer={viewer} />}
      {zoom_kontrolleri_aktif && <ZoomControls viewer={viewer} />}
      {mesafe_legend_aktif && <DistanceLegend viewer={viewer} />}
    </>
  );
}
