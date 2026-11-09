/**
 * Özgür Telli Finans — masaüstü uygulaması (ana süreç).
 *
 * Uygulama web arayüzünün BİREBİR aynısını gösterir: ayrı bir arayüz yazmak iki kod
 * tabanı demekti ve ikisi kaçınılmaz olarak birbirinden ayrışırdı. Masaüstüne özgü
 * olan kısım kabuk: çerçevesiz pencere, animasyonlu açılış, gezinme göstergesi,
 * işletim sistemi bildirimleri, tepsi simgesi ve çevrimdışı karşılama.
 */
/* Açılış izi.
 *
 * macOS'ta uygulama açılışta sessizce ölüyordu: çökme raporu yazılmıyor,
 * hata metni basılmıyor ve Electron normalde hiçbir şey yazdırmadığı için
 * "çıktı yok" bulgusu hiçbir şeyi daraltmıyordu. Hangi çağrının öldürdüğünü
 * görebilmenin tek yolu aşama aşama iz bırakmaktı. FZY_IZ=1 verilmediğinde
 * tamamen sessizdir, bu yüzden üretimde de kalabilir.
 */
const izAcik = process.env.FZY_IZ === '1'

function iz(asama) {
    if (izAcik) process.stderr.write(`[iz] ${asama}\n`)
}

iz('başladı')

