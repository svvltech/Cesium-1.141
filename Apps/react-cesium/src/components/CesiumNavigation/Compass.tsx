import React, { useEffect, useRef, useState } from 'react';
import { Cartesian2, Cartesian3, Transforms, Matrix4, SceneMode, BoundingSphere, HeadingPitchRange, Math as CesiumMath, getTimestamp, defined, Ray, Viewer } from 'cesium';

interface CompassProps {
  viewer: Viewer;
}

// ─── PUSULA TASARIM SABİTLERİ ───────────────────────────────────────────────
// Boyut değişiklikleri yapmak için sadece buradaki değerleri düzenleyin.
// Türetilen değerler (merkez, oran vb.) otomatik hesaplanır.

const VIEWBOX_SIZE = 145;                   // SVG viewBox genişlik/yükseklik
const CENTER = VIEWBOX_SIZE / 2;            // = 72.5 — SVG merkez noktası

// Daireler
const OUTER_RADIUS = 70;                    // Dış (gri) daire yarıçapı
const OUTER_BORDER_WIDTH = 3;               // Dış daire border kalınlığı
const INNER_RADIUS = 32;                    // İç (beyaz) daire yarıçapı

// Oranlar (tıklama sınırları & opaklık hesabı)
const GYRO_RADIUS_RATIO = INNER_RADIUS / CENTER; // ≈ 0.441 — orbit/rotate geçiş eşiği

// Orbit göstergesi (mavi yay)
const ORBIT_INDICATOR_SCALE = 1.386;        // Dış sınırı r=70'e oturtacak ölçek
const ORBIT_INDICATOR_STROKE_WIDTH = 4;     // Yayın kalınlığı (sadece içe doğru kalınlaşır)

// N kutusu
const N_BOX_SIZE = 30;                      // N kutucuğu genişlik/yükseklik
const N_BOX_CORNER_RADIUS = 5;              // Köşe yuvarlaklığı
const N_BOX_Y = -15;                        // Üst kenar Y pozisyonu
const N_BOX_X = CENTER - N_BOX_SIZE / 2;    // = 57.5 — Sol kenar X pozisyonu

// Oklar
const ARROW_INSET = 16;                     // Ok ucunun dış kenara mesafesi
const ARROW_SPREAD = 9;                     // Ok tabanının genişliğinin yarısı
const ARROW_DEPTH = 9;                     // Ok ucundan tabana mesafe

// Küp
const CUBE_SCALE = 0.8;                     // Küp ölçeği

