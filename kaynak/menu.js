/**
 * Yerel uygulama menüsü.
 *
 * Masaüstü uygulaması gibi davranmanın en görünür parçası bu: pencerenin
 * üstünde (macOS'ta ekranın üstünde) işletim sisteminin kendi menüsü durur,
 * kısayollar çalışır, kopyala/yapıştır beklendiği gibi davranır.
 *
 * Electron'un hazır "role" tanımları kullanılır: işletim sisteminin yerleşik
 * davranışını ve platforma özgü kısayollarını (macOS'ta Cmd, Windows'ta Ctrl)
 * kendileri getirir. Etiketleri elle Türkçeleştiriyoruz, davranışı role veriyor.
 *
 * Gezinti bölümü doğrudan sitenin yollarına gider. Yollar artisan route:list
 * çıktısından alındı; uydurulmuş bir yol menüde ölü bir madde bırakırdı.
 */
const { Menu, shell, app, dialog } = require('electron')

const SAYFALAR = [
    { etiket: 'Panel', yol: '/', kisayol: 'CmdOrCtrl+1' },
    { etiket: 'Danışanlar', yol: '/danisanlar', kisayol: 'CmdOrCtrl+2' },
    { etiket: 'Randevular', yol: '/randevular', kisayol: 'CmdOrCtrl+3' },
    { etiket: 'Takvim', yol: '/takvim', kisayol: 'CmdOrCtrl+4' },
    { tur: 'separator' },
    { etiket: 'Para Akışı', yol: '/hesaplar', kisayol: 'CmdOrCtrl+5' },
    { etiket: 'Gelirler', yol: '/gelirler' },
    { etiket: 'Giderler', yol: '/giderler' },
    { etiket: 'Borç / Alacak', yol: '/borc-alacak' },
    { tur: 'separator' },
    { etiket: 'Raporlar', yol: '/raporlar', kisayol: 'CmdOrCtrl+6' },
    { etiket: 'Bildirimler', yol: '/bildirimler' },
]

function menuKur({ pencere, adres, guncellemeyiDenetle }) {
    const git = (yol) => {
        if (!pencere || pencere.isDestroyed()) return
        pencere.show()
        pencere.loadURL(new URL(yol, adres).toString())
    }

    const tarihce = pencere?.webContents?.navigationHistory

    const gezinti = [
        /* Geri/İleri uygulamada da gerekiyor: sayfalar arasında dolaşan
           kullanıcı bir adım geri dönmek istediğinde tarayıcı düğmesi yok. */
        {
            label: 'Geri',
            accelerator: process.platform === 'darwin' ? 'Cmd+Left' : 'Alt+Left',
            click: () => tarihce?.canGoBack() && tarihce.goBack(),
        },
        {
            label: 'İleri',
            accelerator: process.platform === 'darwin' ? 'Cmd+Right' : 'Alt+Right',
            click: () => tarihce?.canGoForward() && tarihce.goForward(),
        },
        { type: 'separator' },
        ...SAYFALAR.map((s) => s.tur === 'separator'
            ? { type: 'separator' }
            : { label: s.etiket, accelerator: s.kisayol, click: () => git(s.yol) }),
    ]

    const sablon = [
        /* macOS'ta ilk menü uygulama adını taşır ve "Hakkında / Çıkış" oraya
           girer; Windows'ta böyle bir menü yoktur, o yüzden koşullu. */
        ...(process.platform === 'darwin' ? [{
            label: app.name,
            submenu: [
                { label: `${app.name} Hakkında`, role: 'about' },
                { type: 'separator' },
                { label: 'Güncellemeleri denetle…', click: () => guncellemeyiDenetle?.() },
                { type: 'separator' },
                { label: 'Hizmetler', role: 'services' },
                { type: 'separator' },
                { label: `${app.name} uygulamasını gizle`, role: 'hide' },
                { label: 'Diğerlerini gizle', role: 'hideOthers' },
                { label: 'Tümünü göster', role: 'unhide' },
                { type: 'separator' },
                { label: 'Çıkış', role: 'quit' },
            ],
        }] : []),
        {
            label: 'Dosya',
            submenu: [
                { label: 'Yenile', accelerator: 'CmdOrCtrl+R', click: () => git(pencere?.webContents.getURL() || '/') },
                { label: 'Yazdır…', accelerator: 'CmdOrCtrl+P', click: () => pencere?.webContents.print() },
                { type: 'separator' },
                ...(process.platform === 'darwin'
                    ? [{ label: 'Pencereyi kapat', role: 'close' }]
                    : [{ label: 'Çıkış', role: 'quit' }]),
            ],
        },
        {
            label: 'Düzen',
            submenu: [
                { label: 'Geri al', role: 'undo' },
                { label: 'Yinele', role: 'redo' },
                { type: 'separator' },
                { label: 'Kes', role: 'cut' },
                { label: 'Kopyala', role: 'copy' },
                { label: 'Yapıştır', role: 'paste' },
                { label: 'Biçimsiz yapıştır', role: 'pasteAndMatchStyle' },
                { label: 'Tümünü seç', role: 'selectAll' },
            ],
        },
        {
            label: 'Görünüm',
            submenu: [
                { label: 'Yakınlaştır', role: 'zoomIn' },
                { label: 'Uzaklaştır', role: 'zoomOut' },
                { label: 'Normal boyut', role: 'resetZoom' },
                { type: 'separator' },
                { label: 'Tam ekran', role: 'togglefullscreen' },
                { type: 'separator' },
                { label: 'Geliştirici araçları', role: 'toggleDevTools' },
            ],
        },
        { label: 'Gezinti', submenu: gezinti },
        {
            label: 'Yardım',
            submenu: [
                ...(process.platform === 'win32'
                    ? [{ label: 'Güncellemeleri denetle…', click: () => guncellemeyiDenetle?.() }, { type: 'separator' }]
                    : []),
                { label: 'Siteyi tarayıcıda aç', click: () => shell.openExternal(adres) },
                {
                    label: 'Sürüm bilgisi',
                    click: () => dialog.showMessageBox(pencere, {
                        type: 'info',
                        title: 'Sürüm bilgisi',
                        message: `${app.name} ${app.getVersion()}`,
                        detail: `Electron ${process.versions.electron}\nChromium ${process.versions.chrome}\n\n${adres}`,
                        buttons: ['Kapat'],
                    }),
                },
            ],
        },
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(sablon))
}

module.exports = { menuKur }
