import React, { useEffect, useRef, useState } from 'react';
import { Viewer, OpenStreetMapImageryProvider } from 'cesium';
import CesiumNavigasyon from './components/CesiumNavigation';

export default function App() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewerRef.current) return;
    
    try {
      const v = new Viewer(viewerRef.current, {
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        baseLayer: false
      });
      
      // Ion token gerektirmeyen OpenStreetMap katmanı
      const osmProvider = new OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/'
      });
      v.imageryLayers.addImageryProvider(osmProvider);
      
      v.scene.screenSpaceCameraController.enableTilt = true;
      v.scene.screenSpaceCameraController.enableLook = true;
      
      setViewer(v);

      return () => {
        if (!v.isDestroyed()) {
           v.destroy();
        }
      };
    } catch (e: any) {
      console.error('Cesium Viewer oluşturulurken hata:', e);
      setError(e.message || String(e));
    }
  }, []);

  if (error) {
    return <div style={{ color: 'red', padding: 20 }}>Hata: {error}</div>;
  }

  return (
    <>
      <div id="cesiumContainer" ref={viewerRef} />
      {viewer && <CesiumNavigasyon viewer={viewer} />}
    </>
  );
}