const { app, BrowserWindow, shell, Notification, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron')
iz('electron yüklendi')
const path = require('node:path')
const { ADRES, IZINLI_KOKENLER, oku, yaz } = require('./ayarlar')
iz('ayarlar yüklendi')
const { menuKur } = require('./menu')
iz('menü yüklendi')
const { guncellemeyiBaslat, simdiDenetle } = require('./guncelleme')
iz('güncelleme yüklendi')
const { baglamMenusuKur } = require('./baglammenu')
iz('bağlam menüsü yüklendi')

/* Derin bağlantı şeması: ozgurtelli://danisanlar/5 uygulamada açılır. */
const SEMA = 'ozgurtelli'

/* Açılış ekranının en az bu kadar görünür kalması sağlanır. Marka
   animasyonunun girişi 0,42 sn gecikmeli başlayıp 0,6 sn sürüyor; altında
   bir değer ekranı görmeye yetmiyor. Üstünde bir değer ise açılışı
   gereksiz yavaşlatır. */
const ASGARI_ACILIS = 1700

let pencere = null
let acilis = null
let acilisAni = 0
let tepsi = null
let bildirimZamanlayici = null
let bildirimImleci = null

/* Teşhis anahtarı. requestSingleInstanceLock Chromium'un
   ProcessSingleton'ını kurar: userData altında bir unix soketi açıp
   dinlemeye başlar, hem de biz bunu mesaj döngüsü başlamadan
   çağırıyoruz. Açılıştaki sessiz ölümün buradan gelip gelmediğini
   ayırt edebilmek için kilidi atlamanın bir yolu olması gerekiyordu.
   Normal çalışmada hiçbir etkisi yok. */
const kilitIstensin = process.env.FZY_KILIT !== 'kapali'
const tekOrnek = kilitIstensin ? app.requestSingleInstanceLock() : true
iz(`tek örnek kilidi: ${tekOrnek} (istendi: ${kilitIstensin})`)

/* İkinci kez açılırsa yeni pencere açılmaz, var olan öne getirilir. */
if (!tekOrnek) {
    app.quit()
} else {
    app.on('second-instance', (_olay, argv) => {
        if (!pencere) return
        if (pencere.isMinimized()) pencere.restore()
        pencere.show()
        pencere.focus()

        /* Görev çubuğu kısayolu ya da derin bağlantı ikinci bir kopya
           başlatmaya çalışır; argümanı var olan pencerede açıyoruz. */
        const yol = argumandanYol(argv)
        if (yol) yolaGit(yol)
    })
}

/*
 * Derin bağlantı şeması işletim sistemine bildirilir. Paketlenmemiş halde
 * (geliştirme) çalıştırılabilir yolu Electron'un kendisini gösterdiği için
 * kayıt anlamlı olmaz, bu yüzden yalnızca pakette yapılır.
 */
iz(`şema kaydı öncesi (paket: ${app.isPackaged})`)
if (app.isPackaged) app.setAsDefaultProtocolClient(SEMA)
iz('şema kaydı sonrası')

/* macOS derin bağlantıyı argümanla değil bu olayla veriyor. */
app.on('open-url', (olay, url) => {
    olay.preventDefault()
    yolaGit(url)
})
iz('open-url bağlandı')

function acilisPenceresi() {
    acilis = new BrowserWindow({
        width: 480,
        height: 360,
        frame: false,
        resizable: false,
        center: true,
        show: false,
        transparent: process.platform === 'darwin',
        backgroundColor: process.platform === 'darwin' ? '#00000000' : '#05341b',
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    })

    acilis.loadFile(path.join(__dirname, 'acilis.html'))
    acilis.once('ready-to-show', () => {
        /* Ekranın GERÇEKTEN göründüğü an. Kapanış bu ana göre gecikir:
           site hızlı yüklendiğinde açılış ekranı yarım saniyeden az
           kalıyordu, kullanıcı "şak diye geçti, hiç göremedim" dedi —
           animasyonların girişi bile bitmiyordu. */
        acilisAni = Date.now()
        acilis.show()
        acilis.webContents.send('acilis-surum', app.getVersion())
    })

    return acilis
}

/**
 * Açılış ekranını sönerek kapatır.
 *
 * Bir anda yok olması "çöktü mü?" hissi veriyordu. Önce pencereye haber
 * verilir (CSS geçişi başlar), geçiş bitince pencere kapanır ve ardından
 * bitti() çağrılır. Toplam bekleme artmasın diye ana penceredeki gecikme
 * 420 ms'den 200 ms'ye indirildi.
 */
function acilisiKapat(bitti) {
    const p = acilis
    acilis = null

    if (!p || p.isDestroyed()) {
        bitti?.()

        return
    }

    /* Asgari görünme süresi. Altındaki hesap "yükleme bitti ama ekranı
       bir anlık bile görmedim" durumunu engeller: sunucu hızlı cevap
       verdiğinde fark kullanıcıya yansımaz, yavaş cevap verdiğinde de
       fazladan bekleme OLMAZ, çünkü süre zaten geçmiş olur. */
    const gecen = acilisAni ? Date.now() - acilisAni : ASGARI_ACILIS
    const kalan = Math.max(0, ASGARI_ACILIS - gecen)

    setTimeout(() => {
        if (p.isDestroyed()) {
            bitti?.()

            return
        }

        p.webContents.send('acilis-bitti')
        setTimeout(() => {
            if (!p.isDestroyed()) p.close()
            bitti?.()
        }, 240)
    }, kalan)
}

function asama(metin) {
    if (acilis && !acilis.isDestroyed()) acilis.webContents.send('acilis-durum', metin)
}

function anaPencere() {
    const kayitli = oku().pencere || {}

    pencere = new BrowserWindow({
        width: kayitli.genislik || 1440,
        height: kayitli.yukseklik || 900,
        x: kayitli.x,
        y: kayitli.y,
        minWidth: 420,
        minHeight: 560,
        show: false,
        backgroundColor: '#f6f6f9',
        /*
         * Başlık çubuğu gizlenir ama pencere düğmeleri kalır: web arayüzünün kendi
         * üst çubuğu başlık çubuğu yerine geçsin diye. Ayrı bir başlık şeridi
         * eklenseydi ekranda iki başlık üst üste görünürdü.
         */
        titleBarStyle: 'hidden',
        /*
         * Pencere düğmeleri (kapat/küçült/büyüt) artık kendilerine ayrılmış
         * 32 piksellik üst şeridin tam ortasında durur. Önce doğrudan içeriğin
         * üzerinde duruyorlardı ve kenar çubuğunun tepesindeki logoyla iç içe
         * geçiyorlardı; şeridi önyükleme katmanı çiziyor (onyukleme.js).
         * Yatay boşluk bırakmak çözüm değildi: menü daraltılınca kenar çubuğu
         * 76 piksele iniyor ve üç düğme o genişliğin tamamını kaplıyor.
         */
        ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 10 } } : {}),
        ...(process.platform === 'win32'
            ? { titleBarOverlay: { color: '#ffffff', symbolColor: '#191c35', height: 48 } }
            : {}),
        webPreferences: {
            preload: path.join(__dirname, 'onyukleme.js'),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true,
        },
    })

    pencere.loadURL(ADRES)

    baglamMenusuKur(pencere, ADRES)

    /* --- Yakınlaştırma hatırlanır ---
       Kullanıcı yazıyı bir kez büyütüyor ve her açılışta yeniden büyütmek
       zorunda kalmamalı. Tarayıcı bunu site başına kendi tutar; uygulamada
       tutacak bir yer olmadığı için tercihlere yazılır. */
    pencere.webContents.on('zoom-changed', () => {
        yaz({ yakinlastirma: pencere.webContents.getZoomLevel() })
    })

    /* --- Gezinme: dış bağlantılar varsayılan tarayıcıya --- */
    const disaridaAc = (url) => {
        if (!IZINLI_KOKENLER.some((k) => url.startsWith(k))) {
            shell.openExternal(url)

            return { action: 'deny' }
        }

        return { action: 'allow' }
    }

    pencere.webContents.setWindowOpenHandler(({ url }) => disaridaAc(url))

    pencere.webContents.on('will-navigate', (olay, url) => {
        if (!IZINLI_KOKENLER.some((k) => url.startsWith(k))) {
            olay.preventDefault()
            shell.openExternal(url)
        }
    })

    /* --- Sayfa geçişi göstergesi: yükleme sürerken üstte ince bir çubuk --- */
    pencere.webContents.on('did-start-navigation', (_o, _u, _h, anaCerceve) => {
        if (anaCerceve) pencere.webContents.send('gecis', 'basladi')
    })

    pencere.webContents.on('did-stop-loading', () => {
        pencere.webContents.send('gecis', 'bitti')
    })

    /* --- Çevrimdışı --- */
    pencere.webContents.on('did-fail-load', (_olay, kod, aciklama, url, anaCerceve) => {
        // -3 = isteği kullanıcı iptal etti; hata değil.
        if (!anaCerceve || kod === -3) return

        asama('Bağlantı kurulamadı')
        pencere.loadFile(path.join(__dirname, 'cevrimdisi.html'), {
            query: { kod: String(kod), aciklama, adres: url },
        })
    })

    /* --- İlk yükleme bitince açılışı kapat --- */
    pencere.webContents.once('did-finish-load', () => {
        asama('Hazır')

        const z = oku().yakinlastirma
        if (typeof z === 'number') pencere.webContents.setZoomLevel(z)

        setTimeout(() => {
            acilisiKapat(() => {
                pencere.show()
                if (kayitli.tamEkran) pencere.maximize()
            })
        }, 200)
    })

    /*
     * --- Tam ekran durumu ---
     * macOS tam ekranda pencere düğmelerini gizler; o halde onlara ayrılan
     * üst şerit de kalkmalı, yoksa tepede boş bir bant kalır. Durum hem
     * değiştikçe gönderilir hem de 'tam-ekran-mi' ucundan sorulabilir:
     * sayfa tam ekranda yeniden yüklenirse önyükleme katmanının durumu
     * baştan bilmesi gerekiyor.
     */
    const tamEkraniBildir = () => {
        if (pencere && !pencere.isDestroyed()) {
            pencere.webContents.send('tam-ekran', pencere.isFullScreen())
        }
    }

    pencere.on('enter-full-screen', tamEkraniBildir)
    pencere.on('leave-full-screen', tamEkraniBildir)

    /* --- Pencere konumu hatırlanır --- */
    const konumuKaydet = () => {
        if (!pencere || pencere.isDestroyed() || pencere.isMinimized()) return
        const [genislik, yukseklik] = pencere.getSize()
        const [x, y] = pencere.getPosition()
        yaz({ pencere: { genislik, yukseklik, x, y, tamEkran: pencere.isMaximized() } })
    }

    pencere.on('resize', konumuKaydet)
    pencere.on('move', konumuKaydet)
    pencere.on('close', konumuKaydet)
    pencere.on('closed', () => { pencere = null })

    return pencere
}

