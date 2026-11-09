#!/usr/bin/env python3
"""macOS çökme raporunu (.ips) okur ve sebebi özetler.

.ips dosyası iki parçadır: ilk satır kısa üstbilgi, kalanı JSON gövde.
Gövdedeki `exception`, `termination` ve `asi` alanları çekirdeğin süreci
neden öldürdüğünü yazar. Electron'un asar bütünlük hatası gibi ölümcül
iç hatalar `asi` (application specific info) alanına düşer; uygulamanın
standart çıktısında hiç görünmez. Bu yüzden tek kanıt budur.
"""
import json
import sys


def main(yol: str) -> int:
    with open(yol, encoding='utf-8', errors='replace') as d:
        ham = d.read()

    # İlk satır JSON değil; gövde ikinci satırdan başlar.
    parcalar = ham.split('\n', 1)
    if len(parcalar) < 2:
        print('rapor gövdesi yok')
        return 1
    try:
        veri = json.loads(parcalar[1])
    except json.JSONDecodeError as hata:
        print('gövde ayrıştırılamadı:', hata)
        return 1

    for alan in ('procName', 'procPath', 'exception', 'termination', 'asi',
                 'isCorpse', 'vmRegionInfo'):
        if alan in veri:
            print(alan, '=', json.dumps(veri[alan], ensure_ascii=False))

    hatali = veri.get('faultingThread')
    izler = veri.get('threads') or []
    if hatali is not None and hatali < len(izler):
        goruntuler = veri.get('usedImages') or []
        print('--- hatalı iş parçacığı #%d ---' % hatali)
        for cerceve in (izler[hatali].get('frames') or [])[:14]:
            sira = cerceve.get('imageIndex', -1)
            ad = goruntuler[sira].get('name', '?') if 0 <= sira < len(goruntuler) else '?'
            print('   %-28s %-12s %s' % (ad, hex(cerceve.get('imageOffset', 0)),
                                         cerceve.get('symbol', '')))
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('kullanım: ips-oku.py <rapor.ips>', file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
