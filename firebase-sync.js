// firebase-sync.js — Firebase Auth, Firestore, leaderboard, duel, cloud sync
// Загружается как ES Module (type="module")

        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { initializeFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, runTransaction, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        let firebaseConfig;
        if (typeof __firebase_config !== 'undefined') {
            firebaseConfig = JSON.parse(__firebase_config);
        } else {
            firebaseConfig = { apiKey: "AIzaSyDdxtpuznCSK5a6CvcJdbt9pzKMXbUVl08", authDomain: "ege-history-bot.firebaseapp.com", projectId: "ege-history-bot", storageBucket: "ege-history-bot.firebasestorage.app", messagingSenderId: "489223236202", appId: "1:489223236202:web:48110779742d40d748f813" };
        }
        
        const appId = typeof __app_id !== 'undefined' ? __app_id : "ege-history-bot";
        
        const app = initializeApp(firebaseConfig); 
        const auth = getAuth(app); 
        
        // Используем initializeFirestore с авто-определением Long Polling для обхода блокировок
        const db = initializeFirestore(app, {
            experimentalAutoDetectLongPolling: true
        });
        
        let fbUser = null; 

        function getTelegramWebApp() {
            return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
        }

        function getTelegramUser() {
            const app = getTelegramWebApp();
            return app && app.initDataUnsafe ? app.initDataUnsafe.user : null;
        }

        function isTelegramMiniAppContext() {
            const app = getTelegramWebApp();
            return !!(app && (app.initData || app.initDataUnsafe));
        }

        function rememberTelegramUser() {
            const tgU = getTelegramUser();
            if (tgU && tgU.id) {
                localStorage.setItem('known_tg_id', String(tgU.id));
                localStorage.removeItem('ege_sync_identity_warning');
                return String(tgU.id);
            }
            return localStorage.getItem('known_tg_id') || '';
        }

        async function waitForTelegramIdentity(timeoutMs = 1800) {
            const started = Date.now();
            rememberTelegramUser();
            while (!localStorage.getItem('known_tg_id') && isTelegramMiniAppContext() && Date.now() - started < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 100));
                rememberTelegramUser();
            }
            return localStorage.getItem('known_tg_id') || '';
        }

        function getIdentitySource(id) {
            const knownTg = localStorage.getItem('known_tg_id') || '';
            const googleUid = localStorage.getItem('google_uid') || '';
            if (knownTg && id === knownTg) return 'telegram';
            if (googleUid && id === 'google_' + googleUid) return 'google';
            if (id) return 'stable';
            return 'missing';
        }

        window.getSyncDebugInfo = function() {
            const canonicalId = fbUser ? resolveUserId(fbUser) : (localStorage.getItem('stable_student_id') || '');
            return {
                telegramContext: isTelegramMiniAppContext(),
                telegramId: localStorage.getItem('known_tg_id') || '',
                googleEmail: localStorage.getItem('google_email') || '',
                canonicalId,
                identitySource: getIdentitySource(canonicalId),
                legacyIds: getAllKnownIds().filter(id => id !== canonicalId),
                pendingCloudSync: localStorage.getItem('ege_pending_cloud_sync') === '1',
                lastCloudSync: localStorage.getItem('ege_last_cloud_sync') || '',
                warning: localStorage.getItem('ege_sync_identity_warning') || ''
            };
        };

        // ─── Надёжная система ID: храним ВСЕ известные идентификаторы ───────
        // Возвращает «канонический» ID для записи/чтения основного документа,
        // но getAllKnownIds() отдаёт полный список для синхронизации во все документы.
        function resolveUserId(userObj) {
            rememberTelegramUser();
            // Google-ID сохраняется в _applyGoogleUser → localStorage 'google_uid'
            
            // Канонический приоритет: TG > Google > старый stable > новый анонимный
            const knownTg = localStorage.getItem('known_tg_id');
            const googleUid = localStorage.getItem('google_uid');
            const oldStable = localStorage.getItem('stable_student_id');
            
            let canonical;
            if (knownTg) {
                canonical = knownTg;
            } else if (googleUid) {
                canonical = 'google_' + googleUid;
            } else if (oldStable) {
                canonical = oldStable;
            } else if (isTelegramMiniAppContext()) {
                localStorage.setItem('ege_sync_identity_warning', 'telegram_id_missing');
                return '';
            } else {
                canonical = userObj ? userObj.uid : 'anon_' + Date.now();
            }
            
            if (oldStable && oldStable !== canonical) {
                localStorage.setItem('previous_stable_student_id', oldStable);
                const legacy = new Set((localStorage.getItem('legacy_student_ids') || '').split(',').filter(Boolean));
                legacy.add(oldStable);
                localStorage.setItem('legacy_student_ids', [...legacy].join(','));
            }
            localStorage.setItem('stable_student_id', canonical);
            return canonical;
        }
        
        // Возвращает массив ВСЕХ известных ID пользователя (для записи во все документы)
        function getAllKnownIds() {
            const ids = new Set();
            const knownTg = localStorage.getItem('known_tg_id');
            const googleUid = localStorage.getItem('google_uid');
            const oldStable = localStorage.getItem('stable_student_id');
            const previousStable = localStorage.getItem('previous_stable_student_id');
            const legacyIds = (localStorage.getItem('legacy_student_ids') || '').split(',').filter(Boolean);
            
            if (knownTg) ids.add(knownTg);
            if (googleUid) ids.add('google_' + googleUid);
            if (oldStable) ids.add(oldStable);
            if (previousStable) ids.add(previousStable);
            legacyIds.forEach(id => ids.add(id));
            
            // Фильтруем дубли и невалидные
            return [...ids].filter(id => id && id.length > 0);
        }

        // Normalize name for comparison: lowercase, collapse spaces, remove punctuation
        function normalizeName(n) {
            return (n || '').trim().toLowerCase().replace(/[^а-яёa-z0-9\s]/gi, '').replace(/\s+/g,' ');
        }
        // Compute similarity of two normalized names (Jaccard on trigrams)
        function nameSimilarity(a, b) {
            if (!a || !b) return 0;
            if (a === b) return 1;
            const trigrams = s => { const t = new Set(); for(let i=0;i<s.length-2;i++) t.add(s.slice(i,i+3)); return t; };
            const ta = trigrams(a), tb = trigrams(b);
            let inter = 0; ta.forEach(t => { if(tb.has(t)) inter++; });
            return inter / (ta.size + tb.size - inter || 1);
        }
        function mergeTwo(base, extra) {
            if ((extra.totalSolved || 0) > (base.totalSolved || 0)) {
                base.totalSolved = extra.totalSolved;
                if (extra.fullStateJson && extra.fullStateJson.length > 20) base.fullStateJson = extra.fullStateJson;
            } else if (extra.fullStateJson && extra.fullStateJson.length > 20 && (!base.fullStateJson || base.fullStateJson.length <= 20)) {
                base.fullStateJson = extra.fullStateJson;
            }
            base.timeSpent = Math.max(base.timeSpent || 0, extra.timeSpent || 0);
            base.lastActive = Math.max(base.lastActive || 0, extra.lastActive || 0);
            // Keep longer/more complete name
            if ((extra.name || '').length > (base.name || '').length && !/(аноним|без имени)/i.test(extra.name)) {
                base.name = extra.name;
            }
        }
        function mergeDuplicateStudents(students) {
            // Step 1: filter zero-activity
            let active = students.filter(s => (s.totalSolved || 0) > 0);
            // Step 2: exact match by normalized name + username
            const exactMap = {};
            const result = [];
            active.forEach(st => {
                const nm = normalizeName(st.name);
                const isAnon = !nm || nm === 'аноним' || nm.includes('без имени') || nm.includes('ученик');
                if (isAnon) {
                    // anonymous: try to keep as-is, will be fuzzy-merged below
                    result.push({ ...st, _nm: nm, _anon: true });
                    return;
                }
                const k = nm + '|' + (st.username || '').trim().toLowerCase();
                if (!exactMap[k]) { exactMap[k] = { ...st, _nm: nm, _anon: false }; result.push(exactMap[k]); }
                else { mergeTwo(exactMap[k], st); }
            });
            // Step 3: fuzzy-merge anonymous entries with existing named entries
            const namedResult = result.filter(s => !s._anon);
            const anonEntries = result.filter(s => s._anon);
            anonEntries.forEach(anon => {
                // Try to find a named entry whose tgId or uid partially matches
                const anonUid = (anon.tgId || anon.uid || '').toString();
                let matched = null;
                // Match by tgId overlap (handles google_ vs numeric tgId)
                if (anonUid) {
                    matched = namedResult.find(n => {
                        const nUid = (n.tgId || n.uid || '').toString();
                        return nUid && (nUid === anonUid || nUid.includes(anonUid) || anonUid.includes(nUid));
                    });
                }
                if (matched) { mergeTwo(matched, anon); }
                else { namedResult.push(anon); } // keep as separate if no match
            });
            // Step 4: fuzzy-merge named entries with high similarity (>0.82)
            const finalResult = [];
            const used = new Set();
            namedResult.forEach((st, i) => {
                if (used.has(i)) return;
                finalResult.push(st);
                namedResult.forEach((other, j) => {
                    if (j <= i || used.has(j)) return;
                    if (nameSimilarity(st._nm, other._nm) > 0.82) {
                        mergeTwo(st, other);
                        used.add(j);
                    }
                });
            });
            // Clean up internal fields
            finalResult.forEach(s => { delete s._nm; delete s._anon; });
            return finalResult;
        }
        
        /*
         * ✅ НЕОБХОДИМЫЕ ИНДЕКСЫ FIRESTORE (создать в Firebase Console → Firestore → Indexes):
         *
         * Коллекция: artifacts/{appId}/public/data/students
         *   1. totalSolved  DESC                              (для openGlobalTopModal)
         *   2. weeklyScore  DESC                              (для loadStudentLeaderboard)
         *   3. classCode    ASC  + totalSolved DESC           (для loadClassProgress с фильтром)
         *   4. googleEmail  ASC                               (для loadProgressFromCloud)
         *
         * Коллекция: artifacts/{appId}/public/data/matches
         *   5. status ASC + createdAt ASC                     (для startDuelSearchDb)
         *
         * Документ-кэш лидерборда (обновляется клиентом раз в 10 мин):
         *   artifacts/{appId}/public/data/leaderboards/global
         *   Поля: { top: Array<{name,username,totalSolved}>, updatedAt: number }
         *   → При 1000 игроков: 1 чтение/открытие топа вместо 20.
         *
         * СБРОС WEEKLY SCORE (каждый понедельник через Cloud Functions):
         *   Обнулять поле weeklyScore у всех документов students.
         *   Пример Cloud Function (Node.js):
         *   exports.resetWeeklyScores = functions.pubsub
         *     .schedule('every monday 00:00').onRun(async () => {
         *       const snap = await admin.firestore()
         *         .collection('artifacts/APP_ID/public/data/students').get();
         *       const batch = admin.firestore().batch();
         *       snap.docs.forEach(d => batch.update(d.ref, { weeklyScore: 0 }));
         *       await batch.commit();
         *     });
         */
        
        const initAuth = async () => {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                try {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } catch(e) {
                    console.warn("Ошибка токена (custom-token-mismatch), используем анонимный вход:", e.message);
                    try {
                        await signInAnonymously(auth);
                    } catch(err) {
                        console.error("Auth init error:", err);
                    }
                }
            } else {
                try {
                    await signInAnonymously(auth);
                } catch(e) {
                    console.error("Auth init error:", e);
                }
            }
        };
        // ─── Google auth helper ──────────────────────────────────────────────────
        function _applyGoogleUser(user) {
            const gName  = user.displayName || '';
            const gEmail = user.email       || '';
            // Set Google name as fallback only if no manual name is set
            if (gName && !localStorage.getItem('student_manual_name'))
                localStorage.setItem('student_manual_name', gName);
            // Сохраняем google_uid — resolveUserId() сам выберет канонический ID
            localStorage.setItem('google_uid',   user.uid);
            localStorage.setItem('google_email', gEmail);
            // Пересчитываем канонический ID (учтёт и ТГ, и Google)
            resolveUserId(user);
            const statusEl = $('profile-google-status');
            if (statusEl) {
                statusEl.textContent  = '✅ ' + (gEmail || gName);
                statusEl.className    = 'text-[11px] font-bold text-emerald-600 mt-1';
            }
            const nameEl = $('profile-name-input');
            if (nameEl) {
                // Show the stored name (could be from TG/cloud), or Google name as fallback
                const storedName = localStorage.getItem('student_manual_name') || gName;
                if (storedName && !nameEl.value) nameEl.value = storedName;
            }
            const classEl = $('profile-class-code');
            if (classEl) {
                const storedClass = localStorage.getItem('student_class_code') || '';
                if (storedClass && !classEl.value) classEl.value = storedClass;
            }
        }

        // ─── Main auth bootstrap ─────────────────────────────────────────────────
        // ВАЖНО: getRedirectResult нужно вызывать ДО signInAnonymously,
        // иначе анонимный вход перебивает сессию редиректа.
        const _bootAuth = async () => {
            let googleSignedIn = false;
            try {
                const result = await getRedirectResult(auth);
                if (result && result.user) {
                    googleSignedIn = true;
                    _applyGoogleUser(result.user);
                    // Тост и синхронизация — в onAuthStateChanged (когда fbUser уже установлен)
                    window._pendingGoogleToast = result.user.email || result.user.displayName || '';
                }
            } catch (e) {
                console.error('getRedirectResult error:', e);

                // ── Аккаунт Google уже привязан к другой анонимной сессии Firebase.
                //    Решение — войти под этим аккаунтом напрямую через credential из ошибки.
                if (e.code === 'auth/credential-already-in-use' ||
                    e.code === 'auth/email-already-in-use') {
                    try {
                        const credential = GoogleAuthProvider.credentialFromError(e);
                        if (credential) {
                            const fallbackResult = await signInWithCredential(auth, credential);
                            googleSignedIn = true;
                            _applyGoogleUser(fallbackResult.user);
                            window._pendingGoogleToast = fallbackResult.user.email || fallbackResult.user.displayName || '';
                        }
                    } catch (fallbackErr) {
                        console.error('signInWithCredential fallback error:', fallbackErr);
                        setTimeout(() => showToast('❌', 'Не удалось войти через Google. Попробуйте ещё раз.', 'bg-rose-500', 'border-rose-700'), 800);
                    }
                } else if (e.code && e.code !== 'auth/redirect-cancelled-by-user'
                                   && e.code !== 'auth/user-cancelled') {
                    setTimeout(() => showToast('❌', 'Ошибка Google: ' + (e.code || e.message), 'bg-rose-500', 'border-rose-700'), 800);
                }
            }

            // Если Google-аккаунт не найден — запускаем стандартный анонимный вход
            if (!googleSignedIn) {
                await initAuth();
            }
        };
        _bootAuth();

        // ─── Google Sign-In (popup with redirect fallback) ─────────────────────
        // signInWithPopup works in most environments including WebViews.
        // If popup is blocked, falls back to signInWithRedirect.
        window.signInWithGoogle = async function() {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            // Remember old ID and local data before switching
            const oldStudentId = localStorage.getItem('stable_student_id') || '';
            const localStateJson = localStorage.getItem('ege_final_storage_v4') || '{}';
            const localSolved = window.state.stats.totalSolvedEver || 0;
            
            async function _handleGoogleResult(user) {
                _applyGoogleUser(user);
                const newId = resolveUserId(user); // now google_<uid>
                
                // loadProgressFromCloud will search by google_<uid>, then by email, then by name
                // This handles the case where data is under TG ID
                await window.loadProgressFromCloud();
                
                const cloudLoaded = window.state.stats.totalSolvedEver || 0;
                
                // If cloud had no data but local had some (from anon session), push to cloud
                if (cloudLoaded === 0 && localSolved > 0) {
                    // Restore local state that might have been overwritten
                    try {
                        const parsed = normalizeSavedStateObject(JSON.parse(localStateJson));
                        if (parsed) applyMergedState(parsed);
                        localStorage.setItem('ege_final_storage_v4', localStateJson);
                    } catch(e) {}
                    await window.syncProgressToCloud();
                } else if (cloudLoaded > 0) {
                    // Cloud was loaded — also sync back to ensure data is under google_<uid>
                    await window.syncProgressToCloud();
                }
                
                // Also migrate old TG document to include googleEmail so future lookups work
                if (oldStudentId && oldStudentId !== newId) {
                    try {
                        const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                        const oldDoc = await getDoc(doc(studentsCol, oldStudentId));
                        if (oldDoc.exists() && (oldDoc.data().totalSolved || 0) > 0) {
                            await setDoc(doc(studentsCol, oldStudentId), { googleEmail: user.email || '' }, { merge: true });
                        }
                    } catch(e) {}
                }
                
                updateGlobalUI();
                if (window.updateProgressBars) updateProgressBars();
            }
            
            try {
                const result = await signInWithPopup(auth, provider);
                if (result && result.user) {
                    await _handleGoogleResult(result.user);
                    showToast('✅', 'Вход через Google: ' + (result.user.email || result.user.displayName || ''), 'bg-emerald-500', 'border-emerald-700');
                }
            } catch (e) {
                if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
                    try {
                        await signInWithRedirect(auth, provider);
                    } catch (redirectErr) {
                        console.error('signInWithRedirect fallback error:', redirectErr);
                        showToast('❌', 'Не удалось войти: ' + (redirectErr.code || redirectErr.message), 'bg-rose-500', 'border-rose-700');
                    }
                } else if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
                    try {
                        const credential = GoogleAuthProvider.credentialFromError(e);
                        if (credential) {
                            const fallbackResult = await signInWithCredential(auth, credential);
                            await _handleGoogleResult(fallbackResult.user);
                            showToast('✅', 'Вход через Google: ' + (fallbackResult.user.email || ''), 'bg-emerald-500', 'border-emerald-700');
                        }
                    } catch (credErr) {
                        console.error('signInWithCredential error:', credErr);
                        showToast('❌', 'Не удалось войти через Google', 'bg-rose-500', 'border-rose-700');
                    }
                } else {
                    console.error('signInWithGoogle error:', e);
                    showToast('❌', 'Ошибка Google: ' + (e.code || e.message), 'bg-rose-500', 'border-rose-700');
                }
            }
        };

        // Хранилище для отписок от HW-слушателей
        let _hwUnsubscribers = [];
        
        onAuthStateChanged(auth, async (u) => { 
            fbUser = u;
            if (u) {
                // Слушатель вызовов на дуэль — запускаем СРАЗУ после авторизации,
                // до загрузки прогресса/ДЗ: иначе любой сбой загрузки лишал бы
                // онлайн-игроков уведомлений о дуэли.
                try { startChallengeListener(); } catch (e) {}
                await waitForTelegramIdentity();
                // ── Сохраняем Google-данные если вход через Google
                const googleProvider = (u.providerData || []).find(p => p.providerId === 'google.com');
                if (googleProvider) {
                    const gEmail = googleProvider.email || u.email || '';
                    const gName  = googleProvider.displayName || u.displayName || '';
                    localStorage.setItem('google_email', gEmail);
                    localStorage.setItem('google_uid',   u.uid);
                    // НЕ перезаписываем stable_student_id напрямую — resolveUserId разберётся
                    if (gName && !localStorage.getItem('student_manual_name'))
                        localStorage.setItem('student_manual_name', gName);
                    _applyGoogleUser(u);
                }

                // Загружаем прогресс из облака (ПЕРЕД синхронизацией — иначе затрём облако нулями)
                // Это также подтягивает known_tg_id из найденного документа
                await window.loadProgressFromCloud();
                
                // Update UI with loaded name/class
                const nameEl = $('profile-name-input');
                const classEl = $('profile-class-code');
                if (nameEl && localStorage.getItem('student_manual_name')) nameEl.value = localStorage.getItem('student_manual_name');
                if (classEl && localStorage.getItem('student_class_code')) classEl.value = localStorage.getItem('student_class_code');
                // Update Google status UI
                if (googleProvider) {
                    const statusEl = $('profile-google-status');
                    const gEmail = localStorage.getItem('google_email') || '';
                    if (statusEl && gEmail) {
                        statusEl.textContent = '✅ ' + gEmail;
                        statusEl.className = 'text-[11px] font-bold text-emerald-600 mt-1';
                    }
                }

                // Тост о входе через Google (если был редирект)
                if (window._pendingGoogleToast) {
                    showToast('✅', 'Вход через Google: ' + window._pendingGoogleToast, 'bg-emerald-500', 'border-emerald-700');
                    window._pendingGoogleToast = null;
                }

                // Теперь синхронизируем актуальный (возможно только что загруженный) прогресс в облако
                window.syncProgressToCloud(); 
                
                // ── Receiver for Homework — слушаем ВСЕ известные документы ──
                // Сначала отписываемся от старых слушателей
                _hwUnsubscribers.forEach(unsub => { try { unsub(); } catch(e) {} });
                _hwUnsubscribers = [];
                
                const hwIds = getAllKnownIds();
                const canonicalId = resolveUserId(u);
                if (!hwIds.includes(canonicalId)) hwIds.push(canonicalId);

                // ── ДИАГНОСТИКА ВЫРАВНИВАНИЯ AUTH (см. AUTH.md) ──────────────────
                // Включается флагом: localStorage.setItem('ege_auth_debug','1') + перезагрузка.
                // Показывает, совпадает ли request.auth.uid с ID документа ученика —
                // от этого зависит, можно ли включать строгие правила владения Firestore.
                // Безопасно: только console.log за флагом, ничего не пишет и не меняет.
                if (localStorage.getItem('ege_auth_debug')) {
                    console.log('[AuthDiag]', JSON.stringify({
                        authUid: u.uid,
                        isAnonymous: u.isAnonymous,
                        providers: (u.providerData || []).map(p => p.providerId),
                        canonicalDocId: canonicalId,
                        identitySource: (typeof getIdentitySource === 'function' ? getIdentitySource(canonicalId) : '?'),
                        match_authUid_equals_docId: u.uid === canonicalId
                    }));
                }
                
                function _handleHwSnapshot(docSnap) {
                    if (!docSnap.exists()) return;
                    const data = docSnap.data();

                    // ── Индивидуально отозванные учителем ДЗ (поле revokedAssignments документа ученика) ──
                    const ownRevoked = Array.isArray(data.revokedAssignments) ? data.revokedAssignments : [];
                    if (ownRevoked.length) {
                        _mergeRevoked(ownRevoked);
                        const rmRevoked = window.reconcileRevokedAssignments ? window.reconcileRevokedAssignments(ownRevoked) : 0;
                        if (rmRevoked > 0) {
                            if (window.recomputeHwMirror) window.recomputeHwMirror();
                            if (window.refreshHwState) window.refreshHwState();
                            saveProgress();
                            if (window.updateGlobalUI) window.updateGlobalUI();
                            if (window.updateHwNavBadge) window.updateHwNavBadge();
                        }
                    }

                    // ── Новая модель: список заданий (pendingAssignments) ──
                    const pending = Array.isArray(data.pendingAssignments) ? data.pendingAssignments : [];
                    if (pending.length) {
                        let added = 0;
                        const revoked = window._classRevoked; // отозванные учителем ДЗ не подхватываем
                        pending.forEach(rec => {
                            if (rec && rec.id && revoked && revoked.has(rec.id)) return;
                            if (window.ingestAssignment && window.ingestAssignment(rec)) added++;
                        });
                        // снимаем обработанные записи с документа (точное соответствие объектов)
                        updateDoc(docSnap.ref, { pendingAssignments: arrayRemove(...pending) }).catch(console.error);
                        if (added > 0) {
                            if (window.recomputeHwMirror) window.recomputeHwMirror();
                            const by = { task3: 0, task4: 0, task5: 0, task7: 0 };
                            pending.forEach(r => { by[r.task] = (by[r.task] || 0) + (Number(r.total) || 0); });
                            const parts = [];
                            if (by.task3) parts.push(`🔗№3: ${by.task3}`);
                            if (by.task4) parts.push(`📍№4: ${by.task4}`);
                            if (by.task5) parts.push(`👤№5: ${by.task5}`);
                            if (by.task7) parts.push(`🎨№7: ${by.task7}`);
                            showToast('🔥', `Новое ДЗ: ${parts.join(', ')}`, 'bg-rose-500', 'border-rose-700');
                            saveProgress();
                            if (window.updateGlobalUI) window.updateGlobalUI();
                        }
                        return;
                    }

                    // ── Legacy: накопительные поля → конвертируем в отдельные задания ──
                    const t3 = data.hwAssignTask3 || 0;
                    const t4 = data.hwAssignTask4 || 0;
                    const t5 = data.hwAssignTask5 || 0;
                    const t7 = data.hwAssignTask7 || 0;
                    const totalHw = t3 + t4 + t5 + t7;
                    const dl = data.assignedTeacherHwDeadline || null;
                    const mkLegacy = (task, n) => n > 0 && window.ingestAssignment && window.ingestAssignment({
                        id: 'legacy_' + task + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                        task, total: n, deadline: dl, assignedAt: Date.now()
                    });
                    if (totalHw > 0) {
                        mkLegacy('task3', t3); mkLegacy('task4', t4); mkLegacy('task5', t5); mkLegacy('task7', t7);
                        if (window.recomputeHwMirror) window.recomputeHwMirror();
                        setDoc(docSnap.ref, { hwAssignTask3: 0, hwAssignTask4: 0, hwAssignTask5: 0, hwAssignTask7: 0, assignedTeacherHw: 0 }, { merge: true }).catch(console.error);
                        const parts = [];
                        if (t3 > 0) parts.push(`🔗№3: ${t3}`);
                        if (t4 > 0) parts.push(`📍№4: ${t4}`);
                        if (t5 > 0) parts.push(`👤№5: ${t5}`);
                        if (t7 > 0) parts.push(`🎨№7: ${t7}`);
                        const dlStr = dl ? ` · до ${new Date(dl + 'T00:00:00').toLocaleDateString('ru-RU')}` : '';
                        showToast('🔥', `ДЗ: ${parts.join(', ')}${dlStr}`, 'bg-rose-500', 'border-rose-700');
                        saveProgress();
                        if(window.updateGlobalUI) window.updateGlobalUI();
                    } else if (data.assignedTeacherHw && data.assignedTeacherHw > 0) {
                        mkLegacy(data.assignedTeacherHwTask || 'task4', data.assignedTeacherHw);
                        if (window.recomputeHwMirror) window.recomputeHwMirror();
                        setDoc(docSnap.ref, { assignedTeacherHw: 0 }, { merge: true }).catch(console.error);
                        showToast('🔥', `ДЗ: ${data.assignedTeacherHw} строк`, 'bg-rose-500', 'border-rose-700');
                        saveProgress();
                        if(window.updateGlobalUI) window.updateGlobalUI();
                    }
                }
                
                const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                for (const hwId of hwIds.filter(Boolean)) {
                    const unsub = onSnapshot(doc(studentsCol, hwId), _handleHwSnapshot, (error) => console.error("HW snapshot error for " + hwId + ":", error));
                    _hwUnsubscribers.push(unsub);
                }
                console.log(`[Sync] HW-слушатели подключены к: [${hwIds.join(', ')}]`);

                // Догружаем старые ДЗ своего класса (на случай, если ученик добавлен на курс позже)
                const myClass = localStorage.getItem('student_class_code');
                if (myClass && window.pullClassAssignments) window.pullClassAssignments(myClass);

                // (слушатель вызовов на дуэль уже запущен выше, сразу после авторизации)
            }
        });

        // ── Глобальные вызовы на дуэль ──
        // Любой матч со статусом 'waiting' = кто-то нажал «Дуэли» и ждёт соперника.
        // Слушаем такие матчи и показываем всем баннер «Принять вызов».
        let _challengeUnsub = null;
        let _autoAccepting = false;
        function _ddbg() { try { if (localStorage.getItem('ege_duel_debug')) console.log('[Duel]', ...arguments); } catch (e) {} }
        function startChallengeListener() {
            if (!db) { _ddbg('listener: нет db'); return; }
            if (_challengeUnsub) { try { _challengeUnsub(); } catch(e) {} _challengeUnsub = null; }
            const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
            // БЕЗ limit: при limit(10) и накопившихся «брошенных» waiting-матчах свежий вызов
            // часто не попадал в выборку (порядок не задан) → уведомление приходило «через раз».
            // Запрос только по равенству status — составной индекс не нужен.
            const waitingQuery = query(matchesRef, where('status', '==', 'waiting'));
            _ddbg('listener подключён, appId =', appId);
            _challengeUnsub = onSnapshot(waitingQuery, (snap) => {
                const myUid = fbUser ? resolveUserId(fbUser) : null;
                const now = Date.now();
                const duel = window.state.duel;
                if (duel && duel.active) { if (window.hideDuelChallenge) window.hideDuelChallenge(); return; }
                // «host» = я создал свой матч и жду соперника. Только в этом состоянии
                // авто-стыкуемся. В момент самой стыковки (searching, но уже не host)
                // не делаем ничего — иначе можно случайно присоединиться ко второму матчу.
                const host = !!(duel && duel.searching && duel.isPlayer1 && duel.matchId);
                if (duel && duel.searching && !host) return;
                const myMatchId = host ? duel.matchId : null;
                let best = null;
                snap.forEach(docSnap => {
                    const d = docSnap.data();
                    if (!d.player1 || !d.player1.uid) return;
                    if (myUid && d.player1.uid === myUid) return;     // не свой вызов
                    if (d.player2) return;                            // слот уже занят
                    if (now - (d.createdAt || 0) > 28000) return;     // протух
                    const id = docSnap.id;
                    // Если я сам жду — стыкуемся только с матчем с «меньшим» id.
                    // Детерминированный тайбрейк: ровно одна сторона присоединяется,
                    // без гонки «оба приняли друг друга».
                    if (host && !(id < myMatchId)) return;
                    if (!best || (d.createdAt || 0) > best.createdAt) best = { matchId: id, name: d.player1.name || 'Игрок', createdAt: d.createdAt || 0 };
                });
                _ddbg('ожидающих:', snap.size, '| подходящий:', best && best.matchId, '| хозяин:', host);
                if (!best) { if (window.hideDuelChallenge) window.hideDuelChallenge(); return; }
                if (host) {
                    // Оба ищут одновременно → авто-стыковка (я — сторона с «бóльшим» id).
                    if (!_autoAccepting) {
                        _autoAccepting = true;
                        _ddbg('авто-стыковка к', best.matchId, '· убираю свой', myMatchId);
                        (async () => {
                            try {
                                if (myMatchId) { try { await deleteDoc(doc(matchesRef, myMatchId)); } catch (e) {} }
                                await window.acceptDuelChallengeDb(best.matchId);
                            } finally { _autoAccepting = false; }
                        })();
                    }
                } else if (window.showDuelChallenge) {
                    window.showDuelChallenge(best);
                }
            }, (err) => { _ddbg('ОШИБКА слушателя:', err && (err.code || err.message)); console.warn('[Challenge] listener error', err); });
        }

        // Принять конкретный вызов (присоединиться к ожидающему матчу как player2)
        window.acceptDuelChallengeDb = async function(matchId) {
            if (!fbUser || !db) { showToast('❌', 'Подключитесь к сети', 'bg-rose-500', 'border-rose-700'); return false; }
            if (window.state.duel && window.state.duel.active) { showToast('ℹ️', 'Вы уже в дуэли', 'bg-blue-500', 'border-blue-700'); return false; }
            const myUid = resolveUserId(fbUser);
            let myName = localStorage.getItem('student_manual_name') || 'Игрок';
            if (myName.length > 12) myName = myName.substring(0, 10) + '..';
            const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
            window.state.duel = { active: false, searching: true, matchId: null, isPlayer1: false, oppName: '', myScore: 0, oppScore: 0, myCombo: 0, oppCombo: 0 };
            try {
                await runTransaction(db, async (transaction) => {
                    const ref = doc(matchesRef, matchId);
                    const snap = await transaction.get(ref);
                    if (!snap.exists()) throw new Error('match_gone');
                    const d = snap.data();
                    if (d.status !== 'waiting' || d.player2 !== null || (d.player1 && d.player1.uid === myUid)) throw new Error('slot_taken');
                    transaction.update(ref, { status: 'playing', player2: { uid: myUid, name: myName, score: 0, combo: 0 }, startTime: Date.now() + 4000 });
                });
                window.state.duel.matchId = matchId;
                window.state.duel.isPlayer1 = false;
                listenToDuel(matchId, myUid);
                return true;
            } catch (e) {
                window.state.duel = { active: false, searching: false, matchId: null, isPlayer1: false, oppName: '', myScore: 0, oppScore: 0, myCombo: 0, oppCombo: 0 };
                if (e.message === 'slot_taken' || e.message === 'match_gone') showToast('⌛', 'Вызов уже принят другим', 'bg-amber-500', 'border-amber-700');
                else { console.error(e); showToast('❌', 'Не удалось принять вызов', 'bg-rose-500', 'border-rose-700'); }
                return false;
            }
        };

        // PvP FIREBASE DUEL LOGIC
        // ✅ FIX: Используем runTransaction для атомарного захвата слота player2
        // Это исключает Race Condition когда двое одновременно присоединяются к одному матчу
        let duelUnsubscribe = null;
        window.startDuelSearchDb = async function() {
            if (!fbUser || !db) { _ddbg('поиск невозможен: нет', !fbUser ? 'авторизации' : 'db'); return showToast('❌', 'Подключитесь к сети', 'bg-rose-500', 'border-rose-700'); }
            window.state.duel = { active: false, searching: true, matchId: null, isPlayer1: false, oppName: '', myScore: 0, oppScore: 0, myCombo: 0, oppCombo: 0 };
            
            const myUid = resolveUserId(fbUser);
            let myName = localStorage.getItem('student_manual_name') || 'Игрок';
            if (myName.length > 12) myName = myName.substring(0, 10) + '..';

            const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
            
            try {
                // Берём ВСЕ waiting-матчи (без limit — иначе свежий кандидат мог не попасть в выборку).
                const waitingQuery = query(matchesRef, where('status', '==', 'waiting'));
                const snapshot = await getDocs(waitingQuery);

                const now = Date.now();
                let candidateIds = [];
                let staleIds = [];
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    const age = now - (data.createdAt || 0);
                    // Брошенный матч (приложение закрыли во время поиска) — на уборку,
                    // иначе очередь разрастается и ломает выборку у всех.
                    if (data.player2 == null && age > 45000) { staleIds.push(docSnap.id); return; }
                    if (data.player1 && data.player1.uid !== myUid && age < 30000) {
                        candidateIds.push(docSnap.id);
                    }
                });
                // Best-effort уборка протухших матчей (правила разрешают delete авторизованным; 45с > окна поиска).
                staleIds.forEach(id => { deleteDoc(doc(matchesRef, id)).catch(() => {}); });
                _ddbg('поиск: в очереди', snapshot.size, '· подходящих', candidateIds.length, '· убрано протухших', staleIds.length);

                let joinedMatchId = null;

                // ✅ FIX: runTransaction — атомарно проверяем что player2 ещё свободен перед записью
                for (const candidateId of candidateIds) {
                    try {
                        await runTransaction(db, async (transaction) => {
                            const matchDocRef = doc(matchesRef, candidateId);
                            const matchSnap = await transaction.get(matchDocRef);
                            if (!matchSnap.exists()) throw new Error('match_gone');
                            const matchData = matchSnap.data();
                            // Проверяем внутри транзакции: слот ещё свободен?
                            if (matchData.status !== 'waiting' || matchData.player2 !== null) {
                                throw new Error('slot_taken');
                            }
                            // Атомарно занимаем слот
                            transaction.update(matchDocRef, {
                                status: 'playing',
                                player2: { uid: myUid, name: myName, score: 0, combo: 0 },
                                startTime: Date.now() + 4000
                            });
                        });
                        joinedMatchId = candidateId;
                        break; // Успешно присоединились
                    } catch (txErr) {
                        if (txErr.message === 'slot_taken' || txErr.message === 'match_gone') {
                            continue; // Слот занят — пробуем следующий
                        }
                        throw txErr; // Другая ошибка — пробрасываем
                    }
                }

                if (joinedMatchId) {
                    window.state.duel.isPlayer1 = false;
                    window.state.duel.matchId = joinedMatchId;
                    _ddbg('присоединился к матчу', joinedMatchId, '→ игра');
                    listenToDuel(joinedMatchId, myUid);
                } else {
                    // Не нашли свободный матч — создаём свой
                    window.state.duel.isPlayer1 = true;
                    const newMatch = await addDoc(matchesRef, {
                        status: 'waiting',
                        createdAt: Date.now(),
                        player1: { uid: myUid, name: myName, score: 0, combo: 0 },
                        player2: null,
                        startTime: 0
                    });
                    window.state.duel.matchId = newMatch.id;
                    _ddbg('создал свой матч', newMatch.id, '— жду соперника/авто-стыковки');
                    listenToDuel(newMatch.id, myUid);
                }
            } catch(e) {
                _ddbg('ОШИБКА поиска:', e && (e.code || e.message));
                console.error("Ошибка поиска дуэли:", e);
                showToast('❌', 'Сервер недоступен (Офлайн)', 'bg-rose-500', 'border-rose-700');
                window.cancelDuelSearch();
            }
        };

        function listenToDuel(matchId, myUid) {
            // ✅ FIX: Всегда отписываемся от предыдущего слушателя перед созданием нового
            if (duelUnsubscribe) {
                try { duelUnsubscribe(); } catch(e) {}
                duelUnsubscribe = null;
            }
            const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
            duelUnsubscribe = onSnapshot(doc(matchesRef, matchId), (docSnap) => {
                if (!docSnap.exists()) {
                    window.cancelDuelSearch('Соперник вышел');
                    return;
                }
                const data = docSnap.data();
                
                if (data.status === 'playing' && window.state.duel.searching) {
                    window.state.duel.searching = false;
                    const opp = window.state.duel.isPlayer1 ? data.player2 : data.player1;
                    window.state.duel.oppName = opp ? opp.name : 'Соперник';
                    window.initDuelStart(data.startTime);
                }
                
                if (data.status === 'playing' && !window.state.duel.searching) {
                    const opp = window.state.duel.isPlayer1 ? data.player2 : data.player1;
                    if (opp) {
                        window.state.duel.oppScore = opp.score || 0;
                        window.state.duel.oppCombo = opp.combo || 0;
                        window.updateDuelUI();
                    }
                }
                
                // ✅ FIX: Автоматически отписываемся когда матч завершён
                if (data.status === 'finished') {
                    if (duelUnsubscribe) { try { duelUnsubscribe(); } catch(e) {} duelUnsubscribe = null; }
                }
            }, (error) => {
                console.error(error);
                window.cancelDuelSearch('Ошибка связи');
            });
        }

        // ✅ FIX: Функция теперь async с правильным await — без молчаливых падений
        window.updateDuelScoreDb = async function(score, combo) {
            if (!db || !window.state.duel.matchId || !fbUser) return;
            const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
            try {
                await updateDoc(doc(matchesRef, window.state.duel.matchId), {
                    [window.state.duel.isPlayer1 ? 'player1' : 'player2']: { 
                        uid: resolveUserId(fbUser), 
                        name: localStorage.getItem('student_manual_name') || 'Игрок', 
                        score: score, 
                        combo: combo 
                    }
                });
            } catch(e) { console.error('[Duel] updateDuelScoreDb error:', e); }
        };

        window.cancelDuelDb = async function() {
            // ✅ FIX: Всегда чистим слушатель первым делом, вне зависимости от состояния
            if (duelUnsubscribe) { try { duelUnsubscribe(); } catch(e) {} duelUnsubscribe = null; }
            if (!db || !window.state.duel.matchId) return;
            
            try {
                const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
                if (window.state.duel.searching && window.state.duel.isPlayer1) {
                    await deleteDoc(doc(matchesRef, window.state.duel.matchId));
                } else if (window.state.duel.active) {
                    await updateDoc(doc(matchesRef, window.state.duel.matchId), { status: 'finished' });
                }
            } catch(e) { console.error(e); }
            window.state.duel = { active: false, searching: false, matchId: null, isPlayer1: false, oppName: '', myScore: 0, oppScore: 0, myCombo: 0, oppCombo: 0 };
        };
        
        // ✅ FIX: Очистка слушателей при уходе со страницы (кнопка «Назад», закрытие вкладки)
        window.addEventListener('beforeunload', () => {
            if (duelUnsubscribe) { try { duelUnsubscribe(); } catch(e) {} duelUnsubscribe = null; }
            if (_challengeUnsub) { try { _challengeUnsub(); } catch(e) {} _challengeUnsub = null; }
            _hwUnsubscribers.forEach(unsub => { try { unsub(); } catch(e) {} });
            _hwUnsubscribers = [];
        });
        
        // ─── Вспомогательные функции кабинета учителя ───

        function computeStudentData(s, monStr, monday) {
            let state = {}; try { state = JSON.parse(s.fullStateJson || '{}'); } catch(e) {}
            const stats = state.stats || state || {};
            const streak = stats.streak || state.streak || 0;
            const timeSpentMin = Math.floor((stats.totalTimeSpent || state.totalTimeSpent || 0) / 60);

            let learnedCount = 0;
            Object.values(stats.factStreaks || state.factStreaks || {}).forEach(v => {
                if (v.level > 0 || v.streak >= 3) learnedCount++;
            });

            const eraNames = { early: 'Древность', '18th': 'XVIII в.', '19th': 'XIX в.', '20th': 'XX в.' };
            const rawEra = stats.eraStats || {};

            // Поддержка обоих форматов: старый flat и новый per-task
            const isNewFormat = rawEra.task3 || rawEra.task4 || rawEra.task5 || rawEra.task7;
            const taskDefs = [
                { key: 'task4', label: '📍 №4 География', color: 'var(--c-brand)' },
                { key: 'task5', label: '👤 №5 Личности',  color: 'var(--c-purple)' },
                { key: 'task7', label: '🎨 №7 Культура',  color: 'var(--c-warn)' },
            ];

            // Общая точность (по всем заданиям и эпохам) для карточки
            let totalCorrect = 0, totalAttempts = 0;
            // eraData — сводная по всем заданиям (для мини-графика эпох в карточке)
            const eraData = {};
            for (const eKey of Object.keys(eraNames)) {
                let c = 0, tot = 0;
                if (isNewFormat) {
                    for (const tk of ['task3','task4','task5','task7']) {
                        const e = (rawEra[tk] || {})[eKey] || {};
                        c   += e.correct || 0;
                        tot += e.total   || 0;
                    }
                } else {
                    const e = rawEra[eKey] || {};
                    c   = e.correct || 0;
                    tot = e.total   || 0;
                }
                totalCorrect  += c;
                totalAttempts += tot;
                eraData[eKey] = { name: eraNames[eKey], correct: c, total: tot, pct: tot > 0 ? Math.round((c/tot)*100) : null };
            }
            const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null;

            // Per-task breakdown для PDF (with learned counts)
            const allFactStreaks = stats.factStreaks || state.factStreaks || {};
            const taskStats = taskDefs.map(({ key, label, color }) => {
                const taskEra = isNewFormat ? (rawEra[key] || {}) : (key === 'task4' ? rawEra : {});
                let tc = 0, tt = 0;
                const eras = [];
                for (const [eKey, eName] of Object.entries(eraNames)) {
                    const e = taskEra[eKey] || { correct: 0, total: 0 };
                    tc += e.correct || 0;
                    tt += e.total   || 0;
                    if (e.total > 0) eras.push({ name: eName, correct: e.correct, total: e.total, pct: Math.round((e.correct/e.total)*100) });
                }
                const learned = countLearnedForTask(key, allFactStreaks);
                return { key, label, color, correct: tc, total: tt, pct: tt > 0 ? Math.round((tc/tt)*100) : null, eras, learned };
            }).filter(t => t.total > 0 || t.learned > 0);

            const dStat = stats.dailyStats || state.dailyStats || {};
            let wScore = 0, wScoreTask4 = 0, wEgePoints = 0;
            const now = new Date();
            const last7 = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now); d.setDate(d.getDate() - i);
                const dStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
                const val = (dStat[dStr] && dStat[dStr].solved) || 0;
                const valT4 = (dStat[dStr] && dStat[dStr].solvedTask4) || 0;
                const perTaskVal = (dStat[dStr] ? ((dStat[dStr].solvedTask4||0)+(dStat[dStr].solvedTask3||0)+(dStat[dStr].solvedTask5||0)+(dStat[dStr].solvedTask7||0)) : 0);
                const dayScore = perTaskVal > 0 ? perTaskVal : val;
                const dayEge = (dStat[dStr] && dStat[dStr].egePoints) || 0;
                if (dStr >= monStr) { wScore += dayScore; wScoreTask4 += valT4; wEgePoints += dayEge; }
                last7.push({ date: dStr, val, t4: (dStat[dStr] && dStat[dStr].solvedTask4) || 0, t5: (dStat[dStr] && dStat[dStr].solvedTask5) || 0, t7: (dStat[dStr] && dStat[dStr].solvedTask7) || 0, mins: dStat[dStr] ? Math.floor((dStat[dStr].timeSpent || 0) / 60) : 0, egePoints: dayEge });
            }
            // No totalSolved fallback — must come from actual dailyStats

            const daysSinceActive = s.lastActive ? Math.floor((Date.now() - s.lastActive) / 86400000) : 999;
            const lastActiveDate = s.lastActive ? new Date(s.lastActive) : null;
            const lastActiveStr = lastActiveDate
                ? `${lastActiveDate.toLocaleDateString('ru-RU')} ${String(lastActiveDate.getHours()).padStart(2,'0')}:${String(lastActiveDate.getMinutes()).padStart(2,'0')}`
                : 'Давно';

            let weakEra = null, weakPct = 101;
            for (const e of Object.values(eraData)) {
                if (e.total >= 5 && e.pct !== null && e.pct < weakPct) { weakPct = e.pct; weakEra = e; }
            }

            // ── ДЗ: сколько осталось ──
            // Новая модель: задания в stats.assignments (подхвачены) + pendingAssignments на документе (ещё не подхвачены).
            const assignments  = Array.isArray(stats.assignments) ? stats.assignments
                                : (Array.isArray(state.assignments) ? state.assignments : []);
            const docPending   = Array.isArray(s.pendingAssignments) ? s.pendingAssignments : [];
            let hwFromAssign = 0, hwDoneOnTime = 0, hwDoneLate = 0, hwOverdue = 0, nearestDl = null;
            const nowMs = Date.now();
            // Выучивание считаем живьём по выученным фактам периода у самого ученика (общая система isFactLearned).
            const hwStreaks = stats.factStreaks || state.factStreaks || {};
            const learnedCountFor = (task, period) => {
                const cfg = (typeof TASK_CONFIG !== 'undefined') ? TASK_CONFIG[task] : null;
                if (!cfg || !cfg.data) return 0;
                const data = cfg.data() || []; const seen = new Set(); let learned = 0;
                data.forEach(f => {
                    if (period && period !== 'all' && f.c !== period) return;
                    let k; try { k = cfg.keyFn(f); } catch (e) { return; }
                    if (seen.has(k)) return; seen.add(k);
                    const v = hwStreaks[k];
                    if (v && ((v.level || 0) > 0 || (v.points || 0) >= 3 || (v.streak || 0) >= 3)) learned++;
                });
                return learned;
            };
            // Зубрёжка: считаем выученные в тренажёре факты (ключи cram:* в factStreaks ученика).
            const cramLearnedCount = () => {
                let n = 0;
                for (const k in hwStreaks) {
                    if (k.indexOf('cram:') !== 0) continue;
                    const v = hwStreaks[k];
                    if (v && ((v.level || 0) > 0 || (v.points || 0) >= 3 || (v.streak || 0) >= 3)) n++;
                }
                return n;
            };
            const itemRemaining = (it) => it.task === 'cram'
                ? Math.max(0, (it.goal || 0) - cramLearnedCount())
                : (it.metric === 'learned'
                    ? Math.max(0, (it.goal || 0) - learnedCountFor(it.task, it.period))
                    : Math.max(0, (it.goal || 0) - (it.progress || 0)));
            assignments.forEach(a => {
                const items = Array.isArray(a.items) ? a.items
                    : (a.task ? [{ task: a.task, period: 'all', metric: 'lines', goal: Number(a.total) || 0, progress: (Number(a.total) || 0) - (Number(a.remaining) || 0) }] : []);
                const rem = items.reduce((x, it) => x + itemRemaining(it), 0);
                if (a.status === 'done' || (items.length && rem === 0)) { a.onTime ? hwDoneOnTime++ : hwDoneLate++; return; }
                if (rem > 0) {
                    hwFromAssign += rem;
                    if (a.deadline) {
                        if (!nearestDl || a.deadline < nearestDl) nearestDl = a.deadline;
                        if (new Date(a.deadline + 'T23:59:59').getTime() < nowMs) hwOverdue += rem;
                    }
                }
            });
            docPending.forEach(r => {
                const g = Array.isArray(r.items) ? r.items.reduce((x, it) => x + (Number(it.goal) || 0), 0) : (Number(r.total) || 0);
                hwFromAssign += g;
                if (r.deadline && (!nearestDl || r.deadline < nearestDl)) nearestDl = r.deadline;
            });
            // Legacy-поля (ученик ещё не обновил приложение)
            const hwLegacy = (Number(s.hwAssignTask3)||0)+(Number(s.hwAssignTask4)||0)+(Number(s.hwAssignTask5)||0)+(Number(s.hwAssignTask7)||0)
                           + (assignments.length ? 0 : Number(stats.hwFlashcardsToSolve || state.hwFlashcardsToSolve || 0));
            const hwRemaining  = hwFromAssign + hwLegacy;
            const hwDeadline   = nearestDl || s.assignedTeacherHwDeadline || null;
            const adH = (stats.achievementsData || state.achievementsData || {});
            const hwOnTimeTotal = Number(adH.hwOnTime || 0);
            const hwLateTotal   = Number(adH.hwLate || 0);
            const hwStreakMax   = Number(adH.hwStreakMax || 0);

            // ── Разбор ошибок: где ученик сейчас чаще ошибается (актуальный пул) ──
            const mistakesPool = Array.isArray(state.mistakesPool) ? state.mistakesPool
                               : (Array.isArray(stats.mistakesPool) ? stats.mistakesPool : []);
            const labelField = { task3: 'process', task4: 'event', task5: 'event', task7: 'culture' };
            const mistakesByTask = { task3: 0, task4: 0, task5: 0, task7: 0 };
            const mistakeList = [];
            mistakesPool.forEach(m => {
                if (!m || !m.fact) return;
                const t = m.task || 'task4';
                if (mistakesByTask[t] !== undefined) mistakesByTask[t]++;
                const lbl = m.fact[labelField[t]] || m.fact.event || m.fact.process || m.fact.culture || '';
                if (lbl) mistakeList.push({ task: t, label: String(lbl).trim() });
            });
            const solvedByTask = stats.solvedByTask || state.solvedByTask || {};

            return { ...s, streak, timeSpentMin, learnedCount, accuracy, eraData, taskStats, wScore, wScoreTask4, wEgePoints, last7, dStat,
                     daysSinceActive, isToday: daysSinceActive === 0, atRisk: daysSinceActive >= 3,
                     lastActiveStr, weakEra, totalCorrect, totalAttempts, hwRemaining, hwDeadline,
                     hwOverdue, hwDoneOnTime, hwDoneLate, hwOnTimeTotal, hwLateTotal, hwStreakMax,
                     mistakesByTask, mistakeTotal: mistakeList.length, mistakeList, solvedByTask };
        }

        function renderMiniBar(last7) {
            const max = Math.max(...last7.map(d => d.val), 1);
            const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
            return last7.map((d, i) => {
                const h = Math.max(3, Math.round((d.val / max) * 28));
                const color = d.val === 0 ? '#e5e7eb' : i === 6 ? 'var(--c-brand)' : '#6ee7b7';
                const dayIdx = (new Date(d.date).getDay() + 6) % 7;
                return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">
                    <div title="${d.date}: ${d.val} строк" style="width:100%;max-width:14px;height:${h}px;background:${color};border-radius:3px 3px 0 0"></div>
                    <span style="font-size:8px;color:#9ca3af;font-weight:700">${days[dayIdx]}</span>
                </div>`;
            }).join('');
        }

        function renderEraRows(eraData) {
            return Object.values(eraData).map(e => {
                if (!e.total) return '';
                const c = e.pct >= 80 ? 'var(--c-success)' : e.pct >= 60 ? 'var(--c-warn)' : 'var(--c-danger-soft)';
                return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                    <span style="font-size:9px;color:#6b7280;font-weight:700;min-width:68px">${e.name}</span>
                    <div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden">
                        <div style="height:100%;width:${e.pct}%;background:${c};border-radius:3px"></div>
                    </div>
                    <span style="font-size:9px;font-weight:700;color:${c};min-width:28px;text-align:right">${e.pct}%</span>
                </div>`;
            }).join('');
        }

        function renderDailyDetail(last7) {
            const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
            return last7.filter(d => d.val > 0).reverse().map(d => {
                const dayIdx = (new Date(d.date).getDay() + 6) % 7;
                const dateStr = new Date(d.date).toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'});
                const parts = [];
                if (d.t4) parts.push(`<span style="color:var(--c-brand)">📍${d.t4}</span>`);
                if (d.t5) parts.push(`<span style="color:var(--c-purple)">👤${d.t5}</span>`);
                if (d.t7) parts.push(`<span style="color:var(--c-warn)">🎨${d.t7}</span>`);
                const taskStr = parts.length ? parts.join(' ') : `<span style="color:var(--c-brand)">${d.val}</span>`;
                return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;padding:3px 0;border-bottom:1px solid #f8fafc">
                    <span style="font-weight:700;color:#94a3b8;min-width:30px">${dateStr}</span>
                    <span style="font-weight:700">${taskStr}</span>
                    <span style="color:#94a3b8;font-weight:600">${d.mins}м</span>
                </div>`;
            }).join('') || '<div style="font-size:9px;color:#94a3b8;padding:4px 0">Нет данных</div>';
        }

        function renderStudentCard(s, idx) {
            const safeUid  = (s.uid  || '').replace(/'/g, "\\'");
            const safeName = (s.name || 'Без имени').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const medal    = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `<span style="color:#9ca3af;font-size:12px">#${idx+1}</span>`;
            const timeStr  = s.timeSpentMin >= 60 ? `${Math.floor(s.timeSpentMin/60)}ч ${s.timeSpentMin%60}м` : `${s.timeSpentMin}м`;
            const accStr   = s.accuracy !== null ? `${s.accuracy}%` : '—';
            const accColor = s.accuracy === null ? '#9ca3af' : s.accuracy >= 80 ? 'var(--c-success)' : s.accuracy >= 60 ? 'var(--c-warn)' : 'var(--c-danger-soft)';
            const atRiskBadge = s.atRisk
                ? `<span style="font-size:9px;font-weight:700;background:#fef2f2;color:var(--c-danger);border:1px solid #fecaca;padding:2px 6px;border-radius:4px">⚠️ ${s.daysSinceActive}д без входа</span>` : '';
            const todayBadge = s.isToday
                ? `<span style="font-size:9px;font-weight:700;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;padding:2px 6px;border-radius:4px">🟢 онлайн сегодня</span>` : '';
            const hwDeadlineStr = s.hwDeadline ? ' · до ' + new Date(s.hwDeadline + 'T00:00:00').toLocaleDateString('ru-RU', {day:'numeric',month:'short'}) : '';
            const hwBadge = (s.hwRemaining > 0)
                ? `<span style="font-size:9px;font-weight:700;background:#fff7ed;color:#ea580c;border:1px solid #fed7aa;padding:2px 6px;border-radius:4px">📝 ДЗ: ${s.hwRemaining}${hwDeadlineStr}</span>`
                : (s.hwDeadline ? `<span style="font-size:9px;font-weight:700;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;padding:2px 6px;border-radius:4px">✅ ДЗ выполнено</span>` : '');
            const hwTimingBadge = ((s.hwOnTimeTotal||0) || (s.hwLateTotal||0))
                ? `<span style="font-size:9px;font-weight:700;background:#eff6ff;color:#0369a1;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px">⏱ вовремя ${s.hwOnTimeTotal||0}${(s.hwLateTotal||0)?` · опозд. ${s.hwLateTotal}`:''}${(s.hwStreakMax||0)>=3?` · 🔥${s.hwStreakMax}`:''}</span>`
                : '';
            const weakBlock = s.weakEra
                ? `<div style="margin-top:6px;font-size:10px;color:#9ca3af;font-weight:700">📍 Слабая тема: <span style="color:var(--c-danger-soft)">${s.weakEra.name} — ${s.weakEra.pct}%</span></div>` : '';
            const _sbt = s.solvedByTask || {}, _mbt = s.mistakesByTask || {};
            const _tm = [['task3','🔗'],['task4','📍'],['task5','👤'],['task7','🎨']];
            const solvedRow = _tm.map(([t,e]) => `<span>${e}<b style="color:var(--c-brand);margin-left:2px">${_sbt[t]||0}</b></span>`).join('');
            const mistRow = _tm.map(([t,e]) => `<span>${e}<b style="color:${(_mbt[t]||0)>0?'var(--c-danger)':'#94a3b8'};margin-left:2px">${_mbt[t]||0}</b></span>`).join('');

            return `<div class="bg-white dark:bg-[#1e1e1e] rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-[#2c2c2c] flex flex-col">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:1px solid #f1f5f9;gap:8px">
                    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                        <span style="font-size:18px;flex-shrink:0">${medal}</span>
                        <div style="min-width:0">
                            <div class="dark:text-gray-200" style="font-weight:900;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name || 'Без имени'}</div>
                            <div style="font-size:9px;color:#94a3b8;margin-top:1px;display:flex;gap:6px;flex-wrap:wrap">
                                <span style="font-family:monospace;color:#64748b">🆔 ${s.tgId || s.knownTgId || s.canonicalId || s.uid || '—'}</span>
                                ${s.classCode ? `<span style="color:var(--c-brand);font-weight:700">класс ${s.classCode}</span>` : ''}
                            </div>
                            <div style="font-size:9px;color:#94a3b8;margin-top:1px">${s.lastActiveStr}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0">${hwBadge}${hwTimingBadge}${atRiskBadge}${todayBadge}</div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:center">
                    <div><div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase">Решено</div><div style="font-size:13px;font-weight:900;color:var(--c-brand)">${s.totalSolved||0}</div></div>
                    <div><div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase">⭐ Баллы</div><div style="font-size:13px;font-weight:900;color:var(--c-warn)">${s.egePoints||0}</div></div>
                    <div><div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase">Выучено</div><div style="font-size:13px;font-weight:900;color:var(--c-success)">${s.learnedCount}</div></div>
                    <div><div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase">Стрик</div><div style="font-size:13px;font-weight:900;color:var(--c-warn)">${s.streak}🔥</div></div>
                    <div><div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase">Точность</div><div style="font-size:13px;font-weight:900;color:${accColor}">${accStr}</div></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9">
                    <div>
                        <div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:4px">Решено по заданиям</div>
                        <div style="display:flex;gap:10px;font-size:11px;font-weight:700">${solvedRow}</div>
                    </div>
                    <div>
                        <div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:4px">Ошибки сейчас (${s.mistakeTotal||0})</div>
                        <div style="display:flex;gap:10px;font-size:11px;font-weight:700">${mistRow}</div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9">
                    <div>
                        <div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:6px">Активность 7 дней</div>
                        <div style="display:flex;align-items:flex-end;gap:2px;height:40px">${renderMiniBar(s.last7)}</div>
                    </div>
                    <div>
                        <div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:6px">Точность по эпохам</div>
                        ${renderEraRows(s.eraData) || '<div style="font-size:9px;color:#94a3b8;padding-top:4px">Нет данных</div>'}
                        ${weakBlock}
                    </div>
                </div>
                <div style="padding:8px 0;border-bottom:1px solid #f1f5f9">
                    <div style="font-size:8px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:4px">Подневная статистика</div>
                    ${renderDailyDetail(s.last7)}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0 4px;font-size:9px;color:#94a3b8;font-weight:700">
                    <span>⏱ В игре: <b style="color:#a78bfa">${timeStr}</b></span>
                    <span>📝 Попыток: <b style="color:#64748b">${s.totalAttempts||0}</b></span>
                    <span>✅ Верных: <b style="color:var(--c-success)">${s.totalCorrect||0}</b></span>
                </div>
                <div style="display:flex;gap:6px;padding-top:8px;border-top:1px solid #f1f5f9">
                    <button onclick="window.promptAssignHw('${safeUid}','${safeName}')" class="flex-1 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors active:scale-95">📝 ДЗ</button>
                    <button onclick="window.openStudentAssignmentsList('${safeUid}','${safeName}')" class="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors active:scale-95" title="Выданные ДЗ ученика и отмена">📋</button>
                    <button onclick="window.downloadStudentPDF('${safeUid}')" class="flex-1 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors active:scale-95">📄 Отчёт</button>
                    <button onclick="window.selectStudentForMerge('${safeUid}','${safeName}')" data-student-uid="${safeUid}" class="bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors active:scale-95" title="Объединить с другим аккаунтом">🔀</button>
                </div>
            </div>`;
        }

        window._cachedStudents = [];

        // Сводная аналитика по всему классу/курсу
        function renderClassAnalytics(students) {
            const cont = document.getElementById('teacher-class-analytics');
            if (!cont) return;
            if (!students || !students.length) { cont.innerHTML = '<p style="font-size:10px;color:#94a3b8;text-align:center;padding:6px 0">Нет данных</p>'; return; }

            const solved = { task3:0, task4:0, task5:0, task7:0 };
            const mistByTask = { task3:0, task4:0, task5:0, task7:0 };
            const eraAgg = {};
            const mistByKey = {};
            let hwDone = 0, hwAssigned = 0, accNumer = 0, accDenom = 0;
            let hwOnTimeSum = 0, hwLateSum = 0;
            const debtors = []; // не сдавшие ДЗ
            const nowTs = Date.now();
            const isOverdue = dl => dl ? (new Date(dl + 'T23:59:59').getTime() < nowTs) : false;

            students.forEach(s => {
                ['task3','task4','task5','task7'].forEach(t => { solved[t] += (s.solvedByTask?.[t]||0); mistByTask[t] += (s.mistakesByTask?.[t]||0); });
                if (s.totalAttempts) { accNumer += s.totalCorrect||0; accDenom += s.totalAttempts||0; }
                Object.entries(s.eraData||{}).forEach(([k,e]) => { if (e && e.total) { (eraAgg[k] = eraAgg[k]||{name:e.name,c:0,t:0}); eraAgg[k].c += e.correct||0; eraAgg[k].t += e.total||0; } });
                (s.mistakeList||[]).forEach(m => { const key = m.task+'|'+m.label; (mistByKey[key] = mistByKey[key]||{count:0,task:m.task,label:m.label}); mistByKey[key].count++; });
                if (s.hwDeadline) { hwAssigned++; if ((s.hwRemaining||0)===0) hwDone++; }
                hwOnTimeSum += (s.hwOnTimeTotal||0); hwLateSum += (s.hwLateTotal||0);
                if ((s.hwRemaining||0) > 0) debtors.push({ name: s.name || 'Без имени', remaining: s.hwRemaining, deadline: s.hwDeadline, overdue: isOverdue(s.hwDeadline) });
            });
            const hwTimingTotal = hwOnTimeSum + hwLateSum;
            const hwOnTimePct = hwTimingTotal ? Math.round(hwOnTimeSum / hwTimingTotal * 100) : null;
            debtors.sort((a,b) => (b.overdue?1:0) - (a.overdue?1:0) || b.remaining - a.remaining);

            const classAcc = accDenom >= 10 ? Math.round(accNumer/accDenom*100) : null;
            const topMistakes = Object.values(mistByKey).sort((a,b)=>b.count-a.count).slice(0,10);
            const em = { task3:'🔗', task4:'📍', task5:'👤', task7:'🎨' };
            const esc = t => String(t||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

            const solvedHtml = ['task3','task4','task5','task7'].map(t =>
                `<div style="text-align:center"><div style="font-size:15px">${em[t]}</div><div style="font-size:13px;font-weight:900;color:var(--c-brand)">${solved[t]}</div><div style="font-size:8px;color:${mistByTask[t]>0?'var(--c-danger)':'#94a3b8'}">−${mistByTask[t]}</div></div>`).join('');

            const eraHtml = ['early','18th','19th','20th'].filter(k=>eraAgg[k]).map(k => {
                const e = eraAgg[k], pc = Math.round(e.c/e.t*100), col = pc>=80?'var(--c-success)':pc>=60?'var(--c-warn)':'var(--c-danger-soft)';
                return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:3px"><span style="min-width:72px;color:#64748b;font-weight:700">${esc(e.name)}</span><div style="flex:1;height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pc}%;background:${col}"></div></div><span style="min-width:34px;text-align:right;font-weight:700;color:${col}">${pc}%</span></div>`;
            }).join('');

            const mistHtml = topMistakes.length ? topMistakes.map((m,i) =>
                `<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:2px 0"><span style="color:#cbd5e1;min-width:14px">${i+1}.</span><span>${em[m.task]||''}</span><span style="flex:1;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="dark:text-gray-300" title="${esc(m.label)}">${esc(m.label)}</span><span style="font-weight:900;color:var(--c-danger);min-width:54px;text-align:right">${m.count} уч.</span></div>`).join('')
                : '<p style="font-size:10px;color:var(--c-success);font-weight:700;padding:4px 0">Активных ошибок нет 🎉</p>';

            // ── Прогресс выучивания: сколько фактов из общего пула выучил каждый ученик ──
            let totalPool = 0;
            if (typeof TASK_CONFIG !== 'undefined') {
                ['task3','task4','task5','task7'].forEach(tk => {
                    const cfg = TASK_CONFIG[tk];
                    if (cfg && cfg.data) {
                        const seen = new Set();
                        (cfg.data() || []).forEach(f => { try { seen.add(cfg.keyFn(f)); } catch(e){} });
                        totalPool += seen.size;
                    }
                });
            }
            const learnRows = students.map(s => ({ name: s.name || 'Без имени', learned: Math.min(s.learnedCount || 0, totalPool || (s.learnedCount||0)) }))
                                      .sort((a,b) => b.learned - a.learned);
            const avgLearned = learnRows.length ? Math.round(learnRows.reduce((x,r)=>x+r.learned,0)/learnRows.length) : 0;
            const avgPct = totalPool ? Math.round(avgLearned/totalPool*100) : 0;
            const learnColor = pc => pc>=66?'var(--c-success)':pc>=33?'var(--c-warn)':'var(--c-danger-soft)';
            const learnHtml = (totalPool && learnRows.length) ? learnRows.map(r => {
                const pc = Math.round(r.learned/totalPool*100), col = learnColor(pc);
                return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:3px"><span style="min-width:84px;color:#334155;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="dark:text-gray-300" title="${esc(r.name)}">${esc(r.name)}</span><div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pc}%;background:${col}"></div></div><span style="min-width:70px;text-align:right;font-weight:700;color:${col}">${r.learned}<span style="color:#cbd5e1;font-weight:400">/${totalPool}</span> · ${pc}%</span></div>`;
            }).join('') : '<p style="font-size:10px;color:#94a3b8">Нет данных</p>';

            cont.innerHTML = `
              <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin:2px 0 4px">Решено по заданиям (− активные ошибки)</div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">${solvedHtml}</div>
              ${(classAcc!==null || hwAssigned) ? `<div style="font-size:10px;color:#64748b;font-weight:700;margin-bottom:6px">${classAcc!==null?`Средняя точность класса: <b style="color:${classAcc>=80?'var(--c-success)':classAcc>=60?'var(--c-warn)':'var(--c-danger-soft)'}">${classAcc}%</b>`:''}${hwAssigned?`${classAcc!==null?' · ':''}ДЗ сдали: <b style="color:#16a34a">${hwDone}/${hwAssigned}</b>`:''}</div>`:''}
              ${hwTimingTotal ? `<div style="font-size:10px;color:#64748b;font-weight:700;margin-bottom:6px">⏱ Сдают вовремя: <b style="color:${hwOnTimePct>=80?'var(--c-success)':hwOnTimePct>=50?'var(--c-warn)':'var(--c-danger-soft)'}">${hwOnTimePct}%</b> <span style="color:#94a3b8;font-weight:400">(вовремя ${hwOnTimeSum} · с опозданием ${hwLateSum})</span></div>`:''}
              <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin:8px 0 4px">Точность класса по эпохам</div>
              ${eraHtml || '<p style="font-size:10px;color:#94a3b8">Нет данных</p>'}
              <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin:10px 0 4px">📚 Выучено фактов${totalPool?` · в среднем ${avgLearned}/${totalPool} (${avgPct}%)`:''}</div>
              ${learnHtml}
              <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin:10px 0 4px">🔥 Где класс чаще ошибается</div>
              ${mistHtml}
              <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin:10px 0 4px">📋 Не сдали ДЗ${debtors.length?` (${debtors.length})`:''}</div>
              ${debtors.length ? debtors.map(d =>
                `<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:2px 0"><span>${d.overdue?'🔴':'🟠'}</span><span style="flex:1;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="dark:text-gray-300">${esc(d.name)}</span><span style="font-weight:700;color:${d.overdue?'var(--c-danger)':'#ea580c'};min-width:120px;text-align:right">${d.remaining} стр.${d.overdue?' · просрочено':(d.deadline?' · до '+new Date(d.deadline+'T00:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}):'')}</span></div>`
              ).join('') : '<p style="font-size:10px;color:var(--c-success);font-weight:700;padding:4px 0">Все сдали ДЗ ✅</p>'}`;
        }
        window.renderClassAnalytics = renderClassAnalytics;

        // PDF-сводка по всему классу
        window.downloadClassReportPDF = async function() {
            const students = window._cachedStudents || [];
            if (!students.length) { showToast('⚠️', 'Класс не загружен', 'bg-rose-500', 'border-rose-700'); return; }
            const solved={task3:0,task4:0,task5:0,task7:0}, mistByTask={task3:0,task4:0,task5:0,task7:0};
            const eraAgg={}, mistByKey={}; let accN=0,accD=0,hwDone=0,hwAssigned=0,hwOnTimeSum=0,hwLateSum=0; const debtors=[];
            const nowTs=Date.now(); const isOverdue=dl=>dl?new Date(dl+'T23:59:59').getTime()<nowTs:false;
            students.forEach(s=>{
                ['task3','task4','task5','task7'].forEach(t=>{solved[t]+=(s.solvedByTask?.[t]||0);mistByTask[t]+=(s.mistakesByTask?.[t]||0);});
                if(s.totalAttempts){accN+=s.totalCorrect||0;accD+=s.totalAttempts||0;}
                Object.entries(s.eraData||{}).forEach(([k,e])=>{if(e&&e.total){(eraAgg[k]=eraAgg[k]||{name:e.name,c:0,t:0});eraAgg[k].c+=e.correct||0;eraAgg[k].t+=e.total||0;}});
                (s.mistakeList||[]).forEach(m=>{const key=m.task+'|'+m.label;(mistByKey[key]=mistByKey[key]||{count:0,task:m.task,label:m.label});mistByKey[key].count++;});
                if(s.hwDeadline){hwAssigned++;if((s.hwRemaining||0)===0)hwDone++;}
                hwOnTimeSum+=(s.hwOnTimeTotal||0); hwLateSum+=(s.hwLateTotal||0);
                if((s.hwRemaining||0)>0)debtors.push({name:s.name||'Без имени',remaining:s.hwRemaining,overdue:isOverdue(s.hwDeadline)});
            });
            const hwTimingTotal=hwOnTimeSum+hwLateSum;
            const hwOnTimePct=hwTimingTotal?Math.round(hwOnTimeSum/hwTimingTotal*100):null;
            const classAcc=accD>=10?Math.round(accN/accD*100):'—';
            const topMist=Object.values(mistByKey).sort((a,b)=>b.count-a.count).slice(0,15);
            debtors.sort((a,b)=>(b.overdue?1:0)-(a.overdue?1:0)||b.remaining-a.remaining);

            // jsPDF + кириллический шрифт (как в отчёте ученика)
            if (typeof window.jspdf === 'undefined') {
                showToast('⏳','Загружаем PDF-модуль…','bg-blue-500','border-blue-700');
                try { await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';sc.onload=res;sc.onerror=()=>rej();document.head.appendChild(sc);}); }
                catch(e){ showToast('❌','Ошибка загрузки PDF','bg-rose-500','border-rose-700'); return; }
            }
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
            let FONT='helvetica';
            if (typeof window.__pdfFonts === 'undefined') {
                try { await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='./assets/fonts/pdf-fonts.js';sc.onload=res;sc.onerror=()=>rej();document.head.appendChild(sc);}); } catch(e){}
            }
            if (window.__pdfFonts) { try {
                doc.addFileToVFS('Roboto-Regular.ttf', window.__pdfFonts.regular); doc.addFont('Roboto-Regular.ttf','Roboto','normal');
                doc.addFileToVFS('Roboto-Bold.ttf', window.__pdfFonts.bold); doc.addFont('Roboto-Bold.ttf','Roboto','bold'); FONT='Roboto';
            } catch(e){} }

            const M=14, PW=210, CW=PW-M*2; let y=M;
            const em={task3:'№3',task4:'№4',task5:'№5',task7:'№7'};
            function need(mm){ if(y+mm>297-M){ doc.addPage(); y=M; } }
            doc.setFillColor(37,99,235); doc.roundedRect(M,y,CW,16,2,2,'F');
            doc.setFont(FONT,'bold'); doc.setFontSize(13); doc.setTextColor(255,255,255);
            doc.text('Сводка по классу — Тренажёр ЕГЭ История', M+4, y+6.5);
            doc.setFont(FONT,'normal'); doc.setFontSize(8); doc.setTextColor(191,219,254);
            doc.text(`${students.length} учеников · ${new Date().toLocaleDateString('ru-RU')}`, M+4, y+12.5); y+=22;

            doc.setFont(FONT,'bold'); doc.setFontSize(11); doc.setTextColor(30,41,59); doc.text('Решено по заданиям', M, y); y+=6;
            doc.setFont(FONT,'normal'); doc.setFontSize(9); doc.setTextColor(51,65,85);
            ['task3','task4','task5','task7'].forEach(t=>{ doc.text(`${em[t]}: ${solved[t]}  (ошибок ${mistByTask[t]})`, M, y); y+=5; });
            y+=2; doc.text(`Средняя точность класса: ${classAcc}%${hwAssigned?`    ДЗ сдали: ${hwDone}/${hwAssigned}`:''}`, M, y); y+=5;
            if (hwTimingTotal) { doc.text(`Сдают вовремя: ${hwOnTimePct}%  (вовремя ${hwOnTimeSum} / с опозданием ${hwLateSum})`, M, y); y+=5; }
            y+=3;

            doc.setFont(FONT,'bold'); doc.setFontSize(11); doc.setTextColor(30,41,59); doc.text('Точность по эпохам', M, y); y+=6;
            doc.setFont(FONT,'normal'); doc.setFontSize(9); doc.setTextColor(51,65,85);
            ['early','18th','19th','20th'].filter(k=>eraAgg[k]).forEach(k=>{ const e=eraAgg[k]; doc.text(`${e.name}: ${Math.round(e.c/e.t*100)}%`, M, y); y+=5; }); y+=4;

            need(20); doc.setFont(FONT,'bold'); doc.setFontSize(11); doc.setTextColor(30,41,59); doc.text('Где класс чаще ошибается', M, y); y+=6;
            doc.setFont(FONT,'normal'); doc.setFontSize(8.5); doc.setTextColor(51,65,85);
            topMist.forEach((m,i)=>{ need(6); const lines=doc.splitTextToSize(`${i+1}. ${em[m.task]} ${m.label} — ${m.count} уч.`, CW); doc.text(lines, M, y); y+=lines.length*4.2; }); y+=4;

            need(20); doc.setFont(FONT,'bold'); doc.setFontSize(11); doc.setTextColor(180,40,40); doc.text(`Не сдали ДЗ (${debtors.length})`, M, y); y+=6;
            doc.setFont(FONT,'normal'); doc.setFontSize(8.5); doc.setTextColor(51,65,85);
            if (!debtors.length) { doc.setTextColor(16,150,80); doc.text('Все сдали ✓', M, y); y+=5; }
            else debtors.forEach(d=>{ need(5); doc.text(`${d.overdue?'(просрочено) ':''}${d.name} — ${d.remaining} стр.`, M, y); y+=4.5; });

            doc.save('Сводка_класса_' + new Date().toISOString().split('T')[0] + '.pdf');
            showToast('📄','PDF-сводка скачана!','bg-blue-500','border-blue-700');
        };

        window.sortAndRenderStudents = function() {
            const st = window._cachedStudents;
            if (!st || !st.length) return;
            const sort = document.getElementById('teacher-sort-select')?.value || 'total';
            const sorted = [...st].sort((a, b) => {
                if (sort === 'weekly')    return (b.wScore||0)       - (a.wScore||0);
                if (sort === 'streak')    return (b.streak||0)       - (a.streak||0);
                if (sort === 'learned')   return (b.learnedCount||0) - (a.learnedCount||0);
                if (sort === 'accuracy')  return (b.accuracy||0)     - (a.accuracy||0);
                if (sort === 'lastActive') return (b.lastActive||0)  - (a.lastActive||0);
                return (b.totalSolved||0) - (a.totalSolved||0);
            });
            const cont = document.getElementById('teacher-class-stats');
            if (cont) cont.innerHTML = sorted.map((s, i) => renderStudentCard(s, i)).join('');
        };

        window.downloadStudentPDF = async function(uid) {
            const s = window._cachedStudents.find(x => x.uid === uid);
            if (!s) return;

            // Parse fullStateJson to extract mistakes list
            let fullState = {};
            try { fullState = JSON.parse(s.fullStateJson || '{}'); } catch(e) {}
            const mistakesPool = fullState.mistakesPool || [];
            const factStreaks = fullState.factStreaks || s.factStreaks || {};

            // Determine database sizes
            const task4Total = typeof bigData !== 'undefined' ? bigData.length : 0;
            const task5Total = typeof task5Data !== 'undefined' ? task5Data.length : 0;
            const task7Total = window.task7Data ? window.task7Data.length : 0;
            const task4Learned = countLearnedForTask('task4', factStreaks);
            const task5Learned = countLearnedForTask('task5', factStreaks);
            const task7Learned = countLearnedForTask('task7', factStreaks);

            const timeStr = s.timeSpentMin >= 60 ? `${Math.floor(s.timeSpentMin/60)}ч ${s.timeSpentMin%60}м` : `${s.timeSpentMin}м`;
            const accStr = s.accuracy !== null ? `${s.accuracy}%` : '—';
            const accColor = s.accuracy === null ? '#9ca3af' : s.accuracy >= 80 ? 'var(--c-success)' : s.accuracy >= 60 ? 'var(--c-warn)' : 'var(--c-danger-soft)';

            // ─── Ленивая загрузка jsPDF — не грузим при старте, только по запросу ──
            if (typeof window.jspdf === 'undefined' && typeof jspdf === 'undefined') {
                showToast('⏳', 'Загружаем PDF-модуль...', 'bg-blue-500', 'border-blue-700');
                try {
                    await new Promise((resolve, reject) => {
                        const sc = document.createElement('script');
                        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                        sc.onload = resolve;
                        sc.onerror = () => reject(new Error('jsPDF load failed'));
                        document.head.appendChild(sc);
                    });
                } catch(err) {
                    showToast('❌', 'Ошибка загрузки PDF-модуля', 'bg-rose-500', 'border-rose-700');
                    return;
                }
            }
            const { jsPDF } = window.jspdf || jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            // ─── Кириллический шрифт (Roboto). Стандартные шрифты jsPDF (helvetica)
            //     кириллицу НЕ умеют — без этого весь русский текст превращается в мусор.
            //     Бандл грузится лениво и кэшируется service worker'ом.
            let PDF_FONT = 'helvetica';
            if (typeof window.__pdfFonts === 'undefined') {
                try {
                    await new Promise((resolve, reject) => {
                        const sc = document.createElement('script');
                        sc.src = './assets/fonts/pdf-fonts.js';
                        sc.onload = resolve;
                        sc.onerror = () => reject(new Error('font load failed'));
                        document.head.appendChild(sc);
                    });
                } catch (e) { console.warn('[PDF] Кириллический шрифт не загружен:', e); }
            }
            if (window.__pdfFonts && window.__pdfFonts.regular) {
                try {
                    doc.addFileToVFS('Roboto-Regular.ttf', window.__pdfFonts.regular);
                    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
                    doc.addFileToVFS('Roboto-Bold.ttf', window.__pdfFonts.bold);
                    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
                    PDF_FONT = 'Roboto';
                } catch (e) { console.warn('[PDF] Не удалось зарегистрировать шрифт:', e); PDF_FONT = 'helvetica'; }
            }

            const PW = 210, PH = 297, M = 14, CW = PW - M * 2;
            let y = M;

            // ── helpers ──────────────────────────────────────────────────────────
            const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
            function needSpace(mm) { if (y + mm > PH - M) { doc.addPage(); y = M; } }
            function hline(yy, r, g, b) { doc.setDrawColor(r||229,g||231,b||235); doc.setLineWidth(0.3); doc.line(M, yy, M + CW, yy); }
            function labelVal(lbl, val, x, yy, lw, vColor) {
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(8); doc.setTextColor(100,116,139);
                doc.text(lbl, x, yy);
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(14); doc.setTextColor(...(vColor||[30,41,59]));
                doc.text(String(val), x, yy + 5.5);
            }
            function sectionTitle(title) {
                needSpace(10);
                hline(y); y += 4;
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(11); doc.setTextColor(30,41,59);
                doc.text(title, M, y); y += 6;
            }
            function bar(x, yy, w, pct, colorArr) {
                doc.setFillColor(241,245,249); doc.roundedRect(x, yy, w, 3, 1, 1, 'F');
                if (pct > 0) { doc.setFillColor(...colorArr); doc.roundedRect(x, yy, clamp(w * pct / 100, 1, w), 3, 1, 1, 'F'); }
            }
            function pctColor(p) { return p >= 80 ? [16,185,129] : p >= 60 ? [245,158,11] : [244,63,94]; }

            // ── Header ───────────────────────────────────────────────────────────
            doc.setFillColor(37,99,235); doc.roundedRect(M, y, CW, 16, 3, 3, 'F');
            doc.setFont(PDF_FONT,'bold'); doc.setFontSize(13); doc.setTextColor(255,255,255);
            doc.text('Отчёт: Тренажёр ЕГЭ История', M + 4, y + 6.5);
            doc.setFont(PDF_FONT,'normal'); doc.setFontSize(8); doc.setTextColor(191,219,254);
            doc.text(new Date().toLocaleDateString('ru-RU'), M + 4, y + 12.5);
            y += 20;

            // ── Student name + last active ────────────────────────────────────────
            doc.setFont(PDF_FONT,'bold'); doc.setFontSize(15); doc.setTextColor(30,41,59);
            doc.text(s.name || 'Без имени', M, y); y += 5;
            doc.setFont(PDF_FONT,'normal'); doc.setFontSize(8); doc.setTextColor(148,163,184);
            doc.text('Последний вход: ' + s.lastActiveStr, M, y); y += 8;

            // ── Stats grid (2 rows × 3 cols) ────────────────────────────────────
            const stats6 = [
                { l: 'Решено',    v: s.totalSolved||0,    c: [59,130,246] },
                { l: 'Выучено',   v: s.learnedCount||0,   c: [16,185,129] },
                { l: 'Стрик',     v: (s.streak||0)+'',    c: [245,158,11] },
                { l: 'За неделю', v: s.wScore||0,          c: [139,92,246] },
                { l: 'Точность',  v: accStr,               c: accColor === '#9ca3af' ? [148,163,184] : accColor === 'var(--c-success)' ? [16,185,129] : accColor === 'var(--c-warn)' ? [245,158,11] : [244,63,94] },
                { l: 'Время',     v: timeStr,              c: [167,139,250] },
            ];
            const cellW = CW / 3, cellH = 13;
            stats6.forEach((st, i) => {
                const cx = M + (i % 3) * cellW, cy = y + Math.floor(i / 3) * (cellH + 2);
                doc.setFillColor(248,250,252); doc.roundedRect(cx, cy, cellW - 2, cellH, 2, 2, 'F');
                doc.setDrawColor(226,232,240); doc.setLineWidth(0.2); doc.roundedRect(cx, cy, cellW - 2, cellH, 2, 2, 'S');
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(7); doc.setTextColor(100,116,139);
                doc.text(st.l.toUpperCase(), cx + (cellW-2)/2, cy + 3.5, { align: 'center' });
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(13); doc.setTextColor(...st.c);
                doc.text(String(st.v), cx + (cellW-2)/2, cy + 10, { align: 'center' });
            });
            y += (cellH + 2) * 2 + 4;

            // ── Learned per task ─────────────────────────────────────────────────
            sectionTitle('Выучено фактов по заданиям');
            const lt = [
                { l: '№4 География', v: task4Learned, tot: task4Total, c: [59,130,246] },
                { l: '№5 Личности',  v: task5Learned, tot: task5Total, c: [139,92,246] },
                { l: '№7 Культура',  v: task7Learned, tot: task7Total, c: [245,158,11] },
            ];
            const ltW = CW / 3;
            lt.forEach((t, i) => {
                const cx = M + i * ltW;
                doc.setFillColor(248,250,252); doc.roundedRect(cx, y, ltW - 2, 16, 2, 2, 'F');
                doc.setDrawColor(226,232,240); doc.setLineWidth(0.2); doc.roundedRect(cx, y, ltW - 2, 16, 2, 2, 'S');
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(7); doc.setTextColor(100,116,139);
                doc.text(t.l, cx + (ltW-2)/2, y + 4, { align: 'center' });
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(14); doc.setTextColor(...t.c);
                doc.text(String(t.v), cx + (ltW-2)/2, y + 11, { align: 'center' });
                doc.setFont(PDF_FONT,'normal'); doc.setFontSize(7); doc.setTextColor(148,163,184);
                doc.text('из ' + t.tot, cx + (ltW-2)/2, y + 14.5, { align: 'center' });
            });
            y += 20;

            // ── Era accuracy ─────────────────────────────────────────────────────
            sectionTitle('Точность по эпохам');
            Object.values(s.eraData).filter(e => e.total > 0).forEach(e => {
                needSpace(9);
                const pc = e.pct; const cc = pctColor(pc);
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(8); doc.setTextColor(107,114,128);
                doc.text(e.name, M, y + 2.5);
                bar(M + 52, y, CW - 52 - 22, pc, cc);
                doc.setFont(PDF_FONT,'bold'); doc.setFontSize(8); doc.setTextColor(...cc);
                doc.text(pc + '%', M + CW - 1, y + 2.5, { align: 'right' });
                if (s.weakEra && s.weakEra.name === e.name) {
                    doc.setFont(PDF_FONT,'normal'); doc.setFontSize(7); doc.setTextColor(239,68,68);
                    doc.text('(слабая тема)', M + CW - 28, y + 2.5);
                }
                y += 7;
            });

            // ── Activity 7 days ──────────────────────────────────────────────────
            sectionTitle('Активность за 7 дней');
            const maxV2 = Math.max(...s.last7.map(d => d.val), 1);
            const bW = CW / 7 - 2, barMaxH = 20;
            const days7 = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
            needSpace(barMaxH + 10);
            s.last7.forEach((d, i) => {
                const bx = M + i * (CW / 7);
                const bh = Math.max(1, Math.round((d.val / maxV2) * barMaxH));
                const by = y + barMaxH - bh;
                const cc = d.val === 0 ? [229,231,235] : i === 6 ? [59,130,246] : [110,231,183];
                doc.setFillColor(...cc); doc.roundedRect(bx, by, bW, bh, 1, 1, 'F');
                if (d.val > 0) {
                    doc.setFont(PDF_FONT,'bold'); doc.setFontSize(6.5); doc.setTextColor(100,116,139);
                    doc.text(String(d.val), bx + bW/2, by - 1, { align: 'center' });
                }
                const dayIdx = (new Date(d.date).getDay() + 6) % 7;
                doc.setFont(PDF_FONT,'normal'); doc.setFontSize(7); doc.setTextColor(156,163,175);
                doc.text(days7[dayIdx], bx + bW/2, y + barMaxH + 4, { align: 'center' });
            });
            y += barMaxH + 9;

            // ── Task stats breakdown ──────────────────────────────────────────────
            if (s.taskStats && s.taskStats.length > 0) {
                sectionTitle('Разбивка по типам заданий');
                s.taskStats.forEach(tk => {
                    needSpace(10);
                    const pc = tk.pct !== null ? tk.pct : 0;
                    const cc = tk.pct !== null ? pctColor(pc) : [148,163,184];
                    doc.setFont(PDF_FONT,'bold'); doc.setFontSize(9); doc.setTextColor(30,41,59);
                    doc.text(tk.label, M, y + 3);
                    doc.setFont(PDF_FONT,'bold'); doc.setFontSize(9); doc.setTextColor(...cc);
                    doc.text((tk.pct !== null ? pc + '%' : '—') + ' (' + tk.correct + '/' + tk.total + ')', M + CW, y + 3, { align: 'right' });
                    bar(M, y + 4.5, CW, pc, cc);
                    y += 11;
                    tk.eras.forEach(era => {
                        needSpace(7);
                        const ec = pctColor(era.pct);
                        doc.setFont(PDF_FONT,'normal'); doc.setFontSize(7.5); doc.setTextColor(107,114,128);
                        doc.text(era.name, M + 6, y + 2.5);
                        bar(M + 52, y, CW - 52 - 18, era.pct, ec);
                        doc.setFont(PDF_FONT,'bold'); doc.setFontSize(7.5); doc.setTextColor(...ec);
                        doc.text(era.pct + '%', M + CW, y + 2.5, { align: 'right' });
                        y += 6;
                    });
                    y += 2;
                });
            }

            // ── Mistakes ─────────────────────────────────────────────────────────
            if (mistakesPool.length > 0) {
                sectionTitle('Ошибки (' + mistakesPool.length + ')');
                const shown = mistakesPool.slice(0, 50);
                shown.forEach((m, i) => {
                    needSpace(7);
                    doc.setFont(PDF_FONT,'bold'); doc.setFontSize(7.5); doc.setTextColor(244,63,94);
                    doc.text(String(i + 1) + '.', M, y + 2.5);
                    const taskLabel = m.task === 'task7' ? '№7' : m.task === 'task5' ? '№5' : m.task === 'task3' ? '№3' : '№4';
                    doc.setFont(PDF_FONT,'bold'); doc.setFontSize(7); doc.setTextColor(100,116,139);
                    doc.text('[' + taskLabel + ']', M + 6, y + 2.5);
                    let mText = '';
                    if (m.task === 'task7') mText = m.fact.culture + ' → ' + m.fact.trait;
                    else if (m.task === 'task5') mText = m.fact.event + ' → ' + m.fact.person;
                    else if (m.task === 'task3') mText = m.fact.process + ' → ' + m.fact.fact;
                    else mText = m.fact.geo + ' | ' + m.fact.year + ' | ' + m.fact.event;
                    doc.setFont(PDF_FONT,'normal'); doc.setFontSize(7.5); doc.setTextColor(30,41,59);
                    const lines = doc.splitTextToSize(mText, CW - 18);
                    doc.text(lines, M + 18, y + 2.5);
                    y += Math.max(6, lines.length * 3.8);
                });
                if (mistakesPool.length > 50) {
                    doc.setFont(PDF_FONT,'normal'); doc.setFontSize(7); doc.setTextColor(148,163,184);
                    doc.text('...и ещё ' + (mistakesPool.length - 50) + ' ошибок', M, y); y += 5;
                }
            }

            // ── Footer ───────────────────────────────────────────────────────────
            const pageCount = doc.internal.getNumberOfPages();
            for (let p = 1; p <= pageCount; p++) {
                doc.setPage(p);
                doc.setFont(PDF_FONT,'normal'); doc.setFontSize(7); doc.setTextColor(148,163,184);
                doc.text('Тренажёр ЕГЭ История | uid: ' + (s.uid||'') + ' | стр. ' + p + '/' + pageCount, PW/2, PH - 6, { align: 'center' });
            }

            const safeName = (s.name||'ученик').replace(/[^а-яёА-ЯЁa-zA-Z0-9_\s]/g,'').replace(/\s+/g,'_');
            doc.save('Отчёт_' + safeName + '_' + new Date().toISOString().split('T')[0] + '.pdf');
            showToast('📄', 'PDF отчёт скачан!', 'bg-blue-500', 'border-blue-700');
        };

        window.loadClassProgress = async function() {
            if (!db) return;
            const tc  = document.getElementById('teacher-class-code-input').value.trim();
            const cont  = document.getElementById('teacher-class-stats');
            const wCont = document.getElementById('weekly-class-stats');
            cont.innerHTML = '<p class="text-center py-4 text-xs font-bold text-gray-500">Загрузка...</p>';
            if (wCont) wCont.innerHTML = '<p class="text-center py-4 text-xs font-bold text-gray-500">Загрузка...</p>';

            try {
                const now    = new Date();
                const day    = now.getDay() || 7;
                const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
                const monStr = monday.getFullYear() + '-' + String(monday.getMonth()+1).padStart(2,'0') + '-' + String(monday.getDate()).padStart(2,'0');

                const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                const filterClass = document.getElementById('teacher-filter-class')?.checked;
                
                // Грузим всех, кто нарешал хотя бы 10 строк (totalSolved >= 10), без жёсткого лимита 200.
                // Серверный фильтр заодно отсекает «мёртвые» аккаунты с нулевой активностью и режет стоимость чтений.
                // Запас limit(3000) — страховка от неконтролируемого чтения на больших объёмах.
                const MIN_SOLVED = 10;
                let firestoreQuery;
                if (filterClass && tc) {
                    firestoreQuery = query(studentsCol, where('classCode', '==', tc), where('totalSolved', '>=', MIN_SOLVED), orderBy('totalSolved', 'desc'), limit(3000));
                } else {
                    firestoreQuery = query(studentsCol, where('totalSolved', '>=', MIN_SOLVED), orderBy('totalSolved', 'desc'), limit(3000));
                }
                
                const qS = await getDocs(firestoreQuery);
                let st = [];
                qS.forEach(docSnap => {
                    const d = docSnap.data(); d.uid = docSnap.id;
                    st.push(d);
                });

                const enriched = st.map(s => computeStudentData(s, monStr, monday));
                enriched.sort((a,b) => (b.totalSolved||0) - (a.totalSolved||0));
                window._cachedStudents = enriched;
                renderClassAnalytics(enriched);

                // Сводка
                const summaryEl = document.getElementById('teacher-class-summary');
                if (enriched.length && summaryEl) {
                    summaryEl.classList.remove('hidden');
                    document.getElementById('summary-count').textContent  = enriched.length;
                    document.getElementById('summary-avg').textContent    = Math.round(enriched.reduce((s,x)=>s+(x.totalSolved||0),0)/enriched.length);
                    document.getElementById('summary-active').textContent = enriched.filter(x=>x.isToday).length;
                    document.getElementById('summary-atrisk').textContent = enriched.filter(x=>x.atRisk).length;
                }

                if (enriched.length === 0) {
                    cont.innerHTML = '<p class="text-center py-4 text-xs font-bold text-gray-500">Ученики не найдены</p>';
                } else {
                    window.sortAndRenderStudents();
                }

                // Топ недели — сортируем по ЕГЭ-баллам (новый показатель), если нет — по строкам
                if (wCont) {
                    const weeklySt = [...enriched]
                        .sort((a,b) => (b.wEgePoints||0) - (a.wEgePoints||0) || (b.wScore||0) - (a.wScore||0))
                        .filter(s => (s.wEgePoints||0) > 0 || (s.wScore||0) > 0);
                    let wHt = weeklySt.length
                        ? weeklySt.map((s,idx) => `<div class="bg-white dark:bg-[#1e1e1e] rounded-2xl p-3 shadow-sm border border-gray-100 dark:border-[#2c2c2c] flex justify-between items-center mb-2">
                            <div class="flex items-center gap-3">
                              <span class="text-2xl font-black">${idx===0?'🥇':idx===1?'🥈':idx===2?'🥉':`<span class="text-gray-400 w-6 inline-block text-center text-lg">${idx+1}</span>`}</span>
                              <span class="font-black text-sm dark:text-gray-200">${s.name||'Без имени'}</span>
                            </div>
                            <div class="flex items-center gap-2">
                              ${s.wEgePoints > 0 ? `<span class="text-sm font-black text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded-lg">⭐ ${s.wEgePoints}б</span>` : ''}
                              <span class="text-xs font-bold text-gray-400">${s.wScore} стр.</span>
                            </div>
                          </div>`).join('')
                        : '<p class="text-center py-4 text-xs font-bold text-gray-500">На этой неделе пока нет активности</p>';
                    wCont.innerHTML = wHt;
                }
            } catch(e) {
                console.error(e);
                cont.innerHTML = '<p class="text-rose-500 text-xs font-bold text-center py-4">Нет подключения к серверу (Офлайн)</p>';
                if (wCont) wCont.innerHTML = '';
            }
        };

        window.loadStudentLeaderboard = async function() {
            const lc = document.getElementById('student-leaderboard-container');
            const ll = document.getElementById('student-leaderboard-list');
            if (!db || !lc || !ll) return;
            lc.classList.remove('hidden');
            ll.innerHTML = '<div class="text-center text-xs text-gray-400 py-2">⏳ Загрузка...</div>';
            try {
                // Берём всех студентов по totalSolved (этот индекс точно есть),
                // затем вычисляем weeklyScore клиентски — это надёжнее чем orderBy weeklyScore,
                // который пропускает документы без этого поля.
                const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                // ✅ FIX: Корректный расчёт понедельника (воскресенье = 7, не 0)
                const monday = new Date();
                const dayOfWeek = monday.getDay() || 7;
                monday.setDate(monday.getDate() - dayOfWeek + 1);
                monday.setHours(0,0,0,0);
                const monStr = monday.toISOString().split('T')[0];

                // Пробуем взять из кэша loadClassProgress если учитель уже загрузил данные
                let students = window._cachedStudents || [];

                if (!students.length) {
                    // ✅ FIX: Сначала пробуем weeklyScore (ловит активных игроков вне топ-100 totalSolved)
                    try {
                        const weeklyQ = query(studentsCol, orderBy('weeklyScore', 'desc'), limit(50));
                        const weeklySnap = await getDocs(weeklyQ);
                        const weeklyStudents = weeklySnap.docs.map(d => {
                            const raw = d.data();
                            // Валидируем что weeklyScore относится к текущей неделе
                            const isCurrentWeek = raw.weekStartStr === monStr;
                            const wScore = isCurrentWeek ? (raw.weeklyScore || 0) : 0;
                            return { name: raw.name || 'Без имени', wScore };
                        }).filter(s => s.wScore > 0);
                        if (weeklyStudents.length > 0) students = weeklyStudents;
                    } catch(weeklyErr) {
                        console.warn('[Leaderboard] weeklyScore index missing, fallback to totalSolved');
                    }
                    // Fallback: totalSolved + клиентский подсчёт
                    if (!students.length) {
                        const q = query(studentsCol, orderBy('totalSolved', 'desc'), limit(100));
                        const snap = await getDocs(q);
                        students = snap.docs.map(d => {
                            const raw = d.data();
                            let wScore = raw.weeklyScore || 0;
                            try {
                                const st = JSON.parse(raw.fullStateJson || '{}');
                                const ds = (st.stats || st).dailyStats || {};
                                let computed = 0;
                                for (const day in ds) {
                                    if (day >= monStr) {
                                        const perTask = (ds[day].solvedTask4||0)+(ds[day].solvedTask3||0)
                                                  + (ds[day].solvedTask5||0)+(ds[day].solvedTask7||0);
                                        computed += perTask > 0 ? perTask : (ds[day].solved||0);
                                    }
                                }
                                if (computed > 0) wScore = computed;
                            } catch(e2) {}
                            return { name: raw.name || 'Без имени', wScore };
                        });
                    }
                } else {
                    // Используем уже загруженные данные учителя
                    students = students.map(s => ({ name: s.name || 'Без имени', wScore: s.wScore || 0, wEge: s.wEgePoints || 0 }));
                }

                // Сортируем по ЕГЭ-баллам, если нет — по строкам
                const top = students
                    .filter(s => (s.wScore||0) > 0 || (s.wEge||0) > 0)
                    .sort((a,b) => (b.wEge||0) - (a.wEge||0) || (b.wScore||0) - (a.wScore||0))
                    .slice(0, 10);

                const medals = ['🥇','🥈','🥉'];
                let ht = top.length
                    ? top.map((s,i) => `<div class="flex items-center gap-2 bg-white dark:bg-[#1e1e1e] p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900/40 mb-1.5">
                        <span class="text-sm w-6 text-center shrink-0">${medals[i]||i+1}</span>
                        <span class="flex-1 font-bold text-[12px] truncate dark:text-gray-200">${s.name}</span>
                        <div class="flex items-center gap-1.5 shrink-0">
                          ${(s.wEge||0) > 0 ? `<span class="font-black text-[11px] text-yellow-600 dark:text-yellow-400">⭐${s.wEge}б</span>` : ''}
                          <span class="font-bold text-[10px] text-gray-400">${s.wScore}стр</span>
                        </div>
                      </div>`).join('')
                    : '<div class="text-center text-xs text-gray-500 font-bold py-2">На этой неделе пока нет активности</div>';
                ll.innerHTML = ht;
            } catch (e) {
                console.error('[loadStudentLeaderboard]', e);
                ll.innerHTML = '<div class="text-center text-xs text-rose-500 font-bold py-2">Нет подключения</div>';
            }
        };

        window.openGlobalTopModal = async function() {
            const cont = document.getElementById('global-top-container'); window.showModal('global-top-modal');
            if (!db) return;
            cont.innerHTML = '<p class="text-[10px] font-bold text-gray-500 text-center py-4">⏳ Загрузка...</p>';
            try {
                // ✅ FIX: Сначала пробуем кэш-документ (leaderboards/global) —
                // 1 чтение вместо 20 чтений. Если кэша нет — делаем прямой запрос.
                const lbCacheRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboards', 'global');
                let tL = [];
                let fromCache = false;
                let cacheUpdatedAt = 0;
                try {
                    const cacheSnap = await getDoc(lbCacheRef);
                    if (cacheSnap.exists() && cacheSnap.data().top && cacheSnap.data().updatedAt > Date.now() - 15 * 60 * 1000) {
                        tL = cacheSnap.data().top;
                        cacheUpdatedAt = cacheSnap.data().updatedAt || 0;
                        fromCache = true;
                    }
                } catch(cacheErr) { /* Кэша нет — идём напрямую */ }

                if (!fromCache) {
                    // ✅ Уменьшен limit: 50 → 20 (снижает стоимость в 2.5 раза)
                    const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                    const topQuery = query(studentsCol, orderBy('totalSolved', 'desc'), limit(20));
                    const qS = await getDocs(topQuery);
                    qS.forEach(docSnap => { tL.push(docSnap.data()); });
                }

                let ht = '<div class="flex flex-col gap-2">';
                tL.forEach((s, idx) => { 
                    ht += `<div class="bg-white dark:bg-[#1e1e1e] rounded-xl p-3 shadow-sm border border-gray-100 dark:border-[#2c2c2c] flex justify-between items-center transition-transform hover:-translate-y-0.5"><div class="flex items-center gap-3"><span class="text-xl sm:text-2xl drop-shadow-sm font-black">${idx===0?'🥇':(idx===1?'🥈':(idx===2?'🥉':`<span class="text-gray-400 w-5 inline-block text-center text-base">${idx+1}</span>`))}</span><div class="flex flex-col"><span class="font-black text-xs sm:text-sm text-gray-800 dark:text-gray-300 leading-tight">${s.name || 'Аноним'}</span>${s.username ? `<span class="text-[9px] font-bold text-blue-500 block leading-tight">@${s.username}</span>` : ''}</div></div><div class="text-right flex flex-col items-end"><span class="text-sm font-black text-examBlue dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-lg border border-blue-100 dark:border-blue-800/50">${s.totalSolved || 0}</span></div></div>`; 
                });
                if (fromCache) ht += `<div class="text-center text-[9px] text-gray-400 pt-1">Обновлено ${new Date(cacheUpdatedAt).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</div>`;
                ht += '</div>'; cont.innerHTML = ht;
            } catch (e) { 
                console.error(e);
                cont.innerHTML = '<p class="text-rose-500 text-xs font-bold text-center py-4">Нет подключения к серверу (Офлайн)</p>'; 
            }
        };

        window._assignHwDb = async function(studentId, num, task, deadline, silent) {
            if (!db) return;
            const taskLabels = { task3: '№3 (Процессы)', task4: '№4 (География)', task5: '№5 (Личности)', task7: '№7 (Культура)' };
            const deadlineStr = deadline ? ` до ${new Date(deadline + 'T00:00:00').toLocaleDateString('ru-RU')}` : '';
            // Новая модель: каждое ДЗ — отдельная запись (не затирает и не суммируется со старым)
            const rec = {
                id: 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
                task: task || 'task4',
                total: Number(num) || 0,
                deadline: deadline || null,
                assignedAt: Date.now()
            };
            try {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'students', studentId);
                await updateDoc(ref, { pendingAssignments: arrayUnion(rec) });
                if (!silent) showToast('✅', `ДЗ: ${num} строк, задание ${taskLabels[task] || task}${deadlineStr}`, 'bg-emerald-500', 'border-emerald-700');
            } catch(e) {
                console.error(e);
                if (silent) throw e; // в массовом режиме пусть считается в счётчике ошибок
                showToast('❌', 'Ошибка назначения ДЗ', 'bg-rose-500', 'border-rose-700');
            }
        };

        // Общий набор отозванных id (классовые из журнала + индивидуальные из документа ученика).
        // Растёт монотонно за сессию — раз отозвано, больше не подхватываем.
        function _mergeRevoked(ids) {
            if (!(window._classRevoked instanceof Set)) window._classRevoked = new Set();
            (ids || []).forEach(id => window._classRevoked.add(id));
            return window._classRevoked;
        }

        // ─── Журнал ДЗ класса: чтобы ученики, добавленные на курс позже, получили старые задания ───
        function _classDocId(code) {
            return String(code || '').trim().replace(/[\/#?%]/g, '_');
        }
        // Догрузить старые ДЗ своего класса (вызывается при входе и при выборе класса). Идемпотентно по id.
        window.pullClassAssignments = async function(rawCode) {
            if (!db) return;
            const code = _classDocId(rawCode);
            if (!code) return;
            try {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'classes', code);
                const snap = await getDoc(ref);
                if (!snap.exists()) return;
                const data = snap.data();
                const list = Array.isArray(data.assignments) ? data.assignments : [];
                // Отозванные учителем ДЗ (вариант А): не подхватываем их и убираем у себя невыполненные копии.
                const revoked = Array.isArray(data.revokedAssignments) ? data.revokedAssignments : [];
                const revokedSet = _mergeRevoked(revoked); // копим в общий набор (классовые + индивидуальные)
                let removed = (window.reconcileRevokedAssignments ? window.reconcileRevokedAssignments(revoked) : 0);
                const today = new Date().toISOString().split('T')[0];
                let added = 0;
                list.forEach(rec => {
                    if (!rec || !rec.id) return;
                    if (revokedSet.has(rec.id)) return; // отозвано — не подхватываем
                    const r = Object.assign({}, rec);
                    // опоздавшему просроченные на момент входа дедлайны снимаем — не штрафуем за то, что задано до его прихода
                    if (r.deadline && r.deadline < today) r.deadline = null;
                    if (window.ingestAssignment && window.ingestAssignment(r)) added++;
                });
                if (removed > 0 && added === 0) {
                    if (window.recomputeHwMirror) window.recomputeHwMirror();
                    if (window.refreshHwState) window.refreshHwState();
                    saveProgress();
                    if (window.updateGlobalUI) window.updateGlobalUI();
                    if (window.updateHwNavBadge) window.updateHwNavBadge();
                }
                if (added > 0) {
                    if (window.recomputeHwMirror) window.recomputeHwMirror();
                    if (window.refreshHwState) window.refreshHwState();
                    saveProgress();
                    if (window.updateGlobalUI) window.updateGlobalUI();
                    if (window.updateHwNavBadge) window.updateHwNavBadge();
                    showToast('📚', `Добавлены задания класса: ${added}`, 'bg-indigo-500', 'border-indigo-700');
                }
            } catch (e) { console.error('pullClassAssignments error:', e); }
        };

        // ─── Учитель: список выданных классу ДЗ (из журнала класса) ───
        window.listClassAssignments = async function(rawCode) {
            if (!db) return [];
            const code = _classDocId(rawCode);
            if (!code) return [];
            try {
                const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'classes', code));
                if (!snap.exists()) return [];
                const list = Array.isArray(snap.data().assignments) ? snap.data().assignments : [];
                // свежие сверху
                return list.slice().sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
            } catch (e) { console.error('listClassAssignments error:', e); return []; }
        };

        // ─── Учитель: отменить выданное ДЗ (вариант А) ───
        // Пишем ОДНУ запись в документ класса: убираем ДЗ из журнала + ставим «отзыв» (revokedAssignments).
        // Документы учеников НЕ трогаем (их прогресс — в fullStateJson, владелец = сам ученик): каждый ученик
        // при следующем входе через pullClassAssignments сам уберёт невыполненную копию, а сданную оставит.
        window.cancelClassAssignment = async function(rawCode, id) {
            if (!db || !id) return false;
            const code = _classDocId(rawCode);
            if (!code) return false;
            try {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'classes', code);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                const list = (Array.isArray(data.assignments) ? data.assignments : []).filter(a => a && a.id !== id);
                const revoked = Array.isArray(data.revokedAssignments) ? data.revokedAssignments.slice() : [];
                if (!revoked.includes(id)) revoked.push(id);
                // не даём списку отозванных расти бесконечно
                const revokedTrimmed = revoked.slice(-300);
                await setDoc(ref, { assignments: list, revokedAssignments: revokedTrimmed, updatedAt: Date.now() }, { merge: true });
                return true;
            } catch (e) { console.error('cancelClassAssignment error:', e); return false; }
        };

        // ─── Учитель: отменить ВСЕ выданные классу ДЗ («с нового листа») ───
        // Чистим журнал класса и отзываем все его id. Сданные у учеников остаются (вариант А).
        window.cancelAllClassAssignments = async function(rawCode) {
            if (!db) return 0;
            const code = _classDocId(rawCode);
            if (!code) return 0;
            try {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'classes', code);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                const ids = (Array.isArray(data.assignments) ? data.assignments : []).map(a => a && a.id).filter(Boolean);
                const revoked = Array.isArray(data.revokedAssignments) ? data.revokedAssignments.slice() : [];
                ids.forEach(id => { if (!revoked.includes(id)) revoked.push(id); });
                await setDoc(ref, { assignments: [], revokedAssignments: revoked.slice(-300), updatedAt: Date.now() }, { merge: true });
                return ids.length;
            } catch (e) { console.error('cancelAllClassAssignments error:', e); return 0; }
        };

        // ─── Учитель: список ДЗ конкретного ученика (pending + подхваченные из его fullStateJson) ───
        window.listStudentAssignments = async function(uid) {
            if (!db || !uid) return [];
            try {
                const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', uid));
                if (!snap.exists()) return [];
                const data = snap.data();
                const revoked = new Set(Array.isArray(data.revokedAssignments) ? data.revokedAssignments : []);
                let ingested = [];
                try { const st = JSON.parse(data.fullStateJson || '{}'); ingested = (st.stats || st || {}).assignments || []; } catch (e) {}
                const byId = new Map();
                (Array.isArray(ingested) ? ingested : []).forEach(a => {
                    if (a && a.id) byId.set(a.id, { id: a.id, title: a.title, deadline: a.deadline, assignedAt: a.assignedAt, items: a.items, state: a.status === 'done' ? 'done' : 'active', revoked: revoked.has(a.id) });
                });
                (Array.isArray(data.pendingAssignments) ? data.pendingAssignments : []).forEach(a => {
                    if (a && a.id && !byId.has(a.id)) byId.set(a.id, { id: a.id, title: a.title, deadline: a.deadline, assignedAt: a.assignedAt, items: a.items, state: 'pending', revoked: revoked.has(a.id) });
                });
                return [...byId.values()].filter(a => !a.revoked).sort((x, y) => (y.assignedAt || 0) - (x.assignedAt || 0));
            } catch (e) { console.error('listStudentAssignments error:', e); return []; }
        };

        // ─── Учитель: отменить ДЗ у конкретного ученика (вариант А) ───
        // Пишем только в верхнеуровневые поля документа ученика (pendingAssignments + revokedAssignments) —
        // НЕ трогаем fullStateJson (его перезаписывает сам ученик). Ученик сам сверится в _handleHwSnapshot.
        window.cancelStudentAssignment = async function(uid, id) {
            if (!db || !uid || !id) return false;
            try {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'students', uid);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                const pending = (Array.isArray(data.pendingAssignments) ? data.pendingAssignments : []).filter(a => a && a.id !== id);
                const revoked = Array.isArray(data.revokedAssignments) ? data.revokedAssignments.slice() : [];
                if (!revoked.includes(id)) revoked.push(id);
                await updateDoc(ref, { pendingAssignments: pending, revokedAssignments: revoked.slice(-300) });
                return true;
            } catch (e) { console.error('cancelStudentAssignment error:', e); return false; }
        };

        // ─── Учитель: отменить ВСЕ невыполненные ДЗ ученика ───
        window.cancelAllStudentAssignments = async function(uid) {
            if (!db || !uid) return 0;
            try {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'students', uid);
                const snap = await getDoc(ref);
                if (!snap.exists()) return 0;
                const data = snap.data();
                let ingested = [];
                try { const st = JSON.parse(data.fullStateJson || '{}'); ingested = (st.stats || st || {}).assignments || []; } catch (e) {}
                const activeIds = (Array.isArray(ingested) ? ingested : []).filter(a => a && a.id && a.status !== 'done').map(a => a.id);
                const pendingIds = (Array.isArray(data.pendingAssignments) ? data.pendingAssignments : []).map(a => a && a.id).filter(Boolean);
                const revoked = Array.isArray(data.revokedAssignments) ? data.revokedAssignments.slice() : [];
                [...activeIds, ...pendingIds].forEach(id => { if (!revoked.includes(id)) revoked.push(id); });
                await updateDoc(ref, { pendingAssignments: [], revokedAssignments: revoked.slice(-300) });
                return activeIds.length + pendingIds.length;
            } catch (e) { console.error('cancelAllStudentAssignments error:', e); return 0; }
        };

        // ── Новый формат: ДЗ как набор подзаданий (items) ──
        // items[i] = {task, period, metric:'lines'|'points'|'learned', goal[, yearStart, yearEnd]}
        // yearStart/yearEnd передаются ТОЛЬКО для period==='custom' (диапазон лет), иначе теряются.
        window._assignBundleToStudentDb = async function(studentId, items, deadline, title, silent) {
            if (!db) return;
            const rec = {
                id: 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
                items: (items || []).map(it => {
                    const o = {
                        task: it.task || 'task4',
                        period: it.period || 'all',
                        metric: (it.metric === 'points' || it.metric === 'learned') ? it.metric : 'lines',
                        goal: Number(it.goal) || 0
                    };
                    if (o.period === 'custom') { o.yearStart = Number(it.yearStart) || 862; o.yearEnd = Number(it.yearEnd) || 2026; }
                    else if (o.task === 'cram' && it.yearStart && it.yearEnd) { o.yearStart = Number(it.yearStart); o.yearEnd = Number(it.yearEnd); } // диапазон зубрёжки не терять
                    return o;
                }),
                deadline: deadline || null,
                title: title || null,
                assignedAt: Date.now()
            };
            try {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'students', studentId);
                await updateDoc(ref, { pendingAssignments: arrayUnion(rec) });
                if (!silent) showToast('✅', `ДЗ выдано · ${rec.items.length} этап.`, 'bg-emerald-500', 'border-emerald-700');
            } catch (e) {
                console.error(e);
                if (silent) throw e;
                showToast('❌', 'Ошибка выдачи ДЗ', 'bg-rose-500', 'border-rose-700');
            }
        };

        window._assignBundleToClassDb = async function(items, deadline, title) {
            const students = (window._cachedStudents || []).filter(s => s.uid);
            if (!students.length) { showToast('⚠️', 'Класс не загружен', 'bg-rose-500', 'border-rose-700'); return; }
            // Один общий рекорд (единый id) — чтобы тот же id попал и текущим ученикам, и в журнал класса.
            // Тогда опоздавший подхватит ДЗ из журнала без дублей с теми, кому уже разослали.
            const rec = {
                id: 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
                items: (items || []).map(it => {
                    const o = {
                        task: it.task || 'task4',
                        period: it.period || 'all',
                        metric: (it.metric === 'points' || it.metric === 'learned') ? it.metric : 'lines',
                        goal: Number(it.goal) || 0
                    };
                    if (o.period === 'custom') { o.yearStart = Number(it.yearStart) || 862; o.yearEnd = Number(it.yearEnd) || 2026; }
                    else if (o.task === 'cram' && it.yearStart && it.yearEnd) { o.yearStart = Number(it.yearStart); o.yearEnd = Number(it.yearEnd); } // диапазон зубрёжки не терять
                    return o;
                }),
                deadline: deadline || null,
                title: title || null,
                assignedAt: Date.now()
            };
            showToast('⏳', `Выдаю ДЗ ${students.length} ученикам…`, 'bg-blue-500', 'border-blue-700');
            let ok = 0, fail = 0;
            for (const s of students) {
                try {
                    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'students', s.uid);
                    await updateDoc(ref, { pendingAssignments: arrayUnion(rec) });
                    ok++;
                } catch (e) { fail++; }
            }
            // Журнал класса(ов) — по всем классам, что есть среди загруженных учеников (для опоздавших)
            const codes = [...new Set(students.map(s => _classDocId(s.classCode)).filter(Boolean))];
            for (const code of codes) {
                try {
                    const cref = doc(db, 'artifacts', appId, 'public', 'data', 'classes', code);
                    await setDoc(cref, { assignments: arrayUnion(rec), updatedAt: Date.now() }, { merge: true });
                } catch (e) { console.error('class-log write error:', e); }
            }
            showToast(fail ? '⚠️' : '✅',
                `ДЗ выдано: ${ok} из ${students.length}${fail ? ` · ошибок: ${fail}` : ''}${codes.length ? ` · журнал: ${codes.join(', ')}` : ''}`,
                fail ? 'bg-amber-500' : 'bg-emerald-500', fail ? 'border-amber-700' : 'border-emerald-700');
            if (window.loadClassProgress) window.loadClassProgress();
        };

        // Массовая выдача ДЗ всему загруженному классу (разворот на запись).
        window._assignHwToClassDb = async function(num, task, deadline) {
            const students = (window._cachedStudents || []).filter(s => s.uid);
            if (!students.length) { showToast('⚠️', 'Класс не загружен', 'bg-rose-500', 'border-rose-700'); return; }
            const taskLabels = { task3: '№3', task4: '№4', task5: '№5', task7: '№7' };
            showToast('⏳', `Выдаю ДЗ ${students.length} ученикам…`, 'bg-blue-500', 'border-blue-700');
            let ok = 0, fail = 0;
            for (const s of students) {
                try { await window._assignHwDb(s.uid, num, task, deadline, true); ok++; }
                catch (e) { fail++; }
            }
            showToast(fail ? '⚠️' : '✅',
                `ДЗ выдано: ${ok} из ${students.length} · ${num} стр. ${taskLabels[task] || ''}${fail ? ` · ошибок: ${fail}` : ''}`,
                fail ? 'bg-amber-500' : 'bg-emerald-500', fail ? 'border-amber-700' : 'border-emerald-700');
            if (window.loadClassProgress) window.loadClassProgress();
        };
        
        // ─── Умное глубокое слияние нескольких fullStateJson ────────────────────
        function normalizeSavedStateObject(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const stats = { ...(raw.stats || raw) };
            const mistakesPool = Array.isArray(raw.mistakesPool)
                ? raw.mistakesPool
                : (Array.isArray(stats.mistakesPool) ? stats.mistakesPool : []);
            delete stats.mistakesPool;
            return {
                stats,
                mistakesPool,
                hideLearned: raw.hideLearned ?? stats.hideLearned ?? true
            };
        }

        function parseSavedStateJson(json) {
            if (!json || json.length < 2) return null;
            try { return normalizeSavedStateObject(JSON.parse(json)); }
            catch(e) { return null; }
        }

        function mergeVisualProgress(states, key) {
            const out = {};
            const score = (v) => {
                if (!v || typeof v !== 'object') return 0;
                return (v.learned ? 1000000 : 0) + (v.streak || 0) * 10000 + (v.correct || 0) * 100 + (v.attempts || 0);
            };
            states.forEach(s => {
                Object.entries(s.stats?.[key] || {}).forEach(([id, val]) => {
                    const cur = out[id];
                    out[id] = !cur || score(val) >= score(cur) ? { ...val } : cur;
                });
            });
            return out;
        }

        function deepMergeStates(jsonStrings) {
            const states = jsonStrings.map(parseSavedStateJson).filter(Boolean);
            if (!states.length) return null;

            const merged = { stats: {}, mistakesPool: [], hideLearned: true };
            const st = merged.stats;

            ['totalSolvedEver','streak','bestSpeedrunScore','flashcardsSolved','totalTimeSpent',
             'egePoints','hwFlashcardsToSolve','hwTask3','hwTask4','hwTask5','hwTask7',
             'visualArchitectureSolved','visualPaintingSolved'].forEach(k => {
                const hasValue = states.some(s => s.stats?.[k] !== undefined);
                if (hasValue) st[k] = Math.max(...states.map(s => Number(s.stats?.[k]) || 0));
            });
            st.solvedByTask = { task3: 0, task4: 0, task5: 0, task7: 0 };
            states.forEach(s => {
                const sbt = s.stats?.solvedByTask || {};
                ['task3','task4','task5','task7'].forEach(k => { st.solvedByTask[k] = Math.max(st.solvedByTask[k], sbt[k] || 0); });
            });
            st.factStreaks = {};
            states.forEach(s => {
                Object.entries(s.stats?.factStreaks || {}).forEach(([k, v]) => {
                    const cur = st.factStreaks[k];
                    if (!cur || (v.level||0) > (cur.level||0) || ((v.level||0)===(cur.level||0) && (v.points||v.streak||0)>(cur.points||cur.streak||0)))
                        st.factStreaks[k] = v;
                });
            });
            st.eraStats = {};
            states.forEach(s => {
                Object.entries(s.stats?.eraStats || {}).forEach(([task, eras]) => {
                    if (!st.eraStats[task]) st.eraStats[task] = {};
                    Object.entries(eras).forEach(([era, val]) => {
                        if (!st.eraStats[task][era]) st.eraStats[task][era] = { correct:0, total:0 };
                        st.eraStats[task][era].correct = Math.max(st.eraStats[task][era].correct, val.correct||0);
                        st.eraStats[task][era].total   = Math.max(st.eraStats[task][era].total,   val.total||0);
                    });
                });
            });
            st.dailyStats = {};
            states.forEach(s => {
                Object.entries(s.stats?.dailyStats || {}).forEach(([date, val]) => {
                    if (!st.dailyStats[date]) st.dailyStats[date] = {};
                    const dst = st.dailyStats[date];
                    Object.entries(val || {}).forEach(([k, v]) => {
                        dst[k] = Math.max(Number(dst[k]) || 0, Number(v) || 0);
                    });
                });
            });
            st.visualArchitectureProgress = mergeVisualProgress(states, 'visualArchitectureProgress');
            st.visualPaintingProgress = mergeVisualProgress(states, 'visualPaintingProgress');
            const achSet = new Set();
            states.forEach(s => (s.stats?.achievements || []).forEach(a => achSet.add(a)));
            st.achievements = [...achSet];
            st.achievementsData = states.reduce((best, s) => {
                const a = s.stats?.achievementsData || {};
                return { nightOwls: Math.max(best.nightOwls||0,a.nightOwls||0), earlyBirds: Math.max(best.earlyBirds||0,a.earlyBirds||0), hwDone: Math.max(best.hwDone||0,a.hwDone||0), hwPerfect: Math.max(best.hwPerfect||0,a.hwPerfect||0), maxMistakes: Math.max(best.maxMistakes||0,a.maxMistakes||0) };
            }, {});
            const mistakeKeys = new Set();
            states.forEach(s => {
                (s.mistakesPool || s.stats?.mistakesPool || []).forEach(m => {
                    const key = JSON.stringify(m.fact);
                    if (!mistakeKeys.has(key)) { mistakeKeys.add(key); merged.mistakesPool.push(m); }
                });
            });
            merged.hideLearned = states.some(s => s.hideLearned === false) ? false : true;
            return merged;
        }

        const CLOUD_STATE_FIELDS = [
            'streak','totalSolvedEver','solvedByTask','flashcardsSolved','eraStats','factStreaks',
            'hwFlashcardsToSolve','hwTask3','hwTask4','hwTask5','hwTask7','totalTimeSpent',
            'bestSpeedrunScore','dailyStats','achievements','achievementsData','egePoints',
            'visualArchitectureProgress','visualArchitectureSolved','visualPaintingProgress','visualPaintingSolved'
        ];

        function applyMergedState(merged) {
            const normalized = normalizeSavedStateObject(merged);
            if (!normalized) return null;
            const st = normalized.stats || {};
            CLOUD_STATE_FIELDS.forEach(k => {
                if (st[k] !== undefined) window.state.stats[k] = st[k];
            });
            if (Array.isArray(normalized.mistakesPool)) window.state.mistakesPool = normalized.mistakesPool;
            window.state.hideLearned = normalized.hideLearned !== false;
            if (!window.state.stats.dailyStats) window.state.stats.dailyStats = {};
            if (!window.state.stats.solvedByTask) window.state.stats.solvedByTask = { task3:0, task4:0, task5:0, task7:0 };
            if (!window.state.stats.achievements) window.state.stats.achievements = [];
            if (!window.state.stats.achievementsData) window.state.stats.achievementsData = {};
            if (!window.state.stats.visualArchitectureProgress) window.state.stats.visualArchitectureProgress = {};
            if (!window.state.stats.visualPaintingProgress) window.state.stats.visualPaintingProgress = {};
            localStorage.setItem('ege_final_storage_v4', JSON.stringify(normalized));
            return normalized;
        }

        window.loadProgressFromCloud = async function() {
            if (!fbUser || !db) return;
            try {
                await waitForTelegramIdentity();
                const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                const canonicalId = resolveUserId(fbUser);
                if (!canonicalId) {
                    localStorage.setItem('ege_pending_cloud_sync', '1');
                    console.warn('[Sync] Telegram context without Telegram ID; cloud load is postponed.');
                    return;
                }
                const allFound = new Map(); // docId → data

                // 1а. По прямым известным ID
                const knownIds = new Set([canonicalId, ...getAllKnownIds()]);
                const knownTg = localStorage.getItem('known_tg_id');
                const googleUid = localStorage.getItem('google_uid');
                if (knownTg) knownIds.add(knownTg);
                if (googleUid) knownIds.add('google_' + googleUid);
                for (const id of knownIds) {
                    try {
                        const snap = await getDoc(doc(studentsCol, id));
                        if (snap.exists() && !snap.data()._mergedInto) {
                            allFound.set(id, snap.data());
                            console.log(`[Sync] ID ${id}: ${snap.data().totalSolved||0} задач`);
                        }
                    } catch(e) { console.warn(`[Sync] Ошибка чтения ${id}:`, e); }
                }

                // 1б. По email — ВСЕГДА (ловит ТГ-документ из браузерной сессии)
                const gEmail = localStorage.getItem('google_email') || fbUser.email || '';
                if (gEmail) {
                    try {
                        const emailSnap = await getDocs(query(studentsCol, where('googleEmail', '==', gEmail), limit(5)));
                        emailSnap.forEach(docSnap => {
                            if (!allFound.has(docSnap.id) && !docSnap.data()._mergedInto) {
                                allFound.set(docSnap.id, docSnap.data());
                                console.log(`[Sync] Email ${gEmail}: doc ${docSnap.id} (${docSnap.data().totalSolved||0} задач)`);
                            }
                        });
                    } catch(e) { console.warn('[Sync] Email search error:', e); }
                }

                // 1в. По имени — ОТКЛЮЧЕНО: слишком рискованно (все "Ученик" сольются)
                // Имя используется только в ручной дедупликации с дополнительными проверками

                if (allFound.size === 0) return;

                // 2. Несколько документов → сливаем, помечаем дубли
                let bestData = null, bestSolved = 0, bestDocId = null;
                allFound.forEach((data, id) => {
                    if ((data.totalSolved||0) >= bestSolved) { bestSolved = data.totalSolved||0; bestData = data; bestDocId = id; }
                });

                if (allFound.size > 1) {
                    console.log(`[Sync] 🔀 Найдено ${allFound.size} документов — слияние`);
                    // ── Защита: не сливаем если нет жёсткого общего идентификатора
                    //    (email или tgId). Без него возможно случайное слияние чужих аккаунтов.
                    const sharedEmail = [...allFound.values()].every(d => d.googleEmail && d.googleEmail === gEmail);
                    const sharedTg    = [...allFound.values()].every(d => d.tgId && d.tgId === localStorage.getItem('known_tg_id'));
                    const localKnownIds = getAllKnownIds();
                    const hasCrossRef  = [...allFound.keys()].some(id => id === canonicalId || localKnownIds.includes(id));
                    if (!sharedEmail && !sharedTg && !hasCrossRef) {
                        console.warn('[Sync] Пропускаем авто-слияние: нет жёсткого общего ID');
                        // Загружаем только лучший документ без слияния
                        allFound.forEach((data, id) => {
                            if ((data.totalSolved||0) >= bestSolved) { bestSolved = data.totalSolved||0; bestData = data; bestDocId = id; }
                        });
                    } else {
                    const localJson = localStorage.getItem('ege_final_storage_v4') || '';
                    const merged = deepMergeStates([...allFound.values()].map(d => d.fullStateJson).concat(localJson).filter(j => j && j.length > 10));
                    if (merged) {
                        applyMergedState(merged);
                        const mergedJson = JSON.stringify(merged);
                        const knownTgForDoc = localStorage.getItem('known_tg_id') || '';
                        localStorage.setItem('ege_final_storage_v4', mergedJson);
                        try {
                            await setDoc(doc(studentsCol, canonicalId), {
                                fullStateJson: mergedJson,
                                totalSolved: window.state.stats.totalSolvedEver || 0,
                                egePoints: window.state.stats.egePoints || 0,
                                tgId: knownTgForDoc || (/^\d+$/.test(canonicalId) ? canonicalId : ''),
                                knownTgId: knownTgForDoc,
                                canonicalId: canonicalId,
                                identitySource: getIdentitySource(canonicalId),
                                googleEmail: localStorage.getItem('google_email') || '',
                                knownGoogleId: localStorage.getItem('google_uid') ? 'google_' + localStorage.getItem('google_uid') : '',
                                _mergedFrom: [...allFound.keys()].filter(id => id !== canonicalId),
                                _mergedAt: Date.now()
                            }, { merge: true });
                        } catch(e) { console.error('[Sync] Merge write error:', e); }
                        for (const [id] of allFound) {
                            if (id === canonicalId) continue;
                            try { await setDoc(doc(studentsCol, id), { _mergedInto: canonicalId, _mergedAt: Date.now() }, { merge: true }); }
                            catch(e) {}
                        }
                        if (window.updateGlobalUI) window.updateGlobalUI();
                        if (window.updateProgressBars) window.updateProgressBars();
                        if (typeof showToast === 'function') showToast('🔀', 'Аккаунты объединены!', 'bg-emerald-500', 'border-emerald-700');
                        return;
                    }
                    } // end else (merge branch)
                } // end if (allFound.size > 1)

                // 3. Один документ — стандартная загрузка
                if (bestData?.name && bestData.name !== 'Ученик' && !localStorage.getItem('student_manual_name')) {
                    localStorage.setItem('student_manual_name', bestData.name);
                    const nameEl = document.getElementById('profile-name-input');
                    if (nameEl) nameEl.value = bestData.name;
                }
                if (bestData?.classCode && !localStorage.getItem('student_class_code')) {
                    localStorage.setItem('student_class_code', bestData.classCode);
                    const classEl = document.getElementById('profile-class-code');
                    if (classEl) classEl.value = bestData.classCode;
                }
                if (bestData?.tgId && /^\d+$/.test(String(bestData.tgId))) localStorage.setItem('known_tg_id', String(bestData.tgId));
                if (bestData?.knownTgId && /^\d+$/.test(String(bestData.knownTgId))) localStorage.setItem('known_tg_id', String(bestData.knownTgId));
                if (bestData?.googleEmail && !localStorage.getItem('google_email')) localStorage.setItem('google_email', bestData.googleEmail);

                if (bestData?.fullStateJson) {
                    const localJson = localStorage.getItem('ege_final_storage_v4') || '';
                    const merged = deepMergeStates([bestData.fullStateJson, localJson].filter(j => j && j.length > 10));
                    if (merged) {
                        applyMergedState(merged);
                        const mergedJson = JSON.stringify(merged);
                        const knownTgForDoc = localStorage.getItem('known_tg_id') || '';
                        try {
                            const mergedUpdate = {
                                fullStateJson: mergedJson,
                                totalSolved: window.state.stats.totalSolvedEver || 0,
                                egePoints: window.state.stats.egePoints || 0,
                                tgId: knownTgForDoc || (/^\d+$/.test(canonicalId) ? canonicalId : ''),
                                knownTgId: knownTgForDoc,
                                canonicalId: canonicalId,
                                identitySource: getIdentitySource(canonicalId),
                                googleEmail: localStorage.getItem('google_email') || bestData.googleEmail || '',
                                knownGoogleId: localStorage.getItem('google_uid') ? 'google_' + localStorage.getItem('google_uid') : (bestData.knownGoogleId || '')
                            };
                            if (bestData.syncPin) mergedUpdate.syncPin = bestData.syncPin;
                            await setDoc(doc(studentsCol, canonicalId), mergedUpdate, { merge: true });
                        } catch(writeErr) { console.warn('[Sync] Merged load write skipped:', writeErr); }
                        console.log(`[Sync] Загружено и объединено ${window.state.stats.totalSolvedEver || bestSolved} задач из ${bestDocId}`);
                    }
                }
                if (window.updateGlobalUI) window.updateGlobalUI();
                if (window.updateProgressBars) window.updateProgressBars();

                // ── FIX: после восстановления known_tg_id / google_uid из облака
                // пересчитываем canonical ID — он мог измениться
                const newCanonical = resolveUserId(fbUser);
                if (newCanonical !== canonicalId && bestDocId && bestDocId !== newCanonical) {
                    // Канонический ID изменился — копируем данные в новый документ
                    // и помечаем старый как merged
                    try {
                        const bestPayload = allFound.get(bestDocId) || bestData;
                        if (bestPayload) {
                            const knownTgForDoc = localStorage.getItem('known_tg_id') || '';
                            await setDoc(doc(studentsCol, newCanonical), {
                                ...bestPayload,
                                tgId: knownTgForDoc || (/^\d+$/.test(newCanonical) ? newCanonical : ''),
                                knownTgId: knownTgForDoc,
                                canonicalId: newCanonical,
                                identitySource: getIdentitySource(newCanonical)
                            }, { merge: true });
                            if (bestDocId !== newCanonical) {
                                await setDoc(doc(studentsCol, bestDocId), { _mergedInto: newCanonical, _mergedAt: Date.now() }, { merge: true });
                            }
                            console.log(`[Sync] Canonical ID changed ${canonicalId} → ${newCanonical}, migrated`);
                        }
                    } catch(e) { console.warn('[Sync] Canonical migration error:', e); }
                }
            } catch(e) { console.error('[Sync] loadProgressFromCloud error:', e); }
        };

        window.syncProgressToCloud = async function() {
            if (!fbUser || !db) return;
            if (!window.state?.stats) return;
            await waitForTelegramIdentity(800);
            const canonicalId = resolveUserId(fbUser);
            if (!canonicalId) {
                localStorage.setItem('ege_pending_cloud_sync', '1');
                console.warn('[Sync] Telegram context without Telegram ID; cloud write is postponed.');
                return;
            }
            
            const nw = Date.now();
            const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
            try {
                const localJson = localStorage.getItem('ege_final_storage_v4') || '{}';
                const currentSnap = await getDoc(doc(studentsCol, canonicalId));
                if (currentSnap.exists()) {
                    const remoteJson = currentSnap.data().fullStateJson || '';
                    const merged = deepMergeStates([remoteJson, localJson].filter(j => j && j.length > 10));
                    if (merged) applyMergedState(merged);
                }
            } catch(e) {
                console.warn('[Sync] Pre-write merge skipped:', e);
            }

            const s = window.state.stats;
            const gEmail = localStorage.getItem('google_email') || '';
            const knownTg = localStorage.getItem('known_tg_id') || '';
            const googleUid = localStorage.getItem('google_uid');
            const googleId = googleUid ? 'google_' + googleUid : '';
            
            // ✅ FIX: Вычисляем weeklyScore здесь и храним как отдельное поле,
            // чтобы индексировать в Firestore для серверной сортировки лидерборда
            const dStat = s.dailyStats || {};
            const now2 = new Date();
            const day2 = now2.getDay() || 7;
            const monday2 = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() - day2 + 1);
            const monStr2 = monday2.getFullYear() + '-' + String(monday2.getMonth()+1).padStart(2,'0') + '-' + String(monday2.getDate()).padStart(2,'0');
            let weeklyScore = 0;
            let weeklyEgePoints = 0; // баллы по критериям ЕГЭ за неделю
            for (const d in dStat) {
                if (d >= monStr2) {
                    const perTask = (dStat[d].solvedTask4 || 0)
                                  + (dStat[d].solvedTask3 || 0)
                                  + (dStat[d].solvedTask5 || 0)
                                  + (dStat[d].solvedTask7 || 0);
                    weeklyScore += perTask > 0 ? perTask : (dStat[d].solved || 0);
                    weeklyEgePoints += (dStat[d].egePoints || 0);
                }
            }
            
            const payload = {
                name: localStorage.getItem('student_manual_name') || 'Ученик',
                classCode: localStorage.getItem('student_class_code') || '',
                googleEmail: gEmail,
                knownTgId: knownTg,
                knownGoogleId: googleId,
                totalSolved: s.totalSolvedEver || 0,
                egePoints: s.egePoints || 0,         // накопленные ЕГЭ-баллы
                weeklyScore: weeklyScore,
                weeklyEgePoints: weeklyEgePoints,     // ЕГЭ-баллы за неделю
                weekStartStr: monStr2,
                fullStateJson: localStorage.getItem('ege_final_storage_v4') || '{}',
                lastActive: nw
            };
            
            // ✅ FIX: Пишем ТОЛЬКО в один канонический документ — никаких Race Conditions
            try {
                await setDoc(doc(studentsCol, canonicalId), {
                    ...payload,
                    tgId: knownTg || (/^\d+$/.test(canonicalId) ? canonicalId : ''),
                    knownTgId: knownTg,
                    canonicalId: canonicalId,
                    identitySource: getIdentitySource(canonicalId)
                }, { merge: true });
                localStorage.removeItem('ege_pending_cloud_sync');
                localStorage.setItem('ege_last_cloud_sync', String(nw));
                console.log(`[Sync] Записано в документ: ${canonicalId}`);
                const legacyIds = getAllKnownIds().filter(id => id && id !== canonicalId);
                for (const legacyId of legacyIds) {
                    try {
                        await setDoc(doc(studentsCol, legacyId), {
                            _mergedInto: canonicalId,
                            _mergedAt: nw,
                            knownTgId: knownTg,
                            googleEmail: gEmail,
                            knownGoogleId: googleId
                        }, { merge: true });
                    } catch(e) {}
                }
            } catch(e) {
                console.error('[Sync] write error', e);
                return; // Не обновляем кэш если основная запись упала
            }

            // ── Кэш лидерборда ────────────────────────────────────────────────
            // ✅ Клиентская стратегия: тот, кто синхронизируется, попутно обновляет
            // кэш-документ leaderboards/global. Это даёт свежий кэш без Cloud Functions.
            // Защита: не чаще 1 раза в 10 минут на устройство (localStorage throttle).
            // При 1000 активных игроков — максимум 6 обновлений кэша в минуту,
            // что стоит 6 записей × 20 чтений = 126 операций/мин (безопасно).
            const CACHE_TTL = 10 * 60 * 1000; // 10 минут
            const lastCacheUpdate = parseInt(localStorage.getItem('_lbCacheUpdatedAt') || '0');
            if (nw - lastCacheUpdate > CACHE_TTL) {
                try {
                    const topQuery = query(
                        studentsCol,
                        orderBy('totalSolved', 'desc'),
                        limit(20)
                    );
                    const topSnap = await getDocs(topQuery);
                    const topData = [];
                    topSnap.forEach(d => {
                        const sd = d.data();
                        // Храним только нужные поля — не весь документ
                        topData.push({
                            name:        sd.name        || 'Аноним',
                            username:    sd.username    || '',
                            totalSolved: sd.totalSolved || 0
                        });
                    });
                    const lbCacheRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboards', 'global');
                    await setDoc(lbCacheRef, { top: topData, updatedAt: nw });
                    localStorage.setItem('_lbCacheUpdatedAt', String(nw));
                    console.log(`[Cache] Лидерборд обновлён: ${topData.length} игроков`);
                } catch(cacheErr) {
                    // Не критично — кэш обновится при следующей синхронизации
                    console.warn('[Cache] Ошибка обновления кэша лидерборда:', cacheErr);
                }
            }
        };

        // ─── Инструмент дедупликации для учителя ────────────────────────────────
        // Сканирует всех студентов, находит дубли (по email/tgId/имени), сливает их.
        // Вызывается из кабинета учителя кнопкой "🔀 Устранить дубли"
        window.runDeduplication = async function() {
            if (!db) return showToast('❌', 'Нет подключения', 'bg-rose-500', 'border-rose-700');
            const btn = document.getElementById('dedup-btn');
            const logEl = document.getElementById('dedup-log');
            if (btn) btn.disabled = true;
            if (logEl) { logEl.innerHTML = '<div style="color:#6b7280;font-size:11px">⏳ Загрузка всех студентов...</div>'; logEl.classList.remove('hidden'); }

            // ── Список стандартных/анонимных имён, которые НЕЛЬЗЯ использовать
            //    как идентификатор — слишком распространены
            const ANON_NAMES = new Set([
                'ученик', 'без имени', 'аноним', 'anonymous', 'student', 'noname',
                'новый ученик', 'ученик без имени', 'учеников', 'имя'
            ]);
            function isAnonName(name) {
                if (!name || name.trim().length < 2) return true;
                const nm = name.trim().toLowerCase().replace(/\s+/g,' ');
                if (ANON_NAMES.has(nm)) return true;
                // "ученик 1", "ученик123", "student5" и т.п.
                if (/^(ученик|аноним|anonymous|student)\s*\d*$/.test(nm)) return true;
                return false;
            }

            try {
                const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                const allSnap = await getDocs(query(studentsCol, orderBy('totalSolved', 'desc'), limit(500)));
                const all = [];
                allSnap.forEach(docSnap => {
                    const d = docSnap.data();
                    if (!d._mergedInto) all.push({ id: docSnap.id, ...d });
                });

                if (logEl) logEl.innerHTML += `<div style="color:#6b7280;font-size:11px">📋 Загружено ${all.length} документов</div>`;

                const groups = [];
                const assigned = new Set();

                all.forEach(docA => {
                    if (assigned.has(docA.id)) return;
                    const myGroup = new Set([docA.id]);
                    assigned.add(docA.id);

                    all.forEach(docB => {
                        if (docB.id === docA.id || assigned.has(docB.id)) return;
                        let linked = false;

                        // ✅ ЖЁСТКИЕ связи — однозначная идентификация
                        // 1. Одинаковый email (оба непустые)
                        if (docA.googleEmail && docB.googleEmail &&
                            docA.googleEmail === docB.googleEmail) linked = true;

                        // 2. Одинаковый числовой tgId (оба непустые)
                        if (!linked && docA.tgId && docB.tgId &&
                            /^\d+$/.test(String(docA.tgId)) &&
                            String(docA.tgId) === String(docB.tgId)) linked = true;

                        // 3. Перекрёстные ссылки knownTgId / knownGoogleId
                        if (!linked && docA.knownTgId && docB.id === String(docA.knownTgId)) linked = true;
                        if (!linked && docB.knownTgId && docA.id === String(docB.knownTgId)) linked = true;
                        if (!linked && docA.knownGoogleId && docB.id === docA.knownGoogleId) linked = true;
                        if (!linked && docB.knownGoogleId && docA.id === docB.knownGoogleId) linked = true;

                        // ⚠️ МЯГКАЯ связь — ФИО — ТОЛЬКО если:
                        //   а) оба имени не анонимные
                        //   б) совпадает ещё хотя бы один фактор (classCode, или один ID известен другому)
                        if (!linked && !isAnonName(docA.name) && !isAnonName(docB.name)) {
                            const nmA = normalizeName(docA.name);
                            const nmB = normalizeName(docB.name);
                            const nameSim = nameSimilarity(nmA, nmB);
                            if (nameSim > 0.92) {
                                // Требуем подтверждающий фактор
                                const sameClass = docA.classCode && docB.classCode &&
                                    docA.classCode === docB.classCode;
                                const crossRef = (docA._mergedFrom || []).includes(docB.id) ||
                                    (docB._mergedFrom || []).includes(docA.id);
                                if (sameClass || crossRef) linked = true;
                                // Если сходство почти идеальное (0.99+) — только тогда без доп. фактора
                                if (!linked && nameSim > 0.99 && nmA.length > 8) linked = true;
                            }
                        }

                        if (linked) { myGroup.add(docB.id); assigned.add(docB.id); }
                    });

                    groups.push(myGroup);
                });

                const dupeGroups = groups.filter(g => g.size > 1);
                if (logEl) logEl.innerHTML += `<div style="color:var(--c-warn);font-size:11px;margin-top:4px">🔍 Найдено ${dupeGroups.length} групп дублей</div>`;

                if (!dupeGroups.length) {
                    if (logEl) logEl.innerHTML += '<div style="color:var(--c-success);font-size:11px;margin-top:4px">✅ Дублей не найдено!</div>';
                    if (btn) btn.disabled = false;
                    return;
                }

                let merged = 0, skipped = 0;
                for (const group of dupeGroups) {
                    const ids = [...group];
                    const docs = all.filter(d => ids.includes(d.id));

                    // Дополнительная проверка: не сливаем если ВСЕ имена анонимные
                    // (значит группа образована только по _mergedFrom — ок, сливаем;
                    //  но если только по имени — пропускаем)
                    const nonAnonCount = docs.filter(d => !isAnonName(d.name)).length;
                    if (nonAnonCount === 0 && docs.every(d => {
                        // Проверяем: есть ли жёсткая связь?
                        return !d.googleEmail && !d.tgId && !d.knownTgId && !d.knownGoogleId;
                    })) {
                        if (logEl) logEl.innerHTML += `<div style="color:#9ca3af;font-size:10px;margin-top:2px">⏭ Пропущено: группа анонимных без жёстких ID (${docs.map(d=>d.id.slice(0,12)).join(', ')})</div>`;
                        skipped++;
                        continue;
                    }

                    // Канонический: не anon_ → больше totalSolved
                    docs.sort((a,b) => {
                        const aAnon = a.id.startsWith('anon_');
                        const bAnon = b.id.startsWith('anon_');
                        if (aAnon !== bAnon) return aAnon ? 1 : -1;
                        return (b.totalSolved||0) - (a.totalSolved||0);
                    });
                    const canonical = docs[0];
                    const dupes = docs.slice(1);
                    const names = docs.map(d => `${d.name||'?'}(${d.totalSolved||0})`).join(' + ');

                    try {
                        const jsonStrings = docs.map(d => d.fullStateJson).filter(j => j && j.length > 10);
                        const mergedState = deepMergeStates(jsonStrings);
                        const mergedJson = mergedState ? JSON.stringify(mergedState) : canonical.fullStateJson;
                        const mergedTotal = mergedState ? (mergedState.stats?.totalSolvedEver || canonical.totalSolved || 0) : (canonical.totalSolved || 0);

                        await setDoc(doc(studentsCol, canonical.id), {
                            fullStateJson: mergedJson,
                            totalSolved: mergedTotal,
                            _mergedFrom: dupes.map(d => d.id),
                            _mergedAt: Date.now()
                        }, { merge: true });

                        for (const dupe of dupes) {
                            await setDoc(doc(studentsCol, dupe.id), {
                                _mergedInto: canonical.id,
                                _mergedAt: Date.now()
                            }, { merge: true });
                        }

                        if (logEl) logEl.innerHTML += `<div style="color:var(--c-success);font-size:11px;margin-top:2px">✅ ${names} → <b>${canonical.id.slice(0,16)}…</b></div>`;
                        merged++;
                    } catch(e) {
                        if (logEl) logEl.innerHTML += `<div style="color:var(--c-danger);font-size:11px;margin-top:2px">❌ ${names}: ${e.message}</div>`;
                        skipped++;
                    }
                }

                if (logEl) logEl.innerHTML += `<div style="color:var(--c-brand);font-size:11px;font-weight:700;margin-top:6px;border-top:1px solid #e5e7eb;padding-top:6px">🎉 Объединено: ${merged} групп · Пропущено: ${skipped}</div>`;
                showToast('🔀', `Объединено ${merged} дублей`, 'bg-emerald-500', 'border-emerald-700');
                if (window.loadClassProgress) window.loadClassProgress();
            } catch(e) {
                console.error('[Dedup] error:', e);
                if (logEl) logEl.innerHTML += `<div style="color:var(--c-danger);font-size:11px">❌ Ошибка: ${e.message}</div>`;
            }
            if (btn) btn.disabled = false;
        };

        // ═══════════════════════════════════════════════════════════════════
        // ── РУЧНОЕ СЛИЯНИЕ АККАУНТОВ (кабинет учителя) ──────────────────
        // ═══════════════════════════════════════════════════════════════════
        // Состояние: первый выбранный ученик
        window._mergeSelectionA = null;

        window.selectStudentForMerge = function(uid, name) {
            if (!window._mergeSelectionA) {
                // Первый выбор
                window._mergeSelectionA = { uid, name };
                showToast('🔀', `Выбран: ${name}. Теперь выбери второй аккаунт`, 'bg-blue-500', 'border-blue-700');
                // Подсветить карточку
                document.querySelectorAll('[data-student-uid]').forEach(el => {
                    el.style.outline = el.dataset.studentUid === uid ? '3px solid var(--c-brand)' : '';
                });
            } else if (window._mergeSelectionA.uid === uid) {
                // Отмена выбора
                window._mergeSelectionA = null;
                showToast('❌', 'Выбор отменён', 'bg-gray-500', 'border-gray-700');
                document.querySelectorAll('[data-student-uid]').forEach(el => el.style.outline = '');
            } else {
                // Второй выбор → показываем диалог подтверждения
                const A = window._mergeSelectionA;
                const B = { uid, name };
                window._mergeSelectionA = null;
                document.querySelectorAll('[data-student-uid]').forEach(el => el.style.outline = '');

                const overlayId = 'merge-confirm-overlay';
                let ov = document.getElementById(overlayId);
                if (!ov) { ov = document.createElement('div'); ov.id = overlayId; document.body.appendChild(ov); }
                ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px';
                ov.innerHTML = `
                <div style="background:#fff;border-radius:20px;padding:24px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3)" class="dark:bg-[#1e1e1e]">
                  <h3 style="font-size:16px;font-weight:900;margin-bottom:4px;color:#111" class="dark:text-white">🔀 Объединить аккаунты?</h3>
                  <p style="font-size:11px;color:#9ca3af;margin-bottom:16px">Данные будут объединены. Это действие необратимо.</p>
                  <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
                    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 12px">
                      <div style="font-size:9px;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:2px">Аккаунт A (главный)</div>
                      <div style="font-size:13px;font-weight:900;color:#1d4ed8">${A.name}</div>
                      <div style="font-size:9px;color:#9ca3af;margin-top:1px;word-break:break-all">${A.uid}</div>
                    </div>
                    <div style="text-align:center;font-size:18px">+</div>
                    <div style="background:#fef9c3;border:1px solid var(--c-accent);border-radius:10px;padding:10px 12px">
                      <div style="font-size:9px;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:2px">Аккаунт B (поглощается)</div>
                      <div style="font-size:13px;font-weight:900;color:#854d0e">${B.name}</div>
                      <div style="font-size:9px;color:#9ca3af;margin-top:1px;word-break:break-all">${B.uid}</div>
                    </div>
                  </div>
                  <div style="font-size:10px;color:#9ca3af;margin-bottom:14px;line-height:1.5">
                    Данные объединятся (максимумы). Аккаунт B получит пометку "_mergedInto" и перестанет отображаться.
                  </div>
                  <div style="display:flex;gap:8px">
                    <button onclick="document.getElementById('${overlayId}').remove()" 
                      style="flex:1;background:#f3f4f6;color:#374151;border:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;cursor:pointer">Отмена</button>
                    <button onclick="window._doManualMerge('${A.uid}','${B.uid}');document.getElementById('${overlayId}').remove()"
                      style="flex:1;background:var(--c-brand);color:#fff;border:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;cursor:pointer">✅ Объединить</button>
                  </div>
                </div>`;
            }
        };

        window._doManualMerge = async function(uidA, uidB) {
            if (!db) return showToast('❌', 'Нет подключения', 'bg-rose-500', 'border-rose-700');
            try {
                const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                const [snapA, snapB] = await Promise.all([getDoc(doc(studentsCol, uidA)), getDoc(doc(studentsCol, uidB))]);
                const dataA = snapA.exists() ? snapA.data() : {};
                const dataB = snapB.exists() ? snapB.data() : {};
                const merged = deepMergeStates([dataA.fullStateJson, dataB.fullStateJson].filter(j => j && j.length > 10));
                const mergedJson = merged ? JSON.stringify(merged) : dataA.fullStateJson;
                const mergedTotal = merged ? (merged.stats?.totalSolvedEver || dataA.totalSolved || 0) : (dataA.totalSolved || 0);
                await setDoc(doc(studentsCol, uidA), {
                    fullStateJson: mergedJson, totalSolved: mergedTotal,
                    _mergedFrom: [...(dataA._mergedFrom || []), uidB], _mergedAt: Date.now()
                }, { merge: true });
                await setDoc(doc(studentsCol, uidB), { _mergedInto: uidA, _mergedAt: Date.now() }, { merge: true });
                showToast('✅', 'Аккаунты объединены!', 'bg-emerald-500', 'border-emerald-700');
                if (window.loadClassProgress) window.loadClassProgress();
            } catch(e) {
                console.error('[ManualMerge]', e);
                showToast('❌', 'Ошибка слияния: ' + e.message, 'bg-rose-500', 'border-rose-700');
            }
        };

        // ═══════════════════════════════════════════════════════════════════
        // ── ПИН-КОД ДЛЯ ПРИВЯЗКИ АККАУНТА ──────────────────────────────
        // ═══════════════════════════════════════════════════════════════════
        // Генерирует/возвращает 8-значный PIN для текущего аккаунта.
        // PIN хранится в Firestore и позволяет связать два устройства.
        window.getOrCreateSyncPin = async function() {
            // Ждём fbUser максимум 5 секунд
            if (!fbUser) {
                await new Promise(resolve => {
                    let attempts = 0;
                    const check = setInterval(() => {
                        attempts++;
                        if (fbUser || attempts >= 50) { clearInterval(check); resolve(); }
                    }, 100);
                });
            }
            if (!fbUser || !db) {
                showToast('❌', 'Нет соединения с сервером', 'bg-rose-500', 'border-rose-700');
                return null;
            }
            const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
            await waitForTelegramIdentity();
            const canonicalId = resolveUserId(fbUser);
            if (!canonicalId) {
                showToast('⚠️', 'Telegram ID еще не получен. Откройте приложение через кнопку бота или повторите через пару секунд.', 'bg-amber-500', 'border-amber-700');
                return null;
            }
            try {
                const snap = await getDoc(doc(studentsCol, canonicalId));
                if (snap.exists() && snap.data().syncPin) return snap.data().syncPin;
                const pin = String(Math.floor(10000000 + Math.random() * 90000000));
                await setDoc(doc(studentsCol, canonicalId), { syncPin: pin, syncPinCreated: Date.now() }, { merge: true });
                return pin;
            } catch(e) {
                console.error('[PIN]', e);
                showToast('❌', 'Ошибка: ' + (e.message || e.code || 'нет доступа'), 'bg-rose-500', 'border-rose-700');
                return null;
            }
        };

        window.showSyncPin = async function() {
            const btn = document.getElementById('sync-pin-btn');
            const display = document.getElementById('sync-pin-display');
            if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
            if (display) { display.textContent = 'Загрузка...'; display.style.color = '#9ca3af'; display.style.fontSize = '12px'; display.style.letterSpacing = 'normal'; }
            const pin = await window.getOrCreateSyncPin();
            if (btn) { btn.disabled = false; btn.textContent = '📋 Мой PIN'; }
            if (!pin) {
                if (display) { display.textContent = '— ошибка —'; display.style.color = 'var(--c-danger)'; }
                return;
            }
            if (display) {
                // Форматируем PIN как XXXX-XXXX для читаемости
                display.textContent = pin.slice(0, 4) + '-' + pin.slice(4);
                display.style.letterSpacing = '3px';
                display.style.fontSize = '20px';
                display.style.fontWeight = '900';
                display.style.color = 'var(--c-brand)';
            }
            try {
                await navigator.clipboard.writeText(pin);
                showToast('📋', 'PIN скопирован: ' + pin, 'bg-blue-500', 'border-blue-700');
            } catch(e) {
                showToast('🔑', 'Ваш PIN: ' + pin, 'bg-blue-500', 'border-blue-700');
            }
        };

        // Привязать к аккаунту по чужому PIN
        window.linkByPin = async function() {
            if (!fbUser || !db) return showToast('❌', 'Нет соединения', 'bg-rose-500', 'border-rose-700');
            const input = document.getElementById('sync-pin-input');
            const pin = input ? input.value.trim() : '';
            if (!/^\d{8}$/.test(pin)) return showToast('⚠️', 'Введите 8-значный PIN', 'bg-amber-500', 'border-amber-700');

            try {
                const studentsCol = collection(db, 'artifacts', appId, 'public', 'data', 'students');
                // Ищем документ с этим PIN
                const pinQuery = query(studentsCol, where('syncPin', '==', pin), limit(2));
                const pinSnap = await getDocs(pinQuery);
                if (pinSnap.empty) return showToast('❌', 'PIN не найден', 'bg-rose-500', 'border-rose-700');

                let targetDoc = null;
                await waitForTelegramIdentity();
                const canonicalId = resolveUserId(fbUser);
                if (!canonicalId) return showToast('⚠️', 'Telegram ID еще не получен. Повторите через пару секунд.', 'bg-amber-500', 'border-amber-700');
                pinSnap.forEach(docSnap => {
                    if (docSnap.id !== canonicalId) targetDoc = docSnap;
                });
                if (!targetDoc) return showToast('⚠️', 'Это ваш собственный PIN', 'bg-amber-500', 'border-amber-700');

                const targetData = targetDoc.data();
                // Объединяем данные: берём лучшее из двух
                const mySnap = await getDoc(doc(studentsCol, canonicalId));
                const myData = mySnap.exists() ? mySnap.data() : {};

                const mySolved = myData.totalSolved || 0;
                const theirSolved = targetData.totalSolved || 0;

                // If Telegram ID is known, keep the canonical Telegram document and merge PIN data into it.
                const preferCanonical = !!localStorage.getItem('known_tg_id');
                const keepRemote = !preferCanonical && theirSolved > mySolved;
                const keepId   = keepRemote ? targetDoc.id : canonicalId;
                const absorbId = keepRemote ? canonicalId   : targetDoc.id;
                const keepData = keepRemote ? targetData : myData;
                const absData  = keepRemote ? myData : targetData;

                const merged = deepMergeStates([keepData.fullStateJson, absData.fullStateJson].filter(j => j && j.length > 10));
                const mergedJson = merged ? JSON.stringify(merged) : keepData.fullStateJson;
                const mergedTotal = merged ? (merged.stats?.totalSolvedEver || Math.max(mySolved, theirSolved)) : Math.max(mySolved, theirSolved);

                await setDoc(doc(studentsCol, keepId), {
                    fullStateJson: mergedJson, totalSolved: mergedTotal,
                    _mergedFrom: [...(keepData._mergedFrom || []), absorbId],
                    _mergedAt: Date.now(), syncPin: keepData.syncPin || targetData.syncPin || '',
                    tgId: localStorage.getItem('known_tg_id') || (/^\d+$/.test(keepId) ? keepId : ''),
                    knownTgId: localStorage.getItem('known_tg_id') || '',
                    canonicalId: keepId,
                    identitySource: getIdentitySource(keepId),
                    googleEmail: localStorage.getItem('google_email') || keepData.googleEmail || targetData.googleEmail || '',
                    knownGoogleId: localStorage.getItem('google_uid') ? 'google_' + localStorage.getItem('google_uid') : (keepData.knownGoogleId || targetData.knownGoogleId || '')
                }, { merge: true });
                await setDoc(doc(studentsCol, absorbId), { _mergedInto: keepId, _mergedAt: Date.now() }, { merge: true });

                // Если наш аккаунт поглощён — обновляем stable_student_id
                if (absorbId === canonicalId) {
                    localStorage.setItem('stable_student_id', keepId);
                    if (/^\d+$/.test(keepId)) localStorage.setItem('known_tg_id', keepId);
                }

                // Загружаем объединённые данные
                if (merged) {
                    applyMergedState(merged);
                }

                showToast('✅', 'Аккаунты успешно привязаны!', 'bg-emerald-500', 'border-emerald-700');
                if (input) input.value = '';
                if (window.updateGlobalUI) window.updateGlobalUI();
                if (window.updateProgressBars) window.updateProgressBars();
            } catch(e) {
                console.error('[PIN link]', e);
                showToast('❌', 'Ошибка: ' + e.message, 'bg-rose-500', 'border-rose-700');
            }
        };