/* ------------------------------------------------------------------ bildirimler */

/**
 * Bildirimler ÇEKİLİR, push ile gelmez.
 *
 * Electron'un Chromium'u Web Push API'sini taşımıyor (FCM bağlantısı yok); tarayıcıda
 * çalışan push yolu burada çalışmaz. Uygulama açıkken sunucuya "son gördüğümden
 * sonrası var mı" diye sorulur ve işletim sistemi bildirimi burada üretilir.
 */
async function bildirimleriCek() {
    const belirtec = oku().belirtec
    if (!belirtec || !Notification.isSupported()) return

    const adres = new URL('/api/masaustu/bildirimler', ADRES)
    if (bildirimImleci !== null) adres.searchParams.set('son', String(bildirimImleci))

    try {
        const yanit = await fetch(adres, {
            headers: { Authorization: `Bearer ${belirtec}`, Accept: 'application/json' },
        })

        if (!yanit.ok) return

        const veri = await yanit.json()
        bildirimImleci = veri.imlec

        if (tepsi) {
            tepsi.setToolTip(veri.okunmamis > 0
                ? `Özgür Telli Finans — ${veri.okunmamis} okunmamış`
                : 'Özgür Telli Finans')
        }

        // macOS ve Windows'ta uygulama simgesinde rozet.
        if (process.platform === 'darwin') app.dock?.setBadge(veri.okunmamis > 0 ? String(veri.okunmamis) : '')
        if (process.platform === 'win32' && pencere) pencere.setOverlayIcon(null, veri.okunmamis > 0 ? `${veri.okunmamis} okunmamış` : '')

        for (const b of veri.bildirimler) {
            const bildirim = new Notification({
                title: b.baslik,
                body: b.govde || '',
                silent: false,
            })

            bildirim.on('click', () => {
                if (!pencere) return
                pencere.show()
                pencere.focus()
                if (b.url) pencere.loadURL(new URL(b.url, ADRES).toString())
            })

            bildirim.show()
        }
    } catch {
        // Ağ yoksa sessizce geçilir; bir sonraki turda yeniden denenir.
    }
}

