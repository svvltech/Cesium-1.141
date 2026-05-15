import React, { useEffect, useRef } from 'react';
import { Cartesian2, Cartesian3, Transforms, Matrix4, SceneMode, BoundingSphere, HeadingPitchRange, Math as CesiumMath, getTimestamp, defined, Ray, Viewer } from 'cesium';

interface CompassProps {
  viewer: Viewer;
}

// === PUSULA TASARIM SABITLERI ===
// Boyut degisiklikleri yapmak icin sadece buradaki degerleri duzenleyin.
// Turetilen degerler (merkez, oran vb.) otomatik hesaplanir.

const VIEWBOX_SIZE = 145;                   // SVG viewBox genislik/yukseklik
const CENTER = VIEWBOX_SIZE / 2;            // = 72.5 - SVG merkez noktasi

// Daireler
const OUTER_RADIUS = 70;                    // Dis (gri) daire yaricapi
const OUTER_BORDER_WIDTH = 3;               // Dis daire border kalinligi
const INNER_RADIUS = 32;                    // Ic (beyaz) daire yaricapi

// Oranlar (tiklama sinirlari & opaklik hesabi)
const GYRO_RADIUS_RATIO = INNER_RADIUS / CENTER; // = 0.441 - orbit/rotate gecis esigi

// Orbit gostergesi (mavi yay)
const ORBIT_INDICATOR_SCALE = 1.386;        // Dis siniri r=70'e oturtacak olcek
const ORBIT_INDICATOR_STROKE_WIDTH = 4;     // Yayin kalinligi

// N kutusu
const N_BOX_SIZE = 30;                      // N kutucugu genislik/yukseklik
const N_BOX_CORNER_RADIUS = 5;              // Kose yuvarlakligi
const N_BOX_Y = -15;                        // Ust kenar Y pozisyonu
const N_BOX_X = CENTER - N_BOX_SIZE / 2;    // = 57.5 - Sol kenar X pozisyonu

// Oklar
const ARROW_INSET = 16;                     // Ok ucunun dis kenara mesafesi
const ARROW_SPREAD = 9;                     // Ok tabaninin genisliginin yarisi
const ARROW_DEPTH = 9;                      // Ok ucundan tabana mesafe

// Kup
const CUBE_SCALE = 0.8;                     // Kup olcegi

