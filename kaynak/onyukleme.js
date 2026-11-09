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

        /*
            macOS: PENCERE DÜĞMELERİNE AYRILMIŞ ÜST ŞERİT.

            Önce üst çubuğa 78 piksel sol boşluk bırakılıyordu. Yetmedi:
            logo üst çubukta değil, kenar çubuğunun tepesinde duruyor ve
            kapat/küçült/büyüt düğmeleri doğrudan onun üzerine biniyordu.
            Kenar çubuğuna boşluk bırakmak da çözüm değil, çünkü menü
            daraltılınca genişliği 76 piksele iniyor ve üç düğme o alanın
            tamamını kaplıyor.

            Bu yüzden düğmelere kendi şeridi veriliyor ve arayüzün tamamı
            32 piksel aşağı kayıyor. Hizalama bozulmuyor: her şey birlikte
            kayıyor, ölçü belirteçlerine (--topbar-h, --sidebar-w) hiç
            dokunulmuyor. Şeridin rengi arayüzün kendi --surface belirtecinden
            geldiği için açık ve koyu temada kendiliğinden doğru.

            Tam ekranda macOS düğmeleri gizler; o zaman şerit de kalkar,
            yoksa tepede boş bir bant kalırdı.
        */
        html.masaustu-darwin:not(.masaustu-tam-ekran) { --mac-serit: 32px; }

        #masaustu-serit {
            display: none;
            position: fixed;
            inset: 0 0 auto 0;
            height: var(--mac-serit, 0px);
            z-index: 2147483646;
            background: var(--surface, #ffffff);
            -webkit-app-region: drag;
        }

        html.masaustu-darwin:not(.masaustu-tam-ekran) #masaustu-serit { display: block; }

        /* Akıştaki içerik şeridin altından başlar. */
        html.masaustu-darwin:not(.masaustu-tam-ekran) body { padding-top: var(--mac-serit); }

        /* Gövde boşluğu sayfayı 32 piksel uzatıp gereksiz bir kaydırma
           çubuğu çıkarırdı; min-h-screen aynı miktarda kısaltılıyor.
           (Hem uygulama hem giriş düzeninin kökü bu sınıfı taşıyor.) */
        html.masaustu-darwin:not(.masaustu-tam-ekran) body > .min-h-screen {
            min-height: calc(100vh - var(--mac-serit));
        }

        /* Sabit ve yapışkan öğeler gövde boşluğundan etkilenmez; ayrıca
           kaydırılmaları gerekiyor. */
        html.masaustu-darwin:not(.masaustu-tam-ekran) aside > .fixed.inset-y-0,
        html.masaustu-darwin:not(.masaustu-tam-ekran) aside > .fixed.inset-0,
        html.masaustu-darwin:not(.masaustu-tam-ekran) .topbar { top: var(--mac-serit); }

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

        html.masaustu-darwin:not(.masaustu-tam-ekran) #masaustu-gecis { top: var(--mac-serit); }

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

    /* Şerit her platformda eklenir ama yalnızca macOS'ta görünür: CSS'te
       tek bir koşul olması, iki yerde birbirinden kopabilecek iki koşul
       olmasından iyi. */
    const serit = document.createElement('div')
    serit.id = 'masaustu-serit'
    document.body.appendChild(serit)

    /* Sayfa tam ekranda yeniden yüklenmiş olabilir; durum baştan sorulur,
       yoksa şerit tam ekranda da görünür kalırdı. */
    ipcRenderer.invoke('tam-ekran-mi')
        .then((acik) => tamEkraniUygula(acik))
        .catch(() => {})
})

function tamEkraniUygula(acik) {
    document.documentElement.classList.toggle('masaustu-tam-ekran', Boolean(acik))
}

ipcRenderer.on('tam-ekran', (_olay, acik) => tamEkraniUygula(acik))
