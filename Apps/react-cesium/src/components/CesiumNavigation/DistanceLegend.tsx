import React, { useEffect, useState } from 'react';
import { Cartesian2, EllipsoidGeodesic, getTimestamp, defined, Viewer } from 'cesium';

const distances = [
  1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000,
  50000, 100000, 200000, 300000, 500000, 1000000, 2000000, 3000000, 5000000, 10000000, 20000000, 30000000, 50000000
];

interface DistanceLegendProps {
  viewer: Viewer;
}

export default function DistanceLegend({ viewer }: DistanceLegendProps) {
  const [distanceLabel, setDistanceLabel] = useState<string | undefined>(undefined);
  const [barWidth, setBarWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!viewer) return;

    let lastUpdate = 0;
    const geodesic = new EllipsoidGeodesic();

    const updateDistanceLegend = () => {
      const now = getTimestamp();
      if (now < lastUpdate + 250) return;
      lastUpdate = now;

      const scene = viewer.scene;
      const width = scene.canvas.clientWidth;
      const height = scene.canvas.clientHeight;

      const left = scene.camera.getPickRay(new Cartesian2((width / 2) | 0, height - 1));
      const right = scene.camera.getPickRay(new Cartesian2(1 + (width / 2) | 0, height - 1));

      const globe = scene.globe;
      const leftPosition = globe.pick(left, scene);
      const rightPosition = globe.pick(right, scene);

      if (!defined(leftPosition) || !defined(rightPosition)) {
        setBarWidth(undefined);
        setDistanceLabel(undefined);
        return;
      }

      const leftCartographic = globe.ellipsoid.cartesianToCartographic(leftPosition);
      const rightCartographic = globe.ellipsoid.cartesianToCartographic(rightPosition);

      geodesic.setEndPoints(leftCartographic, rightCartographic);
      const pixelDistance = geodesic.surfaceDistance;

      const maxBarWidth = 100;
      let distance;
      for (let i = distances.length - 1; !defined(distance) && i >= 0; --i) {
        if (distances[i] / pixelDistance < maxBarWidth) {
          distance = distances[i];
        }
      }

      if (defined(distance)) {
        let label = distance >= 1000 ? (distance / 1000).toString() + ' km' : distance.toString() + ' m';
        setBarWidth((distance / pixelDistance) | 0);
        setDistanceLabel(label);
      } else {
        setBarWidth(undefined);
        setDistanceLabel(undefined);
      }
    };

    const removeListener = viewer.scene.postRender.addEventListener(updateDistanceLegend);

    return () => {
      removeListener();
    };
  }, [viewer]);

  if (!distanceLabel || !barWidth) {
    return null;
  }

  return (
    <div className="distance-legend">
      <div className="distance-legend-label">{distanceLabel}</div>
      <div className="distance-legend-scale-bar" style={{ width: barWidth + 'px', left: (5 + (125 - barWidth) / 2) + 'px' }}></div>
    </div>
  );
}
