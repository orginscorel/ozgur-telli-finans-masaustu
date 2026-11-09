/**
 * Sağ tık (bağlam) menüsü.
 *
 * Electron varsayılan olarak HİÇ bağlam menüsü getirmez. Sağ tıklayınca
 * hiçbir şey çıkmaması, uygulamayı yarım bırakılmış gösteriyordu: metin
 * kutusunda kopyala/yapıştır yoktu, yazım denetimi açık olmasına rağmen
 * önerilere ulaşmanın yolu yoktu (öneriler yalnızca bu menüde görünür).
 *
 * Menü İÇERİĞE GÖRE kurulur: boş bir alana sağ tıklamakla metin kutusuna
 * sağ tıklamak aynı menüyü vermemeli. Kullanılamayacak maddeler hiç
 * eklenmez; sönük maddelerle dolu bir menü kullanıcıya bilgi vermiyor.
 */
const { Menu, MenuItem, clipboard, shell } = require('electron')

function baglamMenusuKur(pencere, adres) {
    pencere.webContents.on('context-menu', (_olay, p) => {
        const menu = new Menu()
        const ekle = (secenekler) => menu.append(new MenuItem(secenekler))
        const ayirac = () => {
            // Baştaki ve üst üste gelen ayıraçlar menüde boş çizgi bırakır.
            if (menu.items.length && menu.items[menu.items.length - 1].type !== 'separator') {
                ekle({ type: 'separator' })
            }
        }

        /* --- Yazım önerileri en üstte: düzeltme için tıklanan şey budur --- */
        if (p.misspelledWord) {
            for (const oneri of p.dictionarySuggestions.slice(0, 5)) {
                ekle({ label: oneri, click: () => pencere.webContents.replaceMisspelling(oneri) })
            }

            if (p.dictionarySuggestions.length === 0) {
                ekle({ label: 'Öneri yok', enabled: false })
            }

            ayirac()
            ekle({
                label: 'Sözlüğe ekle',
                click: () => pencere.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord),
            })
            ayirac()
        }

        /* --- Metin kutusu --- */
        if (p.isEditable) {
            ekle({ label: 'Geri al', role: 'undo', enabled: p.editFlags.canUndo })
            ekle({ label: 'Yinele', role: 'redo', enabled: p.editFlags.canRedo })
            ayirac()
            ekle({ label: 'Kes', role: 'cut', enabled: p.editFlags.canCut })
            ekle({ label: 'Kopyala', role: 'copy', enabled: p.editFlags.canCopy })
            ekle({ label: 'Yapıştır', role: 'paste', enabled: p.editFlags.canPaste })
            ekle({ label: 'Biçimsiz yapıştır', role: 'pasteAndMatchStyle', enabled: p.editFlags.canPaste })
            ayirac()
            ekle({ label: 'Tümünü seç', role: 'selectAll' })
        } else if (p.selectionText && p.selectionText.trim()) {
            ekle({ label: 'Kopyala', role: 'copy' })
            ayirac()
            /* Seçili metinle sistemin kendi arama sayfasına gitmek, uygulamayı
               bırakıp tarayıcıya atlamak olurdu; arama uygulamanın içinde. */
            ekle({
                label: 'Sistemde ara',
                click: () => {
                    const q = p.selectionText.trim().slice(0, 120)
                    pencere.loadURL(new URL(`/arama?q=${encodeURIComponent(q)}`, adres).toString())
                },
            })
        }

        /* --- Bağlantı --- */
        if (p.linkURL) {
            ayirac()
            ekle({ label: 'Bağlantıyı kopyala', click: () => clipboard.writeText(p.linkURL) })
            ekle({ label: 'Tarayıcıda aç', click: () => shell.openExternal(p.linkURL) })
        }

        /* --- Görsel --- */
        if (p.mediaType === 'image' && p.srcURL) {
            ayirac()
            ekle({ label: 'Görseli kopyala', role: 'copyImage' })
            ekle({ label: 'Görsel adresini kopyala', click: () => clipboard.writeText(p.srcURL) })
        }

        /* --- Gezinti: her zaman var, çünkü sağ tık menüsü boş kalmamalı --- */
        ayirac()
        ekle({
            label: 'Geri',
            enabled: pencere.webContents.navigationHistory.canGoBack(),
            click: () => pencere.webContents.navigationHistory.goBack(),
        })
        ekle({
            label: 'İleri',
            enabled: pencere.webContents.navigationHistory.canGoForward(),
            click: () => pencere.webContents.navigationHistory.goForward(),
        })
        ekle({ label: 'Yenile', click: () => pencere.webContents.reload() })

        menu.popup({ window: pencere })
    })
}

module.exports = { baglamMenusuKur }
