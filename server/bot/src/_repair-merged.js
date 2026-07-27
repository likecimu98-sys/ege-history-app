// Ремонт: телеграмные документы (числовой ID), ошибочно помеченные _mergedInto
// в АНОНИМНЫЙ документ (ненулевой прогресс прячется от загрузки).
// Правило: числовой doc.id + _mergedInto на НЕчисловой ID => убрать пометку.
// Запуск: node _repair-merged.js         — только показать (dry run)
//         node _repair-merged.js --fix   — починить
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('/root/bot/serviceAccount.json')) });
const db = admin.firestore();
const base = 'artifacts/ege-history-bot/public/data';
const FIX = process.argv.includes('--fix');

(async () => {
    const col = db.collection(`${base}/students`);
    const all = await col.get();
    console.log(`Всего документов: ${all.size}`);
    const victims = [];
    all.forEach(s => {
        const d = s.data();
        if (!d._mergedInto) return;
        const idNumeric = /^\d+$/.test(s.id);
        const targetNumeric = /^\d+$/.test(String(d._mergedInto));
        if (idNumeric && !targetNumeric) {
            victims.push({ id: s.id, name: d.name || '', solved: d.totalSolved || 0, target: d._mergedInto });
        }
    });
    console.log(`Телеграмных документов, похороненных в анонимные: ${victims.length}`);
    victims.forEach(v => console.log(`  ${v.id} «${v.name}» solved=${v.solved} -> ${v.target}`));

    if (FIX && victims.length) {
        for (const v of victims) {
            await col.doc(v.id).update({
                _mergedInto: admin.firestore.FieldValue.delete(),
                _mergedAt: admin.firestore.FieldValue.delete()
            });
            console.log(`  ✅ восстановлен ${v.id}`);
            // подчистим ссылку в _mergedFrom документа-свалки (косметика)
            try {
                await col.doc(String(v.target)).update({
                    _mergedFrom: admin.firestore.FieldValue.arrayRemove(v.id)
                });
            } catch (e) {}
        }
        console.log('Готово.');
    } else if (!FIX) {
        console.log('(dry run — ничего не менял; запусти с --fix)');
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
