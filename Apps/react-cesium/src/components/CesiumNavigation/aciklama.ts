/*
Viewed Pusula.tsx:386-425

Bu dosya, CesiumJS (3 boyutlu harita motoru) üzerinde kamerayı yönlendirmek için kullanılan **etkileşimli bir pusula** bileşenidir. Ekranın sağ üst köşesinde durur ve hem kameranın nereye baktığını gösterir hem de fareyle tutulup çevrilerek kamerayı kontrol etmeyi sağlar.

Kodu anlamayı kolaylaştırmak için 4 ana bölüme ayırabiliriz:

---

### 1. Temel Mantık ve Performans (Neden böyle yazılmış?)

React uygulamalarında ekrandaki bir değeri değiştirdiğinizde (örneğin pusulanın dönüş açısı), React o bileşeni baştan aşağı yeniden çizer (buna *re-render* denir). 
Ancak bir 3D haritada kamera saniyede 60 kez hareket edebilir. Pusulanın saniyede 60 kez baştan çizilmesi haritayı çok yavaşlatır (kattar).

Bu yüzden kodda özel bir optimizasyon yapılmıştır:
- React'in klasik **`useState` (durum tutucu)** yapısı yerine **`useRef` (referans tutucu)** kullanılmıştır.
- Kamera döndüğünde React'e "bileşeni baştan çiz" demek yerine, pusulanın HTML koduna (DOM) gidilip **"sadece senin dönüş açını değiştiriyorum"** denir. Bu sayede pusula yağ gibi akar ve performansı hiç etkilemez.

### 2. Önemli Yapıtaşları (Referanslar)

Kodun başında pusulanın farklı parçalarına ulaşmak için "kancalar" (referanslar) tanımlanmıştır:
- `pusula_ref`: Pusulanın en dış kutusu. Fare tıklamalarını yakalamak için kullanılır.
- `dis_halka_ref`: Üzerinde Kuzey, Güney yazan dönen dış halka.
- `orbit_isaretci_ref`: Fareyle pusulayı tuttuğunuzda beliren mavi yay (gösterge).
- `gyro_ref`: Pusulanın en içindeki sabit duran daire.

Ayrıca `state_ref` adında büyük bir depo vardır. Bu depo; kullanıcı pusulaya tıkladığında farenin nerede olduğunu, kameranın o anki açısını ve hareketin ne zaman başladığını **React'i uyandırmadan** aklında tutar.

### 3. Kullanıcı Etkileşimleri (Tıklama ve Sürükleme)

Kullanıcı pusulaya tıkladığında olaylar şu sırayla gerçekleşir:

*   **`handle_mouse_down` (Fareye Basıldığında):**
    Kullanıcının pusulanın tam olarak neresine tıkladığını hesaplar. 
    - Eğer tam **ortaya (iç daireye)** tıkladıysa, kamerayı bir merkezin etrafında döndürmek için `orbit` metodunu çağırır.
    - Eğer **dış halkaya** tıkladıysa, kamerayı olduğu yerde sağa/sola çevirmek için `dondur` metodunu çağırır.

*   **`handle_double_click` (Çift Tıklama):**
    Pusulaya çift tıklandığında kamerayı anında standart harita görünümüne (Kuzeye ve düz aşağıya bakacak şekilde) hizalar. (Sizin isteğinizle buradaki yavaş animasyonu kaldırdık, artık anında dönüyor).

### 4. Kamerayı Hareket Ettiren Ana Metodlar

Kameranın hareketini sağlayan iki ana motor vardır:

#### A. `dondur` Metodu (Kamerayı Olduğu Yerde Çevirme)
Siz kendi etrafınızda dönüp etrafa bakıyormuşsunuz gibi düşünün.
- Dış halkaya tıklayıp fareyi sürüklediğinizde çalışır.
- Farenin ne kadar sürüklendiğini (`hareket_fonksiyonu` içinde) hesaplar ve kameranın `heading` (bakış açısı) değerini o kadar değiştirir.
- Fareyi bıraktığınızda (`birakma_fonksiyonu`) dinlemeyi bırakır.

#### B. `orbit` Metodu (Bir Merkezin Etrafında Dönme)
Bir heykelin etrafında yürüyerek ona bakıyormuşsunuz gibi düşünün.
- İç daireye tıklandığında çalışır.
- Önce kameranın haritada tam olarak **nereye baktığını** bulur (Bunu `kamera_odagini_al` metodu yapar).
- `orbit_tick_fonksiyonu` adında özel bir motor kurar. Bu motor her saniye 60 kere çalışarak, siz fareyi basılı tutup sağa sola çektikçe kamerayı o odak noktasının etrafında bir yörüngede (orbit) döndürür.
- Fare hareket ettikçe mavi bir gösterge belirir (`aci_ve_opakligi_guncelle` metodu bu göstergenin şeffaflığını ve açısını ayarlar).

---

### Özetle Kodun Akışı:
1. Cesium kamerası her hareket ettiğinde, Pusulanın **dış halkası** doğrudan HTML üzerinden döndürülür (`post_render` metodu).
2. Siz pusulaya tıkladığınızda kod araya girer (Cesium'un kendi kontrollerini ezer) ve nereye tıkladığınıza göre ya **Orbit (Yörünge)** modunu ya da **Döndürme** modunu başlatır.
3. Fareyi sürüklediğiniz sürece kameraya yeni koordinatlar verilir.
4. Fareyi bıraktığınızda tüm temizlik işlemleri yapılır ve sistem normale döner.

*/