export default function Compass({ viewer }: CompassProps) {
  const compassRef = useRef<HTMLDivElement>(null);
  const outerRingRef = useRef<HTMLDivElement>(null);
  const nSquareLayerRef = useRef<HTMLDivElement>(null);
  const orbitMarkerRef = useRef<HTMLDivElement>(null);
  const gyroRef = useRef<HTMLDivElement>(null);

  // Mutable refs for tracking drag state across renders without causing re-renders
  const stateRef = useRef<{
    orbitLastTimestamp: number;
    orbitFrame?: Matrix4;
    orbitIsLook: boolean;
    orbitCursorAngle: number;
    orbitCursorOpacity: number;
    orbitTickFunction?: () => void;
    orbitMouseMoveFunction?: (e: any) => void;
    orbitMouseUpFunction?: () => void;
    isRotating: boolean;
    rotateInitialCursorAngle: number;
    rotateFrame?: Matrix4;
    rotateIsLook: boolean;
    rotateInitialCameraAngle: number;
    rotateMouseMoveFunction?: (e: any) => void;
    rotateMouseUpFunction?: () => void;
  }>({
    orbitLastTimestamp: 0,
    orbitFrame: undefined,
    orbitIsLook: false,
    orbitCursorAngle: 0,
    orbitCursorOpacity: 0,
    orbitTickFunction: undefined,
    orbitMouseMoveFunction: undefined,
    orbitMouseUpFunction: undefined,
    isRotating: false,
    rotateInitialCursorAngle: 0,
    rotateFrame: undefined,
    rotateIsLook: false,
    rotateInitialCameraAngle: 0,
    rotateMouseMoveFunction: undefined,
    rotateMouseUpFunction: undefined
  });

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

  useEffect(() => {
    if (!viewer) return;

    const postRender = () => {
      const currentHeading = viewer.scene.camera.heading;
      if (outerRingRef.current) {
        outerRingRef.current.style.transform = `rotate(-${currentHeading}rad)`;
      }
      if (nSquareLayerRef.current) {
        nSquareLayerRef.current.style.transform = `rotate(-${currentHeading}rad)`;
      }
    };

    const removePostRender = viewer.scene.postRender.addEventListener(postRender);

    return () => {
      removePostRender();
    };
  }, [viewer]);

  const getClientXY = (e: any) => {
    let temp = e.touches ? e.touches[0] : e;
    return { clientX: temp.clientX, clientY: temp.clientY };
  };

  // [KRİTİK] React'in kendi onMouseDown (Synthetic Event) sistemi, Cesium'un ScreenSpaceEventHandler'ı ile
  // aynı anda tetiklendiği için mouse'u bıraksak bile Cesium kamerayı çevirmeye devam ediyordu.
  // Çözüm: React'in olay dinleyicisi yerine doğrudan DOM elementine native (capture: true) event bağlamak.
  useEffect(() => {
    const el = compassRef.current;
    if (!el) return;

    const onMouseDown = (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      handleMouseDown(e);
    };

    el.addEventListener('mousedown', onMouseDown, true);
    el.addEventListener('touchstart', onMouseDown, { capture: true, passive: false });

    return () => {
      el.removeEventListener('mousedown', onMouseDown, true);
      el.removeEventListener('touchstart', onMouseDown, true);
    };
  }); // her render'da güncelle (heading, viewer değişebilir)

  const handleMouseDown = (e: any) => {
    const { clientX, clientY } = getClientXY(e);
    const scene = viewer.scene;
    if (scene.mode === SceneMode.MORPHING) return;

    const compassElement = compassRef.current;
    if (!compassElement) return;
    const compassRectangle = compassElement.getBoundingClientRect();
    const maxDistance = compassRectangle.width / 2.0;
    const center = new Cartesian2((compassRectangle.right - compassRectangle.left) / 2.0, (compassRectangle.bottom - compassRectangle.top) / 2.0);
    const clickLocation = new Cartesian2(clientX - compassRectangle.left, clientY - compassRectangle.top);
    const vector = Cartesian2.subtract(clickLocation, center, new Cartesian2());
    const distanceFromCenter = Cartesian2.magnitude(vector);

    const distanceFraction = distanceFromCenter / maxDistance;

    if ((e.target as Element)?.closest?.('.n-box-rect')) {
      // N kutusu -> sadece rotate
      rotate(compassElement, vector);
    } else if (distanceFraction < 1.0) {
      // Dairenin geri kalanı (iç ve dış) -> orbit
      // İç daire tıklandıysa (distanceFraction < GYRO_RADIUS_RATIO), tek tıklamayı algılaması için bilgi gönderiyoruz
      orbit(compassElement, vector, distanceFraction < GYRO_RADIUS_RATIO);
    }
  };

  const alignNorth = () => {
    const scene = viewer.scene;
    const camera = scene.camera;
    const sscc = scene.screenSpaceCameraController;

    if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs) return;

    if (scene.mode === SceneMode.COLUMBUS_VIEW && !sscc.enableTranslate) return;
    if (scene.mode === SceneMode.SCENE3D || scene.mode === SceneMode.COLUMBUS_VIEW) {
      if (!sscc.enableLook) return;
      if (scene.mode === SceneMode.SCENE3D && !sscc.enableRotate) return;
    }

    const center = getCameraFocus(viewer);
    if (!center) {
      camera.flyHome(1);
      return;
    }

    const cameraPosition = scene.globe.ellipsoid.cartographicToCartesian(camera.positionCartographic, new Cartesian3());
    const surfaceNormal = scene.globe.ellipsoid.geodeticSurfaceNormal(center);
    const focusBoundingSphere = new BoundingSphere(center, 0);

    camera.flyToBoundingSphere(focusBoundingSphere, {
      offset: new HeadingPitchRange(0,
        CesiumMath.PI_OVER_TWO - Cartesian3.angleBetween(surfaceNormal, camera.directionWC),
        Cartesian3.distance(cameraPosition, center)
      ),
      duration: 1.5
    });
  };

  const updateAngleAndOpacity = (vector: Cartesian2, compassWidth: number) => {
    const angle = Math.atan2(-vector.y, vector.x);
    const oAngle = CesiumMath.zeroToTwoPi(angle - CesiumMath.PI_OVER_TWO);
    stateRef.current.orbitCursorAngle = oAngle;

    const distance = Cartesian2.magnitude(vector);
    const maxDistance = compassWidth / 2.0;

    // Orbit opaklığının ve dönme hızının iç daire sınırında maksimum (1.0) olmasını sağlıyoruz
    const gyroRadius = maxDistance * GYRO_RADIUS_RATIO;
    const distanceFraction = Math.min(distance / gyroRadius, 1.0);
    const easedOpacity = 0.5 * distanceFraction * distanceFraction + 0.5;
    stateRef.current.orbitCursorOpacity = easedOpacity;

    if (orbitMarkerRef.current) {
      orbitMarkerRef.current.style.transform = `rotate(-${oAngle}rad)`;
      orbitMarkerRef.current.style.opacity = easedOpacity.toString();
    }
  };

  const orbit = (compassElement: HTMLElement, cursorVector: Cartesian2, isInnerCircle: boolean) => {
    const scene = viewer.scene;
    const sscc = scene.screenSpaceCameraController;

    if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs) return;

    // [KRİTİK] .NET WebView2'den gelen (nokta kaydır modu vb.) "enableTilt" veya "enableRotate"
    // kısıtlamalarına saygı duymak için bu kontroller yapılıyor. Kısıtlama varsa pusula işlevsiz kalır.
    switch (scene.mode) {
      case SceneMode.COLUMBUS_VIEW:
        if (!sscc.enableLook && (!sscc.enableTranslate || !sscc.enableTilt)) return;
        break;
      case SceneMode.SCENE3D:
        if (!sscc.enableLook && (!sscc.enableTilt || !sscc.enableRotate)) return;
        break;
      case SceneMode.SCENE2D:
        if (!sscc.enableTranslate) return;
        break;
      default: break;
    }

    // Clean up any previous orbit listeners
    if (stateRef.current.orbitMouseUpFunction) {
      stateRef.current.orbitMouseUpFunction();
    }

    let hasMoved = false;

    if (gyroRef.current) {
      gyroRef.current.classList.add('compass-gyro-active');
    }

    stateRef.current.orbitLastTimestamp = getTimestamp();

    const camera = scene.camera;
    const center = getCameraFocus(viewer);

    if (!defined(center)) {
      stateRef.current.orbitFrame = Transforms.eastNorthUpToFixedFrame(camera.positionWC, scene.globe.ellipsoid, new Matrix4());
      stateRef.current.orbitIsLook = true;
    } else {
      stateRef.current.orbitFrame = Transforms.eastNorthUpToFixedFrame(center, scene.globe.ellipsoid, new Matrix4());
      stateRef.current.orbitIsLook = false;
    }

    stateRef.current.orbitTickFunction = () => {
      const timestamp = getTimestamp();
      const deltaT = timestamp - stateRef.current.orbitLastTimestamp;
      const rate = (stateRef.current.orbitCursorOpacity - 0.5) * 2.5 / 1000;
      const distance = deltaT * rate;

      const angle = stateRef.current.orbitCursorAngle + CesiumMath.PI_OVER_TWO;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;

      let oldTransform: any;
      if (defined(stateRef.current.orbitFrame)) {
        oldTransform = Matrix4.clone(camera.transform, new Matrix4());
        camera.lookAtTransform(stateRef.current.orbitFrame);
      }

      if (scene.mode === SceneMode.SCENE2D) {
        camera.move(new Cartesian3(x, y, 0), Math.max(scene.canvas.clientWidth, scene.canvas.clientHeight) / 100 * camera.positionCartographic.height * distance);
      } else {
        if (stateRef.current.orbitIsLook) {
          camera.look(Cartesian3.UNIT_Z, -x);
          camera.look(camera.right, -y);
        } else {
          camera.rotateLeft(x);
          camera.rotateUp(y);
        }
      }

      if (defined(stateRef.current.orbitFrame)) {
        camera.lookAtTransform(oldTransform);
      }

      stateRef.current.orbitLastTimestamp = timestamp;
    };

    stateRef.current.orbitMouseMoveFunction = (e: any) => {
      hasMoved = true;
      const { clientX, clientY } = getClientXY(e);
      const compassRectangle = compassElement.getBoundingClientRect();
      const c = new Cartesian2((compassRectangle.right - compassRectangle.left) / 2.0, (compassRectangle.bottom - compassRectangle.top) / 2.0);
      const clickLocation = new Cartesian2(clientX - compassRectangle.left, clientY - compassRectangle.top);
      const vector = Cartesian2.subtract(clickLocation, c, new Cartesian2());
      updateAngleAndOpacity(vector, compassRectangle.width);
    };

    // Capture references BEFORE adding listeners
    const moveFn = stateRef.current.orbitMouseMoveFunction;
    const tickFn = stateRef.current.orbitTickFunction;

    const upFn = () => {
      if (!hasMoved && isInnerCircle) {
        alignNorth();
      }

      if (orbitMarkerRef.current) {
        orbitMarkerRef.current.style.opacity = '0';
      }

      if (gyroRef.current) {
        gyroRef.current.classList.remove('compass-gyro-active');
      }

      window.removeEventListener('mousemove', moveFn, true);
      window.removeEventListener('touchmove', moveFn, true);
      window.removeEventListener('mouseup', upFn, true);
      window.removeEventListener('touchend', upFn, true);
      if (tickFn) {
        viewer.clock.onTick.removeEventListener(tickFn);
      }
      stateRef.current.orbitMouseMoveFunction = undefined;
      stateRef.current.orbitMouseUpFunction = undefined;
      stateRef.current.orbitTickFunction = undefined;
    };
    stateRef.current.orbitMouseUpFunction = upFn;

    window.addEventListener('mousemove', moveFn, true);
    window.addEventListener('touchmove', moveFn, { capture: true, passive: false });
    window.addEventListener('mouseup', upFn, true);
    window.addEventListener('touchend', upFn, true);
    viewer.clock.onTick.addEventListener(stateRef.current.orbitTickFunction);
    updateAngleAndOpacity(cursorVector, compassElement.getBoundingClientRect().width);
  };

  const rotate = (compassElement: HTMLElement, cursorVector: Cartesian2) => {
    const scene = viewer.scene;
    const camera = scene.camera;
    const sscc = scene.screenSpaceCameraController;

    // [KRİTİK] İç gyro'da (orbit) olduğu gibi, dış halkada (rotate) da .NET WebView2 kısıtlamaları kontrol ediliyor.
    if (scene.mode === SceneMode.MORPHING || scene.mode === SceneMode.SCENE2D || !sscc.enableInputs) return;
    if (!sscc.enableLook && (scene.mode === SceneMode.COLUMBUS_VIEW || (scene.mode === SceneMode.SCENE3D && !sscc.enableRotate))) return;

    // Clean up any previous rotate listeners
    if (stateRef.current.rotateMouseUpFunction) {
      stateRef.current.rotateMouseUpFunction();
    }

    stateRef.current.isRotating = true;
    stateRef.current.rotateInitialCursorAngle = Math.atan2(-cursorVector.y, cursorVector.x);

    const viewCenter = getCameraFocus(viewer);

    if (!defined(viewCenter) || (scene.mode === SceneMode.COLUMBUS_VIEW && !sscc.enableLook && !sscc.enableTranslate)) {
      stateRef.current.rotateFrame = Transforms.eastNorthUpToFixedFrame(camera.positionWC, scene.globe.ellipsoid, new Matrix4());
      stateRef.current.rotateIsLook = true;
    } else {
      stateRef.current.rotateFrame = Transforms.eastNorthUpToFixedFrame(viewCenter, scene.globe.ellipsoid, new Matrix4());
      stateRef.current.rotateIsLook = false;
    }

    let oldTransform: any;
    if (defined(stateRef.current.rotateFrame)) {
      oldTransform = Matrix4.clone(camera.transform, new Matrix4());
      camera.lookAtTransform(stateRef.current.rotateFrame);
    }

    stateRef.current.rotateInitialCameraAngle = -camera.heading;

    if (defined(stateRef.current.rotateFrame)) {
      camera.lookAtTransform(oldTransform);
    }

    const rotateMoveFn = (e: any) => {
      const { clientX, clientY } = getClientXY(e);
      const compassRectangle = compassElement.getBoundingClientRect();
      const center = new Cartesian2((compassRectangle.right - compassRectangle.left) / 2.0, (compassRectangle.bottom - compassRectangle.top) / 2.0);
      const clickLocation = new Cartesian2(clientX - compassRectangle.left, clientY - compassRectangle.top);
      const vector = Cartesian2.subtract(clickLocation, center, new Cartesian2());
      const angle = Math.atan2(-vector.y, vector.x);

      const angleDifference = angle - stateRef.current.rotateInitialCursorAngle;
      const newCameraAngle = CesiumMath.zeroToTwoPi(stateRef.current.rotateInitialCameraAngle - angleDifference);

      let oldT: any;
      if (defined(stateRef.current.rotateFrame)) {
        oldT = Matrix4.clone(camera.transform, new Matrix4());
        camera.lookAtTransform(stateRef.current.rotateFrame);
      }

      const currentCameraAngle = -camera.heading;
      camera.rotateRight(newCameraAngle - currentCameraAngle);

      if (defined(stateRef.current.rotateFrame)) {
        camera.lookAtTransform(oldT);
      }
    };

    const rotateUpFn = () => {
      stateRef.current.isRotating = false;
      window.removeEventListener('mousemove', rotateMoveFn, true);
      window.removeEventListener('touchmove', rotateMoveFn, true);
      window.removeEventListener('mouseup', rotateUpFn, true);
      window.removeEventListener('touchend', rotateUpFn, true);
      stateRef.current.rotateMouseMoveFunction = undefined;
      stateRef.current.rotateMouseUpFunction = undefined;
    };

    stateRef.current.rotateMouseMoveFunction = rotateMoveFn;
    stateRef.current.rotateMouseUpFunction = rotateUpFn;

    window.addEventListener('mousemove', rotateMoveFn, true);
    window.addEventListener('touchmove', rotateMoveFn, { capture: true, passive: false });
    window.addEventListener('mouseup', rotateUpFn, true);
    window.addEventListener('touchend', rotateUpFn, true);
  };

  return (
    <div className="compass" title="" ref={compassRef}>

      <div ref={orbitMarkerRef} className="compass-rotation-marker" style={{ position: 'absolute', zIndex: 10, opacity: 0, pointerEvents: 'none' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <defs>
            {/* Bu maske, şeklin dış daire dışına taşmasını fiziksel olarak engeller */}
            <clipPath id="outer-circle-clip">
              <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS} />
            </clipPath>
          </defs>

          <g clipPath="url(#outer-circle-clip)">
            {/* Kalınlığı artırmak için ORBIT_INDICATOR_STROKE_WIDTH sabitini düzenleyin */}
            <g transform={`translate(${CENTER}, ${CENTER}) scale(${ORBIT_INDICATOR_SCALE}) translate(-${CENTER}, -${CENTER})`}>
              <path d="M 72.46875,22.03125 C 59.505873,22.050338 46.521615,27.004287 36.6875,36.875 L 47.84375,47.96875 C 61.521556,34.240041 83.442603,34.227389 97.125,47.90625 l 11.125,-11.125 C 98.401629,26.935424 85.431627,22.012162 72.46875,22.03125 z" fill="#68ADFE" stroke="#68ADFE" strokeWidth={ORBIT_INDICATOR_STROKE_WIDTH} strokeLinejoin="round" />
            </g>
          </g>
        </svg>
      </div>

      {/* 1. DIŞ HALKA ARKA PLANI (DÖNEN) */}
      <div ref={outerRingRef} className="compass-outer-ring" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}>

        {/* 1A. Oklar Arkaplan Dairesi */}
        <svg className="compass-asset-bg-circle" style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS} fill="#B3B3B3" stroke="#333333" strokeWidth={OUTER_BORDER_WIDTH} />
        </svg>

      </div>

      {/* 1C. N Yazan Kare — Ayrı katmanda, orbit göstergesi (zIndex:10) üstünde kalır */}
      <div ref={nSquareLayerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 11, pointerEvents: 'none' }}>
        <svg className="compass-asset-n-square" style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <rect className="n-box-rect" x={N_BOX_X} y={N_BOX_Y} width={N_BOX_SIZE} height={N_BOX_SIZE} rx={N_BOX_CORNER_RADIUS} fill="white" style={{ pointerEvents: 'auto' }} />
          <text x={CENTER} y={N_BOX_Y + N_BOX_SIZE - 9} fontFamily="Arial" fontSize="16" fontWeight="bold" fill="black" textAnchor="middle" style={{ userSelect: 'none', pointerEvents: 'none' }}>N</text>
        </svg>
      </div>

      {/* 1B. Oklar (SABİT) */}
      <div className="compass-fixed-arrows" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none' }}>
        <svg className="compass-asset-arrows" style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          {/* Üst */}
          <polygon points={`${CENTER},${ARROW_INSET} ${CENTER + ARROW_SPREAD},${ARROW_INSET + ARROW_DEPTH} ${CENTER - ARROW_SPREAD},${ARROW_INSET + ARROW_DEPTH}`} fill="white" />
          {/* Sağ */}
          <polygon points={`${VIEWBOX_SIZE - ARROW_INSET},${CENTER} ${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH},${CENTER - ARROW_SPREAD} ${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH},${CENTER + ARROW_SPREAD}`} fill="white" />
          {/* Alt */}
          <polygon points={`${CENTER},${VIEWBOX_SIZE - ARROW_INSET} ${CENTER - ARROW_SPREAD},${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH} ${CENTER + ARROW_SPREAD},${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH}`} fill="white" />
          {/* Sol */}
          <polygon points={`${ARROW_INSET},${CENTER} ${ARROW_INSET + ARROW_DEPTH},${CENTER + ARROW_SPREAD} ${ARROW_INSET + ARROW_DEPTH},${CENTER - ARROW_SPREAD}`} fill="white" />
        </svg>
      </div>

      {/* 2. İÇ HALKA (ORBIT/GYRO) */}
      <div ref={gyroRef} className="compass-gyro" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 3 }}>

        {/* 2A. Ortadaki Daire */}
        <svg className="compass-asset-inner-circle" style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <circle cx={CENTER} cy={CENTER} r={INNER_RADIUS} fill="white" />
        </svg>

        {/* 2B. Ortadaki Küp */}
        <svg className="compass-asset-cube" style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <g transform={`translate(${CENTER}, ${CENTER}) scale(${CUBE_SCALE}) translate(-${CENTER}, -${CENTER})`}>
            <polygon points="72.5,55 90,65 72.5,75 55,65" fill="#5F73E8" />
            <polygon points="55,65 72.5,75 72.5,95 55,85" fill="#3A4BB5" />
            <polygon points="90,65 72.5,75 72.5,95 90,85" fill="#4B5ED7" />
            <line x1="72.5" y1="75" x2="72.5" y2="95" stroke="white" strokeWidth="2" />
            <line x1="72.5" y1="75" x2="55" y2="65" stroke="white" strokeWidth="2" />
            <line x1="72.5" y1="75" x2="90" y2="65" stroke="white" strokeWidth="2" />
          </g>
        </svg>

      </div>
    </div>
  );
}