function bildirimDongusu() {
    clearInterval(bildirimZamanlayici)
    // 45 sn: daha sık sorgulamak sunucuya yük, daha seyrek olunca bildirim geç geliyor.
    bildirimZamanlayici = setInterval(bildirimleriCek, 45_000)
    bildirimleriCek()
}

/* ------------------------------------------------------- derin bağlantı / hızlı görev */

/*
 * Görev çubuğu ve Dock'tan doğrudan iş başlatma.
 *
 * Masaüstü uygulamalarının beklenen davranışı: simgeye sağ tıklayınca sık
 * yapılan işler çıkar. Yollar artisan route:list çıktısından alındı.
 */
const HIZLI_GOREVLER = [
    { etiket: 'Yeni gelir', yol: '/gelirler/yeni' },
    { etiket: 'Yeni gider', yol: '/giderler/yeni' },
    { etiket: 'Yeni danışan', yol: '/danisanlar/yeni' },
    { etiket: 'Yeni randevu', yol: '/randevular/yeni' },
]

/**
 * Verilen yolu uygulamada açar.
 *
 * Gelen değer DIŞARIDAN geliyor (derin bağlantı, komut satırı argümanı), bu
 * yüzden köken denetlenir: başka bir adrese yönlendiren bir bağlantı
 * uygulamanın penceresinde yabancı bir sayfa açabilirdi.
 */
