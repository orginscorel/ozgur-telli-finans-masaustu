/**
 * Güncelleme denetimi.
 *
 * İki ayrı yol var, çünkü tek yol her iki platformda çalışmıyor:
 *
 * Windows — electron-updater paketi indirir ve kurar. Kullanıcıdan tek istenen
 * "şimdi yeniden başlat" onayı.
 *
 * macOS — güncelleme UYGULAMA İÇİNDE yapılır ama Apple'ın çatısıyla değil.
 * Squirrel.Mac, indirilen paketin çalışan uygulamanın imza gereksinimini
 * karşılamasını şart koşuyor; ad-hoc imzada bu gereksinim ikilinin kendi
 * özetine bağlı olduğu için yeni bir derleme onu asla karşılamıyor ve
 * kurulum sessizce reddediliyor. Bu yüzden indirme ve değiş-tokuş elle
 * yapılıyor: bkz. mac-guncelleme.js. Oradaki yol işlemezse (paket salt
 * okunur bir yerde, beslemede ZIP yok, ağ hatası) haber verme yoluna
 * düşülür ve kullanıcı sürüm atlamaz.
 *
 * Sürüm bilgisi sitenin kendi ucundan okunur (/api/masaustu/surum). O uç zaten
 * config/masaustu.php içeriğini veriyor; ayrı bir sürüm dosyası tutmak aynı
 * bilgiyi iki yerde tutmak olurdu.
 */
const { app, dialog, shell } = require('electron')
const { ADRES } = require('./ayarlar')
const { dahaYeni } = require('./surum')
const macGuncelleme = require('./mac-guncelleme')

/* 6 saat: günde birkaç kez yeterli. Daha sık sormak sunucuya boş yük. */
const ARALIK = 6 * 60 * 60 * 1000

/** Siteden yayınlanmış sürümü ve indirme bağlantılarını okur. */
async function yayinBilgisi() {
    const yanit = await fetch(new URL('/api/masaustu/surum', ADRES), {
        headers: { Accept: 'application/json' },
    })

    if (!yanit.ok) throw new Error(`sürüm ucu ${yanit.status} döndü`)

    return yanit.json()
}

/** macOS (ve Windows'ta güncelleyici çökerse yedek yol): yalnızca haber verir. */
async function haberVer(pencere) {
    let bilgi

    try {
        bilgi = await yayinBilgisi()
    } catch {
        // Ağ yoksa sessiz geçilir; sonraki turda yeniden denenir.
        return
    }

    if (!dahaYeni(bilgi.surum, app.getVersion())) return

    const baglanti = process.platform === 'darwin'
        ? (process.arch === 'arm64' ? bilgi.indirme?.macos : bilgi.indirme?.macos_intel)
        : bilgi.indirme?.windows

    const { response } = await dialog.showMessageBox(pencere, {
        type: 'info',
        buttons: ['İndir', 'Sonra'],
        defaultId: 0,
        cancelId: 1,
        title: 'Yeni sürüm var',
        message: `Özgür Telli Finans ${bilgi.surum} yayınlandı.`,
        detail: `Şu an ${app.getVersion()} sürümünü kullanıyorsunuz.\n\n`
            + (bilgi.notlar ? `${bilgi.notlar}\n\n` : '')
            + 'İndirilen dosyayı açıp kurmanız yeterli; ayarlarınız ve kayıtlarınız korunur.',
    })

    if (response === 0 && baglanti) shell.openExternal(baglanti)
}

/** Windows: indirir, kurulumu kullanıcının onayıyla yapar. */
function kendiliginden(pencere) {
    let autoUpdater

    /*
     * require paketin içinde çözülemezse (bağımlılık paketlenmemiş, dosya
     * bozulmuş) buradan SENKRON bir hata fırlar. Yakalanmazsa ana süreçteki
     * uncaughtException yakalayıcısına düşer ve kullanıcı açılışta hata
     * kutusuyla karşılaşır. Güncelleme denetiminin başarısızlığı uygulamanın
     * kullanılmasını engellememeli: haber verme yoluna düşülür.
     */
    try {
        ({ autoUpdater } = require('electron-updater'))
    } catch {
        haberVer(pencere)

        return
    }

    autoUpdater.autoDownload = true
    /* Kurulum kullanıcı onayıyla yapılır: çalışma ortasında uygulamanın
       kendi kendine kapanması finans kaydı girerken veri kaybı demekti. */
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null

    autoUpdater.on('update-downloaded', async (bilgi) => {
        const { response } = await dialog.showMessageBox(pencere, {
            type: 'info',
            buttons: ['Şimdi yeniden başlat', 'Çıkışta kur'],
            defaultId: 0,
            cancelId: 1,
            title: 'Güncelleme hazır',
            message: `Sürüm ${bilgi.version} indirildi.`,
            detail: 'Kurulum için uygulamanın yeniden başlaması gerekiyor. '
                + '"Çıkışta kur" derseniz güncelleme siz uygulamayı kapattığınızda kendiliğinden kurulur.',
        })

        if (response === 0) {
            setImmediate(() => autoUpdater.quitAndInstall())
        }
    })

    autoUpdater.on('error', () => {
        /* Güncelleyici çalışmazsa (ağ, besleme dosyası eksik, imza sorunu)
           kullanıcı sürüm atlamasın diye haber verme yoluna düşülür. */
        haberVer(pencere)
    })

    autoUpdater.checkForUpdates().catch(() => haberVer(pencere))
}

