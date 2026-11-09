/**
 * macOS için UYGULAMA İÇİ güncelleme.
 *
 * Neden Apple'ın kendi yolu kullanılmıyor
 * ---------------------------------------
 * electron-updater macOS'ta Squirrel.Mac üzerinden çalışır ve Squirrel,
 * indirilen paketin ÇALIŞAN uygulamanın kod imzası gereksinimini
 * karşılamasını şart koşar. Ad-hoc imzada (sertifikasız imza) bu gereksinim
 * ikilinin kendi özetine bağlıdır; yeni bir derlemenin özeti farklı olduğu
 * için eski sürümün gereksinimini hiçbir zaman karşılamaz ve güncelleme
 * sessizce reddedilir. Developer ID sertifikası alınırsa bu dosya tamamen
 * kaldırılıp Windows'taki electron-updater yolu ikisine de uygulanabilir.
 *
 * Bu yüzden indirme ve kurulum burada elle yapılıyor. Sıra şöyle:
 *   1. Besleme dosyası okunur  (paket/latest-mac.yml — electron-builder yazar)
 *   2. Mimariye uygun ZIP indirilir (ilerleme Dock simgesinde görünür)
 *   3. SHA-512 doğrulanır      — eşleşmezse hiçbir şeye dokunulmaz
 *   4. ditto ile açılır        — unzip KULLANILMAZ, çatı paketlerindeki
 *                                sembolik bağları bozuyor
 *   5. codesign ile denetlenir — yarım inen paket çalışan uygulamanın
 *                                yerini almasın
 *   6. Uygulama kapanınca kabuk betiği paketi değiştirip yeniden açar
 *
 * Besleme dosyası tek doğruluk kaynağı: sürüm, dosya adı, boyut ve SHA-512
 * orada. Ayrı bir yapılandırma tutmak aynı bilgiyi iki yerde tutmak olurdu.
 */
const { app, dialog } = require('electron')
const { execFile, spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { ADRES } = require('./ayarlar')
const { dahaYeni } = require('./surum')

const BESLEME = '/paket/latest-mac.yml'
const CALISTIR = (komut, argv) => new Promise((coz, red) => {
    execFile(komut, argv, { maxBuffer: 1 << 22 }, (hata, cikti) => (hata ? red(hata) : coz(cikti)))
})

/* İndirilip açılmış, kurulumu bekleyen sürüm. Kullanıcı "Sonra" derse
   paket silinmez: 6 saat sonraki denetimde 300 MB yeniden indirilmesin,
   yalnızca yeniden başlatma teklif edilsin. */
let bekleyen = null

/**
 * latest-mac.yml'yi ayrıştırır.
 *
 * Tam bir YAML çözücü taşımaya değmez: dosyanın biçimi sabit ve
 * electron-builder üretiyor. Yine de files bloğunun bittiği yer
 * (girintisiz bir satır) denetleniyor, yoksa bloktan SONRAKİ üst düzey
 * sha512 alanı son dosyanın üzerine yazılırdı.
 */
function beslemeyiAyristir(metin) {
    const surum = (metin.match(/^version:\s*(\S+)/m) || [])[1]
    const dosyalar = []
    let simdiki = null

    for (const ham of metin.split('\n')) {
        const satir = ham.replace(/\s+$/, '')
        let esleme

        if ((esleme = satir.match(/^\s*-\s*url:\s*(\S+)/))) {
            simdiki = { url: esleme[1] }
            dosyalar.push(simdiki)
            continue
        }

        if (!simdiki) continue

        if (/^\S/.test(satir)) { simdiki = null; continue }

        if ((esleme = satir.match(/^\s*sha512:\s*(\S+)/))) simdiki.sha512 = esleme[1]
        else if ((esleme = satir.match(/^\s*size:\s*(\d+)/))) simdiki.boyut = Number(esleme[1])
    }

    return { surum, dosyalar }
}

/** Çalışan mimariye uygun ZIP. DMG ilk kurulum için; güncellemede ZIP açılıyor. */
function dosyaSec(dosyalar) {
    const mimari = process.arch === 'arm64' ? 'arm64' : 'x64'

    return dosyalar.find((d) => /\.zip$/i.test(d.url) && d.url.includes(mimari)) || null
}

/** Kurulu paketin yolu: .../X.app (çalıştırılabilirden geriye yürünür). */
function paketYolu() {
    const yol = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '')

    return yol.endsWith('.app') ? yol : null
}

/**
 * Uygulama içi kurulumun MÜMKÜN olup olmadığı.
 *
 * Paket salt okunur bir yerdeyse (DMG'den çalıştırılmış, /Applications'a
 * yazma izni yok) kurulum zaten başarısız olurdu; denemek yerine haber
 * verme yoluna düşmek daha dürüst.
 */
function kurulabilir() {
    if (!app.isPackaged || process.platform !== 'darwin') return false

    const paket = paketYolu()
    if (!paket) return false

    try {
        fs.accessSync(path.dirname(paket), fs.constants.W_OK)
        fs.accessSync(paket, fs.constants.W_OK)

        return true
    } catch {
        return false
    }
}