function yolaGit(ham) {
    if (!pencere || pencere.isDestroyed() || !ham) return

    let yol = String(ham)
    if (yol.startsWith(`${SEMA}://`)) yol = '/' + yol.slice(SEMA.length + 3)

    let hedef

    try {
        hedef = new URL(yol, ADRES)
    } catch {
        return
    }

    if (hedef.origin !== new URL(ADRES).origin) return

    if (pencere.isMinimized()) pencere.restore()
    pencere.show()
    pencere.focus()
    pencere.loadURL(hedef.toString())
}

/** Komut satırında derin bağlantı ya da --sayfa= var mı. */
function argumandanYol(argv) {
    const sema = argv.find((a) => a.startsWith(`${SEMA}://`))
    if (sema) return sema

    const bayrak = argv.find((a) => a.startsWith('--sayfa='))

    return bayrak ? bayrak.slice('--sayfa='.length) : null
}

function hizliGorevleriKur() {
    if (process.platform === 'win32') {
        /* Görev çubuğu listesi uygulamayı YENİDEN ÇALIŞTIRIR; tek örnek kilidi
           sayesinde ikinci kopya açılmaz, argüman var olan pencereye düşer. */
        app.setUserTasks(HIZLI_GOREVLER.map((g) => ({
            program: process.execPath,
            arguments: `--sayfa=${g.yol}`,
            title: g.etiket,
            description: g.etiket,
            iconPath: process.execPath,
            iconIndex: 0,
        })))
    }

    if (process.platform === 'darwin') {
        app.dock?.setMenu(Menu.buildFromTemplate(
            HIZLI_GOREVLER.map((g) => ({ label: g.etiket, click: () => yolaGit(g.yol) }))
        ))
    }
}

/* ------------------------------------------------------------------ tepsi */

function tepsiKur() {
    /*
     * İki ayrı dosya, çünkü iki platform menü çubuğu simgesini farklı
     * ele alıyor:
     *
     * macOS — simge "template" olmalı: yalnızca siyah ve saydamlık.
     *   İşletim sistemi açık/koyu menü çubuğuna, vurgulanmış duruma ve
     *   koyu moda göre rengi KENDİSİ veriyor. Renkli bir simge koymak
     *   menü çubuğunda yamalı duruyordu, koyu menü çubuğunda ise siyah
     *   simge görünmez oluyordu.
     *
     * Windows — template diye bir kavram yok; renkli simge kullanılır,
     *   yoksa siyah simge koyu görev çubuğunda kaybolurdu.
     */
    const sablon = process.platform === 'darwin'
    const dosya = sablon ? 'tepsi.png' : 'tepsi-win.png'
    const simge = nativeImage.createFromPath(path.join(__dirname, '..', 'varliklar', dosya))
    if (simge.isEmpty()) return

    const olculu = simge.resize({ width: 18, height: 18 })
    if (sablon) olculu.setTemplateImage(true)

    tepsi = new Tray(olculu)
    tepsi.setToolTip('Özgür Telli Finans')
    tepsi.setContextMenu(Menu.buildFromTemplate([
        { label: 'Pencereyi göster', click: () => { pencere?.show(); pencere?.focus() } },
        { type: 'separator' },
        ...HIZLI_GOREVLER.map((g) => ({ label: g.etiket, click: () => yolaGit(g.yol) })),
        { type: 'separator' },
        { label: 'Bildirimleri şimdi denetle', click: () => bildirimleriCek() },
        { label: 'Güncellemeleri denetle…', click: () => simdiDenetle(pencere) },
        { type: 'separator' },
        { label: 'Çıkış', click: () => app.quit() },
    ]))
    tepsi.on('click', () => { pencere?.show(); pencere?.focus() })
}