function guncellemeyiBaslat(pencere) {
    // Geliştirme sırasında paket yok; güncelleme denetimi anlamsız ve gürültülü.
    if (!app.isPackaged) return

    const calistir = () => {
        if (!pencere || pencere.isDestroyed()) return

        if (process.platform === 'win32') { kendiliginden(pencere); return }

        if (!macGuncelleme.kurulabilir()) { haberVer(pencere); return }

        /* Uygulama içi kurulum denenir; olmazsa kullanıcı sürüm atlamasın
           diye haber verme yoluna düşülür. Kendiliğinden denetimde hata
           kutusu GÖSTERİLMEZ: kullanıcı bir şey istemedi. */
        macGuncelleme.guncelle(pencere)
            .then(({ durum }) => { if (durum === 'basarisiz') haberVer(pencere) })
            .catch(() => haberVer(pencere))
    }

    /* Önceki oturumdan kalmış, açılmış güncelleme paketi yüzlerce megabayt
       tutuyor; her açılışta temizlenir. */
    if (process.platform === 'darwin') macGuncelleme.artiklariTemizle()

    /* Açılışta hemen sorulmaz: ilk saniyeler pencerenin yüklenmesine ayrılır,
       araya bir diyalog girerse açılış animasyonunun üstüne biner. */
    setTimeout(calistir, 20_000)
    setInterval(calistir, ARALIK)
}

/**
 * Menüden elle denetleme.
 *
 * Kendiliğinden denetlemeden ayrı duruyor çünkü burada SONUÇ NE OLURSA OLSUN
 * kullanıcıya bir şey söylenmeli: menüden tıklayıp hiçbir şey görmemek
 * "çalışmadı mı?" sorusunu doğurur.
 */
async function simdiDenetle(pencere) {
    /* macOS'ta uygulama içi kurulum mümkünse akışın tamamı oraya devredilir:
       sürüm denetimi, indirme, doğrulama ve kurulum onayı orada. */
    if (process.platform === 'darwin' && macGuncelleme.kurulabilir()) {
        const { durum, hata } = await macGuncelleme.guncelle(pencere)

        if (durum === 'guncel') {
            await dialog.showMessageBox(pencere, {
                type: 'info',
                title: 'Güncelleme yok',
                message: `En son sürümü kullanıyorsunuz (${app.getVersion()}).`,
                buttons: ['Kapat'],
            })

            return
        }

        /* 'kuruluyor' ve 'ertelendi' durumlarında kullanıcıyla zaten
           konuşuldu; üstüne bir kutu daha çıkarmak gereksiz. */
        if (durum !== 'basarisiz') return

        /* Uygulama içinde kurulamadı. Menüden tıklayan kullanıcıya hem
           sebep söylenir hem de elle kurma yolu TEK kutuda sunulur. */
        const { response } = await dialog.showMessageBox(pencere, {
            type: 'warning',
            buttons: ['Siteden indir', 'Kapat'],
            defaultId: 0,
            cancelId: 1,
            title: 'Uygulama içinde güncellenemedi',
            message: 'Güncelleme uygulama içinde kurulamadı.',
            detail: `${hata}\n\nSürümü siteden indirip kurabilirsiniz; ayarlarınız ve kayıtlarınız korunur.`,
        })

        if (response === 0) shell.openExternal(new URL('/uygulama', ADRES).toString())

        return
    }

    let bilgi

    try {
        bilgi = await yayinBilgisi()
    } catch (hata) {
        await dialog.showMessageBox(pencere, {
            type: 'warning',
            title: 'Denetlenemedi',
            message: 'Güncelleme bilgisi alınamadı.',
            detail: `İnternet bağlantınızı denetleyip yeniden deneyin.\n\n${hata?.message || hata}`,
            buttons: ['Kapat'],
        })

        return
    }

    if (dahaYeni(bilgi.surum, app.getVersion())) {
        await haberVer(pencere)

        return
    }

    await dialog.showMessageBox(pencere, {
        type: 'info',
        title: 'Güncelleme yok',
        message: `En son sürümü kullanıyorsunuz (${app.getVersion()}).`,
        buttons: ['Kapat'],
    })
}

module.exports = { guncellemeyiBaslat, simdiDenetle, dahaYeni }
