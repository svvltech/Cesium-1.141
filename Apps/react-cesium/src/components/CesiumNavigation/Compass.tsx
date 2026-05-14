import React, { useEffect, useRef, useState } from 'react';
import { Cartesian2, Cartesian3, Transforms, Matrix4, SceneMode, BoundingSphere, HeadingPitchRange, Math as CesiumMath, getTimestamp, defined, Ray, Viewer } from 'cesium';

interface CompassProps {
  viewer: Viewer;
}

export default function Compass({ viewer }: CompassProps) {
  const compassRef = useRef<HTMLDivElement>(null);
  const [heading, setHeading] = useState(0);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [orbitCursorAngle, setOrbitCursorAngle] = useState(0);
  const [orbitCursorOpacity, setOrbitCursorOpacity] = useState(0);

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
      setHeading(viewer.scene.camera.heading);
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

    const onDblClick = (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      handleDoubleClick();
    };

    el.addEventListener('mousedown', onMouseDown, true);
    el.addEventListener('touchstart', onMouseDown, { capture: true, passive: false });
    el.addEventListener('dblclick', onDblClick, true);

    return () => {
      el.removeEventListener('mousedown', onMouseDown, true);
      el.removeEventListener('touchstart', onMouseDown, true);
      el.removeEventListener('dblclick', onDblClick, true);
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
    const nominalTotalRadius = 145;
    const norminalGyroRadius = 50;

    if (distanceFraction < norminalGyroRadius / nominalTotalRadius) {
      orbit(compassElement, vector);
    } else if (distanceFraction < 1.0) {
      rotate(compassElement, vector);
    }
  };

  const handleDoubleClick = () => {
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
    setOrbitCursorAngle(oAngle);

    const distance = Cartesian2.magnitude(vector);
    const maxDistance = compassWidth / 2.0;
    const distanceFraction = Math.min(distance / maxDistance, 1.0);
    const easedOpacity = 0.5 * distanceFraction * distanceFraction + 0.5;
    stateRef.current.orbitCursorOpacity = easedOpacity;
    setOrbitCursorOpacity(easedOpacity);
  };

  const orbit = (compassElement: HTMLElement, cursorVector: Cartesian2) => {
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

    setIsOrbiting(true);
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
      setIsOrbiting(false);
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
      <div className="compass-outer-ring-background"></div>
      
      {isOrbiting && (
        <div className="compass-rotation-marker" style={{ transform: `rotate(-${orbitCursorAngle}rad)`, opacity: orbitCursorOpacity }}>
          <svg width="100%" height="100%" viewBox="0 0 145 145">
            <path d="M 72.46875,22.03125 C 59.505873,22.050338 46.521615,27.004287 36.6875,36.875 L 47.84375,47.96875 C 61.521556,34.240041 83.442603,34.227389 97.125,47.90625 l 11.125,-11.125 C 98.401629,26.935424 85.431627,22.012162 72.46875,22.03125 z" />
          </svg>
        </div>
      )}
      
      <div className="compass-outer-ring" style={{ transform: `rotate(-${heading}rad)` }}>
        <svg width="100%" height="100%" viewBox="0 0 145 145">
          <path d="m 66.5625,0 0,15.15625 3.71875,0 0,-10.40625 5.5,10.40625 4.375,0 0,-15.15625 -3.71875,0 0,10.40625 L 70.9375,0 66.5625,0 z M 72.5,20.21875 c -28.867432,0 -52.28125,23.407738 -52.28125,52.28125 0,28.87351 23.413818,52.3125 52.28125,52.3125 28.86743,0 52.28125,-23.43899 52.28125,-52.3125 0,-28.873512 -23.41382,-52.28125 -52.28125,-52.28125 z m 0,1.75 c 13.842515,0 26.368948,5.558092 35.5,14.5625 l -11.03125,11 0.625,0.625 11.03125,-11 c 8.9199,9.108762 14.4375,21.579143 14.4375,35.34375 0,13.764606 -5.5176,26.22729 -14.4375,35.34375 l -11.03125,-11 -0.625,0.625 11.03125,11 c -9.130866,9.01087 -21.658601,14.59375 -35.5,14.59375 -13.801622,0 -26.321058,-5.53481 -35.4375,-14.5 l 11.125,-11.09375 c 6.277989,6.12179 14.857796,9.90625 24.3125,9.90625 19.241896,0 34.875,-15.629154 34.875,-34.875 0,-19.245847 -15.633104,-34.84375 -34.875,-34.84375 -9.454704,0 -18.034511,3.760884 -24.3125,9.875 L 37.0625,36.4375 C 46.179178,27.478444 58.696991,21.96875 72.5,21.96875 z m -0.875,0.84375 0,13.9375 1.75,0 0,-13.9375 -1.75,0 z M 36.46875,37.0625 47.5625,48.15625 C 41.429794,54.436565 37.65625,63.027539 37.65625,72.5 c 0,9.472461 3.773544,18.055746 9.90625,24.34375 L 36.46875,107.9375 c -8.96721,-9.1247 -14.5,-21.624886 -14.5,-35.4375 0,-13.812615 5.53279,-26.320526 14.5,-35.4375 z M 72.5,39.40625 c 18.297686,0 33.125,14.791695 33.125,33.09375 0,18.302054 -14.827314,33.125 -33.125,33.125 -18.297687,0 -33.09375,-14.822946 -33.09375,-33.125 0,-18.302056 14.796063,-33.09375 33.09375,-33.09375 z M 22.84375,71.625 l 0,1.75 13.96875,0 0,-1.75 -13.96875,0 z m 85.5625,0 0,1.75 14,0 0,-1.75 -14,0 z M 71.75,108.25 l 0,13.9375 1.71875,0 0,-13.9375 -1.71875,0 z" />
        </svg>
      </div>

      <div className="compass-gyro-background"></div>

      <div className={`compass-gyro ${isOrbiting ? 'compass-gyro-active' : ''}`}>
        <svg width="100%" height="100%" viewBox="0 0 145 145">
          <path d="m 72.71875,54.375 c -0.476702,0 -0.908208,0.245402 -1.21875,0.5625 -0.310542,0.317098 -0.551189,0.701933 -0.78125,1.1875 -0.172018,0.363062 -0.319101,0.791709 -0.46875,1.25 -6.91615,1.075544 -12.313231,6.656514 -13,13.625 -0.327516,0.117495 -0.661877,0.244642 -0.9375,0.375 -0.485434,0.22959 -0.901634,0.471239 -1.21875,0.78125 -0.317116,0.310011 -0.5625,0.742111 -0.5625,1.21875 l 0.03125,0 c 0,0.476639 0.245384,0.877489 0.5625,1.1875 0.317116,0.310011 0.702066,0.58291 1.1875,0.8125 0.35554,0.168155 0.771616,0.32165 1.21875,0.46875 1.370803,6.10004 6.420817,10.834127 12.71875,11.8125 0.146999,0.447079 0.30025,0.863113 0.46875,1.21875 0.230061,0.485567 0.470708,0.870402 0.78125,1.1875 0.310542,0.317098 0.742048,0.5625 1.21875,0.5625 0.476702,0 0.876958,-0.245402 1.1875,-0.5625 0.310542,-0.317098 0.582439,-0.701933 0.8125,-1.1875 0.172018,-0.363062 0.319101,-0.791709 0.46875,-1.25 6.249045,-1.017063 11.256351,-5.7184 12.625,-11.78125 0.447134,-0.1471 0.86321,-0.300595 1.21875,-0.46875 0.485434,-0.22959 0.901633,-0.502489 1.21875,-0.8125 0.317117,-0.310011 0.5625,-0.710861 0.5625,-1.1875 l -0.03125,0 c 0,-0.476639 -0.245383,-0.908739 -0.5625,-1.21875 C 89.901633,71.846239 89.516684,71.60459 89.03125,71.375 88.755626,71.244642 88.456123,71.117495 88.125,71 87.439949,64.078341 82.072807,58.503735 75.21875,57.375 c -0.15044,-0.461669 -0.326927,-0.884711 -0.5,-1.25 -0.230061,-0.485567 -0.501958,-0.870402 -0.8125,-1.1875 -0.310542,-0.317098 -0.710798,-0.5625 -1.1875,-0.5625 z m -0.0625,1.40625 c 0.03595,-0.01283 0.05968,0 0.0625,0 0.0056,0 0.04321,-0.02233 0.1875,0.125 0.144288,0.147334 0.34336,0.447188 0.53125,0.84375 0.06385,0.134761 0.123901,0.309578 0.1875,0.46875 -0.320353,-0.01957 -0.643524,-0.0625 -0.96875,-0.0625 -0.289073,0 -0.558569,0.04702 -0.84375,0.0625 C 71.8761,57.059578 71.936151,56.884761 72,56.75 c 0.18789,-0.396562 0.355712,-0.696416 0.5,-0.84375 0.07214,-0.07367 0.120304,-0.112167 0.15625,-0.125 z m 0,2.40625 c 0.448007,0 0.906196,0.05436 1.34375,0.09375 0.177011,0.592256 0.347655,1.271044 0.5,2.03125 0.475097,2.370753 0.807525,5.463852 0.9375,8.9375 -0.906869,-0.02852 -1.834463,-0.0625 -2.78125,-0.0625 -0.92298,0 -1.802327,0.03537 -2.6875,0.0625 0.138529,-3.473648 0.493653,-6.566747 0.96875,-8.9375 0.154684,-0.771878 0.320019,-1.463985 0.5,-2.0625 0.405568,-0.03377 0.804291,-0.0625 1.21875,-0.0625 z m -2.71875,0.28125 c -0.129732,0.498888 -0.259782,0.987558 -0.375,1.5625 -0.498513,2.487595 -0.838088,5.693299 -0.96875,9.25 -3.21363,0.15162 -6.119596,0.480068 -8.40625,0.9375 -0.682394,0.136509 -1.275579,0.279657 -1.84375,0.4375 0.799068,-6.135482 5.504716,-11.036454 11.59375,-12.1875 z M 75.5,58.5 c 6.043169,1.18408 10.705093,6.052712 11.5,12.15625 -0.569435,-0.155806 -1.200273,-0.302525 -1.875,-0.4375 -2.262525,-0.452605 -5.108535,-0.783809 -8.28125,-0.9375 -0.130662,-3.556701 -0.470237,-6.762405 -0.96875,-9.25 C 75.761959,59.467174 75.626981,58.990925 75.5,58.5 z m -2.84375,12.09375 c 0.959338,0 1.895843,0.03282 2.8125,0.0625 C 75.48165,71.267751 75.5,71.871028 75.5,72.5 c 0,1.228616 -0.01449,2.438313 -0.0625,3.59375 -0.897358,0.0284 -1.811972,0.0625 -2.75,0.0625 -0.927373,0 -1.831062,-0.03473 -2.71875,-0.0625 -0.05109,-1.155437 -0.0625,-2.365134 -0.0625,-3.59375 0,-0.628972 0.01741,-1.232249 0.03125,-1.84375 0.895269,-0.02827 1.783025,-0.0625 2.71875,-0.0625 z M 68.5625,70.6875 c -0.01243,0.60601 -0.03125,1.189946 -0.03125,1.8125 0,1.22431 0.01541,2.407837 0.0625,3.5625 -3.125243,-0.150329 -5.92077,-0.471558 -8.09375,-0.90625 -0.784983,-0.157031 -1.511491,-0.316471 -2.125,-0.5 -0.107878,-0.704096 -0.1875,-1.422089 -0.1875,-2.15625 0,-0.115714 0.02849,-0.228688 0.03125,-0.34375 0.643106,-0.20284 1.389577,-0.390377 2.25,-0.5625 2.166953,-0.433487 4.97905,-0.75541 8.09375,-0.90625 z m 8.3125,0.03125 c 3.075121,0.15271 5.824455,0.446046 7.96875,0.875 0.857478,0.171534 1.630962,0.360416 2.28125,0.5625 0.0027,0.114659 0,0.228443 0,0.34375 0,0.735827 -0.07914,1.450633 -0.1875,2.15625 -0.598568,0.180148 -1.29077,0.34562 -2.0625,0.5 -2.158064,0.431708 -4.932088,0.754666 -8.03125,0.90625 0.04709,-1.154663 0.0625,-2.33819 0.0625,-3.5625 0,-0.611824 -0.01924,-1.185379 -0.03125,-1.78125 z M 57.15625,72.5625 c 0.0023,0.572772 0.06082,1.131112 0.125,1.6875 -0.125327,-0.05123 -0.266577,-0.10497 -0.375,-0.15625 -0.396499,-0.187528 -0.665288,-0.387337 -0.8125,-0.53125 -0.147212,-0.143913 -0.15625,-0.182756 -0.15625,-0.1875 0,-0.0047 -0.02221,-0.07484 0.125,-0.21875 0.147212,-0.143913 0.447251,-0.312472 0.84375,-0.5 0.07123,-0.03369 0.171867,-0.06006 0.25,-0.09375 z m 31.03125,0 c 0.08201,0.03503 0.175941,0.05872 0.25,0.09375 0.396499,0.187528 0.665288,0.356087 0.8125,0.5 0.14725,0.14391 0.15625,0.21405 0.15625,0.21875 0,0.0047 -0.009,0.04359 -0.15625,0.1875 -0.147212,0.143913 -0.416001,0.343722 -0.8125,0.53125 -0.09755,0.04613 -0.233314,0.07889 -0.34375,0.125 0.06214,-0.546289 0.09144,-1.094215 0.09375,-1.65625 z m -29.5,3.625 c 0.479308,0.123125 0.983064,0.234089 1.53125,0.34375 2.301781,0.460458 5.229421,0.787224 8.46875,0.9375 0.167006,2.84339 0.46081,5.433176 0.875,7.5 0.115218,0.574942 0.245268,1.063612 0.375,1.5625 -5.463677,-1.028179 -9.833074,-5.091831 -11.25,-10.34375 z m 27.96875,0 C 85.247546,81.408945 80.919274,85.442932 75.5,86.5 c 0.126981,-0.490925 0.261959,-0.967174 0.375,-1.53125 0.41419,-2.066824 0.707994,-4.65661 0.875,-7.5 3.204493,-0.15162 6.088346,-0.480068 8.375,-0.9375 0.548186,-0.109661 1.051942,-0.220625 1.53125,-0.34375 z M 70.0625,77.53125 c 0.865391,0.02589 1.723666,0.03125 2.625,0.03125 0.912062,0 1.782843,-0.0048 2.65625,-0.03125 -0.165173,2.736408 -0.453252,5.207651 -0.84375,7.15625 -0.152345,0.760206 -0.322989,1.438994 -0.5,2.03125 -0.437447,0.03919 -0.895856,0.0625 -1.34375,0.0625 -0.414943,0 -0.812719,-0.02881 -1.21875,-0.0625 -0.177011,-0.592256 -0.347655,-1.271044 -0.5,-2.03125 -0.390498,-1.948599 -0.700644,-4.419842 -0.875,-7.15625 z m 1.75,10.28125 c 0.284911,0.01545 0.554954,0.03125 0.84375,0.03125 0.325029,0 0.648588,-0.01171 0.96875,-0.03125 -0.05999,0.148763 -0.127309,0.31046 -0.1875,0.4375 -0.18789,0.396562 -0.386962,0.696416 -0.53125,0.84375 -0.144288,0.147334 -0.181857,0.125 -0.1875,0.125 -0.0056,0 -0.07446,0.02233 -0.21875,-0.125 C 72.355712,88.946416 72.18789,88.646562 72,88.25 71.939809,88.12296 71.872486,87.961263 71.8125,87.8125 z" />
        </svg>
      </div>
    </div>
  );
}
