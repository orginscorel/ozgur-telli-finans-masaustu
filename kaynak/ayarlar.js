/**
 * Uygulama genelinde sabitler ve kullanıcı tercihlerinin saklanması.
 *
 * Tercihler electron-store gibi bir bağımlılık yerine düz JSON olarak userData
 * altında tutulur: tek bir küçük dosya için ek paket taşımaya değmez.
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ADRES = 'https://fzy.bogalab.com.tr'

/* Uygulamanın açmasına izin verilen kökenler. Dışarıdaki her bağlantı
   varsayılan tarayıcıya gider: uygulama penceresi bir web tarayıcısı değildir. */
const IZINLI_KOKENLER = [ADRES]

const dosya = () => path.join(app.getPath('userData'), 'tercihler.json')

function oku() {
    try {
        return JSON.parse(fs.readFileSync(dosya(), 'utf8'))
    } catch {
        return {}
    }
}

function yaz(yeni) {
    const mevcut = oku()
    const birlesik = { ...mevcut, ...yeni }

    try {
        fs.mkdirSync(path.dirname(dosya()), { recursive: true })
        fs.writeFileSync(dosya(), JSON.stringify(birlesik, null, 2))
    } catch (e) {
        console.error('Tercihler yazılamadı:', e.message)
    }

    return birlesik
}

module.exports = { ADRES, IZINLI_KOKENLER, oku, yaz }