async function beslemeOku() {
    const yanit = await fetch(new URL(BESLEME, ADRES), { cache: 'no-store' })
    if (!yanit.ok) throw new Error(`besleme ${yanit.status} döndü`)

    return beslemeyiAyristir(await yanit.text())
}

/** Dosyayı indirir; ilerleme Dock simgesindeki çubuğa yansır. */
async function indir(url, hedef, boyut, pencere) {
    const yanit = await fetch(url, { cache: 'no-store' })
    if (!yanit.ok || !yanit.body) throw new Error(`indirme ${yanit.status} döndü`)

    const toplam = Number(yanit.headers.get('content-length')) || boyut || 0
    let inen = 0
    let sonBildirim = 0

    const kaynak = Readable.fromWeb(yanit.body)
    kaynak.on('data', (parca) => {
        inen += parca.length
        /* Her parçada arayüze dokunmak gereksiz iş; saniyede ~10 kez yeter. */
        if (toplam && Date.now() - sonBildirim > 100) {
            sonBildirim = Date.now()
            pencere?.setProgressBar?.(Math.min(0.99, inen / toplam))
        }
    })

    await pipeline(kaynak, fs.createWriteStream(hedef))

    return inen
}

async function ozet(dosya) {
    const h = crypto.createHash('sha512')
    await pipeline(fs.createReadStream(dosya), h)

    return h.digest('base64')
}

/**
 * İndirilen paketi açar ve denetler.
 *
 * ditto kullanılıyor: unzip, .framework paketlerindeki sembolik bağları
 * gerçek dosyalara çevirip paketi bozuyor ve ortaya çalışmayan bir
 * uygulama çıkıyor. codesign denetimi de yarım inmiş ya da bozulmuş bir
 * paketin çalışan uygulamanın yerini almasını engelliyor.
 */
async function acVeDenetle(zip, dizin) {
    await fs.promises.rm(dizin, { recursive: true, force: true })
    await fs.promises.mkdir(dizin, { recursive: true })
    await CALISTIR('/usr/bin/ditto', ['-x', '-k', zip, dizin])

    const icerik = await fs.promises.readdir(dizin)
    const ad = icerik.find((a) => a.endsWith('.app'))
    if (!ad) throw new Error('arşivde uygulama paketi yok')

    const yeni = path.join(dizin, ad)
    await CALISTIR('/usr/bin/codesign', ['--verify', '--deep', '--strict', yeni])

    return yeni
}

/**
 * Değiş-tokuş betiği.
 *
 * Çalışan paketin üzerine yazılamaz; bu yüzden uygulama kapandıktan SONRA
 * iş yapan ayrı bir süreç gerekiyor. Eski paket silinmeden önce yedeğe
 * alınır ve yeni paket yerine konamazsa geri yüklenir: kullanıcı en kötü
 * durumda eski sürümle devam eder, uygulamasız kalmaz.
 */
function betikYaz(pid, hedef, yeni) {
    const betik = path.join(app.getPath('temp'), 'fzy-guncelle.sh')
    const kacis = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

    fs.writeFileSync(betik, `#!/bin/sh
hedef=${kacis(hedef)}
yeni=${kacis(yeni)}
yedek="$hedef.guncelleme-yedegi"

# Uygulamanın kapanmasını bekle (en çok 30 saniye).
i=0
while kill -0 ${pid} 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -gt 150 ] && break
    sleep 0.2
done

rm -rf "$yedek"
mv "$hedef" "$yedek" || exit 1

if mv "$yeni" "$hedef"; then
    rm -rf "$yedek"
    rm -rf "$(dirname "$yeni")"
else
    # Geri al: kullanıcı uygulamasız kalmasın.
    mv "$yedek" "$hedef"
fi

open "$hedef"
`, { mode: 0o755 })

    return betik
}

/** Kurulumu başlatır: betiği ayrı süreçte çalıştırıp uygulamadan çıkar. */
function kur(yeni) {
    const hedef = paketYolu()
    if (!hedef) return false

    const betik = betikYaz(process.pid, hedef, yeni)

    /* detached + unref: uygulama kapandıktan sonra da yaşaması gerekiyor,
       yoksa kendi kurulumunu yapan süreci de beraberinde götürürdü. */
    spawn('/bin/sh', [betik], { detached: true, stdio: 'ignore' }).unref()
    bekleyen = null
    app.quit()

    return true
}

/** Önceki oturumdan kalmış açılmış paketleri siler (yüzlerce MB tutuyorlar). */
function artiklariTemizle() {
    const paket = paketYolu()
    if (!paket) return

    try {
        fs.rmSync(path.join(path.dirname(paket), '.fzy-guncelleme'), { recursive: true, force: true })
        fs.rmSync(`${paket}.guncelleme-yedegi`, { recursive: true, force: true })
    } catch {
        // Temizlik başarısız olursa güncelleme yine çalışır; sessiz geçilir.
    }
}