export default function Compass({ viewer }: CompassProps) {
  // DOM Referanslari
  const pusula_ref = useRef<HTMLDivElement>(null);
  const dis_halka_ref = useRef<HTMLDivElement>(null);
  const n_kutu_katmani_ref = useRef<HTMLDivElement>(null);
  const orbit_isaretci_ref = useRef<HTMLDivElement>(null);
  const gyro_ref = useRef<HTMLDivElement>(null);

  // Re-render tetiklemeden, surukleme durumunu takip etmek icin kullanilan mutable state referansi
  const state_ref = useRef<{
    orbit_son_zaman_damgasi: number;
    orbit_cercevesi?: Matrix4;
    orbit_bakis_modu_mu: boolean;
    orbit_imlec_acisi: number;
    orbit_imlec_opakligi: number;
    orbit_tick_fonksiyonu?: () => void;
    orbit_mouse_move_fonksiyonu?: (e: any) => void;
    orbit_mouse_up_fonksiyonu?: () => void;
    donuyor_mu: boolean;
    donme_ilk_imlec_acisi: number;
    donme_cercevesi?: Matrix4;
    donme_bakis_modu_mu: boolean;
    donme_ilk_kamera_acisi: number;
    donme_mouse_move_fonksiyonu?: (e: any) => void;
    donme_mouse_up_fonksiyonu?: () => void;
  }>({
    orbit_son_zaman_damgasi: 0,
    orbit_cercevesi: undefined,
    orbit_bakis_modu_mu: false,
    orbit_imlec_acisi: 0,
    orbit_imlec_opakligi: 0,
    orbit_tick_fonksiyonu: undefined,
    orbit_mouse_move_fonksiyonu: undefined,
    orbit_mouse_up_fonksiyonu: undefined,
    donuyor_mu: false,
    donme_ilk_imlec_acisi: 0,
    donme_cercevesi: undefined,
    donme_bakis_modu_mu: false,
    donme_ilk_kamera_acisi: 0,
    donme_mouse_move_fonksiyonu: undefined,
    donme_mouse_up_fonksiyonu: undefined
  });

  // Bilesen unmount oldugunda (ekrandan kalktiginda) 
  // havada kalan window event'lerini ve Cesium onTick listener'larini temizler.
  useEffect(() => {
    return () => {
      if (state_ref.current.orbit_mouse_up_fonksiyonu) {
        state_ref.current.orbit_mouse_up_fonksiyonu();
      }
      if (state_ref.current.donme_mouse_up_fonksiyonu) {
        state_ref.current.donme_mouse_up_fonksiyonu();
      }
    };
  }, []);

  // Kameranin odak noktasini bulur
  const kamera_odagini_al = (guncel_viewer: Viewer): Cartesian3 | undefined => {
    const scene = guncel_viewer.scene;
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

  // React render dongusunu bypass ederek, her Cesium karesinde (frame)
  // DOM elementlerinin donus acilarini gunceller (60fps pruzsuzluk saglar)
  useEffect(() => {
    if (!viewer) return;

    const post_render = () => {
      const current_heading = viewer.scene.camera.heading;
      if (dis_halka_ref.current) {
        dis_halka_ref.current.style.transform = `rotate(-${current_heading}rad)`;
      }
      if (n_kutu_katmani_ref.current) {
        n_kutu_katmani_ref.current.style.transform = `rotate(-${current_heading}rad)`;
      }
    };

    const remove_post_render = viewer.scene.postRender.addEventListener(post_render);

    return () => {
      remove_post_render();
    };
  }, [viewer]);

  const fare_koordinatlarini_al = (e: any) => {
    let gecici = e.touches ? e.touches[0] : e;
    return { x: gecici.clientX, y: gecici.clientY };
  };

  // React'in kendi onMouseDown (Synthetic Event) sistemi, Cesium'un ScreenSpaceEventHandler'i ile
  // cakisabilecegi icin dogrudan DOM elementine native (capture: true) event bagliyoruz.
  useEffect(() => {
    const eleman = pusula_ref.current;
    if (!eleman) return;

    const on_mouse_down = (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      handle_mouse_down(e);
    };

    eleman.addEventListener('mousedown', on_mouse_down, true);
    eleman.addEventListener('touchstart', on_mouse_down, { capture: true, passive: false });

    return () => {
      eleman.removeEventListener('mousedown', on_mouse_down, true);
      eleman.removeEventListener('touchstart', on_mouse_down, true);
    };
  }, [viewer]);

  // Ana tiklama mantigi: Kullanicinin N kutusuna mi yoksa orbit bolgesine mi tikladigini ayirt eder
  const handle_mouse_down = (e: any) => {
    const { x, y } = fare_koordinatlarini_al(e);
    const scene = viewer.scene;
    if (scene.mode === SceneMode.MORPHING) return;

    const pusula_elemani = pusula_ref.current;
    if (!pusula_elemani) return;

    const pusula_dortgeni = pusula_elemani.getBoundingClientRect();
    const maksimum_mesafe = pusula_dortgeni.width / 2.0;
    const merkez = new Cartesian2((pusula_dortgeni.right - pusula_dortgeni.left) / 2.0, (pusula_dortgeni.bottom - pusula_dortgeni.top) / 2.0);
    const tiklama_konumu = new Cartesian2(x - pusula_dortgeni.left, y - pusula_dortgeni.top);
    const vektor = Cartesian2.subtract(tiklama_konumu, merkez, new Cartesian2());
    const merkeze_uzaklik = Cartesian2.magnitude(vektor);

    const mesafe_orani = merkeze_uzaklik / maksimum_mesafe;

    if ((e.target as Element)?.closest?.('.n-box-rect')) {
      // Sadece N kutusu donme (rotate/yaw) islevine sahiptir
      donme_baslat(pusula_elemani, vektor);
    } else if (mesafe_orani < 1.0) {
      // Dairenin geri kalani (ic ve dis) orbit islevine sahiptir
      const ic_daire_mi = mesafe_orani < GYRO_RADIUS_RATIO;
      orbit_baslat(pusula_elemani, vektor, ic_daire_mi);
    }
  };

  // Kamerayi kuzeye ve asagiya dogru (standart harita gorunumu) hizalar
  const kuzeye_hizala = () => {
    const scene = viewer.scene;
    const camera = scene.camera;
    const sscc = scene.screenSpaceCameraController;

    if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs) return;

    if (scene.mode === SceneMode.COLUMBUS_VIEW && !sscc.enableTranslate) return;
    if (scene.mode === SceneMode.SCENE3D || scene.mode === SceneMode.COLUMBUS_VIEW) {
      if (!sscc.enableLook) return;
      if (scene.mode === SceneMode.SCENE3D && !sscc.enableRotate) return;
    }

    const odak = kamera_odagini_al(viewer);
    if (!odak) {
      camera.flyHome(1);
      return;
    }

    const kamera_pozisyonu = scene.globe.ellipsoid.cartographicToCartesian(camera.positionCartographic, new Cartesian3());
    const yuzey_normali = scene.globe.ellipsoid.geodeticSurfaceNormal(odak);
    const focus_bounding_sphere = new BoundingSphere(odak, 0);

    camera.flyToBoundingSphere(focus_bounding_sphere, {
      offset: new HeadingPitchRange(0,
        CesiumMath.PI_OVER_TWO - Cartesian3.angleBetween(yuzey_normali, camera.directionWC),
        Cartesian3.distance(kamera_pozisyonu, odak)
      ),
      duration: 1.5
    });
  };

  // Orbit sirasinda mavi yayin acisini ve hiz belirten opakligini hesaplar
  const aci_ve_opaklik_guncelle = (vektor: Cartesian2, pusula_genisligi: number) => {
    const aci = Math.atan2(-vektor.y, vektor.x);
    const o_aci = CesiumMath.zeroToTwoPi(aci - CesiumMath.PI_OVER_TWO);
    state_ref.current.orbit_imlec_acisi = o_aci;

    const mesafe = Cartesian2.magnitude(vektor);
    const maksimum_mesafe = pusula_genisligi / 2.0;

    // Orbit opakliginin ve donme hizinin ic daire sinirinda maksimum (1.0) olmasini sagliyoruz
    const gyro_yaricapi = maksimum_mesafe * GYRO_RADIUS_RATIO;
    const mesafe_orani = Math.min(mesafe / gyro_yaricapi, 1.0);
    const yumusatilmis_opaklik = 0.5 * mesafe_orani * mesafe_orani + 0.5;
    state_ref.current.orbit_imlec_opakligi = yumusatilmis_opaklik;

    if (orbit_isaretci_ref.current) {
      orbit_isaretci_ref.current.style.transform = `rotate(-${o_aci}rad)`;
      orbit_isaretci_ref.current.style.opacity = yumusatilmis_opaklik.toString();
    }
  };

  // Kamera egme ve cevresel donus (orbit) fonksiyonu
  const orbit_baslat = (pusula_elemani: HTMLElement, baslangic_vektoru: Cartesian2, ic_daire_mi: boolean) => {
    const scene = viewer.scene;
    const sscc = scene.screenSpaceCameraController;

    if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs) return;

    // .NET WebView2'den veya baska bir eklentiden gelebilecek
    // kamera kisitlamalarina (orn: egme kapali) saygi duyulur
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

    // Aktif bir orbit islemi varsa temizle
    if (state_ref.current.orbit_mouse_up_fonksiyonu) {
      state_ref.current.orbit_mouse_up_fonksiyonu();
    }

    let hareket_etti_mi = false;

    if (gyro_ref.current) {
      gyro_ref.current.classList.add('compass-gyro-active');
    }

    state_ref.current.orbit_son_zaman_damgasi = getTimestamp();

    const camera = scene.camera;
    const odak = kamera_odagini_al(viewer);

    if (!defined(odak)) {
      state_ref.current.orbit_cercevesi = Transforms.eastNorthUpToFixedFrame(camera.positionWC, scene.globe.ellipsoid, new Matrix4());
      state_ref.current.orbit_bakis_modu_mu = true;
    } else {
      state_ref.current.orbit_cercevesi = Transforms.eastNorthUpToFixedFrame(odak, scene.globe.ellipsoid, new Matrix4());
      state_ref.current.orbit_bakis_modu_mu = false;
    }

    state_ref.current.orbit_tick_fonksiyonu = () => {
      const zaman_damgasi = getTimestamp();
      const zaman_farki = zaman_damgasi - state_ref.current.orbit_son_zaman_damgasi;
      const hiz_orani = (state_ref.current.orbit_imlec_opakligi - 0.5) * 2.5 / 1000;
      const hiz_mesafesi = zaman_farki * hiz_orani;

      const aci = state_ref.current.orbit_imlec_acisi + CesiumMath.PI_OVER_TWO;
      const x = Math.cos(aci) * hiz_mesafesi;
      const y = Math.sin(aci) * hiz_mesafesi;

      let eski_transform: any;
      if (defined(state_ref.current.orbit_cercevesi)) {
        eski_transform = Matrix4.clone(camera.transform, new Matrix4());
        camera.lookAtTransform(state_ref.current.orbit_cercevesi);
      }

      if (scene.mode === SceneMode.SCENE2D) {
        camera.move(new Cartesian3(x, y, 0), Math.max(scene.canvas.clientWidth, scene.canvas.clientHeight) / 100 * camera.positionCartographic.height * hiz_mesafesi);
      } else {
        if (state_ref.current.orbit_bakis_modu_mu) {
          camera.look(Cartesian3.UNIT_Z, -x);
          camera.look(camera.right, -y);
        } else {
          camera.rotateLeft(x);
          camera.rotateUp(y);
        }
      }

      if (defined(state_ref.current.orbit_cercevesi)) {
        camera.lookAtTransform(eski_transform);
      }

      state_ref.current.orbit_son_zaman_damgasi = zaman_damgasi;
    };

    state_ref.current.orbit_mouse_move_fonksiyonu = (e: any) => {
      hareket_etti_mi = true;
      const { x, y } = fare_koordinatlarini_al(e);
      const pusula_dortgeni = pusula_elemani.getBoundingClientRect();
      const merkez = new Cartesian2((pusula_dortgeni.right - pusula_dortgeni.left) / 2.0, (pusula_dortgeni.bottom - pusula_dortgeni.top) / 2.0);
      const tiklama_konumu = new Cartesian2(x - pusula_dortgeni.left, y - pusula_dortgeni.top);
      const vektor = Cartesian2.subtract(tiklama_konumu, merkez, new Cartesian2());
      aci_ve_opaklik_guncelle(vektor, pusula_dortgeni.width);
    };

    const hareket_fonksiyonu = state_ref.current.orbit_mouse_move_fonksiyonu;
    const tick_fonksiyonu = state_ref.current.orbit_tick_fonksiyonu;

    const birakma_fonksiyonu = () => {
      // Eger sadece tiklanip birakildiysa (hic hareket yoksa) kamerayi kuzeye hizala
      if (!hareket_etti_mi && ic_daire_mi) {
        kuzeye_hizala();
      }

      if (orbit_isaretci_ref.current) {
        orbit_isaretci_ref.current.style.opacity = '0';
      }

      if (gyro_ref.current) {
        gyro_ref.current.classList.remove('compass-gyro-active');
      }

      window.removeEventListener('mousemove', hareket_fonksiyonu, true);
      window.removeEventListener('touchmove', hareket_fonksiyonu, true);
      window.removeEventListener('mouseup', birakma_fonksiyonu, true);
      window.removeEventListener('touchend', birakma_fonksiyonu, true);
      if (tick_fonksiyonu) {
        viewer.clock.onTick.removeEventListener(tick_fonksiyonu);
      }
      state_ref.current.orbit_mouse_move_fonksiyonu = undefined;
      state_ref.current.orbit_mouse_up_fonksiyonu = undefined;
      state_ref.current.orbit_tick_fonksiyonu = undefined;
    };
    state_ref.current.orbit_mouse_up_fonksiyonu = birakma_fonksiyonu;

    window.addEventListener('mousemove', hareket_fonksiyonu, true);
    window.addEventListener('touchmove', hareket_fonksiyonu, { capture: true, passive: false });
    window.addEventListener('mouseup', birakma_fonksiyonu, true);
    window.addEventListener('touchend', birakma_fonksiyonu, true);
    viewer.clock.onTick.addEventListener(state_ref.current.orbit_tick_fonksiyonu);
    aci_ve_opaklik_guncelle(baslangic_vektoru, pusula_elemani.getBoundingClientRect().width);
  };

  // Kamera dikey eksende (heading) cevirme fonksiyonu
  const donme_baslat = (pusula_elemani: HTMLElement, baslangic_vektoru: Cartesian2) => {
    const scene = viewer.scene;
    const camera = scene.camera;
    const sscc = scene.screenSpaceCameraController;

    // Iceride (orbit) oldugu gibi, dis halkada (rotate) da WebView2 kisitlamalari kontrol ediliyor.
    if (scene.mode === SceneMode.MORPHING || scene.mode === SceneMode.SCENE2D || !sscc.enableInputs) return;
    if (!sscc.enableLook && (scene.mode === SceneMode.COLUMBUS_VIEW || (scene.mode === SceneMode.SCENE3D && !sscc.enableRotate))) return;

    if (state_ref.current.donme_mouse_up_fonksiyonu) {
      state_ref.current.donme_mouse_up_fonksiyonu();
    }

    state_ref.current.donuyor_mu = true;
    state_ref.current.donme_ilk_imlec_acisi = Math.atan2(-baslangic_vektoru.y, baslangic_vektoru.x);

    const odak = kamera_odagini_al(viewer);

    if (!defined(odak) || (scene.mode === SceneMode.COLUMBUS_VIEW && !sscc.enableLook && !sscc.enableTranslate)) {
      state_ref.current.donme_cercevesi = Transforms.eastNorthUpToFixedFrame(camera.positionWC, scene.globe.ellipsoid, new Matrix4());
      state_ref.current.donme_bakis_modu_mu = true;
    } else {
      state_ref.current.donme_cercevesi = Transforms.eastNorthUpToFixedFrame(odak, scene.globe.ellipsoid, new Matrix4());
      state_ref.current.donme_bakis_modu_mu = false;
    }

    let eski_transform: any;
    if (defined(state_ref.current.donme_cercevesi)) {
      eski_transform = Matrix4.clone(camera.transform, new Matrix4());
      camera.lookAtTransform(state_ref.current.donme_cercevesi);
    }

    state_ref.current.donme_ilk_kamera_acisi = -camera.heading;

    if (defined(state_ref.current.donme_cercevesi)) {
      camera.lookAtTransform(eski_transform);
    }

    const hareket_fonksiyonu = (e: any) => {
      const { x, y } = fare_koordinatlarini_al(e);
      const pusula_dortgeni = pusula_elemani.getBoundingClientRect();
      const merkez = new Cartesian2((pusula_dortgeni.right - pusula_dortgeni.left) / 2.0, (pusula_dortgeni.bottom - pusula_dortgeni.top) / 2.0);
      const tiklama_konumu = new Cartesian2(x - pusula_dortgeni.left, y - pusula_dortgeni.top);
      const vektor = Cartesian2.subtract(tiklama_konumu, merkez, new Cartesian2());
      const aci = Math.atan2(-vektor.y, vektor.x);

      const aci_farki = aci - state_ref.current.donme_ilk_imlec_acisi;
      const yeni_kamera_acisi = CesiumMath.zeroToTwoPi(state_ref.current.donme_ilk_kamera_acisi - aci_farki);

      let gecici_transform: any;
      if (defined(state_ref.current.donme_cercevesi)) {
        gecici_transform = Matrix4.clone(camera.transform, new Matrix4());
        camera.lookAtTransform(state_ref.current.donme_cercevesi);
      }

      const current_heading = -camera.heading;
      camera.rotateRight(yeni_kamera_acisi - current_heading);

      if (defined(state_ref.current.donme_cercevesi)) {
        camera.lookAtTransform(gecici_transform);
      }
    };

    const birakma_fonksiyonu = () => {
      state_ref.current.donuyor_mu = false;
      window.removeEventListener('mousemove', hareket_fonksiyonu, true);
      window.removeEventListener('touchmove', hareket_fonksiyonu, true);
      window.removeEventListener('mouseup', birakma_fonksiyonu, true);
      window.removeEventListener('touchend', birakma_fonksiyonu, true);
      state_ref.current.donme_mouse_move_fonksiyonu = undefined;
      state_ref.current.donme_mouse_up_fonksiyonu = undefined;
    };

    state_ref.current.donme_mouse_move_fonksiyonu = hareket_fonksiyonu;
    state_ref.current.donme_mouse_up_fonksiyonu = birakma_fonksiyonu;

    window.addEventListener('mousemove', hareket_fonksiyonu, true);
    window.addEventListener('touchmove', hareket_fonksiyonu, { capture: true, passive: false });
    window.addEventListener('mouseup', birakma_fonksiyonu, true);
    window.addEventListener('touchend', birakma_fonksiyonu, true);
  };

  return (
    <div className="compass" title="" ref={pusula_ref}>

      <div ref={orbit_isaretci_ref} className="compass-rotation-marker" style={{ position: 'absolute', zIndex: 10, opacity: 0, pointerEvents: 'none' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <defs>
            {/* Bu maske, seklin dis daire disina tasmasini fiziksel olarak engeller */}
            <clipPath id="outer-circle-clip">
              <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS} />
            </clipPath>
          </defs>

          <g clipPath="url(#outer-circle-clip)">
            {/* Kalinligi artirmak icin ORBIT_INDICATOR_STROKE_WIDTH sabitini duzenleyin */}
            <g transform={`translate(${CENTER}, ${CENTER}) scale(${ORBIT_INDICATOR_SCALE}) translate(-${CENTER}, -${CENTER})`}>
              <path d="M 72.46875,22.03125 C 59.505873,22.050338 46.521615,27.004287 36.6875,36.875 L 47.84375,47.96875 C 61.521556,34.240041 83.442603,34.227389 97.125,47.90625 l 11.125,-11.125 C 98.401629,26.935424 85.431627,22.012162 72.46875,22.03125 z" fill="#68ADFE" stroke="#68ADFE" strokeWidth={ORBIT_INDICATOR_STROKE_WIDTH} strokeLinejoin="round" />
            </g>
          </g>
        </svg>
      </div>

      {/* 1. DIS HALKA ARKA PLANI (DONEN) */}
      <div ref={dis_halka_ref} className="compass-outer-ring" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}>
        <svg className="compass-asset-bg-circle" style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS} fill="#B3B3B3" stroke="#333333" strokeWidth={OUTER_BORDER_WIDTH} />
        </svg>
      </div>

      {/* 1C. N Yazan Kare - Ayri katmanda, orbit gostergesi (zIndex:10) ustunde kalir */}
      <div ref={n_kutu_katmani_ref} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 11, pointerEvents: 'none' }}>
        <svg className="compass-asset-n-square" style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <rect className="n-box-rect" x={N_BOX_X} y={N_BOX_Y} width={N_BOX_SIZE} height={N_BOX_SIZE} rx={N_BOX_CORNER_RADIUS} fill="white" style={{ pointerEvents: 'auto' }} />
          <text x={CENTER} y={N_BOX_Y + N_BOX_SIZE - 9} fontFamily="Arial" fontSize="16" fontWeight="bold" fill="black" textAnchor="middle" style={{ userSelect: 'none', pointerEvents: 'none' }}>N</text>
        </svg>
      </div>

      {/* 1B. Oklar (SABIT) */}
      <div className="compass-fixed-arrows" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none' }}>
        <svg className="compass-asset-arrows" style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          {/* Ust */}
          <polygon points={`${CENTER},${ARROW_INSET} ${CENTER + ARROW_SPREAD},${ARROW_INSET + ARROW_DEPTH} ${CENTER - ARROW_SPREAD},${ARROW_INSET + ARROW_DEPTH}`} fill="white" />
          {/* Sag */}
          <polygon points={`${VIEWBOX_SIZE - ARROW_INSET},${CENTER} ${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH},${CENTER - ARROW_SPREAD} ${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH},${CENTER + ARROW_SPREAD}`} fill="white" />
          {/* Alt */}
          <polygon points={`${CENTER},${VIEWBOX_SIZE - ARROW_INSET} ${CENTER - ARROW_SPREAD},${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH} ${CENTER + ARROW_SPREAD},${VIEWBOX_SIZE - ARROW_INSET - ARROW_DEPTH}`} fill="white" />
          {/* Sol */}
          <polygon points={`${ARROW_INSET},${CENTER} ${ARROW_INSET + ARROW_DEPTH},${CENTER + ARROW_SPREAD} ${ARROW_INSET + ARROW_DEPTH},${CENTER - ARROW_SPREAD}`} fill="white" />
        </svg>
      </div>

      {/* 2. IC HALKA (ORBIT/GYRO) */}
      <div ref={gyro_ref} className="compass-gyro" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 3 }}>

        {/* 2A. Ortadaki Daire */}
        <svg className="compass-asset-inner-circle" style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <circle cx={CENTER} cy={CENTER} r={INNER_RADIUS} fill="white" />
        </svg>

        {/* 2B. Ortadaki Kup */}
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