/* ------------------------------------------------------------------ köprü */

ipcMain.handle('belirtec-kaydet', (_olay, belirtec) => {
    yaz({ belirtec })
    bildirimImleci = null
    bildirimDongusu()

    return true
})

ipcMain.handle('belirtec-var-mi', () => Boolean(oku().belirtec))
ipcMain.handle('surum', () => app.getVersion())
ipcMain.handle('tam-ekran-mi', () => Boolean(pencere && !pencere.isDestroyed() && pencere.isFullScreen()))
ipcMain.handle('yeniden-yukle', () => { pencere?.loadURL(ADRES) })

ipcMain.handle('disarida-ac', (_olay, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
})

/* ------------------------------------------------------------------ yaşam döngüsü */

iz('ipcMain köprüsü kuruldu, whenReady bekleniyor')
app.whenReady().then(() => {
    iz('app hazır')
    acilisPenceresi()
    iz('açılış penceresi kuruldu')
    asama('Sunucuya bağlanılıyor…')

    anaPencere()
    iz('ana pencere kuruldu')
    menuKur({ pencere, adres: ADRES, guncellemeyiDenetle: () => simdiDenetle(pencere) })
    iz('menü kuruldu')
    tepsiKur()
    iz('tepsi kuruldu')
    hizliGorevleriKur()
    iz('hızlı görevler kuruldu')
    bildirimDongusu()
    iz('bildirim döngüsü kuruldu')
    guncellemeyiBaslat(pencere)
    iz('güncelleme başlatıldı')

    /* Uygulama bir derin bağlantıyla açıldıysa ilk yükleme bitince oraya
       gidilir; daha erken çağırmak yüklenmekte olan sayfayı yarıda kesiyordu. */
    const acilisYolu = argumandanYol(process.argv)
    if (acilisYolu) pencere.webContents.once('did-finish-load', () => yolaGit(acilisYolu))

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) anaPencere()
        else pencere?.show()
    })

    iz('açılış tamamlandı')
}).catch((hata) => {
    /* Sessiz ölümün bir JS hatasından gelip gelmediğini ayırt etmek için:
       yerel bir çökme buraya düşmez, JS hatası düşer. */
    iz(`AÇILIŞ HATASI: ${hata && hata.stack ? hata.stack : hata}`)
})

app.on('window-all-closed', () => {
    /*
     * BİLEREK platform alışkanlığının dışına çıkılıyor.
     *
     * macOS'ta pencereyi kapatmak uygulamayı kapatmaz, Dock'ta açık kalır.
     * Kullanıcı bunu hata olarak bildirdi: "x basıp kapatınca uygulamayı
     * kapatmak yerine alta alıyor". Bu bir muhasebe uygulaması; gün
     * sonunda kapatılıyor ve açık kalması "kapattım mı?" sorusu doğuruyor.
     * Sahibinin açık isteğiyle her platformda kapanıyor.
     *
     * Arka planda bildirim toplama da böylece duruyor; pencere kapalıyken
     * bildirim beklemek isteyen bir kullanım yok, uygulama kapatılıyor.
     */
    app.quit()
})

/* Güvenlik: uygulama içinden yeni pencere açılmasına ve izin isteklerine kapalıyız. */
iz('modül sonu')
app.on('web-contents-created', (_olay, icerik) => {
    icerik.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)

        return { action: 'deny' }
    })
})

process.on('uncaughtException', (hata) => {
    console.error('Beklenmeyen hata:', hata)
    if (app.isReady()) {
        dialog.showErrorBox('Beklenmeyen hata', String(hata?.message || hata))
    }
})
