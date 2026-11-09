/**
 * Önyükleme köprüsü.
 *
 * Web sayfası Node'a ERİŞMEZ (contextIsolation açık, nodeIntegration kapalı): uzak
 * bir sayfaya Node vermek, sitede bulunacak herhangi bir XSS'i doğrudan dosya sistemi
 * erişimine çevirirdi. Buradan yalnızca sayılı, dar yüzeyli işlevler açılır.
 *
 * Ayrıca masaüstüne özgü arayüz katmanı burada enjekte edilir: üst çubuğu pencere
 * sürükleme alanı yapmak, gezinme göstergesi ve pencere düğmelerine yer bırakmak.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('masaustu', {
    var: true,
    platform: process.platform,
    surum: () => ipcRenderer.invoke('surum'),
    belirtecKaydet: (b) => ipcRenderer.invoke('belirtec-kaydet', b),
    belirtecVarMi: () => ipcRenderer.invoke('belirtec-var-mi'),
    yenidenYukle: () => ipcRenderer.invoke('yeniden-yukle'),
    disaridaAc: (url) => ipcRenderer.invoke('disarida-ac', url),
})

/* ---------------------------------------------------------------- arayüz katmanı */

ipcRenderer.on('gecis', (_olay, durum) => {
    const cubuk = document.getElementById('masaustu-gecis')
    if (cubuk) cubuk.dataset.durum = durum
})

/*
 * Pencereye dosya sürüklemek engellenir.
 *
 * Tarayıcı davranışı: bırakılan dosya o sekmede AÇILIR. Uygulamada bunun
 * sonucu, kullanıcının çalıştığı ekranın yerini rastgele bir PDF'in ya da
 * resmin almasıydı — masaüstü uygulaması gibi davranmıyordu. Dosya yükleme
 * alanları bundan etkilenmez: oradaki bırakma olayı sayfanın kendi
 * işleyicisine ulaşmadan önce durdurulmaz, yalnızca pencere düzeyindeki
 * varsayılan "dosyayı aç" davranışı iptal edilir.
 */
for (const olay of ['dragover', 'drop']) {
    window.addEventListener(olay, (e) => {
        if (e.target.closest('input[type="file"], [data-dosya-birak]')) return
        e.preventDefault()
    })
}

window.addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('masaustu-uygulama', `masaustu-${process.platform}`)

    const stil = document.createElement('style')
    stil.textContent = `
        /*
            Üst çubuk pencereyi sürükler. Çerçevesiz pencerede sürüklenecek bir alan
            kalmazsa pencere hiç taşınamaz; web arayüzünün kendi üst çubuğu bu işi
            görür, böylece ikinci bir başlık şeridi eklemeye gerek kalmaz.
        */
        .masaustu-uygulama .topbar { -webkit-app-region: drag; }

        /* Sürükleme alanı içindeki tıklanabilir her şey geri alınır, yoksa
           düğmeler ve arama kutusu çalışmaz. */
        .masaustu-uygulama .topbar button,
        .masaustu-uygulama .topbar a,
        .masaustu-uygulama .topbar input,
        .masaustu-uygulama .topbar [role="button"],
        .masaustu-uygulama .topbar .btn { -webkit-app-region: no-drag; }

        /* macOS'ta trafik ışıklarına yer açılır. */
        .masaustu-darwin .topbar { padding-left: 78px; }

        /* Windows'ta pencere düğmeleri sağ üstte durur; üst çubuğun sağ ucu boşaltılır. */
        .masaustu-win32 .topbar { padding-right: 148px; }

        /* Masaüstü gezinme göstergesi: web içi geçiş çubuğundan ayrı, pencere
           düzeyindeki yüklemeleri (ilk açılış, yeniden yükleme) gösterir. */
        #masaustu-gecis {
            position: fixed;
            inset: 0 0 auto 0;
            height: 2px;
            z-index: 2147483647;
            pointer-events: none;
            opacity: 0;
            transition: opacity 180ms ease;
        }

        #masaustu-gecis[data-durum="basladi"] { opacity: 1; }

        #masaustu-gecis::before {
            content: '';
            position: absolute;
            inset: 0;
            width: 38%;
            background: linear-gradient(90deg, transparent, var(--brand-500, #0d8847), transparent);
            animation: masaustu-kay 1.1s cubic-bezier(0.45, 0, 0.3, 1) infinite;
        }

        @keyframes masaustu-kay {
            0%   { transform: translateX(-110%); }
            100% { transform: translateX(300%); }
        }

        @media (prefers-reduced-motion: reduce) {
            #masaustu-gecis::before { animation: none; }
        }

        /* Uygulamada metin seçimi yalnızca içerikte anlamlı; kabuk öğelerinde kapalı. */
        .masaustu-uygulama .topbar,
        .masaustu-uygulama aside { -webkit-user-select: none; user-select: none; }
    `
    document.head.appendChild(stil)

    const cubuk = document.createElement('div')
    cubuk.id = 'masaustu-gecis'
    document.body.appendChild(cubuk)
})
