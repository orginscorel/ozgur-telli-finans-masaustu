/**
 * Sürüm karşılaştırması.
 *
 * Ayrı dosyada duruyor çünkü hem guncelleme.js hem mac-guncelleme.js
 * kullanıyor; birinden ötekine require etmek döngüsel bağımlılık yapar ve
 * CommonJS'te döngüde modülün yarım hâli görünebilir.
 */

/**
 * "1.10.0" > "1.9.0" doğru sonuçlansın diye parçalar SAYI olarak karşılaştırılır.
 * Dizgi karşılaştırması bu örnekte yanlış cevap verirdi ("1.10" < "1.9").
 */
function dahaYeni(uzak, yerel) {
    const a = String(uzak).split('.').map((n) => parseInt(n, 10) || 0)
    const b = String(yerel).split('.').map((n) => parseInt(n, 10) || 0)

    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0
        const y = b[i] || 0
        if (x !== y) return x > y
    }

    return false
}

module.exports = { dahaYeni }
