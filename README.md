# Özgür Telli Finans — masaüstü uygulaması

`https://fzy.bogalab.com.tr` adresindeki klinik finans ve danışan yönetimi
sisteminin Windows ve macOS uygulaması.

## Uygulama neyi içerir, neyi içermez

Uygulama **arayüzü taşımaz**; canlı sitenin arayüzünü gösterir. Bu kasıtlı:
ayrı bir masaüstü arayüzü yazmak iki kod tabanı demekti ve ikisi kaçınılmaz
olarak birbirinden ayrışırdı.

Sonucu şudur: **sistemde yapılan her değişiklik uygulamaya anında yansır.**
Yeni rapor, yeni alan, düzeltme, tasarım değişikliği — hiçbiri yeni paket
gerektirmez. Yalnızca bu depodaki kabuk değiştiğinde (pencere davranışı,
menü, bildirimler, tepsi, Electron sürümü) yeni paket gerekir.

Kabuğun sağladıkları: çerçevesiz pencere ve sürüklenebilir üst çubuk,
animasyonlu açılış, yerel Türkçe menü ve kısayollar, işletim sistemi
bildirimleri, tepsi simgesi, çevrimdışı karşılama, pencere konumu hafızası,
otomatik güncelleme.

## Derleme

Derleme **GitHub Actions üzerinde** yapılır: macOS paketi ancak gerçek bir
Mac'te düzgün üretilir, barındırma sunucusu ise Linux.

- **Sürüm yayınlamak:** `package.json` içindeki sürümü yükselt, işle, etiket at:
  ```
  git tag v2.0.1 && git push origin v2.0.1
  ```
  İş akışı iki platformda derler ve paketleri **sürüm (release) sayfasına**
  koyar: `https://github.com/orginscorel/ozgur-telli-finans-masaustu/releases`
- **Deneme derlemesi:** Actions sekmesi → "Paketleri üret" → "Run workflow".
  Etiket olmadığı için paket yüklenmez, yalnızca derlemenin sağlamlığı denenir.

> Paketler bilinçli olarak Actions "artifact" deposuna değil sürüm sayfasına
> yüklenir: hesabın artifact kotası dolu ("Artifact storage quota has been
> hit") ve derleme başarılı olsa bile yükleme adımı tökezliyordu. Release
> varlıkları o kotaya girmez.

Yerelde (node kurulu bir makinede):
```
npm install
npm run windows   # yalnızca Windows'ta
npm run macos     # yalnızca macOS'ta
```

> `package-lock.json` henüz yok; barındırma sunucusunda node kurulu olmadığı
> için üretilemedi. İlk derlemeden sonra çıkan kilit dosyası depoya eklenirse
> iş akışındaki `npm install` satırı `npm ci` yapılabilir ve derlemeler
> birbirinin tıpatıp aynısı olur.

## Otomatik güncelleme

Güncelleme beslemesi **GitHub'da değil, kendi sunucumuzda**:
`https://fzy.bogalab.com.tr/paket/`. Sebebi, bu deponun özel olması — GitHub
beslemesi kullanılsa uygulamanın içine bir GitHub anahtarı gömmek gerekirdi ve
o anahtar paketi açan herkese görünür olurdu.

| Platform | Davranış |
|---|---|
| **Windows** | Paketi kendiliğinden indirir, kurulum için onay ister. |
| **macOS** | Yalnızca haber verir, indirme bağlantısını açar. |

macOS'ta kendiliğinden güncelleme **yapılamaz**: Apple'ın güncelleme çatısı
paketin geçerli bir imza taşımasını şart koşar, imzasız uygulamada kurulum
sessizce reddedilir. Apple Developer hesabı alınırsa
`kaynak/guncelleme.js` içindeki platform dallanması kaldırılabilir.

Yayınlanan sürüm bilgisi sitenin kendi ucundan okunur
(`/api/masaustu/surum` → `config/masaustu.php`). **Yeni paket yayınlandığında o
dosyadaki `surum`, `tarih` ve `notlar` alanları güncellenmelidir**, yoksa
uygulama yeni sürümü hiç görmez.

## İmza

Paketler **imzasız** dağıtılıyor (bilinçli karar).

- **Windows:** ilk kurulumda SmartScreen "Windows bilgisayarınızı korudu"
  der. *Daha fazla bilgi → Yine de çalıştır.* Bir kez yapılır.
- **macOS:** ilk açılışta "doğrulanamadı" der. Uygulama simgesine *sağ tık →
  Aç* denir. Bir kez yapılır.

İmza istenirse: Windows'ta bulut imzalı kod imzalama sertifikası,
macOS'ta Apple Developer hesabı (99 $/yıl) gerekir.

## Paketleri siteye yükleme

İş akışının son adımı paketleri siteye kopyalar. Bunun için depo ayarlarına
(*Settings → Secrets and variables → Actions*) şu gizli değerler eklenir:

| Ad | Değer |
|---|---|
| `SUNUCU_ADRES` | sunucunun adresi |
| `SUNUCU_KULLANICI` | `bogalabcom` |
| `SUNUCU_SSH_ANAHTARI` | yetkili özel SSH anahtarı (tamamı) |
| `SUNUCU_HEDEF_DIZIN` | `/home/bogalabcom/public_html/fzy.bogalab.com.tr/paket` |
| `SUNUCU_PORT` | varsayılan dışındaysa |

Bu değerler tanımlı değilse yükleme adımı **atlanır, iş başarısız olmaz** —
paketler Actions çıktısından elle indirilebilir.

## 1.1.0'dan geçiş

1.1.0 bir ZIP'ti ve güncelleyici içermiyordu; **kendiliğinden 2.0.0'a
geçemez.** 2.0.0 bir kez elle kurulur, sonraki güncellemeler otomatik olur.

Uygulama adı bilinçli olarak değiştirilmedi, bu yüzden kullanıcı ayarları ve
bildirim belirteci (işletim sisteminin `userData` klasöründe) korunur.
Kurulumdan sonra 1.1.0'ın açılmış ZIP klasörü elle silinebilir.