/**
 * Uygulama içi güncelleme akışı.
 *
 * Hata kutusu BURADA gösterilmiyor. Bu işlev yalnızca ne olduğunu
 * bildirir; kullanıcıya ne söyleneceğine çağıran karar verir. Yoksa
 * kendiliğinden denetimde sessiz kalması gereken bir hata kutu açar ya da
 * elle denetlemede üst üste iki kutu çıkardı.
 *
 * Dönüş: { durum, hata? }
 *   durum = 'kuruluyor'  kurulum başladı, uygulama kapanıyor
 *         | 'guncel'     zaten en son sürüm
 *         | 'ertelendi'  yeni sürüm var, kullanıcı sonraya bıraktı
 *         | 'basarisiz'  hata alanında sebebi var
 */
async function guncelle(pencere) {
    let besleme

    try {
        besleme = await beslemeOku()
    } catch (hata) {
        return { durum: 'basarisiz', hata: `sürüm bilgisi okunamadı: ${hata?.message || hata}` }
    }

    if (!besleme.surum || !dahaYeni(besleme.surum, app.getVersion())) return { durum: 'guncel' }

    /* Zaten indirilmiş ve bekliyorsa yeniden indirme: kullanıcı "Sonra"
       dedikten sonraki denetimde 300 MB tekrar inmesin. */
    if (bekleyen && bekleyen.surum === besleme.surum) {
        return { durum: (await yenidenBaslatSor(pencere, besleme.surum, bekleyen.yol)) ? 'kuruluyor' : 'ertelendi' }
    }

    const dosya = dosyaSec(besleme.dosyalar)
    if (!dosya || !dosya.sha512) {
        /* Beslemede bu mimariye uygun ZIP yok. 2.0.6'dan önceki yayınlarda
           yalnızca DMG vardı; o durumda uygulama içi kurulum yapılamaz ve
           çağıran elle indirme yolunu sunar. */
        return { durum: 'basarisiz', hata: 'bu sürüm için uygulama içi kurulum paketi yayınlanmamış' }
    }

    const { response } = await dialog.showMessageBox(pencere, {
        type: 'info',
        buttons: ['Şimdi güncelle', 'Sonra'],
        defaultId: 0,
        cancelId: 1,
        title: 'Yeni sürüm var',
        message: `Özgür Telli Finans ${besleme.surum} yayınlandı.`,
        detail: `Şu an ${app.getVersion()} sürümünü kullanıyorsunuz.\n\n`
            + 'Güncelleme uygulama içinde indirilip kurulur; hiçbir dosya '
            + 'indirmeniz ya da elle kurmanız gerekmez. Ayarlarınız ve '
            + 'kayıtlarınız korunur.',
    })

    if (response !== 0) return { durum: 'ertelendi' }

    const paket = paketYolu()
    const gecici = path.join(app.getPath('temp'), `fzy-${besleme.surum}.zip`)
    /* Açma işlemi KURULU PAKETİN YANINA yapılıyor: son adım aynı disk
       bölümünde bir ad değiştirme olsun, kopyalama olmasın. Farklı
       bölümler arası taşıma yüz megabaytı kopyalardı ve yarıda kalma
       riski taşırdı. */
    const acilacak = path.join(path.dirname(paket), '.fzy-guncelleme')

    try {
        await indir(new URL(dosya.url, new URL('/paket/', ADRES)).toString(), gecici, dosya.boyut, pencere)

        const bulunan = await ozet(gecici)
        if (bulunan !== dosya.sha512) {
            throw new Error('indirilen dosyanın özeti beslemeyle uyuşmuyor')
        }

        const yeni = await acVeDenetle(gecici, acilacak)
        bekleyen = { surum: besleme.surum, yol: yeni }

        return { durum: (await yenidenBaslatSor(pencere, besleme.surum, yeni)) ? 'kuruluyor' : 'ertelendi' }
    } catch (hata) {
        await fs.promises.rm(acilacak, { recursive: true, force: true }).catch(() => {})

        return { durum: 'basarisiz', hata: hata?.message || String(hata) }
    } finally {
        pencere?.setProgressBar?.(-1)
        await fs.promises.rm(gecici, { force: true }).catch(() => {})
    }
}

async function yenidenBaslatSor(pencere, surum, yeni) {
    const { response } = await dialog.showMessageBox(pencere, {
        type: 'info',
        buttons: ['Şimdi yeniden başlat', 'Sonra'],
        defaultId: 0,
        cancelId: 1,
        title: 'Güncelleme hazır',
        message: `Sürüm ${surum} indirildi ve doğrulandı.`,
        detail: 'Kurulum için uygulamanın kapanıp yeniden açılması gerekiyor. '
            + 'Bu birkaç saniye sürer. "Sonra" derseniz güncelleme indirilmiş '
            + 'olarak bekler; istediğinizde menüden kurabilirsiniz.',
    })

    return response === 0 ? kur(yeni) : false
}

/* betikYaz sınama için de dışa veriliyor: değiş-tokuş betiği yanlış
   yazılırsa kullanıcının uygulamasını silebilir, bu yüzden sahte
   paketlerle sınanabilir olması gerekiyor. */
module.exports = { guncelle, kurulabilir, artiklariTemizle, beslemeyiAyristir, dosyaSec, betikYaz }
