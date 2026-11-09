/**
 * Özgür Telli Finans — masaüstü uygulaması (ana süreç).
 *
 * Uygulama web arayüzünün BİREBİR aynısını gösterir: ayrı bir arayüz yazmak iki kod
 * tabanı demekti ve ikisi kaçınılmaz olarak birbirinden ayrışırdı. Masaüstüne özgü
 * olan kısım kabuk: çerçevesiz pencere, animasyonlu açılış, gezinme göstergesi,
 * işletim sistemi bildirimleri, tepsi simgesi ve çevrimdışı karşılama.
 */
const { app, BrowserWindow, shell, Notification, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron')
const path = require('node:path')
const { ADRES, IZINLI_KOKENLER, oku, yaz } = require('./ayarlar')
const { menuKur } = require('./menu')
const { guncellemeyiBaslat, simdiDenetle } = require('./guncelleme')

let pencere = null
let acilis = null
let tepsi = null
let bildirimZamanlayici = null
let bildirimImleci = null

const tekOrnek = app.requestSingleInstanceLock()

/* İkinci kez açılırsa yeni pencere açılmaz, var olan öne getirilir. */
if (!tekOrnek) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (!pencere) return
        if (pencere.isMinimized()) pencere.restore()
        pencere.focus()
    })
}

function acilisPenceresi() {
    acilis = new BrowserWindow({
        width: 420,
        height: 320,
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
        acilis.show()
        acilis.webContents.send('acilis-surum', app.getVersion())
    })

    return acilis
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
        ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 18 } } : {}),
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

        setTimeout(() => {
            if (acilis && !acilis.isDestroyed()) acilis.close()
            acilis = null
            pencere.show()
            if (kayitli.tamEkran) pencere.maximize()
        }, 420)
    })

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

/* ------------------------------------------------------------------ tepsi */

function tepsiKur() {
    const simge = nativeImage.createFromPath(path.join(__dirname, '..', 'varliklar', 'tepsi.png'))
    if (simge.isEmpty()) return

    tepsi = new Tray(simge.resize({ width: 18, height: 18 }))
    tepsi.setToolTip('Özgür Telli Finans')
    tepsi.setContextMenu(Menu.buildFromTemplate([
        { label: 'Pencereyi göster', click: () => { pencere?.show(); pencere?.focus() } },
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
ipcMain.handle('yeniden-yukle', () => { pencere?.loadURL(ADRES) })

ipcMain.handle('disarida-ac', (_olay, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
})

/* ------------------------------------------------------------------ yaşam döngüsü */

app.whenReady().then(() => {
    acilisPenceresi()
    asama('Sunucuya bağlanılıyor…')

    anaPencere()
    menuKur({ pencere, adres: ADRES, guncellemeyiDenetle: () => simdiDenetle(pencere) })
    tepsiKur()
    bildirimDongusu()
    guncellemeyiBaslat(pencere)

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) anaPencere()
        else pencere?.show()
    })
})

app.on('window-all-closed', () => {
    // macOS'ta pencere kapanınca uygulama kapanmaz; platform alışkanlığı budur.
    if (process.platform !== 'darwin') app.quit()
})

/* Güvenlik: uygulama içinden yeni pencere açılmasına ve izin isteklerine kapalıyız. */
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
