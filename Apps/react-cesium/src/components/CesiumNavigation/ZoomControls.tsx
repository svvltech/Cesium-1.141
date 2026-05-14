import React from 'react';
import { Cartesian3, Ray, SceneMode, IntersectionTests, Viewer } from 'cesium';

interface ZoomControlsProps {
  viewer: Viewer;
}

export default function ZoomControls({ viewer }: ZoomControlsProps) {
  
  const getCameraFocus = (viewer: Viewer): Cartesian3 | undefined => {
    const scene = viewer.scene;
    const camera = scene.camera;
    if (scene.mode === SceneMode.MORPHING) return undefined;
    
    const ray = new Ray(camera.positionWC, camera.directionWC);
    let intersection = scene.globe.pick(ray, scene);
    if (!intersection) return undefined;

    if (scene.mode === SceneMode.SCENE2D || scene.mode === SceneMode.COLUMBUS_VIEW) {
      intersection = camera.worldToCameraCoordinatesPoint(intersection);
    }
    return intersection;
  };

  // [KRİTİK] Kameranın baktığı noktayı (focus) bulur ve o noktaya doğru yakınlaştırma (zoom In/Out)
  // işlemini gerçekleştirir. Cesium ScreenSpaceCameraController'ın kısıtlamalarına uyar.
  const handleZoom = (amount: number) => {
    if (!viewer) return;
    const scene = viewer.scene;
    const camera = scene.camera;
    const sscc = scene.screenSpaceCameraController;

    if (!sscc.enableInputs || !sscc.enableZoom) return;

    if (scene.mode === SceneMode.SCENE2D) {
      camera.zoomIn(camera.positionCartographic.height * (1 - amount));
      return;
    }

    const focus = getCameraFocus(viewer);
    let orientation: any;
    let focusPoint: Cartesian3;

    if (focus) {
      focusPoint = focus;
      orientation = {
        direction: camera.direction,
        up: camera.up
      };
    } else {
      const ray = new Ray(camera.worldToCameraCoordinatesPoint(scene.globe.ellipsoid.cartographicToCartesian(camera.positionCartographic)), camera.directionWC);
      const intersection = IntersectionTests.grazingAltitudeLocation(ray, scene.globe.ellipsoid);
      if (!intersection) {
        focusPoint = Cartesian3.ZERO;
      } else {
        focusPoint = intersection;
      }
      orientation = {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll
      };
    }

    const direction = Cartesian3.subtract(camera.position, focusPoint, new Cartesian3());
    const movement = Cartesian3.multiplyByScalar(direction, amount, new Cartesian3());
    const newPosition = Cartesian3.add(focusPoint, movement, new Cartesian3());

    if (scene.mode === SceneMode.COLUMBUS_VIEW) {
        camera.position = newPosition;
    } else {
        camera.flyTo({
            destination: newPosition,
            orientation: orientation,
            duration: 0.5,
            convert: false
        });
    }
  };

  const resetView = () => {
     if (!viewer) return;
     viewer.camera.flyHome(1);
  };

  return (
    <div className="navigation-controls">
      <div className="navigation-control" onClick={() => handleZoom(0.5)} title="Yakınlaştır">
        <div className="navigation-control-icon-zoom-in">+</div>
      </div>
      <div className="navigation-control" onClick={resetView} title="Sıfırla">
        <div className="navigation-control-icon-svg">
           <svg viewBox="0 0 15 15"><path d="M 7.5,0 C 3.375,0 0,3.375 0,7.5 0,11.625 3.375,15 7.5,15 c 3.46875,0 6.375,-2.4375 7.21875,-5.625 l -1.96875,0 C 12,11.53125 9.9375,13.125 7.5,13.125 4.40625,13.125 1.875,10.59375 1.875,7.5 1.875,4.40625 4.40625,1.875 7.5,1.875 c 1.59375,0 2.90625,0.65625 3.9375,1.6875 l -3,3 6.5625,0 L 15,0 12.75,2.25 C 11.4375,0.84375 9.5625,0 7.5,0 z" /></svg>
        </div>
      </div>
      <div className="navigation-control-last" onClick={() => handleZoom(2.0)} title="Uzaklaştır">
        <div className="navigation-control-icon-zoom-out">-</div>
      </div>
    </div>
  );
}
